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
 *   5..6    -> 's' (Silver, +50 pts)
 *   7..8    -> 'y' (Gold,   +100 pts)
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
  const SCORE = [1, 5, 5, 20, 20, 50, 50, 100, 100];
  const COLOR = ['g', 'b', 'b', 'r', 'r', 's', 's', 'y', 'y'];
  const COLOR_SCORE = { g: 1, b: 5, r: 20, s: 50, y: 100, p: -10 };
  const COLOR_RANGE = {
    g: [0, 0],
    b: [1, 2],
    r: [3, 4],
    s: [5, 6],
    y: [7, 8]
  };

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
      if (col === 'g' || col === 'b' || col === 'r' || col === 's' || col === 'y') {
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
    const buckets = { g: [], b: [], r: [] };
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
  // PART 2: MULTI-LEVEL LAYOUT GENERATOR & CONSTRAINT SOLVER (Intermediate 5x6 & Advanced 5x8)
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
    // Fisher-Yates shuffle
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

  /**
   * Compute sequential score when revealing `col` ('g'|'b'|'r'|'s'|'y'|'p'),
   * clamping at 0 whenever a gray penalty mine ('p', -10) is triggered.
   */
  function applyScoreStep(currentScore, col) {
    if (col === 'p') return Math.max(0, currentScore - 10);
    return currentScore + (COLOR_SCORE[col] || 0);
  }

  /**
   * Exact + Monte-Carlo Constraint Solver for Intermediate (5x6) and Advanced (5x8)
   * given color Marks Map(cell -> 'g'|'b'|'r'|'s'|'y'|'p'):
   * - If a cell is marked 'p' (Gray penalty mine): it IS a mine (100% penalty mine),
   *   contributing +1 to all its neighbors' mine counts, and consuming 1 of the level's penaltyMines!
   * - If a cell is marked 'g'|'b'|'r'|'s'|'y': it is SAFE (not a mine), and its neighbors'
   *   total mine count (fatal + penalty) lies in COLOR_RANGE[col].
   * - Because fatal mines and unrevealed penalty mines are indistinguishable to adjacent color clues,
   *   among all unrevealed cells, the fraction of total mines that are fatal vs. unrevealed penalty is:
   *     remFatal = cfg.fatalMines
   *     remPenalty = cfg.penaltyMines - markedGrayCount
   *     remTotalMines = remFatal + remPenalty
   *   So if an unrevealed cell i has total-mine probability P(mine at i) = pTotal,
   *   then by symmetry:
   *     P(fatal mine at i)   = pTotal * (remFatal / remTotalMines)
   *     P(penalty mine at i) = pTotal * (remPenalty / remTotalMines)
   */
  function solveLevelMarks(levelKey, marksMap) {
    const cfg = LEVELS[levelKey] || LEVELS.beginner;
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
    const cellState = new Int8Array(N_CELLS); // 0 = unknown, -1 = known safe, +1 = known mine ('p')
    const constraints = [];
    let knownMines = 0;

    for (const [cell, col] of marksMap.entries()) {
      if (cell < 0 || cell >= N_CELLS) continue;
      if (col === 'p') {
        cellState[cell] = 1;
        knownMines++;
      } else if (COLOR_RANGE[col]) {
        cellState[cell] = -1;
        constraints.push({ cell, min: COLOR_RANGE[col][0], max: COLOR_RANGE[col][1] });
      }
    }

    // Check if player marked more gray penalty mines than exist in this level
    if (knownMines > cfg.penaltyMines) {
      return { beliefCount: 0, exactCount: true, stats: new Array(N_CELLS).fill(null), rec: null, remFatal: cfg.fatalMines, remPenalty: 0 };
    }

    const remFatal = cfg.fatalMines;
    const remPenalty = cfg.penaltyMines - knownMines;
    const remTotalMines = remFatal + remPenalty;

    // Iteratively propagate deterministic constraints (0-mine neighbors & saturated max-mine neighbors)
    // before backtracking / sampling
    const inferredState = new Int8Array(cellState);
    let baseKnownMines = knownMines;
    let changed = true;
    while (changed) {
      changed = false;
      for (let k = 0; k < constraints.length; k++) {
        const con = constraints[k];
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
    }

    const totalMinesTarget = cfg.totalMines;
    const unknownAll = [];
    for (let i = 0; i < N_CELLS; i++) if (inferredState[i] === 0) unknownAll.push(i);
    const minesToPlace = totalMinesTarget - baseKnownMines;
    if (minesToPlace < 0 || minesToPlace > unknownAll.length) {
      return { beliefCount: 0, exactCount: true, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
    }

    // Partition unknownAll into constrained frontier cells (adjacent to at least one color clue)
    // and unconstrained interior/exterior cells
    const inFrontier = new Uint8Array(N_CELLS);
    const activeConstraints = [];
    for (let k = 0; k < constraints.length; k++) {
      const con = constraints[k];
      const neighbors = nb[con.cell];
      let mCnt = 0;
      const unkList = [];
      for (let j = 0; j < neighbors.length; j++) {
        const u = neighbors[j];
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

    // Order frontierVars by highest constraint degree for fast pruning
    const varCons = new Array(N_CELLS);
    for (let i = 0; i < N_CELLS; i++) varCons[i] = [];
    for (let cIdx = 0; cIdx < activeConstraints.length; cIdx++) {
      for (const u of activeConstraints[cIdx].vars) varCons[u].push(cIdx);
    }
    frontierVars.sort((a, b) => varCons[b].length - varCons[a].length);

    // Precompute binomial coefficients C(n, k)
    const MAX_N = N_CELLS + 1;
    const COMB = Array.from({ length: MAX_N }, () => new Float64Array(MAX_N));
    for (let n = 0; n < MAX_N; n++) {
      COMB[n][0] = 1;
      for (let k = 1; k <= n; k++) COMB[n][k] = COMB[n - 1][k - 1] + COMB[n - 1][k];
    }

    const F = frontierVars.length;
    const U_FREE = freeVars.length;
    const assign = new Int8Array(N_CELLS);
    for (let i = 0; i < N_CELLS; i++) if (inferredState[i] === 1) assign[i] = 1;

    let totalWeight = 0;
    let solutionNodes = 0;
    const MAX_NODES = 18000;
    const cellMineWeight = new Float64Array(N_CELLS);
    for (let i = 0; i < N_CELLS; i++) {
      if (inferredState[i] === 1) cellMineWeight[i] = 1; // Will scale by totalWeight after search
    }

    // Store up to 600 weighted frontier solutions to compute accurate color distributions & EVs
    const savedFrontierSolutions = [];

    function dfs(idx, placedInFrontier) {
      if (placedInFrontier > minesToPlace) return;
      const remFrontier = F - idx;
      if (placedInFrontier + remFrontier + U_FREE < minesToPlace) return;

      if (idx === F) {
        const needInFree = minesToPlace - placedInFrontier;
        if (needInFree < 0 || needInFree > U_FREE) return;
        const w = COMB[U_FREE][needInFree];
        if (w <= 0) return;
        totalWeight += w;
        solutionNodes++;

        for (let k = 0; k < F; k++) {
          const u = frontierVars[k];
          if (assign[u] === 1) cellMineWeight[u] += w;
        }
        if (U_FREE > 0 && needInFree > 0) {
          const freeFrac = w * (needInFree / U_FREE);
          for (let k = 0; k < U_FREE; k++) {
            cellMineWeight[freeVars[k]] += freeFrac;
          }
        }
        if (savedFrontierSolutions.length < 600) {
          const fMask = [];
          for (let k = 0; k < F; k++) if (assign[frontierVars[k]] === 1) fMask.push(frontierVars[k]);
          savedFrontierSolutions.push({ fMines: fMask, needInFree, w });
        }
        return;
      }

      if (solutionNodes >= MAX_NODES) return;

      const u = frontierVars[idx];
      const cList = varCons[u];

      // Try assign[u] = 0 (Safe)
      let ok0 = true;
      for (let j = 0; j < cList.length; j++) {
        const con = activeConstraints[cList[j]];
        if (con.curMines + (con.remUnk - 1) < con.minNeed) { ok0 = false; break; }
      }
      if (ok0) {
        assign[u] = 0;
        for (let j = 0; j < cList.length; j++) activeConstraints[cList[j]].remUnk--;
        dfs(idx + 1, placedInFrontier);
        for (let j = 0; j < cList.length; j++) activeConstraints[cList[j]].remUnk++;
      }

      // Try assign[u] = 1 (Mine)
      if (placedInFrontier + 1 <= minesToPlace) {
        let ok1 = true;
        for (let j = 0; j < cList.length; j++) {
          const con = activeConstraints[cList[j]];
          if (con.curMines + 1 > con.maxAllw) { ok1 = false; break; }
        }
        if (ok1) {
          assign[u] = 1;
          for (let j = 0; j < cList.length; j++) {
            const con = activeConstraints[cList[j]];
            con.curMines++;
            con.remUnk--;
          }
          dfs(idx + 1, placedInFrontier + 1);
          for (let j = 0; j < cList.length; j++) {
            const con = activeConstraints[cList[j]];
            con.curMines--;
            con.remUnk++;
          }
          assign[u] = 0;
        }
      }
    }

    dfs(0, 0);

    if (totalWeight <= 0) {
      return { beliefCount: 0, exactCount: solutionNodes < MAX_NODES, stats: new Array(N_CELLS).fill(null), rec: null, remFatal, remPenalty };
    }

    for (let i = 0; i < N_CELLS; i++) {
      if (inferredState[i] === 1) cellMineWeight[i] = totalWeight;
      else if (inferredState[i] === -1) cellMineWeight[i] = 0;
    }

    // Ratio of fatal mines vs penalty mines among all remaining unrevealed mines
    const fatalRatio = remTotalMines > 0 ? (remFatal / remTotalMines) : 0;
    const penaltyRatio = remTotalMines > 0 ? (remPenalty / remTotalMines) : 0;

    // Estimate adjacent mine count distribution for each unrevealed cell
    const stats = new Array(N_CELLS).fill(null);
    const pTotalArr = new Float64Array(N_CELLS);
    for (let i = 0; i < N_CELLS; i++) {
      pTotalArr[i] = Math.min(1, Math.max(0, cellMineWeight[i] / totalWeight));
    }

    for (let i = 0; i < N_CELLS; i++) {
      if (marksMap.has(i)) { stats[i] = null; continue; }
      const pAny = pTotalArr[i];
      const pFatal = pAny * fatalRatio;
      const pPenalty = pAny * penaltyRatio;

      // Approximate neighbor count distribution when cell i is safe using neighbor marginals
      const neighbors = nb[i];
      // Dynamic programming over neighbors' conditional mine probabilities
      let dist = new Float64Array(9);
      dist[0] = 1.0;
      for (let j = 0; j < neighbors.length; j++) {
        const u = neighbors[j];
        const q = pTotalArr[u];
        for (let k = j + 1; k >= 1; k--) {
          dist[k] = dist[k] * (1 - q) + dist[k - 1] * q;
        }
        dist[0] *= (1 - q);
      }
      let evSafe = 0;
      for (let c = 0; c <= 8; c++) evSafe += dist[c] * SCORE[c];
      // Expected score change if not fatal (could be safe or gray penalty mine -10)
      const nonFatalProb = 1 - pFatal;
      const evClick = nonFatalProb > 1e-9
        ? ((1 - pAny) * evSafe + pPenalty * (-10)) / nonFatalProb
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

    // Recommend best cell for Intermediate / Advanced:
    // 1. On empty board: recommend corner (0,0) — highest probability of opening 0-mine Green region
    // 2. Any cell with pAnyMine === 0 (100% guaranteed safe, neither fatal nor penalty): pick highest EV
    // 3. Otherwise, minimize fatal mine risk (pFatal) while avoiding known 100% penalty mines,
    //    and among tied lowest-risk cells, prefer corners/low-degree high-pGreen cells to unlock 0% regions
    let rec = null;
    if (marksMap.size === 0) {
      rec = { cell: 0, ...stats[0], expZeroSafe: stats[0].pGreen * 3, reason: 'open-corner' };
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
            // Prefer higher Green probability (unlocks safe zone) + expected score
            const va = sa.pGreen * 120 + sa.ev * 0.4 - nb[a].length * 1.5;
            const vb = sb.pGreen * 120 + sb.ev * 0.4 - nb[b].length * 1.5;
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
      exactCount: solutionNodes < MAX_NODES,
      stats,
      rec,
      remFatal,
      remPenalty
    };
  }

  root.MG = {
    R, C, N, K, SCORE, COLOR, COLOR_SCORE, COLOR_RANGE,
    LEVELS, NB, NB_BY_LEVEL, PLACEMENTS,
    colorOfCount, filterBelief, beliefFromColorMarks, beliefWithout,
    analyze, oneStepLookahead, recommend,
    generateRandomLayout, applyScoreStep, solveLevelMarks
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
