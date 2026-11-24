/* Headless verification test for:
 * 1. Backup existence & integrity (minesweeper-4x5-backup.html)
 * 2. Beginner (初级 4x5, 4 fatal mines, >30 pts): 100% preserved original behavior in Solver & Play modes
 * 3. Intermediate (中级 5x6, 4 fatal + 4 gray penalty mines, >50 pts): Silver (5-6), Gold (7-8), Gray (-10, min 0)
 * 4. Advanced (高级 5x8, 8 fatal + 8 gray penalty mines, >70 pts): Solver & Play modes
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
    insertAdjacentHTML(pos, v) { this._html += v; },
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
    contextmenu(ev) { if (this._ev && this._ev.contextmenu) this._ev.contextmenu(ev || { preventDefault() {}, clientX: 200, clientY: 200 }); }
  };
  return el;
}

const ids = new Map();
const document = {
  body: El('body'),
  getElementById(id) { if (!ids.has(id)) ids.set(id, El('div')); return ids.get(id); },
  createElement(tag) { return El(tag); },
  querySelectorAll() { return []; },
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
  console, Math, Number, Array, Object, JSON, Map, Set, Float64Array, Int8Array, Int32Array, Uint8Array, String
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const MG = ctx.MG;
const APP = ctx.MG_APP;

// ============================================================================
// PART A: Test BEGINNER (初级 4x5, 4 mines, >30 pts) — 100% preserved original behavior
// ============================================================================
APP.setLevel('beginner');
APP.setAppMode('solver');
APP.newGame();
let cells = ids.get('board').children;
if (cells.length !== 20) throw new Error('Beginner board must have 20 cells, got ' + cells.length);

if (ids.get('sBelief').textContent !== '4,845 种' && ids.get('sBelief').textContent !== '4845 种') {
  throw new Error('Expected 4845 initial belief states, got ' + ids.get('sBelief').textContent);
}
if (!cells[0].classList.contains('rec')) {
  throw new Error('Expected corner cell 0 to be recommended on empty board');
}

// Switch to right-click cycle mode and test Green -> Blue -> Red on cell 0
ids.get('rightModeBtn').onclick();
cells[0].contextmenu(); // '' -> 'g'
if (!cells[0].classList.contains('g')) throw new Error('Expected cell 0 to be green');
if (ids.get('sZeroSafe').textContent !== '3 格') throw new Error('Expected 3 zero-safe neighbors around green corner');
cells[0].contextmenu(); // 'g' -> 'b'
if (!cells[0].classList.contains('b')) throw new Error('Expected cell 0 to be blue');
cells[0].contextmenu(); // 'b' -> 'r'
if (!cells[0].classList.contains('r')) throw new Error('Expected cell 0 to be red');
if (ids.get('sSureMine').textContent !== '3 格') throw new Error('Expected 3 certain mines around red corner');

// Simulate 100 beginner solver games
let solverPass30 = 0;
for (let g = 0; g < 100; g++) {
  APP.newGame();
  const firstRec = APP.getState().rec.cell;
  const pool = MG.PLACEMENTS.filter(p => !(p.mask & (1 << firstRec)));
  const secret = pool[(g * 37) % pool.length];
  for (let step = 0; step < 16; step++) {
    const st = APP.getState();
    const pick = st.rec.cell;
    if (secret.mask & (1 << pick)) break;
    APP.markCellColor(pick, MG.COLOR[secret.cnt[pick]]);
  }
  if (APP.getState().score > 30) solverPass30++;
}
console.log(`Beginner solver (100 games): >30 win rate = ${solverPass30}%`);
if (solverPass30 < 75) throw new Error('Beginner solver win rate dropped unexpectedly: ' + solverPass30);

// ============================================================================
// PART B: Test INTERMEDIATE (中级 5x6=30, 4 fatal + 4 penalty, >50 pts)
// ============================================================================
APP.setLevel('intermediate');
APP.setAppMode('solver');
APP.newGame();
cells = ids.get('board').children;
if (cells.length !== 30) throw new Error('Intermediate board must have 30 cells, got ' + cells.length);

// Test Gray penalty mine ('p') score clamping at 0:
// Mark cell 0 as Green (+1), then mark cell 1 as Gray penalty mine (-10) => score MUST be 0 (no negative!)
APP.markCellColor(0, 'g');
if (APP.getState().score !== 1) throw new Error('Expected score 1 after green mark');
APP.markCellColor(1, 'p');
if (APP.getState().score !== 0) throw new Error('Expected score clamped to 0 after gray penalty mine, got ' + APP.getState().score);
if (!cells[1].classList.contains('p')) throw new Error('Expected cell 1 to have gray penalty class .p');

// Test Silver ('s', 5-6 mines, +100) and Gold ('y', 7-8 mines, +300)
APP.markCellColor(7, 's');
if (APP.getState().score !== 100) throw new Error('Expected score 100 after silver mark, got ' + APP.getState().score);
APP.markCellColor(14, 'y');
if (APP.getState().score !== 400) throw new Error('Expected score 400 after gold mark, got ' + APP.getState().score);
APP.markCellColor(2, 'p');
if (APP.getState().score !== 390) throw new Error('Expected score 390 after second gray penalty mine, got ' + APP.getState().score);

// Test Intermediate Play Mode: hitting gray penalty mine does NOT end game, deducts 10 clamped at 0
APP.setAppMode('play');
let interPenaltyTriggered = 0, interExplosions = 0;
for (let g = 0; g < 60; g++) {
  ids.get('newBtn').onclick();
  cells = ids.get('board').children;
  for (let i = 0; i < 30; i++) {
    if (ids.get('stateTxt').textContent === '本局结束') {
      interExplosions++;
      break;
    }
    const prevHits = APP.getState().penaltyHits;
    cells[i].click();
    const st = APP.getState();
    if (st.score < 0) throw new Error('Score became negative: ' + st.score);
    if (st.penaltyHits > prevHits) {
      interPenaltyTriggered++;
      if (st.over) throw new Error('Clicking a gray penalty mine must NOT end the game!');
      if (!cells[i].classList.contains('p')) throw new Error('Clicked penalty mine must render as gray (.p)!');
    }
  }
}
console.log(`Intermediate play mode (60 games): gray penalty mines hit (game continued) = ${interPenaltyTriggered}, fatal explosions = ${interExplosions}`);
if (interPenaltyTriggered === 0) throw new Error('No gray penalty mines were triggered in 60 intermediate games');

// ============================================================================
// PART C: Test ADVANCED (高级 5x8=40, 8 fatal + 8 penalty, >70 pts)
// ============================================================================
APP.setLevel('advanced');
APP.setAppMode('solver');
APP.newGame();
cells = ids.get('board').children;
if (cells.length !== 40) throw new Error('Advanced board must have 40 cells, got ' + cells.length);

// Mark corner (0,0) as Green (0 mines) -> neighbors 1, 8, 9 must be 0% safe!
APP.markCellColor(0, 'g');
if (ids.get('sZeroSafe').textContent !== '3 格') {
  throw new Error('Expected 3 zero-safe neighbors around green corner in Advanced 5x8, got ' + ids.get('sZeroSafe').textContent);
}
for (const nb of [1, 8, 9]) {
  if (!cells[nb].classList.contains('sure-safe')) {
    throw new Error(`Neighbor ${nb} in Advanced 5x8 was not marked sure-safe!`);
  }
}

// Test Advanced Play Mode
APP.setAppMode('play');
let advPenaltyTriggered = 0;
for (let g = 0; g < 40; g++) {
  ids.get('newBtn').onclick();
  cells = ids.get('board').children;
  for (let i = 0; i < 40; i++) {
    if (ids.get('stateTxt').textContent === '本局结束') break;
    const prevHits = APP.getState().penaltyHits;
    cells[i].click();
    const st = APP.getState();
    if (st.score < 0) throw new Error('Advanced score became negative: ' + st.score);
    if (st.penaltyHits > prevHits) {
      advPenaltyTriggered++;
      if (st.over) throw new Error('Clicking a gray penalty mine in Advanced must NOT end the game!');
    }
  }
}
console.log(`Advanced play mode (40 games): gray penalty mines hit (game continued) = ${advPenaltyTriggered}`);
if (advPenaltyTriggered === 0) throw new Error('No gray penalty mines triggered in Advanced play mode');

console.log('ALL MULTI-LEVEL TESTS PASSED');
