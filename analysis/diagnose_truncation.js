/* 诊断 solveLevelMarks 的 MAX_NODES 截断问题 + 检查 fatal/penalty 对称拆分 + 条件分布近似误差 */
require('./engine.js');
const MG = globalThis.MG;
const { LEVELS, COLOR, COLOR_SCORE, NB_BY_LEVEL, applyScoreStep, solveLevelMarks } = MG;

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function genSeededLayout(cfg, nb, rng, firstSafeCell) {
  const avail = [];
  for (let i = 0; i < cfg.N; i++) if (i !== firstSafeCell) avail.push(i);
  for (let i = avail.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = avail[i]; avail[i] = avail[j]; avail[j] = t;
  }
  const fatalSet = new Set(avail.slice(0, cfg.fatalMines));
  const penaltySet = new Set(avail.slice(cfg.fatalMines, cfg.fatalMines + cfg.penaltyMines));
  const cnt = new Int8Array(cfg.N);
  for (let i = 0; i < cfg.N; i++) {
    let s = 0;
    for (const j of nb[i]) if (fatalSet.has(j) || penaltySet.has(j)) s++;
    cnt[i] = s;
  }
  return { fatalSet, penaltySet, cnt };
}

// 模拟高级对局（用 solver 推荐），追踪每次 solveLevelMarks 的截断情况
const cfg = LEVELS.advanced;
const nb = NB_BY_LEVEL.advanced;
const rng = makeRng(777);

let truncations = 0, calls = 0, maxSolutionNodes = 0;
const truncationCells = [];

for (let g = 0; g < 30; g++) {
  const firstRec = solveLevelMarks('advanced', new Map()).rec.cell;
  const layout = genSeededLayout(cfg, nb, rng, firstRec);
  const marks = new Map();
  let score = 0, safeOpened = 0;

  for (let step = 1; step <= cfg.N; step++) {
    if (safeOpened >= cfg.safeCells) break;
    const res = solveLevelMarks('advanced', marks);
    calls++;
    // 无法直接拿 solutionNodes（未导出），用 beliefCount 和 exactCount 判断
    if (res.exactCount === false) {
      truncations++;
      truncationCells.push(marks.size);
    }
    const cell = res.rec.cell;
    if (layout.fatalSet.has(cell)) break;
    if (layout.penaltySet.has(cell)) {
      score = applyScoreStep(score, 'p');
      marks.set(cell, 'p');
    } else {
      const col = COLOR[layout.cnt[cell]];
      score = applyScoreStep(score, col);
      safeOpened++;
      marks.set(cell, col);
    }
  }
}

console.log(`高级模式 30 局: solveLevelMarks 调用 ${calls} 次, exactCount=false (截断) ${truncations} 次`);
console.log(`截断时的已标注格数: [${truncationCells.join(', ')}]`);

// 另外：检查 fatalRatio 对称拆分的自洽性 —— 验证 pFatal+pPenalty === pAnyMine
const res2 = solveLevelMarks('advanced', new Map([[0, 'g'], [10, 'b']]));
let sumViolation = 0;
for (let i = 0; i < cfg.N; i++) {
  const s = res2.stats[i];
  if (!s) continue;
  const diff = Math.abs((s.pFatal + s.pPenalty) - s.pAnyMine);
  if (diff > 1e-9) sumViolation++;
}
console.log(`pFatal+pPenalty !== pAnyMine 的格子数: ${sumViolation}`);
