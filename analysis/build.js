const fs = require('fs');
const path = require('path');
const engine = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
const tpl = fs.readFileSync(path.join(__dirname, 'game.template.html'), 'utf8');
const out = tpl.replace('__ENGINE__', engine);
if (out === tpl) throw new Error('placeholder not found');
fs.writeFileSync(path.join(__dirname, '..', 'minesweeper-4x5.html'), out);
fs.writeFileSync(path.join(__dirname, '..', 'index.html'), out);
console.log('written', out.length, 'bytes (minesweeper-4x5.html & index.html)');
