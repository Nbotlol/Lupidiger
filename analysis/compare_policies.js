/* Compare candidate tie-breaking / lookahead policies over all 3876 safe-first-click layouts. */
require('./engine.js');
const MG = globalThis.MG;
const { R, C, N, K, SCORE, COLOR, COLOR_SCORE, NB, PLACEMENTS, filterBelief, beliefFromColorMarks, analyze } = MG;

// Precompute degree (number of neighbors)
const DEG = NB.map(l => l.length);

// 1-step information / safe-unlocking lookahead for tied lowest-risk cells
function oneStepLookahead(belief, revealedMask, cell, cellStat) {
  // If we click `cell` and survive, we observe 'g', 'b', or 'r'
  // Fast partition of belief where cell is safe into g, b, r buckets
  const bit = 1 << cell;
  const buckets = { g: [], b: [], r: [] };
  for (let k = 0; k < belief.length; k++) {
    const p = belief[k];
    if (p.mask & bit) continue;
    buckets[COLOR[p.cnt[cell]]].push(p);
  }
  const safeTotal = cellStat.safe;
  if (!safeTotal) return { expZeroSafe: 0, expNextMinRisk: 1, infoGain: 0 };

  let expZeroSafe = 0;
  let expNextSurvive = 0;
  let entropyAfter = 0;
  const nextMask = revealedMask | bit;

  for (const col of ['g', 'b', 'r']) {
    const sub = buckets[col];
    const m = sub.length;
    if (!m) continue;
    const w = m / safeTotal;
    entropyAfter += w * Math.log2(m);

    // Count how many unrevealed cells become 0% mine risk (or what the minimum mine risk is) in `sub`
    // Using bitwise OR of all masks in `sub`: any bit that is 0 in `orMask` has 0 mines across all layouts in `sub`!
    let orMask = 0;
    const mineCounts = new Int32Array(N);
    for (let k = 0; k < m; k++) {
      const pm = sub[k].mask;
      orMask |= pm;
    }
    const zeroSafeMask = (~orMask) & (~nextMask) & ((1 << N) - 1);
    let zeroCnt = 0;
    for (let i = 0; i < N; i++) if (zeroSafeMask & (1 << i)) zeroCnt++;
    expZeroSafe += w * zeroCnt;

    if (zeroCnt > 0) {
      expNextSurvive += w * 1.0;
    } else {
      // Find minimum mine probability in `sub`
      for (let k = 0; k < m; k++) {
        const pm = sub[k].mask;
        for (let i = 0; i < N; i++) if (pm & (1 << i)) mineCounts[i]++;
      }
      let minP = 1;
      for (let i = 0; i < N; i++) {
        if (nextMask & (1 << i)) continue;
        const p = mineCounts[i] / m;
        if (p < minP) minP = p;
      }
      expNextSurvive += w * (1 - minP);
    }
  }

  const infoGain = Math.log2(safeTotal) - entropyAfter;
  return { expZeroSafe, expNextSurvive, infoGain };
}

