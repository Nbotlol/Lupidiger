const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'minesweeper-4x5.html'), 'utf8');
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
function El(tag) {
  const el = {
    tagName: tag, style: {}, dataset: {}, children: [], textContent: '', _html: '', className: '',
    classList: { _s: new Set(), add(...c){c.forEach(x=>this._s.add(x))}, remove(...c){c.forEach(x=>this._s.delete(x))},
      toggle(c,v){ if(v===undefined) v=!this._s.has(c); v?this._s.add(c):this._s.delete(c); }, contains(c){return this._s.has(c)} },
    set innerHTML(v){ this._html=v; if(v===''){ this._num=null; this.children=[]; } },
    get innerHTML(){ return this._html; },
    appendChild(c){ this.children.push(c); },
    querySelector(sel){ if(sel==='.num'){ if(!this._num) this._num=El('span'); return this._num; } return null; },
    setAttribute(){}, addEventListener(ev,fn){ (this._ev=this._ev||{})[ev]=fn; }, click(){ this._ev&&this._ev.click&&this._ev.click(); }
  };
  return el;
}
const ids = new Map();
const document = { getElementById(id){ if(!ids.has(id)) ids.set(id, El('div')); return ids.get(id); },
  createElement(t){ return El(t); }, addEventListener(){} };
const ctx = { document, setTimeout: fn => 0, console, Math, Number, Array, Object, JSON, Map, Set, Float64Array, Int8Array, String };
vm.createContext(ctx); vm.runInContext(code, ctx);

ids.get('newBtn').onclick();
ids.get('coachBtn').onclick();
let cells = ids.get('board').children;
for (let step = 0; step < 12; step++) {
  if (ids.get('stateTxt').textContent === '本局结束') { console.log('END score', ids.get('score').textContent); break; }
  let best = null, list = [];
  for (let i = 0; i < 20; i++) {
    const tag = cells[i].children.find(c => String(c.className).startsWith('prob'));
    if (tag) list.push([i, tag.textContent]);
    if (tag) { const p = parseFloat(tag.textContent); if (best === null || p < best.p) best = { i, p, txt: tag.textContent }; }
  }
  console.log('step', step, 'probs', JSON.stringify(list), '-> pick', best);
  let target = best ? best.i : cells.findIndex(c => !c.classList.contains('open'));
  console.log('   clicking', target, 'classes', [...cells[target].classList._s]);
  cells[target].click();
  console.log('   score', ids.get('score').textContent, 'state', ids.get('stateTxt').textContent);
}
