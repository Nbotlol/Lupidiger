/* Benchmark & diagnosis of Advanced mode (5x8 = 40 cells, 8 fatal mines + 8 gray penalty mines, target > 70)
 * With Silver = +100 (5-6 mines), Gold = +300 (7-8 mines), Red = +20 (3-4), Blue = +5 (1-2), Green = +1 (0), Gray = -10 (min 0).
 */
require('./engine.js');
const MG = globalThis.MG;
const { LEVELS, SCORE, COLOR, COLOR_SCORE, NB_BY_LEVEL, applyScoreStep, solveLevelMarks } = MG;

const cfg = LEVELS.advanced;
const nb = NB_BY_LEVEL.advanced;

function rc(i) { return `(${(i / cfg.C | 0) + 1},${(i % cfg.C) + 1})`; }

// 1. Theoretical cell expected values on an empty 5x8 board with 16 total mines out of 39 remaining cells
// (given the clicked cell itself is safe)
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - i + 1) / i;
  return r;
}

console.log('=== 1. ADVANCED (5x8, 16 MINES) FIRST-CLICK CELL TYPE ANALYSIS (IF SAFE) ===');
for (const [label, deg] of [['Corner (deg=3)', 3], ['Edge   (deg=5)', 5], ['Inner  (deg=8)', 8]]) {
  let ev = 0;
  let distStr = [];
  const pCol = { g: 0, b: 0, r: 0, s: 0, y: 0 };
  for (let k = 0; k <= deg; k++) {
    const p = (comb(deg, k) * comb(39 - deg, 16 - k)) / comb(39, 16);
    ev += p * SCORE[k];
    pCol[COLOR[k]] += p;
  }
  console.log(
    `${label}: E[score|safe] = +${ev.toFixed(2).padStart(5,' ')} | ` +
    `G(+1): ${(pCol.g*100).toFixed(1).padStart(4,' ')}% | ` +
    `B(+5): ${(pCol.b*100).toFixed(1).padStart(4,' ')}% | ` +
    `R(+20): ${(pCol.r*100).toFixed(1).padStart(4,' ')}% | ` +
    `S(+100): ${(pCol.s*100).toFixed(1).padStart(4,' ')}% | ` +
    `Y(+300): ${(pCol.y*100).toFixed(1).padStart(4,' ')}%`
  );
}

// Deterministic seeded PRNG for reproducible benchmark layouts
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function genSeededLayout(rng, firstSafeCell) {
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

function playAdvancedGame(layout, customPicker) {
  const marks = new Map();
  let score = 0;
  let safeOpened = 0;
  let penaltyHits = 0;
  let reached70 = false;
  let maxScoreReached = 0;
  const log = [];

  for (let step = 1; step <= cfg.N; step++) {
    if (safeOpened >= cfg.safeCells) break;
    const res = solveLevelMarks('advanced', marks);
    const cell = customPicker ? customPicker(res, marks, score) : (res.rec ? res.rec.cell : -1);
    if (cell < 0) break;

    const s = res.stats[cell];
    if (layout.fatalSet.has(cell)) {
      log.push({ step, rc: rc(cell), out: 'BOOM', pFatal: s ? s.pFatal : 0, ev: s ? s.ev : 0, score });
      return { cleared: false, reached70, finalScore: score, maxScoreReached, safeOpened, penaltyHits, steps: step, log };
    }
    if (layout.penaltySet.has(cell)) {
      score = applyScoreStep(score, 'p');
      penaltyHits++;
      marks.set(cell, 'p');
      log.push({ step, rc: rc(cell), out: 'GRAY(-10)', pFatal: s ? s.pFatal : 0, ev: s ? s.ev : 0, score });
    } else {
      const c = layout.cnt[cell];
      const col = COLOR[c];
      score = applyScoreStep(score, col);
      safeOpened++;
      marks.set(cell, col);
      if (score > 70) reached70 = true;
      if (score > maxScoreReached) maxScoreReached = score;
      log.push({ step, rc: rc(cell), out: `${col.toUpperCase()}(+${COLOR_SCORE[col]})`, pFatal: s ? s.pFatal : 0, ev: s ? s.ev : 0, score });
    }
  }
  return { cleared: true, reached70, finalScore: score, maxScoreReached, safeOpened, penaltyHits, steps: log.length, log };
}

// Run 15 sample games with current default policy and log them
console.log('\n=== 2. 15 SAMPLE ADVANCED GAMES WITH CURRENT STRATEGY ===');
const rngSample = makeRng(20261125);
for (let g = 1; g <= 15; g++) {
  const firstRec = solveLevelMarks('advanced', new Map()).rec.cell;
  const layout = genSeededLayout(rngSample, firstRec);
  const r = playAdvancedGame(layout, null);
  const trail = r.log.map(x => `${x.rc}:${x.out}[pF=${(x.pFatal*100).toFixed(0)}%]`).join(' ');
  console.log(
    `Game #${String(g).padStart(2,'0')} => Final: ${String(r.finalScore).padStart(4,' ')} pts ` +
    `(${r.reached70 ? 'WIN >70' : 'LOSE   '}, ${r.safeOpened}/24 safe, ${r.penaltyHits} gray, ${r.cleared ? 'CLEAR' : 'BOOM '}) | ${trail}`
  );
}