function makePolicy(mode) {
  return function pick(belief, stats, revealedMask) {
    if (!revealedMask) return 0; // top-left corner

    // 1. Check if there are any 0% guaranteed safe cells
    let zeros = [];
    let minP = 1;
    for (let i = 0; i < N; i++) {
      const s = stats[i];
      if (!s || !s.n) continue;
      if (s.p === 0) zeros.push(i);
      if (s.p < minP - 1e-12) minP = s.p;
    }

    if (zeros.length > 0) {
      if (zeros.length === 1) return zeros[0];
      if (mode === 'old_ev') {
        zeros.sort((a, b) => stats[b].ev - stats[a].ev);
        return zeros[0];
      }
      // Lookahead among 0% safe cells: since ALL 0% cells stay 0% until clicked,
      // does clicking order among 0% cells matter?
      // YES! Because a 0% cell might reveal information that turns currently risky cells into NEW 0% cells,
      // AND we will click all 0% cells anyway! Wait: if we click ALL 0% cells anyway, their order doesn't change
      // the set of revealed 0% cells before we have to make a risky guess!
      // Still, picking the 0% cell with highest EV first gets us >30 faster.
      zeros.sort((a, b) => stats[b].ev - stats[a].ev);
      return zeros[0];
    }

    // 2. No 0% cell exists: we must pick among cells near minP
    let cands = [];
    for (let i = 0; i < N; i++) {
      const s = stats[i];
      if (!s || !s.n) continue;
      if (Math.abs(s.p - minP) < 1e-12) cands.push(i);
    }

    if (cands.length === 1 || mode === 'old_ev') {
      cands.sort((a, b) => stats[b].ev - stats[a].ev);
      return cands[0];
    }

    if (mode === 'pGreen') {
      cands.sort((a, b) => (stats[b].pGreen - stats[a].pGreen) || (stats[b].ev - stats[a].ev));
      return cands[0];
    }

    if (mode === 'lookahead_survive') {
      let bestCell = cands[0], bestScore = -1e9;
      for (const i of cands) {
        const la = oneStepLookahead(belief, revealedMask, i, stats[i]);
        // Prioritize 2-step survival probability, then expected 0%-safe cells unlocked, then infoGain, then EV
        const val = la.expNextSurvive * 1000 + la.expZeroSafe * 40 + la.infoGain * 10 + stats[i].ev * 0.2;
        if (val > bestScore) { bestScore = val; bestCell = i; }
      }
      return bestCell;
    }

    if (mode === 'lookahead_all_near') {
      // Consider any cell within +2% of minP if its 2-step survival is higher!
      let near = [];
      for (let i = 0; i < N; i++) {
        const s = stats[i];
        if (!s || !s.n) continue;
        if (s.p <= minP + 0.035) near.push(i);
      }
      let bestCell = near[0], bestScore = -1e9;
      for (const i of near) {
        const s = stats[i];
        const la = oneStepLookahead(belief, revealedMask, i, s);
        const twoStepSurvive = (1 - s.p) * la.expNextSurvive;
        const val = twoStepSurvive * 1000 + (1 - s.p) * la.expZeroSafe * 35 + (1 - s.p) * la.infoGain * 12 + (1 - s.p) * s.ev * 0.15;
        if (val > bestScore) { bestScore = val; bestCell = i; }
      }
      return bestCell;
    }
  };
}

const pool = PLACEMENTS.filter(p => !(p.mask & 1));
for (const mode of ['old_ev', 'pGreen', 'lookahead_survive', 'lookahead_all_near']) {
  const picker = makePolicy(mode);
  let pass30 = 0, cleared = 0, totalScore = 0, step2Booms = 0, totalSafeOpened = 0;
  const t0 = Date.now();
  for (const layout of pool) {
    const marks = new Map();
    let score = 0, busted = false;
    for (let step = 1; step <= 16; step++) {
      const belief = beliefFromColorMarks(marks);
      const mask = [...marks.keys()].reduce((m, idx) => m | (1 << idx), 0);
      const stats = analyze(belief, mask);
      const cell = picker(belief, stats, mask);
      if (layout.mask & (1 << cell)) {
        busted = true;
        if (step === 2) step2Booms++;
        break;
      }
      const col = COLOR[layout.cnt[cell]];
      score += COLOR_SCORE[col];
      marks.set(cell, col);
    }
    if (score > 30) pass30++;
    if (!busted) cleared++;
    totalScore += score;
    totalSafeOpened += marks.size;
  }
  console.log(
    `Policy [${mode.padEnd(18, ' ')}]: >30 win=${(pass30/pool.length*100).toFixed(2)}% | ` +
    `16-clear=${(cleared/pool.length*100).toFixed(2)}% | avgScore=${(totalScore/pool.length).toFixed(2)} | ` +
    `avgCells=${(totalSafeOpened/pool.length).toFixed(2)} | (${Date.now()-t0}ms)`
  );
}
