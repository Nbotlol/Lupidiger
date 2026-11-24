/* How many layouts can be cleared WITHOUT ever guessing (only 0%-risk clicks)? */
require('./engine.js');
const MG = globalThis.MG;
const { N, SCORE, PLACEMENTS, filterBelief, beliefWithout, analyze } = MG;

function playGuessFree(trueP, firstCell) {
  let belief = beliefWithout(PLACEMENTS, firstCell);
  let mask = 0, score = 0, cell = firstCell, guesses = 0;
  for (;;) {
    if (trueP.mask & (1 << cell)) return { ok: false, why: 'guess-bust', guesses, score };
    const c = trueP.cnt[cell];
    mask |= 1 << cell;
    score += SCORE[c];
    if (score > 30) return { ok: true, guesses, score };
    belief = filterBelief(belief, cell, c);
    const stats = analyze(belief, mask);
    let best = null;
    for (let i = 0; i < N; i++) {
      const s = stats[i]; if (!s) continue;
      if (s.p === 0 && (!best || s.ev > best.ev)) best = { cell: i, ev: s.ev, p: 0 };
    }
    if (!best) {
      // forced to guess -> count how many such states and stop
      return { ok: false, why: 'forced-guess', guesses: guesses + 1, score };
    }
    cell = best.cell;
  }
}

for (const firstCell of [0, 15, 5, 6, 7]) {
  let noGuessWin = 0, forced = 0, total = 0;
  for (const p of PLACEMENTS) {
    if (p.mask & (1 << firstCell)) continue;
    total++;
    const r = playGuessFree(p, firstCell);
    if (r.ok) noGuessWin++; else forced++;
  }
  const r = (firstCell / MG.C) | 0, c = firstCell % MG.C;
  console.log(`first (${r},${c}): guess-free wins ${noGuessWin}/${total} = ${(noGuessWin / total * 100).toFixed(2)}%  (forced guess ${(forced / total * 100).toFixed(2)}%)`);
}
