/* 验证 solveLevelMarks 的正确性：
 * 1. 蒙特卡洛采样 vs 求解器，对比每格的 pAnyMine / pFatal / pPenalty / 条件颜色分布
 * 2. 检查 dfs 是否触发 MAX_NODES 截断（exactCount 变 false）
 * 3. 检查 fatal/penalty 对称拆分
 */
require('./engine.js');
const MG = globalThis.MG;
const { LEVELS, COLOR, COLOR_SCORE, COLOR_RANGE, NB_BY_LEVEL } = MG;

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 对高级/中级做 rejection sampling：随机 fatal + penalty 布局，接受满足约束的样本
function monteCarloStats(levelKey, marks, samples) {
  const cfg = LEVELS[levelKey];
  const nb = NB_BY_LEVEL[levelKey];
  const rng = makeRng(42);
  const N = cfg.N;

  const anyMine = new Float64Array(N);
  const fatal = new Float64Array(N);
  const penalty = new Float64Array(N);
  const safeColorDist = Array.from({ length: N }, () => new Float64Array(9));
  const safeCount = new Float64Array(N);
  let accepted = 0;

  for (let it = 0; it < samples; it++) {
    // 随机排列，前 fatalMines 致命，次 penaltyMines 扣分
    const perm = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    const fSet = new Set(perm.slice(0, cfg.fatalMines));
    const pSet = new Set(perm.slice(cfg.fatalMines, cfg.totalMines));
    const isMine = i => fSet.has(i) || pSet.has(i);

    // 检查约束
    let ok = true;
    for (const [cell, col] of marks.entries()) {
      if (col === 'p') {
        if (!pSet.has(cell)) { ok = false; break; }
      } else {
        if (isMine(cell)) { ok = false; break; }
        let cnt = 0;
        for (const j of nb[cell]) if (isMine(j)) cnt++;
        const [lo, hi] = COLOR_RANGE[col];
        if (cnt < lo || cnt > hi) { ok = false; break; }
      }
    }
    if (!ok) continue;
    accepted++;

    for (let i = 0; i < N; i++) {
      if (marks.has(i)) continue;
      if (fSet.has(i)) fatal[i]++;
      if (pSet.has(i)) penalty[i]++;
      if (isMine(i)) anyMine[i]++;
      else {
        safeCount[i]++;
        let cnt = 0;
        for (const j of nb[i]) if (isMine(j)) cnt++;
        safeColorDist[i][cnt]++;
      }
    }
  }

  const out = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (marks.has(i)) continue;
    const pAny = anyMine[i] / accepted;
    const pFatal = fatal[i] / accepted;
    const pPenalty = penalty[i] / accepted;
    const dist = new Float64Array(9);
    if (safeCount[i] > 0) for (let c = 0; c < 9; c++) dist[c] = safeColorDist[i][c] / safeCount[i];
    let ev = 0;
    for (let c = 0; c < 9; c++) ev += dist[c] * MG.SCORE[c];
    out[i] = {
      pAny, pFatal, pPenalty,
      ev,
      pGreen: dist[0], pBlue: dist[1] + dist[2], pRed: dist[3] + dist[4],
      pSilver: dist[5] + dist[6], pGold: dist[7] + dist[8]
    };
  }
  return { accepted, out };
}

function compare(levelKey, marks, samples) {
  const cfg = LEVELS[levelKey];
  const mc = monteCarloStats(levelKey, marks, samples);
  const sol = MG.solveLevelMarks(levelKey, marks);

  console.log(`\n===== ${cfg.name} (${cfg.R}x${cfg.C})  marks=[${[...marks.entries()].map(([c, col]) => `(${c}:${col})`).join(' ')}]  accepted=${mc.accepted}/${samples} ====`);
  console.log(`solver: beliefCount=${sol.beliefCount}  exactCount=${sol.exactCount}  remFatal=${sol.remFatal}  remPenalty=${sol.remPenalty}`);

  // 逐格对比（只对比几个关键格）
  const checkCells = [];
  for (let i = 0; i < cfg.N; i++) if (!marks.has(i)) checkCells.push(i);

  let maxAnyErr = 0, maxFatalErr = 0, maxEvErr = 0;
  let worstAny = -1, worstFatal = -1, worstEv = -1;

  for (const i of checkCells) {
    const s = sol.stats[i];
    const m = mc.out[i];
    if (!s || !m) continue;
    const anyErr = Math.abs(s.pAnyMine - m.pAny);
    const fatalErr = Math.abs(s.pFatal - m.pFatal);
    const evErr = Math.abs(s.ev - m.ev);
    if (anyErr > maxAnyErr) { maxAnyErr = anyErr; worstAny = i; }
    if (fatalErr > maxFatalErr) { maxFatalErr = fatalErr; worstFatal = i; }
    if (evErr > maxEvErr) { maxEvErr = evErr; worstEv = i; }
  }

  console.log(`最大误差:  pAnyMine=${(maxAnyErr * 100).toFixed(2)}% @cell${worstAny}  |  pFatal=${(maxFatalErr * 100).toFixed(2)}% @cell${worstFatal}  |  ev=${maxEvErr.toFixed(2)} @cell${worstEv}`);

  // 打印最差几格的对比
  const show = new Set([worstAny, worstFatal, worstEv]);
  for (const i of show) {
    if (i < 0) continue;
    const s = sol.stats[i], m = mc.out[i];
    if (!s || !m) continue;
    console.log(
      `  cell ${i} (r${(i / cfg.C | 0) + 1}c${(i % cfg.C) + 1}): ` +
      `solver pAny=${(s.pAnyMine * 100).toFixed(1)}% pFatal=${(s.pFatal * 100).toFixed(1)}% pPenalty=${(s.pPenalty * 100).toFixed(1)}% ev=${s.ev.toFixed(2)} | ` +
      `MC pAny=${(m.pAny * 100).toFixed(1)}% pFatal=${(m.pFatal * 100).toFixed(1)}% pPenalty=${(m.pPenalty * 100).toFixed(1)}% ev=${m.ev.toFixed(2)}`
    );
  }

  return { maxAnyErr, maxFatalErr, maxEvErr, sol };
}

const S = 40000;

// 场景1：高级，标 (0,0)=绿（角，0雷），(10)=蓝（内部 2,3，1-2雷）
compare('advanced', new Map([[0, 'g'], [10, 'b']]), S);

// 场景2：高级，标 (0,0)=绿，(10)=红（3-4雷）
compare('advanced', new Map([[0, 'g'], [10, 'r']]), S);

// 场景3：中级，标 (0,0)=绿，(7)=蓝
compare('intermediate', new Map([[0, 'g'], [7, 'b']]), S);

// 场景4：高级，含灰色扣分雷 (10)=p（灰）
compare('advanced', new Map([[0, 'g'], [10, 'p'], [18, 'b']]), S);
