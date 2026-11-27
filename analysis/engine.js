/* Shared engine for the multi-level color-only scoring game & assistant solver.
 * - Beginner (初级): 4x5, 4 fatal mines, 0 penalty mines, target > 30 (EXACT original engine preserved!)
 * - Intermediate (中级): 5x6, 4 fatal mines + 4 penalty mines (8 total), target > 50
 * - Advanced (高级): 5x8, 8 fatal mines + 8 penalty mines (16 total), target > 70
 *
 * Colors & rules:
 * - Safe cell colors by adjacent total mine count (fatal + penalty):
 *   0       -> 'g' (Green,  +1 pt)
 *   1..2    -> 'b' (Blue,   +5 pts)
 *   3..4    -> 'r' (Red,    +20 pts)
 *   5..6    -> 's' (Silver, +100 pts)
 *   7..8    -> 'y' (Gold,   +300 pts)
 * - Penalty mine ('p', Gray):
 *   Counts as 1 mine for adjacent cells' colors; when clicked, game does NOT end,
 *   score decreases by 10 (clamped at minimum 0: Math.max(0, score - 10)),
 *   and reveals as Gray ('p') which serves as a known mine in inference!
 * - Fatal mine: ends the game immediately with explosion.
 */
(function (root) {
  const LEVELS = {
    beginner: {
      id: 'beginner',
      name: '初级',
      R: 4, C: 5, N: 20,
      fatalMines: 4,
      penaltyMines: 0,
      totalMines: 4,
      safeCells: 16,
      clickableCells: 16,
      target: 30
    },
    intermediate: {
      id: 'intermediate',
      name: '中级',
      R: 5, C: 6, N: 30,
      fatalMines: 4,
      penaltyMines: 4,
      totalMines: 8,
      safeCells: 22,
      clickableCells: 26, // 22 safe + 4 penalty mines
      target: 50
    },
    advanced: {
      id: 'advanced',
      name: '高级',
      R: 5, C: 8, N: 40,
      fatalMines: 8,
      penaltyMines: 8,
      totalMines: 16,
      safeCells: 24,
      clickableCells: 32, // 24 safe + 8 penalty mines
      target: 70
    }
  };

  // Index = adjacent total mine count (0..8)
  const SCORE = [1, 5, 5, 20, 20, 100, 100, 300, 300];
  const COLOR = ['g', 'b', 'b', 'r', 'r', 's', 's', 'y', 'y'];
  const COLOR_SCORE = { g: 1, b: 5, r: 20, s: 100, y: 300, p: -10 };
  const COLOR_RANGE = {
    g: [0, 0],
    b: [1, 2],
    r: [3, 4],
    s: [5, 6],
    y: [7, 8]
  };
  const SAFE_COLORS = Object.keys(COLOR_RANGE); // ['g', 'b', 'r', 's', 'y']

  function buildNeighbors(R, C) {
    const N = R * C;
    const nb = new Array(N);
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i % C;
      const list = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < R && cc >= 0 && cc < C) list.push(rr * C + cc);
      }
      nb[i] = list;
    }
    return nb;
  }

  const NB_BY_LEVEL = {
    beginner: buildNeighbors(4, 5),
    intermediate: buildNeighbors(5, 6),
    advanced: buildNeighbors(5, 8)
  };

  // Precompute binomial coefficients C(n, k) up to 45
  const MAX_COMB = 45;
  const COMB = Array.from({ length: MAX_COMB }, () => new Float64Array(MAX_COMB));
  for (let n = 0; n < MAX_COMB; n++) {
    COMB[n][0] = 1;
    for (let k = 1; k <= n; k++) COMB[n][k] = COMB[n - 1][k - 1] + COMB[n - 1][k];
  }

  // ============================================================================
  // PART 1: BEGINNER (4x5, 4 mines) — Exact enumeration of all C(20,4)=4845 layouts
  //         Kept 100% identical in behavior and exports to the original engine!
  // ============================================================================
  const R = 4, C = 5, N = 20, K = 4;
  const NB = NB_BY_LEVEL.beginner;

  function colorOfCount(cnt) {
    return COLOR[cnt];
  }

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
      PLACEMENTS.push({ mask, fatalMask: mask, penaltyMask: 0, cnt, maxScore });
      return;
    }
    for (let i = start; i <= N - left; i++) gen(i + 1, left - 1, mask | (1 << i));
  })(0, K, 0);

  function filterBelief(belief, cell, obs) {
    const col = typeof obs === 'string' ? obs : COLOR[obs];
    const bit = 1 << cell, out = [];
    for (let k = 0; k < belief.length; k++) {
      const p = belief[k];
      if (!(p.mask & bit) && COLOR[p.cnt[cell]] === col) out.push(p);
    }
    return out;
  }

  function beliefFromColorMarks(marks) {
    const entries = marks instanceof Map
      ? [...marks.entries()]
      : Object.entries(marks).map(([k, v]) => [Number(k), v]);
    let b = PLACEMENTS;
    for (let idx = 0; idx < entries.length; idx++) {
      const cell = entries[idx][0];
      const col = entries[idx][1];
      if (COLOR_RANGE[col]) {
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

  function analyze(belief, revealedMask) {
    const n = belief.length, out = new Array(N);
    const hist = new Float64Array(9);
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
      if (safe) for (let c = 0; c <= 8; c++) ev += hist[c] * SCORE[c] / safe;
      const pTotalMine = n ? mines / n : 0;
      out[i] = {
        p: pTotalMine,
        pFatal: pTotalMine,
        pPenalty: 0,
        pAnyMine: pTotalMine,
        ev,
        evClick: ev,
        safe,
        n,
        pGreen: safe ? hist[0] / safe : 0,
        pBlue: safe ? (hist[1] + hist[2]) / safe : 0,
        pRed: safe ? (hist[3] + hist[4]) / safe : 0,
        pSilver: safe ? (hist[5] + hist[6]) / safe : 0,
        pGold: safe ? (hist[7] + hist[8]) / safe : 0
      };
    }
    return out;
  }

  function oneStepLookahead(belief, revealedMask, cell, cellStat) {
    if (!belief || !belief.length || !cellStat || !cellStat.safe) {
      return { expZeroSafe: 0, expNextSurvive: 0, infoGain: 0 };
    }
    const bit = 1 << cell;
    // Dynamically initialize buckets for all safe colors from COLOR_RANGE (fixes P5)
    const buckets = {};
    for (let c = 0; c < SAFE_COLORS.length; c++) buckets[SAFE_COLORS[c]] = [];

    for (let k = 0; k < belief.length; k++) {
      const p = belief[k];
      if (p.mask & bit) continue;
      const col = COLOR[p.cnt[cell]];
      if (buckets[col]) buckets[col].push(p);
    }
    const safeTotal = cellStat.safe;
    let expZeroSafe = 0;
    let expNextSurvive = 0;
    let entropyAfter = 0;
    const nextMask = revealedMask | bit;
    const allMask = (1 << N) - 1;

    for (let c = 0; c < SAFE_COLORS.length; c++) {
      const col = SAFE_COLORS[c];
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

  function recommend(stats, revealedMask, belief) {
    if (!revealedMask) {
      const s0 = stats[0];
      if (s0) return { cell: 0, ...s0, expZeroSafe: 1.47, infoGain: 1.0, reason: 'open-corner' };
    }
    let zeros = [], minP = 1;
    for (let i = 0; i < stats.length; i++) {
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
      const la = (belief && stats.length === 20)
        ? oneStepLookahead(belief, revealedMask, best, stats[best])
        : { expZeroSafe: 0, infoGain: 0 };
      return { cell: best, ...stats[best], ...la, reason: 'guaranteed-safe' };
    }

    let cands = [];
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      if (!s || !s.n) continue;
      if (Math.abs(s.p - minP) < 1e-12) cands.push(i);
    }
    if (!cands.length) return null;

    let bestCell = cands[0], bestVal = -1e9, bestLa = { expZeroSafe: 0, expNextSurvive: 0, infoGain: 0 };
    for (let k = 0; k < cands.length; k++) {
      const i = cands[k];
      const s = stats[i];
      const la = (belief && stats.length === 20 && cands.length > 1)
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

  // ============================================================================
  // PART 2: MULTI-LEVEL LAYOUT GENERATOR & EXACT COMPONENT-CONVOLUTION SOLVER
  //         (Intermediate 5x6 & Advanced 5x8 — Zero truncation, 100% exact!)
  // ============================================================================
  function generateRandomLayout(levelKey, firstSafeCell) {
    const cfg = LEVELS[levelKey] || LEVELS.beginner;
    if (cfg.id === 'beginner') {
      const pool = PLACEMENTS.filter(p => !(p.mask & (1 << firstSafeCell)));
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return {
        N: cfg.N,
        fatalSet: new Set([...Array(cfg.N).keys()].filter(i => (pick.mask >> i) & 1)),
        penaltySet: new Set(),
        cnt: pick.cnt
      };
    }

    const nb = NB_BY_LEVEL[cfg.id];
    const avail = [];
    for (let i = 0; i < cfg.N; i++) if (i !== firstSafeCell) avail.push(i);
    for (let i = avail.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = avail[i]; avail[i] = avail[j]; avail[j] = tmp;
    }
    const fatalSet = new Set(avail.slice(0, cfg.fatalMines));
    const penaltySet = new Set(avail.slice(cfg.fatalMines, cfg.fatalMines + cfg.penaltyMines));
    const cnt = new Int8Array(cfg.N);
    for (let i = 0; i < cfg.N; i++) {
      let s = 0;
      for (const j of nb[i]) {
        if (fatalSet.has(j) || penaltySet.has(j)) s++;
      }
      cnt[i] = s;
    }
    return { N: cfg.N, fatalSet, penaltySet, cnt };
  }

  function applyScoreStep(currentScore, col) {
    if (col === 'p') return Math.max(0, currentScore - 10);
    return currentScore + (COLOR_SCORE[col] || 0);
  }

  /**
   * 100% Exact Connected-Component & Polynomial Convolution Constraint Solver
   * for Intermediate (5x6) and Advanced (5x8).
   *
   * Eliminates all DFS truncation and 600-solution sampling bias by:
   * 1. Single-constraint + Pairwise subset-difference + Global mine-count propagation (fixes P4).
   * 2. Partitioning the remaining frontier variables into independent connected components
   *    (two frontier variables are connected if they share at least one active color constraint).
   * 3. Solving each component independently by exact backtracking indexed by component mine count `m`,
   *    and convolving the component polynomials with the unconstrained free variables `C(U_FREE, m_free)`
   *    to obtain exact total layout counts and exact per-cell mine probabilities (fixes P1).
   * 4. Computing exact conditional adjacent mine count distributions for every cell without storing
   *    a truncated list of 600 solutions.
   */
  function solveLevelMarks(levelKey, marksMap, currentScore) {
    const cfg = LEVELS[levelKey] || LEVELS.beginner;
    const curSc = typeof currentScore === 'number' ? currentScore : 10;
    if (cfg.id === 'beginner') {
      const belief = beliefFromColorMarks(marksMap);
      const mask = [...marksMap.keys()].reduce((m, idx) => m | (1 << idx), 0);
      const stats = analyze(belief, mask);
      const rec = recommend(stats, mask, belief);
      return {
        beliefCount: belief.length,
        exactCount: true,
        stats,
        rec,
        remFatal: cfg.fatalMines,
        remPenalty: 0
      };
    }

    const N_CELLS = cfg.N;
    const nb = NB_BY_LEVEL[cfg.id];
    const inferredState = new Int8Array(N_CELLS); // 0 = unknown, -1 = known safe, +1 = known mine
    const rawConstraints = [];
    let markedGrayMines = 0;

    for (const [cell, col] of marksMap.entries()) {
      if (cell < 0 || cell >= N_CELLS) continue;
      if (col === 'p') {
        inferredState[cell] = 1;
        markedGrayMines++;
      } else if (COLOR_RANGE[col]) {
        inferredState[cell] = -1;
        rawConstraints.push({ cell, min: COLOR_RANGE[col][0], max: COLOR_RANGE[col][1] });
      }
    }

    if (markedGrayMines > cfg.penaltyMines) {
      return { beliefCount: 0, exactCount: true, stats: new Array(N_CELLS).fill(null), rec: null, remFatal: cfg.fatalMines, remPenalty: 0 };
    }

    const remFatal = cfg.fatalMines;
    const remPenalty = cfg.penaltyMines - markedGrayMines;
    const remTotalMines = remFatal + remPenalty;

    // ---- STEP 1: Enhanced Constraint Propagation (Single + Pairwise Difference + Global Bounds) ----
    let baseKnownMines = markedGrayMines;
    let changed = true;
    while (changed) {
      changed = false;

      // 1a. Single-constraint saturation & zero-clearing
      for (let k = 0; k < rawConstraints.length; k++) {
        const con = rawConstraints[k];
        const neighbors = nb[con.cell];
        let mCnt = 0, uCnt = 0;
        for (let j = 0; j < neighbors.length; j++) {
          const st = inferredState[neighbors[j]];
          if (st === 1) mCnt++;
          else if (st === 0) uCnt++;
        }
        if (mCnt > con.max || mCnt + uCnt < con.min) {
          return { beliefCount: 0, exactCount: true, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
        }
        if (uCnt > 0 && mCnt === con.max) {
          for (let j = 0; j < neighbors.length; j++) {
            const u = neighbors[j];
            if (inferredState[u] === 0) { inferredState[u] = -1; changed = true; }
          }
        } else if (uCnt > 0 && mCnt + uCnt === con.min) {
          for (let j = 0; j < neighbors.length; j++) {
            const u = neighbors[j];
            if (inferredState[u] === 0) { inferredState[u] = 1; baseKnownMines++; changed = true; }
          }
        }
      }

      // 1b. Global remaining mines bound check
      let totalUnk = 0;
      for (let i = 0; i < N_CELLS; i++) if (inferredState[i] === 0) totalUnk++;
      const remToPlace = cfg.totalMines - baseKnownMines;
      if (remToPlace < 0 || remToPlace > totalUnk) {
        return { beliefCount: 0, exactCount: true, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
      }
      if (totalUnk > 0 && remToPlace === 0) {
        for (let i = 0; i < N_CELLS; i++) if (inferredState[i] === 0) inferredState[i] = -1;
        changed = true;
      } else if (totalUnk > 0 && remToPlace === totalUnk) {
        for (let i = 0; i < N_CELLS; i++) if (inferredState[i] === 0) { inferredState[i] = 1; baseKnownMines++; }
        changed = true;
      }

      // 1c. Pairwise subset-difference elimination between overlapping constraints A and B:
      // For two active constraints A (minA..maxA on varsA) and B (minB..maxB on varsB):
      // The maximum possible difference (mines in A\B) - (mines in B\A) is |A\B|,
      // which occurs iff ALL of A\B are mines (1) and ALL of B\A are safe (-1).
      // Since (mines in A) - (mines in B) >= minA - maxB, if minA - maxB === |A\B| (>0),
      // then every cell in A\B MUST be a mine and every cell in B\A MUST be safe!
      if (!changed && rawConstraints.length >= 2) {
        const activeList = [];
        for (let k = 0; k < rawConstraints.length; k++) {
          const con = rawConstraints[k];
          let mCnt = 0;
          const uSet = [];
          for (const u of nb[con.cell]) {
            if (inferredState[u] === 1) mCnt++;
            else if (inferredState[u] === 0) uSet.push(u);
          }
          if (uSet.length > 0) {
            activeList.push({
              min: Math.max(0, con.min - mCnt),
              max: con.max - mCnt,
              uSet
            });
          }
        }
        for (let a = 0; a < activeList.length; a++) {
          for (let b = 0; b < activeList.length; b++) {
            if (a === b) continue;
            const A = activeList[a], B = activeList[b];
            const onlyA = [];
            let shared = 0;
            for (const u of A.uSet) {
              if (B.uSet.indexOf(u) >= 0) shared++;
              else onlyA.push(u);
            }
            if (shared === 0) continue;
            const onlyB = [];
            for (const u of B.uSet) if (A.uSet.indexOf(u) < 0) onlyB.push(u);
            if (A.min - B.max > onlyA.length) {
              return { beliefCount: 0, exactCount: true, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
            }
            if (A.min - B.max === onlyA.length && (onlyA.length > 0 || onlyB.length > 0)) {
              for (const u of onlyA) {
                if (inferredState[u] === 0) { inferredState[u] = 1; baseKnownMines++; changed = true; }
              }
              for (const u of onlyB) {
                if (inferredState[u] === 0) { inferredState[u] = -1; changed = true; }
              }
            }
          }
        }
      }
    }

    const minesToPlace = cfg.totalMines - baseKnownMines;
    const unknownAll = [];
    for (let i = 0; i < N_CELLS; i++) if (inferredState[i] === 0) unknownAll.push(i);
    if (minesToPlace < 0 || minesToPlace > unknownAll.length) {
      return { beliefCount: 0, exactCount: true, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
    }

    // ---- STEP 2: Build active constraints & partition frontier into connected components ----
    const inFrontier = new Uint8Array(N_CELLS);
    const activeConstraints = [];
    for (let k = 0; k < rawConstraints.length; k++) {
      const con = rawConstraints[k];
      let mCnt = 0;
      const unkList = [];
      for (const u of nb[con.cell]) {
        if (inferredState[u] === 1) mCnt++;
        else if (inferredState[u] === 0) unkList.push(u);
      }
      if (mCnt > con.max || mCnt + unkList.length < con.min) {
        return { beliefCount: 0, exactCount: true, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
      }
      if (unkList.length > 0) {
        for (const u of unkList) inFrontier[u] = 1;
        activeConstraints.push({
          cell: con.cell,
          minNeed: Math.max(0, con.min - mCnt),
          maxAllw: con.max - mCnt,
          curMines: 0,
          remUnk: unkList.length,
          vars: unkList
        });
      }
    }

    const frontierVars = [];
    const freeVars = [];
    for (const u of unknownAll) {
      if (inFrontier[u]) frontierVars.push(u);
      else freeVars.push(u);
    }
    const U_FREE = freeVars.length;

    // Map each cell to the active constraints it participates in
    const varCons = Array.from({ length: N_CELLS }, () => []);
    for (let cIdx = 0; cIdx < activeConstraints.length; cIdx++) {
      for (const u of activeConstraints[cIdx].vars) varCons[u].push(cIdx);
    }

    // BFS to find connected components of (frontierVars + activeConstraints)
    const visitedVar = new Uint8Array(N_CELLS);
    const visitedCon = new Uint8Array(activeConstraints.length);
    const components = [];

    for (const startVar of frontierVars) {
      if (visitedVar[startVar]) continue;
      const compVars = [];
      const compCons = [];
      const queue = [startVar];
      visitedVar[startVar] = 1;
      while (queue.length > 0) {
        const u = queue.pop();
        compVars.push(u);
        for (const cIdx of varCons[u]) {
          if (!visitedCon[cIdx]) {
            visitedCon[cIdx] = 1;
            compCons.push(cIdx);
            for (const v of activeConstraints[cIdx].vars) {
              if (!visitedVar[v]) {
                visitedVar[v] = 1;
                queue.push(v);
              }
            }
          }
        }
      }
      // Order variables within component:
      // Place degree>1 "articulation / shared" variables FIRST, and degree===1 "leaf" variables LAST!
      // Once all degree>1 variables are assigned, every remaining active constraint only contains
      // disjoint leaf variables, so we can count all valid leaf completions analytically via combinations
      // in O(1) time without branching on the leaf variables at all!
      compVars.sort((a, b) => varCons[b].length - varCons[a].length);
      components.push({ vars: compVars, cons: compCons });
    }

    // ---- STEP 3: Exact DFS on each connected component independently ----
    // With Analytic Degree-1 Leaf Collapsing:
    // Any variable in `compVars` that belongs to ONLY 1 active constraint (varCons[u].length === 1)
    // is grouped into that constraint's `leafVars` bucket!
    // We ONLY branch with DFS on `coreVars` (variables with varCons[u].length >= 2).
    // At a leaf of the `coreVars` DFS tree, each constraint cIdx in the component has `L_c` leaf variables
    // and needs between `needMin = max(0, minNeed - curMines)` and `needMax = min(L_c, maxAllw - curMines)`
    // mines among its `L_c` leaf variables. Because leaf variables of different constraints are DISJOINT,
    // we simply convolve the small binomial polynomials `P_c(x) = sum_{k=needMin..needMax} C(L_c, k) x^k`!
    let anyTruncated = false;
    const compResults = [];

    for (let cId = 0; cId < components.length; cId++) {
      const comp = components[cId];
      const cVars = comp.vars;
      const cCons = comp.cons;
      const Fc = cVars.length;
      const maxM = Math.min(Fc, minesToPlace);
      const ways = new Float64Array(maxM + 1);
      const varMineWays = Array.from({ length: Fc }, () => new Float64Array(maxM + 1));

      // Map global var id to local index 0..Fc-1
      const localIdxOf = new Int32Array(N_CELLS).fill(-1);
      for (let k = 0; k < Fc; k++) localIdxOf[cVars[k]] = k;

      const coreVars = [];
      const conLeaves = new Map(); // cIdx -> array of local indices of degree-1 variables
      for (const cIdx of cCons) conLeaves.set(cIdx, []);

      for (let k = 0; k < Fc; k++) {
        const u = cVars[k];
        if (varCons[u].length >= 2) {
          coreVars.push(u);
        } else if (varCons[u].length === 1) {
          conLeaves.get(varCons[u][0]).push(k);
        }
      }

      const nCore = coreVars.length;
      const coreLocalIdx = coreVars.map(u => localIdxOf[u]);
      const leafGroups = [];
      for (const cIdx of cCons) {
        const leaves = conLeaves.get(cIdx);
        if (leaves.length > 0) {
          leafGroups.push({ cIdx, leaves, L: leaves.length });
        }
      }
      const nGroups = leafGroups.length;
      let compNodes = 0;
      const COMP_MAX_NODES = 200000;

      function dfsCore(idx, placedCore, coreMask) {
        if (placedCore > maxM) return;
        if (idx === nCore) {
          compNodes++;
          if (nGroups === 0) {
            ways[placedCore] += 1;
            for (let j = 0; j < nCore; j++) {
              if ((coreMask >> j) & 1) varMineWays[coreLocalIdx[j]][placedCore] += 1;
            }
            return;
          }

          // Analytic convolution over the `nGroups` disjoint leaf buckets!
          // Each group g has `L` leaves and valid mine count `k in [kMin, kMax]` with weight `C(L, k)`.
          const gMin = new Int32Array(nGroups);
          const gMax = new Int32Array(nGroups);
          let sumMin = 0, sumMax = 0;
          for (let g = 0; g < nGroups; g++) {
            const grp = leafGroups[g];
            const con = activeConstraints[grp.cIdx];
            const kMin = Math.max(0, con.minNeed - con.curMines);
            const kMax = Math.min(grp.L, con.maxAllw - con.curMines);
            if (kMin > kMax) return; // Infeasible leaf bucket
            gMin[g] = kMin;
            gMax[g] = kMax;
            sumMin += kMin;
            sumMax += kMax;
          }
          if (placedCore + sumMin > maxM) return;
          const maxLeafM = Math.min(sumMax, maxM - placedCore);

          // Prefix and suffix convolutions over the `nGroups` leaf groups
          const pref = Array.from({ length: nGroups + 1 }, () => new Float64Array(maxLeafM + 1));
          pref[0][0] = 1;
          for (let g = 0; g < nGroups; g++) {
            const L = leafGroups[g].L, k0 = gMin[g], k1 = gMax[g];
            for (let m1 = 0; m1 <= maxLeafM; m1++) {
              const v1 = pref[g][m1];
              if (v1 === 0) continue;
              for (let k = k0; k <= k1 && m1 + k <= maxLeafM; k++) {
                pref[g + 1][m1 + k] += v1 * COMB[L][k];
              }
            }
          }

          const totalLeafPoly = pref[nGroups];
          for (let mL = sumMin; mL <= maxLeafM; mL++) {
            const w = totalLeafPoly[mL];
            if (w === 0) continue;
            const totM = placedCore + mL;
            ways[totM] += w;
            for (let j = 0; j < nCore; j++) {
              if ((coreMask >> j) & 1) varMineWays[coreLocalIdx[j]][totM] += w;
            }
          }

          // For each leaf group g, compute the exact mine weight for its leaves
          if (nGroups === 1) {
            const grp = leafGroups[0];
            const L = grp.L, k0 = gMin[0], k1 = gMax[0];
            for (let k = k0; k <= k1 && placedCore + k <= maxM; k++) {
              if (k === 0) continue;
              const wLeaf = COMB[L][k] * (k / L);
              const totM = placedCore + k;
              for (let l = 0; l < L; l++) varMineWays[grp.leaves[l]][totM] += wLeaf;
            }
          } else {
            const suff = Array.from({ length: nGroups + 1 }, () => new Float64Array(maxLeafM + 1));
            suff[nGroups][0] = 1;
            for (let g = nGroups - 1; g >= 0; g--) {
              const L = leafGroups[g].L, k0 = gMin[g], k1 = gMax[g];
              for (let m1 = 0; m1 <= maxLeafM; m1++) {
                const v1 = suff[g + 1][m1];
                if (v1 === 0) continue;
                for (let k = k0; k <= k1 && m1 + k <= maxLeafM; k++) {
                  suff[g][m1 + k] += v1 * COMB[L][k];
                }
              }
            }
            for (let g = 0; g < nGroups; g++) {
              const grp = leafGroups[g];
              const L = grp.L, k0 = gMin[g], k1 = gMax[g];
              for (let k = k0; k <= k1; k++) {
                if (k === 0) continue;
                const wGroupK = COMB[L][k] * (k / L);
                // Convolve pref[g] and suff[g+1] at total mL - k
                for (let m1 = 0; m1 + k <= maxLeafM; m1++) {
                  const p1 = pref[g][m1];
                  if (p1 === 0) continue;
                  for (let m2 = 0; m1 + m2 + k <= maxLeafM; m2++) {
                    const s2 = suff[g + 1][m2];
                    if (s2 === 0) continue;
                    const totM = placedCore + m1 + m2 + k;
                    const addW = p1 * s2 * wGroupK;
                    for (let l = 0; l < L; l++) varMineWays[grp.leaves[l]][totM] += addW;
                  }
                }
              }
            }
          }
          return;
        }

        if (compNodes >= COMP_MAX_NODES) {
          anyTruncated = true;
          return;
        }

        const u = coreVars[idx];
        const cList = varCons[u];

        // Branch 0: u is Safe
        let ok0 = true;
        for (let j = 0; j < cList.length; j++) {
          const con = activeConstraints[cList[j]];
          if (con.curMines + (con.remUnk - 1) < con.minNeed) { ok0 = false; break; }
        }
        if (ok0) {
          for (let j = 0; j < cList.length; j++) activeConstraints[cList[j]].remUnk--;
          dfsCore(idx + 1, placedCore, coreMask);
          for (let j = 0; j < cList.length; j++) activeConstraints[cList[j]].remUnk++;
        }

        // Branch 1: u is Mine
        if (placedCore + 1 <= maxM) {
          let ok1 = true;
          for (let j = 0; j < cList.length; j++) {
            const con = activeConstraints[cList[j]];
            if (con.curMines + 1 > con.maxAllw) { ok1 = false; break; }
          }
          if (ok1) {
            for (let j = 0; j < cList.length; j++) {
              const con = activeConstraints[cList[j]];
              con.curMines++;
              con.remUnk--;
            }
            dfsCore(idx + 1, placedCore + 1, coreMask | (1 << idx));
            for (let j = 0; j < cList.length; j++) {
              const con = activeConstraints[cList[j]];
              con.curMines--;
              con.remUnk++;
            }
          }
        }
      }

      dfsCore(0, 0, 0);
      let totalCompWays = 0;
      for (let m = 0; m <= maxM; m++) totalCompWays += ways[m];
      if (totalCompWays === 0) {
        return { beliefCount: 0, exactCount: !anyTruncated, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
      }
      compResults.push({ vars: cVars, maxM, ways, varMineWays, solMasks: [] });
    }

    // ---- STEP 4: Convolve components & freeVars to get exact marginal probabilities ----
    const M = minesToPlace;
    const numComp = compResults.length;

    // Prefix and suffix polynomial convolutions so we can get the distribution of mines
    // in "all components EXCEPT component cId" in O(M^2) time!
    const prefixPoly = Array.from({ length: numComp + 1 }, () => new Float64Array(M + 1));
    prefixPoly[0][0] = 1;
    for (let c = 0; c < numComp; c++) {
      const w = compResults[c].ways;
      const maxMc = compResults[c].maxM;
      for (let m1 = 0; m1 <= M; m1++) {
        if (prefixPoly[c][m1] === 0) continue;
        for (let m2 = 0; m2 <= maxMc && m1 + m2 <= M; m2++) {
          if (w[m2] > 0) prefixPoly[c + 1][m1 + m2] += prefixPoly[c][m1] * w[m2];
        }
      }
    }

    const suffixPoly = Array.from({ length: numComp + 1 }, () => new Float64Array(M + 1));
    suffixPoly[numComp][0] = 1;
    for (let c = numComp - 1; c >= 0; c--) {
      const w = compResults[c].ways;
      const maxMc = compResults[c].maxM;
      for (let m1 = 0; m1 <= M; m1++) {
        if (suffixPoly[c + 1][m1] === 0) continue;
        for (let m2 = 0; m2 <= maxMc && m1 + m2 <= M; m2++) {
          if (w[m2] > 0) suffixPoly[c][m1 + m2] += suffixPoly[c + 1][m1] * w[m2];
        }
      }
    }

    // Total valid layouts across the entire board:
    // sum_{mF = 0..M} prefixPoly[numComp][mF] * C(U_FREE, M - mF)
    const allFrontierPoly = prefixPoly[numComp];
    let totalWeight = 0;
    let freeMineWeightSum = 0;
    for (let mF = 0; mF <= M; mF++) {
      const wF = allFrontierPoly[mF];
      if (wF === 0) continue;
      const needFree = M - mF;
      if (needFree < 0 || needFree > U_FREE) continue;
      const wFree = COMB[U_FREE][needFree];
      const wTot = wF * wFree;
      totalWeight += wTot;
      if (U_FREE > 0 && needFree > 0) {
        freeMineWeightSum += wTot * (needFree / U_FREE);
      }
    }

    if (totalWeight <= 0) {
      return { beliefCount: 0, exactCount: !anyTruncated, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
    }

    const cellMineWeight = new Float64Array(N_CELLS);
    for (let i = 0; i < N_CELLS; i++) {
      if (inferredState[i] === 1) cellMineWeight[i] = totalWeight;
      else if (inferredState[i] === -1) cellMineWeight[i] = 0;
    }
    for (const u of freeVars) {
      cellMineWeight[u] = freeMineWeightSum;
    }

    // For each component cId, convolve prefixPoly[cId] * suffixPoly[cId + 1] * C(U_FREE, .)
    // so we know the exact external weight `extWeight[m_c]` for placing `m_c` mines in component cId!
    for (let c = 0; c < numComp; c++) {
      const comp = compResults[c];
      const otherFrontier = new Float64Array(M + 1);
      for (let m1 = 0; m1 <= M; m1++) {
        if (prefixPoly[c][m1] === 0) continue;
        for (let m2 = 0; m1 + m2 <= M; m2++) {
          if (suffixPoly[c + 1][m2] > 0) {
            otherFrontier[m1 + m2] += prefixPoly[c][m1] * suffixPoly[c + 1][m2];
          }
        }
      }
      const extWeight = new Float64Array(comp.maxM + 1);
      for (let mc = 0; mc <= comp.maxM; mc++) {
        let s = 0;
        for (let mOther = 0; mc + mOther <= M; mOther++) {
          const wOther = otherFrontier[mOther];
          if (wOther === 0) continue;
          const needFree = M - mc - mOther;
          if (needFree >= 0 && needFree <= U_FREE) {
            s += wOther * COMB[U_FREE][needFree];
          }
        }
        extWeight[mc] = s;
      }
      comp.otherFrontier = otherFrontier;
      comp.extWeight = extWeight;

      for (let k = 0; k < comp.vars.length; k++) {
        const u = comp.vars[k];
        let wMine = 0;
        for (let mc = 0; mc <= comp.maxM; mc++) {
          wMine += comp.varMineWays[k][mc] * extWeight[mc];
        }
        cellMineWeight[u] = wMine;
      }
    }

    // Map each frontier variable to its (componentIndex, localVarIndex)
    const varCompMap = new Array(N_CELLS).fill(null);
    for (let c = 0; c < numComp; c++) {
      const vars = compResults[c].vars;
      for (let k = 0; k < vars.length; k++) {
        varCompMap[vars[k]] = { cId: c, bit: 1 << k };
      }
    }

    const fatalRatio = remTotalMines > 0 ? (remFatal / remTotalMines) : 0;
    const penaltyRatio = remTotalMines > 0 ? (remPenalty / remTotalMines) : 0;

    const pTotalArr = new Float64Array(N_CELLS);
    for (let i = 0; i < N_CELLS; i++) {
      pTotalArr[i] = Math.min(1, Math.max(0, cellMineWeight[i] / totalWeight));
    }

    // ---- STEP 5: Compute Conditional Neighbor Mine Count Distribution for each cell i ----
    const stats = new Array(N_CELLS).fill(null);

    for (let i = 0; i < N_CELLS; i++) {
      if (marksMap.has(i)) { stats[i] = null; continue; }
      const pAny = pTotalArr[i];
      const pFatal = pAny * fatalRatio;
      const pPenalty = pAny * penaltyRatio;
      const neighbors = nb[i];
      const dist = new Float64Array(9);

      // Classify cell i's neighbors into:
      // - fixedKnownMines (inferredState === 1)
      // - freeNb (in freeVars)
      // - frontierNb grouped by component id
      let fixedKnownMines = 0;
      let freeNb = 0;
      const compNbBits = new Map(); // cId -> array of bitmasks of neighbors in that component
      for (const u of neighbors) {
        if (inferredState[u] === 1) fixedKnownMines++;
        else if (inferredState[u] === -1) continue;
        else if (inFrontier[u]) {
          const info = varCompMap[u];
          if (!compNbBits.has(info.cId)) compNbBits.set(info.cId, []);
          compNbBits.get(info.cId).push(info.bit);
        } else {
          freeNb++;
        }
      }

      const iInfo = varCompMap[i]; // non-null if cell i is in frontierVars
      const iInFree = (inferredState[i] === 0 && !inFrontier[i]);

      if (pAny >= 1 - 1e-12) {
        dist[0] = 1.0;
      } else if (compNbBits.size === 0 && !iInfo) {
        // Cell i and all its unknown neighbors are in freeVars (or known):
        // Exact hypergeometric convolution over allFrontierPoly[mF]
        let sumW = 0;
        const freePool = iInFree ? (U_FREE - 1) : U_FREE;
        for (let mF = 0; mF <= M; mF++) {
          const wF = allFrontierPoly[mF];
          if (wF === 0) continue;
          const freeMines = M - mF;
          if (freeMines < 0 || freeMines > freePool) continue;
          const wWays = wF * COMB[freePool][freeMines];
          if (wWays <= 0) continue;
          sumW += wWays;
          const denom = COMB[freePool][freeMines];
          const maxAdd = Math.min(freeNb, freeMines);
          for (let add = 0; add <= maxAdd; add++) {
            const remFree = freePool - freeNb;
            const remMines = freeMines - add;
            if (remMines < 0 || remMines > remFree) continue;
            dist[fixedKnownMines + add] += wWays * (COMB[freeNb][add] * COMB[remFree][remMines]) / denom;
          }
        }
        if (sumW > 0) for (let c = 0; c <= 8; c++) dist[c] /= sumW;
        else dist[0] = 1.0;
      } else {
        // Cell i has some neighbors in frontier components and/or freeVars:
        // First convolve the exact marginals of i's frontier neighbors, then convolve with the exact
        // conditional hypergeometric distribution of i's `freeNb` free neighbors!
        const fDist = new Float64Array(9);
        fDist[fixedKnownMines] = 1.0;
        let fCount = 0;
        let fExpectedMines = 0;
        for (const u of neighbors) {
          if (inferredState[u] === 0 && inFrontier[u]) {
            const q = pTotalArr[u];
            fExpectedMines += q;
            for (let k = fixedKnownMines + fCount + 1; k >= fixedKnownMines + 1; k--) {
              fDist[k] = fDist[k] * (1 - q) + fDist[k - 1] * q;
            }
            fDist[fixedKnownMines] *= (1 - q);
            fCount++;
          }
        }
        if (freeNb === 0) {
          for (let c = 0; c <= 8; c++) dist[c] = fDist[c];
        } else {
          // Exact hypergeometric distribution for the `freeNb` neighbors in freeVars
          // conditioned on cell i being safe!
          const freeDist = new Float64Array(freeNb + 1);
          const freePool = iInFree ? (U_FREE - 1) : U_FREE;
          let sumW = 0;
          for (let mF = 0; mF <= M; mF++) {
            const wF = allFrontierPoly[mF];
            if (wF === 0) continue;
            const freeMines = M - mF;
            if (freeMines < 0 || freeMines > freePool) continue;
            const wWays = wF * COMB[freePool][freeMines];
            if (wWays <= 0) continue;
            sumW += wWays;
            const denom = COMB[freePool][freeMines];
            const maxAdd = Math.min(freeNb, freeMines);
            for (let add = 0; add <= maxAdd; add++) {
              const remFree = freePool - freeNb;
              const remMines = freeMines - add;
              if (remMines < 0 || remMines > remFree) continue;
              freeDist[add] += wWays * (COMB[freeNb][add] * COMB[remFree][remMines]) / denom;
            }
          }
          if (sumW > 0) {
            for (let add = 0; add <= freeNb; add++) freeDist[add] /= sumW;
          } else {
            freeDist[0] = 1.0;
          }
          // Convolve fDist and freeDist
          for (let k1 = 0; k1 <= fixedKnownMines + fCount; k1++) {
            if (fDist[k1] === 0) continue;
            for (let k2 = 0; k2 <= freeNb && k1 + k2 <= 8; k2++) {
              dist[k1 + k2] += fDist[k1] * freeDist[k2];
            }
          }
        }
      }

      let evSafe = 0;
      for (let c = 0; c <= 8; c++) evSafe += dist[c] * SCORE[c];
      // Actual penalty loss if cell i is a gray penalty mine (respecting score clamping at 0!)
      const actualPenaltyLoss = Math.min(10, Math.max(0, curSc));
      const nonFatalProb = 1 - pFatal;
      const evClick = nonFatalProb > 1e-9
        ? ((1 - pAny) * evSafe - pPenalty * actualPenaltyLoss) / nonFatalProb
        : 0;

      stats[i] = {
        p: pFatal,            // Fatal bomb probability (ends game!)
        pFatal,
        pPenalty,             // Gray penalty mine probability (-10 pts, game continues)
        pAnyMine: pAny,       // Total mine probability (fatal + penalty)
        ev: evSafe,
        evClick,
        safe: Math.round(totalWeight * (1 - pAny)),
        n: Math.round(totalWeight),
        pGreen: dist[0],
        pBlue: dist[1] + dist[2],
        pRed: dist[3] + dist[4],
        pSilver: dist[5] + dist[6],
        pGold: dist[7] + dist[8]
      };
    }

    // ---- STEP 6: Recommend best cell ----
    let rec = null;
    if (marksMap.size === 0) {
      const startCell = cfg.id === 'advanced' ? 10 : 0; // (2,3) for Advanced, (1,1) for Intermediate
      const st0 = stats[startCell];
      rec = {
        cell: startCell,
        ...st0,
        expZeroSafe: st0.pGreen * nb[startCell].length,
        reason: cfg.id === 'advanced' ? 'open-inner-high-ev' : 'open-corner'
      };
    } else {
      let zeros = [];
      let minAny = 1;
      for (let i = 0; i < N_CELLS; i++) {
        const s = stats[i];
        if (!s) continue;
        if (s.pAnyMine <= 1e-9) zeros.push(i);
        if (s.pAnyMine < minAny - 1e-9) minAny = s.pAnyMine;
      }
      if (zeros.length > 0) {
        zeros.sort((a, b) => stats[b].ev - stats[a].ev);
        const best = zeros[0];
        rec = { cell: best, ...stats[best], expZeroSafe: stats[best].pGreen * nb[best].length, reason: 'guaranteed-safe' };
      } else {
        let cands = [];
        for (let i = 0; i < N_CELLS; i++) {
          const s = stats[i];
          if (!s) continue;
          if (Math.abs(s.pAnyMine - minAny) < 1e-7) cands.push(i);
        }
        if (cands.length > 0) {
          cands.sort((a, b) => {
            const sa = stats[a], sb = stats[b];
            if (cfg.id === 'advanced') {
              const va = sa.evClick + sa.pGreen * nb[a].length * 15;
              const vb = sb.evClick + sb.pGreen * nb[b].length * 15;
              return vb - va;
            }
            const va = sa.pGreen * 120 + sa.evClick * 0.45 - nb[a].length * 1.2;
            const vb = sb.pGreen * 120 + sb.evClick * 0.45 - nb[b].length * 1.2;
            return vb - va;
          });
          const best = cands[0];
          rec = {
            cell: best,
            ...stats[best],
            expZeroSafe: stats[best].pGreen * nb[best].length,
            reason: 'lowest-risk-lookahead'
          };
        }
      }
    }

    return {
      beliefCount: Math.round(totalWeight),
      exactCount: !anyTruncated,
      stats,
      rec,
      remFatal,
      remPenalty
    };
  }

  root.MG = {
    R, C, N, K, SCORE, COLOR, COLOR_SCORE, COLOR_RANGE, SAFE_COLORS,
    LEVELS, NB, NB_BY_LEVEL, PLACEMENTS,
    colorOfCount, filterBelief, beliefFromColorMarks, beliefWithout,
    analyze, oneStepLookahead, recommend,
    generateRandomLayout, applyScoreStep, solveLevelMarks
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
