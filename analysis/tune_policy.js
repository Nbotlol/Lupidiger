/* Fine-tune the recommendation policy to maximize both >30 win rate, 16-cell full clear rate, and avg final score. */
require('./engine.js');
const MG = globalThis.MG;
const { R, C, N, K, SCORE, COLOR, COLOR_SCORE, NB, PLACEMENTS, beliefFromColorMarks, analyze } = MG;

function oneStepLookahead(belief, revealedMask, cell, cellStat) {
  const bit = 1 << cell;
  const buckets = { g: [], b: [], r: [] };
  for (let k = 0; k < belief.length; k++) {
    const p = belief[k];
    if (p.mask & bit) continue;
    buckets[COLOR[p.cnt[cell]]].push(p);
  }
  const safeTotal = cellStat.safe;
  if (!safeTotal) return { expZeroSafe: 0, expNextSurvive: 0, infoGain: 0 };

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

    let orMask = 0;
    for (let k = 0; k < m; k++) orMask |= sub[k].mask;
    const zeroSafeMask = (~orMask) & (~nextMask) & ((1 << N) - 1);
    let zeroCnt = 0;
    for (let i = 0; i < N; i++) if (zeroSafeMask & (1 << i)) zeroCnt++;
    expZeroSafe += w * zeroCnt;

    if (zeroCnt > 0) {
      expNextSurvive += w * 1.0;
    } else {
      const mineCounts = new Int32Array(N);
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

function evalPolicy(name, fn) {
  const pool = PLACEMENTS.filter(p => !(p.mask & 1));
  let pass30 = 0, cleared = 0, totalScore = 0, totalCells = 0;
  for (const layout of pool) {
    const marks = new Map();
    let score = 0, busted = false;
    for (let step = 1; step <= 16; step++) {
      const belief = beliefFromColorMarks(marks);
      const mask = [...marks.keys()].reduce((m, idx) => m | (1 << idx), 0);
      const stats = analyze(belief, mask);
      const cell = fn(belief, stats, mask, score);
      if (layout.mask & (1 << cell)) { busted = true; break; }
      const col = COLOR[layout.cnt[cell]];
      score += COLOR_SCORE[col];
      marks.set(cell, col);
    }
    if (score > 30) pass30++;
    if (!busted) cleared++;
    totalScore += score;
    totalCells += marks.size;
  }
  console.log(
    `${name.padEnd(24,' ')} => >30: ${(pass30/pool.length*100).toFixed(2)}% | ` +
    `clear: ${(cleared/pool.length*100).toFixed(2)}% | ` +
    `avgScore: ${(totalScore/pool.length).toFixed(2)} | ` +
    `avgCells: ${(totalCells/pool.length).toFixed(2)}`
  );
}

// Hybrid 1: Among tied min-p cells, score = expZeroSafe * 100 + expNextSurvive * 200 + pGreen * 80 + infoGain * 20 + ev
evalPolicy('hybrid_zero_pGreen', (belief, stats, mask) => {
  if (!mask) return 0;
  let minP = 1, zeros = [];
  for (let i = 0; i < N; i++) {
    const s = stats[i]; if (!s || !s.n) continue;
    if (s.p === 0) zeros.push(i);
    if (s.p < minP - 1e-12) minP = s.p;
  }
  if (zeros.length) {
    zeros.sort((a, b) => stats[b].ev - stats[a].ev);
    return zeros[0];
  }
  let cands = [];
  for (let i = 0; i < N; i++) {
    const s = stats[i]; if (!s || !s.n) continue;
    if (Math.abs(s.p - minP) < 1e-12) cands.push(i);
  }
  if (cands.length === 1) return cands[0];
  let best = cands[0], bestVal = -1e9;
  for (const i of cands) {
    const s = stats[i];
    const la = oneStepLookahead(belief, mask, i, s);
    const val = la.expZeroSafe * 120 + la.expNextSurvive * 250 + s.pGreen * 90 + la.infoGain * 25 + s.ev * 0.5;
    if (val > bestVal) { bestVal = val; best = i; }
  }
  return best;
});

// Hybrid 2: Also consider when score is close to 30 vs far from 30
evalPolicy('hybrid_stage_aware', (belief, stats, mask, score) => {
  if (!mask) return 0;
  let minP = 1, zeros = [];
  for (let i = 0; i < N; i++) {
    const s = stats[i]; if (!s || !s.n) continue;
    if (s.p === 0) zeros.push(i);
    if (s.p < minP - 1e-12) minP = s.p;
  }
  if (zeros.length) {
    zeros.sort((a, b) => stats[b].ev - stats[a].ev);
    return zeros[0];
  }
  let cands = [];
  for (let i = 0; i < N; i++) {
    const s = stats[i]; if (!s || !s.n) continue;
    if (Math.abs(s.p - minP) < 1e-12) cands.push(i);
  }
  if (cands.length === 1) return cands[0];
  let best = cands[0], bestVal = -1e9;
  for (const i of cands) {
    const s = stats[i];
    const la = oneStepLookahead(belief, mask, i, s);
    // If one click can push us over 30 (e.g. score + 5 > 30 and pBlue+pRed is high), give slight bonus
    const reach30Prob = (score + 1 > 30 ? s.pGreen : 0) + (score + 5 > 30 ? s.pBlue : 0) + (score + 20 > 30 ? s.pRed : 0);
    const stageBonus = (score <= 30) ? reach30Prob * 25 : 0;
    const val = la.expZeroSafe * 140 + la.expNextSurvive * 220 + s.pGreen * 100 + la.infoGain * 20 + stageBonus + s.ev * 0.4;
    if (val > bestVal) { bestVal = val; best = i; }
  }
  return best;
});
