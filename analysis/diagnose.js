/* Play actual games using the current Recommender policy and inspect every step & failure mode. */
require('./engine.js');
const MG = globalThis.MG;
const { R, C, N, K, SCORE, COLOR, COLOR_SCORE, PLACEMENTS, filterBelief, beliefFromColorMarks, analyze, recommend } = MG;

function rc(i) { return `(${(i / C | 0) + 1},${(i % C) + 1})`; }

function playOne(layout, verbose) {
  const marks = new Map();
  let score = 0;
  const log = [];
  for (let step = 1; step <= 16; step++) {
    const belief = beliefFromColorMarks(marks);
    const mask = [...marks.keys()].reduce((m, idx) => m | (1 << idx), 0);
    const stats = analyze(belief, mask);
    const rec = recommend(stats, mask, belief);
    const cell = rec.cell;
    const hitMine = (layout.mask & (1 << cell)) !== 0;

    // Count how many 0% cells and tied min-p cells existed at this decision point
    let zeroCells = [], minP = 1, minPCells = [];
    for (let i = 0; i < N; i++) {
      if (!stats[i]) continue;
      if (stats[i].p === 0) zeroCells.push(i);
      if (stats[i].p < minP - 1e-12) { minP = stats[i].p; minPCells = [i]; }
      else if (Math.abs(stats[i].p - minP) < 1e-12) minPCells.push(i);
    }

    if (hitMine) {
      log.push({
        step, cell, rc: rc(cell), outcome: 'BOOM',
        p: rec.p, ev: rec.ev, belief: belief.length,
        zeroCount: zeroCells.length, tiedMinPCount: minPCells.length,
        tiedCells: minPCells.map(i => `${rc(i)}:ev=${stats[i].ev.toFixed(1)},pG=${(stats[i].pGreen*100).toFixed(0)}%`)
      });
      return { cleared: false, steps: step, safeOpened: step - 1, score, passed30: score > 30, log };
    }

    const cnt = layout.cnt[cell];
    const col = COLOR[cnt];
    score += COLOR_SCORE[col];
    marks.set(cell, col);
    log.push({
      step, cell, rc: rc(cell), outcome: col.toUpperCase() + `(+${COLOR_SCORE[col]})`,
      p: rec.p, ev: rec.ev, belief: belief.length, score,
      zeroCount: zeroCells.length, tiedMinPCount: minPCells.length
    });
  }
  return { cleared: true, steps: 16, safeOpened: 16, score, passed30: score > 30, log };
}

// 1. Run 20 sample games and print detailed trace
const pool = PLACEMENTS.filter(p => !(p.mask & 1)); // first click at (1,1) safe
console.log('=== 20 SAMPLE GAMES DETAILED LOG ===');
for (let g = 0; g < 20; g++) {
  const layout = pool[Math.floor((g * 193 + 7) % pool.length)];
  const mines = [];
  for (let i = 0; i < N; i++) if (layout.mask & (1 << i)) mines.push(rc(i));
  const res = playOne(layout);
  const trail = res.log.map(x => `${x.rc}->${x.outcome}[p=${(x.p*100).toFixed(0)}%,tie=${x.tiedMinPCount}]`).join('  ');
  console.log(`Game #${String(g+1).padStart(2,'0')} [Mines: ${mines.join(' ')}] => Final: ${String(res.score).padStart(3,' ')} pts (${res.safeOpened}/16格, ${res.cleared ? 'CLEAR' : 'BOOM '}) | ${trail}`);
}

// 2. Exhaustive run over all 3876 layouts with corner (1,1) safe to diagnose failure patterns
let pass30 = 0, cleared = 0, totalScore = 0;
let boomAtStep = {};
let boomWhenTied = 0, totalBooms = 0;
let firstStepBlueThenNext = {};

for (const layout of pool) {
  const res = playOne(layout);
  if (res.passed30) pass30++;
  if (res.cleared) cleared++;
  totalScore += res.score;
  if (!res.cleared) {
    totalBooms++;
    const last = res.log[res.log.length - 1];
    boomAtStep[last.step] = (boomAtStep[last.step] || 0) + 1;
    if (last.tiedMinPCount > 1) boomWhenTied++;
    if (res.log.length >= 2 && res.log[0].outcome.startsWith('B')) {
      const s2 = res.log[1];
      firstStepBlueThenNext[s2.rc] = (firstStepBlueThenNext[s2.rc] || 0) + 1;
    }
  }
}

console.log('\n=== EXHAUSTIVE DIAGNOSIS OVER ALL 3876 SAFE-START LAYOUTS ===');
console.log(`>30 pts win rate : ${(pass30 / pool.length * 100).toFixed(2)}% (${pass30}/${pool.length})`);
console.log(`16-cell full clear: ${(cleared / pool.length * 100).toFixed(2)}% (${cleared}/${pool.length})`);
console.log(`Average final score: ${(totalScore / pool.length).toFixed(2)} pts`);
console.log(`Boom by step:`, boomAtStep);
console.log(`Booms where multiple cells had the EXACT SAME lowest mine probability: ${boomWhenTied}/${totalBooms} (${(boomWhenTied/totalBooms*100).toFixed(1)}%)`);

// 3. Look closely at Step 2 after Step 1 opens BLUE at (1,1):
console.log('\n=== DEEP DIVE: WHAT HAPPENS AT STEP 2 WHEN (1,1) IS BLUE? ===');
const m1 = new Map([[0, 'b']]);
const b1 = beliefFromColorMarks(m1);
const st1 = analyze(b1, 1);
for (let i = 1; i < N; i++) {
  const s = st1[i];
  console.log(`Cell ${rc(i)} (idx ${String(i).padStart(2,' ')}): pMine=${(s.p*100).toFixed(2)}% | EV=+${s.ev.toFixed(2)} | pGreen=${(s.pGreen*100).toFixed(1)}% pBlue=${(s.pBlue*100).toFixed(1)}% pRed=${(s.pRed*100).toFixed(1)}%`);
}
