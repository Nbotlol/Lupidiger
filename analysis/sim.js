/* Monte-Carlo / exhaustive evaluation of the probability-first policy. */
require('./engine.js');
const MG = globalThis.MG;
const { N, SCORE, PLACEMENTS, filterBelief, beliefWithout, analyze, recommend } = MG;

function playGame(trueP, firstCell, firstSafe) {
  let belief = firstSafe ? beliefWithout(PLACEMENTS, firstCell) : PLACEMENTS.slice();
  let mask = 0, score = 0, clicks = 0;
  let cell = firstCell;
  let mineFirst = !firstSafe && (trueP.mask & (1 << firstCell)) !== 0;
  if (mineFirst) return { win: false, score: 0, clicks: 1, bust: true };

  for (;;) {
    clicks++;
    if (trueP.mask & (1 << cell)) return { win: false, score, clicks, bust: true };
    const c = trueP.cnt[cell];
    mask |= 1 << cell;
    score += SCORE[c];
    if (score > 30) return { win: true, score, clicks, bust: false };
    belief = filterBelief(belief, cell, c);
    if (!belief.length) throw new Error('inconsistent belief');
    const stats = analyze(belief, mask);
    const pick = recommend(stats, mask);
    if (!pick) return { win: false, score, clicks, bust: false };
    cell = pick.cell;
    if (clicks > 25) throw new Error('runaway');
  }
}

function evaluate(firstCell, sample, firstSafe) {
  const all = PLACEMENTS;
  let layouts = all.filter(p => !(p.mask & (1 << (firstCell))));
  if (!firstSafe) layouts = all;
  let pool = layouts;
  if (sample && sample < layouts.length) {
    pool = [];
    const step = layouts.length / sample;
    for (let i = 0; i < sample; i++) pool.push(layouts[Math.floor(i * step)]);
  }
  let win = 0, scoreSum = 0, bust = 0, clickSum = 0;
  const hist = {};
  for (const p of pool) {
    const r = playGame(p, firstCell, firstSafe);
    if (r.win) { win++; hist[r.clicks] = (hist[r.clicks] || 0) + 1; }
    else if (r.bust) bust++;
    scoreSum += r.score; clickSum += r.clicks;
  }
  return { n: pool.length, winRate: win / pool.length, bustRate: bust / pool.length,
           avgScore: scoreSum / pool.length, avgClicks: clickSum / pool.length, hist };
}

const sample = Number(process.argv[2] || 400);
console.log('layouts total', PLACEMENTS.length);
let best = null;
for (let cell = 0; cell < N; cell++) {
  const r = evaluate(cell, sample, true);   // first click guaranteed safe
  const rr = (cell / MG.C) | 0, cc = cell % MG.C;
  console.log(`first (${rr},${cc})  win ${(r.winRate * 100).toFixed(2)}%  bust ${(r.bustRate * 100).toFixed(2)}%  avgScore ${r.avgScore.toFixed(1)}  clicks ${r.avgClicks.toFixed(2)}`);
  if (!best || r.winRate > best.winRate) best = { cell, ...r };
}
console.log('best first cell:', `(${(best.cell / MG.C) | 0},${best.cell % MG.C})`, best);
