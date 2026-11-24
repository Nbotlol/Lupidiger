/* Headless verification test for:
 * 1. Backup existence & integrity (minesweeper-4x5-backup.html)
 * 2. Right-click color annotation recommender mode (only knowing color ranges 0 / 1-2 / 3-4)
 * 3. Playable random mode (>30 pts continues, color-only display, explosion animation)
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const backupPath = path.join(__dirname, '..', 'minesweeper-4x5-backup.html');
if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size < 20000) {
  throw new Error('Backup file minesweeper-4x5-backup.html is missing or incomplete!');
}

const htmlPath = path.join(__dirname, '..', 'minesweeper-4x5.html');
const html = fs.readFileSync(htmlPath, 'utf8');

if ((html.match(/\uFFFD/g) || []).length > 0) {
  throw new Error('Encoding corruption detected (\uFFFD)');
}
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) throw new Error('no script found in minesweeper-4x5.html');
const code = m[1];

let canvasDrawCalls = 0;

function El(tag) {
  const el = {
    tagName: tag,
    style: { setProperty() {} },
    dataset: {},
    children: [],
    textContent: '',
    _html: '',
    width: 1024,
    height: 768,
    offsetWidth: 100,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, v) { if (v === undefined) v = !this._s.has(c); v ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    set innerHTML(v) { this._html = v; this._num = null; this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); },
    querySelector(sel) {
      if (sel === '.num') { if (!this._num) this._num = El('span'); return this._num; }
      return null;
    },
    querySelectorAll() { return []; },
    contains() { return false; },
    getBoundingClientRect() { return { left: 200, top: 200, width: 80, height: 80 }; },
    getContext() {
      return {
        clearRect() {},
        save() {},
        restore() {},
        beginPath() {},
        arc() { canvasDrawCalls++; },
        stroke() { canvasDrawCalls++; },
        fill() { canvasDrawCalls++; },
        translate() {},
        rotate() {},
        fillRect() { canvasDrawCalls++; }
      };
    },
    setAttribute() {},
    getAttribute() { return ''; },
    addEventListener(ev, fn) { (this._ev = this._ev || {})[ev] = fn; },
    click() { if (this._ev && this._ev.click) this._ev.click({}); },
    contextmenu(ev) { if (this._ev && this._ev.contextmenu) this._ev.contextmenu(ev || { preventDefault() {}, clientX: 200, clientY: 200 }); },
    touchstart(ev) { if (this._ev && this._ev.touchstart) this._ev.touchstart(ev || { touches: [{ clientX: 180, clientY: 220 }] }); },
    touchend(ev) { if (this._ev && this._ev.touchend) this._ev.touchend(ev || { preventDefault() {} }); }
  };
  return el;
}

const ids = new Map();
const document = {
  body: El('body'),
  getElementById(id) { if (!ids.has(id)) ids.set(id, El('div')); return ids.get(id); },
  createElement(tag) { return El(tag); },
  addEventListener() {}
};

const window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener() {}
};

let pendingRaf = null;
const ctx = {
  document,
  window,
  localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); } },
  requestAnimationFrame: (fn) => { if (!pendingRaf) { pendingRaf = fn; fn(); pendingRaf = null; } return 1; },
  setTimeout: () => 1,
  clearTimeout: () => {},
  console, Math, Number, Array, Object, JSON, Map, Set, Float64Array, Int8Array, String
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const MG = ctx.MG;
const APP = ctx.MG_APP;

// ============================================================================
// PART A: Test Right-Click Color Annotation Recommender Mode ("solver")
// ============================================================================
APP.setAppMode('solver');
APP.newGame();
let cells = ids.get('board').children;

// 1. On empty board, all 4845 placements are valid, and corner (0,0) is recommended
if (ids.get('sBelief').textContent !== '4845 种') {
  throw new Error('Expected 4845 initial belief states, got ' + ids.get('sBelief').textContent);
}
if (!cells[0].classList.contains('rec')) {
  throw new Error('Expected corner cell 0 to be recommended on empty board');
}

// 2. Test right-click popup & mobile touch tap / long-press annotation
cells[0].contextmenu(); // opens popup menu in 'menu' rightClickStyle
if (!ids.get('colorMenu').classList.contains('show')) {
  throw new Error('Right-click did not open floating color menu');
}
// Also test mobile tap with active default green brush ('g') on cell 4
cells[4].click();
if (!cells[4].classList.contains('g')) {
  throw new Error('Mobile tap with active green brush did not mark cell 4 as green');
}
cells[4].click(); // tapping again toggles/clears cell 4
if (cells[4].classList.contains('g')) {
  throw new Error('Tapping cell 4 again did not clear its mark');
}
// Switch to right-click cycle mode and right-click cell 0 -> 'g' (Green: 0 mines)
ids.get('rightModeBtn').onclick();
cells[0].contextmenu(); // '' -> 'g'
if (!cells[0].classList.contains('g')) {
  throw new Error('Right-click cycle did not mark cell 0 as green (g)');
}
// Since cell 0 (top-left corner) is Green (0 adjacent mines), its 3 neighbors (1, 5, 6)
// MUST be 0% mine probability (100% guaranteed safe), and belief count must be C(16,4)=1820!
if (ids.get('sBelief').textContent !== '1820 种') {
  throw new Error('Expected C(16,4)=1820 layouts when corner is Green, got ' + ids.get('sBelief').textContent);
}
if (ids.get('sZeroSafe').textContent !== '3 格') {
  throw new Error('Expected 3 guaranteed-safe neighbors around green corner, got ' + ids.get('sZeroSafe').textContent);
}
for (const nb of [1, 5, 6]) {
  if (!cells[nb].classList.contains('sure-safe')) {
    throw new Error(`Neighbor ${nb} of green corner was not marked sure-safe!`);
  }
}

// 3. Verify that Blue ('b') uses the RANGE {1, 2} and NOT an exact count:
// When cell 0 is Blue ('b'), layouts with 1 mine in {1,5,6} (3 * C(16,3) = 1680)
// PLUS layouts with 2 mines in {1,5,6} (3 * C(16,2) = 360) = 2040 layouts must be kept!
cells[0].contextmenu(); // 'g' -> 'b'
if (!cells[0].classList.contains('b')) {
  throw new Error('Second right-click cycle did not mark cell 0 as blue (b)');
}
if (ids.get('sBelief').textContent !== '2040 种') {
  throw new Error('Blue corner must keep both 1-mine and 2-mine layouts (1680+360=2040), got ' + ids.get('sBelief').textContent);
}

// 4. Verify that Red ('r') uses the RANGE {3, 4}:
// For corner cell 0 (only 3 neighbors), 3 mines in {1,5,6} has C(16,1)=16 layouts.
cells[0].contextmenu(); // 'b' -> 'r'
if (!cells[0].classList.contains('r')) {
  throw new Error('Third right-click cycle did not mark cell 0 as red (r)');
}
if (ids.get('sBelief').textContent !== '16 种') {
  throw new Error('Red corner must have 16 valid layouts, got ' + ids.get('sBelief').textContent);
}
// And its 3 neighbors (1, 5, 6) must all be identified as 100% certain mines!
if (ids.get('sSureMine').textContent !== '3 格') {
  throw new Error('Red corner must lock 3 certain mines in {1,5,6}, got ' + ids.get('sSureMine').textContent);
}

// 5. Simulate 200 full games guided ONLY by the Right-Click Color Recommender:
// External oracle has a secret layout, player clicks the recommender's suggested cell,
// observes ONLY its color ('g'/'b'/'r'), right-clicks to annotate that color, and repeats.
let solverPass30 = 0, solverFullClear = 0, solverTotalScore = 0;
for (let g = 0; g < 200; g++) {
  APP.newGame();
  cells = ids.get('board').children;
  // Pick a secret layout that is safe on the first recommended cell (cell 0)
  const firstRec = APP.getState().rec.cell;
  const pool = MG.PLACEMENTS.filter(p => !(p.mask & (1 << firstRec)));
  const secret = pool[(g * 19) % pool.length];

  for (let step = 0; step < 16; step++) {
    const st = APP.getState();
    if (!st.rec) throw new Error('Recommender failed to produce a recommendation at step ' + step);
    const pick = st.rec.cell;
    if (secret.mask & (1 << pick)) {
      // Hit a mine in external game
      break;
    }
    const trueCount = secret.cnt[pick];
    const observedColor = MG.COLOR[trueCount]; // Player only sees color ('g', 'b', or 'r')!
    APP.markCellColor(pick, observedColor);
  }
  const finalScore = APP.getState().score;
  solverTotalScore += finalScore;
  if (finalScore > 30) solverPass30++;
  if (APP.getState().colorMarks.size === 16) solverFullClear++;
}
console.log(`Solver right-click recommender (200 games): >30 rate ${(solverPass30 / 2).toFixed(1)}%, full-clear ${(solverFullClear / 2).toFixed(1)}%, avg score ${(solverTotalScore / 200).toFixed(1)}`);

// ============================================================================
// PART B: Test Playable Random Game Mode ("play") — pure gameplay, NO right-click annotation & NO recommendation UI
// ============================================================================
APP.setAppMode('play');
let gamesContinuedPast30 = 0, fullClears = 0, mineExplosions = 0;

// Verify right-click annotation and recommendation overlays are disabled in play mode
cells = ids.get('board').children;
cells[0].contextmenu();
if (ids.get('colorMenu').classList.contains('show')) {
  throw new Error('Right-click color menu should NOT open in play mode!');
}
if (ids.get('recBanner').style.display !== 'none') {
  throw new Error('Recommendation banner should be hidden in play mode!');
}
if (cells.some(c => c.classList.contains('rec') || c.classList.contains('sure-safe'))) {
  throw new Error('Play mode cells should NOT have recommendation or probability classes!');
}

for (let g = 0; g < 150; g++) {
  ids.get('newBtn').onclick();
  cells = ids.get('board').children;
  cells[0].click();

  let sawAliveAbove30 = false;
  for (let step = 1; step <= 20; step++) {
    const sc = Number(ids.get('score').textContent);
    const st = ids.get('stateTxt').textContent;

    for (let i = 0; i < 20; i++) {
      if (cells[i].classList.contains('open')) {
        const numTxt = cells[i].querySelector('.num').textContent;
        if (numTxt !== '') throw new Error(`Cell ${i} displayed mine count "${numTxt}"!`);
      }
      if (cells[i].classList.contains('rec')) {
        throw new Error('Play mode cell should never show .rec recommendation!');
      }
    }

    if (st === '本局结束') {
      const openCount = cells.filter(c => c.classList.contains('open')).length;
      const explodedCount = cells.filter(c => c.classList.contains('exploded')).length;
      if (openCount === 16) fullClears++;
      else if (explodedCount === 1) mineExplosions++;
      else throw new Error(`Unexpected end state: open=${openCount}, exploded=${explodedCount}`);
      break;
    }
    if (sc > 30) sawAliveAbove30 = true;

    const nextIdx = cells.findIndex(c => !c.classList.contains('open'));
    cells[nextIdx].click();
  }
  if (sawAliveAbove30) gamesContinuedPast30++;
}

console.log(`Play mode (150 games): continued past 30=${gamesContinuedPast30}, fullClears=${fullClears}, explosions=${mineExplosions}, canvasCalls=${canvasDrawCalls}`);
if (gamesContinuedPast30 === 0 || mineExplosions === 0 || canvasDrawCalls === 0) {
  throw new Error('Play mode checks failed');
}
console.log('ALL TESTS PASSED');
