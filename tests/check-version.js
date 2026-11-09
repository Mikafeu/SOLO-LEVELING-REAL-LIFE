// Vérifie que le numéro de version est identique partout.
// Usage : node tests/check-version.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const app = read('app.js').match(/const APP_VERSION = '([^']+)'/)[1];
const sw = read('sw.js').match(/const VERSION = '([^']+)'/)[1];
const html = [...read('index.html').matchAll(/\?v=([0-9.]+)/g)].map(m => m[1]);
const all = [app, sw, ...html];
if (new Set(all).size !== 1) { console.error('Versions différentes :', { app, sw, html }); process.exit(1); }
console.log('Version OK :', app);
