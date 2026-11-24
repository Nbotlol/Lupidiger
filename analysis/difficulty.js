/* Difficulty sweep: win rate vs. score threshold, greedy probability-first policy,
   first click on a corner, first click guaranteed safe. */
require('./engine.js');
const MG = globalThis.MG;
const { N, SCORE, PLACEMENTS, filterBelief, beliefWithout, analyze, recommend } = MG;

function play(trueP, firstCell, target) {
  let belief = beliefWithout(PLACEMENTS, firstCell);
  let mask = 0, score = 0, cell = firstCell;
  for (let step = 0; step < 20; step++) {
    if (trueP.mask & (1 << cell)) return { win: false, score, steps: step + 1 };
    const c = trueP.cnt[cell];
    mask |= 1 << cell;
    score += SCORE[c];
    if (score > target) return { win: true, score, steps: step + 1 };
    belief = filterBelief(belief, cell, c);
    const pick = recommend(analyze(belief, mask), mask);
    if (!pick) return { win: false, score, steps: step + 1 };
    cell = pick.cell;
  }
  return { win: false, score, steps: 20 };
}

const firstCell = Number(process.argv[2] || 0);
const layouts = PLACEMENTS.filter(p => !(p.mask & (1 << firstCell)));
const targets = [20, 25, 30, 35, 40, 45, 50, 55, 60];
for (const t of targets) {
  let win = 0;
  for (const p of layouts) if (play(p, firstCell, t).win) win++;
  console.log(`target >${t}: win ${(win / layouts.length * 100).toFixed(2)}%`);
}
