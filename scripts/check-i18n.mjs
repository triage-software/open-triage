// i18n key parity check (en vs pl) — run with: node check-i18n.mjs
import { readFileSync } from 'node:fs';
const flat = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, p + k + '.') : [p + k]));
const en = flat(JSON.parse(readFileSync('messages/en.json', 'utf8')));
const pl = flat(JSON.parse(readFileSync('messages/pl.json', 'utf8')));
const missPl = en.filter((k) => !pl.includes(k));
const missEn = pl.filter((k) => !en.includes(k));
console.log('en keys:', en.length, 'pl keys:', pl.length);
console.log('missing in pl:', missPl.length ? missPl : 'none');
console.log('missing in en:', missEn.length ? missEn : 'none');
process.exit(missPl.length || missEn.length ? 1 : 0);
