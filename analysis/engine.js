/* Shared engine for the 4x5 / 4-mine color-only scoring game & assistant solver.
 * Works in Node and in the browser (attaches to globalThis.MG). */
(function (root) {
  const R = 4, C = 5, N = R * C, K = 4;
  const SCORE = [1, 5, 5, 20, 20];       // index = adjacent mine count
  const COLOR = ['g', 'b', 'b', 'r', 'r']; // css class per adjacent mine count
  const COLOR_SCORE = { g: 1, b: 5, r: 20 };

  const NB = [];
  for (let i = 0; i < N; i++) {
    const r = (i / C) | 0, c = i % C;
    const list = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < R && cc >= 0 && cc < C) list.push(rr * C + cc);
    }
    NB.push(list);
  }

  function colorOfCount(cnt) {
    return COLOR[cnt];
  }

  // ---- all C(20,4) mine layouts -------------------------------------------------
  const PLACEMENTS = [];
  (function gen(start, left, mask) {
    if (left === 0) {
      const cnt = new Int8Array(N);
      let maxScore = 0;
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (const j of NB[i]) if (mask & (1 << j)) s++;
        cnt[i] = s;
        if (!(mask & (1 << i))) maxScore += SCORE[s];
      }
      PLACEMENTS.push({ mask, cnt, maxScore });
      return;
    }
    for (let i = start; i <= N - left; i++) gen(i + 1, left - 1, mask | (1 << i));
  })(0, K, 0);

  /**
   * Keep only layouts matching the observed COLOR of `cell`
   * ('g' => 0 mines, 'b' => 1 or 2 mines, 'r' => 3 or 4 mines).
   * Notice we NEVER know whether 'b' is 1 or 2, or whether 'r' is 3 or 4.
   */
  function filterBelief(belief, cell, obs) {
    const col = typeof obs === 'string' ? obs : COLOR[obs];
    const bit = 1 << cell, out = [];
    for (let k = 0; k < belief.length; k++) {
      const p = belief[k];
      if (!(p.mask & bit) && COLOR[p.cnt[cell]] === col) out.push(p);
    }
    return out;
  }

  /**
   * Build the exact belief set from a Map or Array/Object of cell -> color ('g'|'b'|'r'),
   * using ONLY color range constraints (g: 0, b: 1..2, r: 3..4).
   */
  function beliefFromColorMarks(marks) {
    const entries = marks instanceof Map
      ? [...marks.entries()]
      : Object.entries(marks).map(([k, v]) => [Number(k), v]);
    let b = PLACEMENTS;
    for (let idx = 0; idx < entries.length; idx++) {
      const cell = entries[idx][0];
      const col = entries[idx][1];
      if (col === 'g' || col === 'b' || col === 'r') {
        b = filterBelief(b, cell, col);
      }
    }
    return b;
  }

  function beliefWithout(belief, cell) {
    const bit = 1 << cell, out = [];
    for (let k = 0; k < belief.length; k++) if (!(belief[k].mask & bit)) out.push(belief[k]);
    return out;
  }

  /** Per-cell statistics for the current belief. */
  function analyze(belief, revealedMask) {
    const n = belief.length, out = new Array(N);
    const hist = new Float64Array(5);
    for (let i = 0; i < N; i++) {
      if (revealedMask & (1 << i)) { out[i] = null; continue; }
      let mines = 0;
      hist.fill(0);
      for (let k = 0; k < n; k++) {
        const p = belief[k];
        if (p.mask & (1 << i)) mines++;
        else hist[p.cnt[i]]++;
      }
      const safe = n - mines;
      let ev = 0;
      if (safe) for (let c = 0; c <= 4; c++) ev += hist[c] * SCORE[c] / safe;
      out[i] = {
        p: n ? mines / n : 0,
        ev,
        safe,
        n,
        pGreen: safe ? hist[0] / safe : 0,
        pBlue: safe ? (hist[1] + hist[2]) / safe : 0,
        pRed: safe ? (hist[3] + hist[4]) / safe : 0
      };
    }
    return out;
  }

  /**
   * 1-step information & safe-cell unlocking lookahead:
   * Simulates observing 'g', 'b', or 'r' on `cell` and computes:
   * - expZeroSafe: expected number of 0%-risk (guaranteed safe) cells unlocked on the next board
   * - expNextSurvive: expected survival probability on the subsequent move
   * - infoGain: expected Shannon entropy reduction (bits) on the remaining mine layouts
   */
  function oneStepLookahead(belief, revealedMask, cell, cellStat) {
    if (!belief || !belief.length || !cellStat || !cellStat.safe) {
      return { expZeroSafe: 0, expNextSurvive: 0, infoGain: 0 };
    }
    const bit = 1 << cell;
    const buckets = { g: [], b: [], r: [] };
    for (let k = 0; k < belief.length; k++) {
      const p = belief[k];
      if (p.mask & bit) continue;
      buckets[COLOR[p.cnt[cell]]].push(p);
    }
    const safeTotal = cellStat.safe;
    let expZeroSafe = 0;
    let expNextSurvive = 0;
    let entropyAfter = 0;
    const nextMask = revealedMask | bit;
    const allMask = (1 << N) - 1;

    for (const col of ['g', 'b', 'r']) {
      const sub = buckets[col];
      const m = sub.length;
      if (!m) continue;
      const w = m / safeTotal;
      entropyAfter += w * Math.log2(m);

      let orMask = 0;
      for (let k = 0; k < m; k++) orMask |= sub[k].mask;
      const zeroSafeMask = (~orMask) & (~nextMask) & allMask;
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

  /**
   * Lookahead-enhanced recommendation policy:
   * 1. On an empty board (revealedMask === 0), recommend a corner cell (49.1% Green rate).
   * 2. If one or more 0% guaranteed-safe cells exist, pick one (preferring higher expected score).
   * 3. When forced to guess among lowest-mine-probability cells, do NOT blindly greedily chase
   *    high-degree interior cells (which have only 5% Green rate and leave the player trapped).
   *    Instead, evaluate 1-step lookahead (expected 0%-safe cells unlocked + next-step survival +
   *    probability of opening a Green 0-mine region + information gain).
   */
  function recommend(stats, revealedMask, belief) {
    if (!revealedMask) {
      const s0 = stats[0];
      if (s0) return { cell: 0, ...s0, expZeroSafe: 1.47, infoGain: 1.0, reason: 'open-corner' };
    }
    let zeros = [], minP = 1;
    for (let i = 0; i < N; i++) {
      const s = stats[i];
      if (!s || !s.n) continue;
      if (s.p === 0) zeros.push(i);
      if (s.p < minP - 1e-12) minP = s.p;
    }

    if (zeros.length > 0) {
      let best = zeros[0];
      for (let k = 1; k < zeros.length; k++) {
        const i = zeros[k];
        if (stats[i].ev > stats[best].ev + 1e-12) best = i;
      }
      const la = belief ? oneStepLookahead(belief, revealedMask, best, stats[best]) : { expZeroSafe: 0, infoGain: 0 };
      return { cell: best, ...stats[best], ...la, reason: 'guaranteed-safe' };
    }

    // Collect all cells tied for minimum mine probability
    let cands = [];
    for (let i = 0; i < N; i++) {
      const s = stats[i];
      if (!s || !s.n) continue;
      if (Math.abs(s.p - minP) < 1e-12) cands.push(i);
    }
    if (!cands.length) return null;

    let bestCell = cands[0], bestVal = -1e9, bestLa = { expZeroSafe: 0, expNextSurvive: 0, infoGain: 0 };
    for (let k = 0; k < cands.length; k++) {
      const i = cands[k];
      const s = stats[i];
      const la = (belief && cands.length > 1)
        ? oneStepLookahead(belief, revealedMask, i, s)
        : { expZeroSafe: s.pGreen * 3, expNextSurvive: 1 - s.p, infoGain: 0 };
      const val = la.expZeroSafe * 140 + la.expNextSurvive * 250 + s.pGreen * 100 + la.infoGain * 25 + s.ev * 0.4;
      if (val > bestVal) {
        bestVal = val;
        bestCell = i;
        bestLa = la;
      }
    }
    return { cell: bestCell, ...stats[bestCell], ...bestLa, reason: 'lowest-risk-lookahead' };
  }

  root.MG = {
    R, C, N, K, SCORE, COLOR, COLOR_SCORE, NB, PLACEMENTS,
    colorOfCount, filterBelief, beliefFromColorMarks, beliefWithout,
    analyze, oneStepLookahead, recommend
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
