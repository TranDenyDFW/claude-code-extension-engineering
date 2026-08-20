/** Validate the generated report before it is delivered. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const h = readFileSync(join(HERE, 'head-to-head-20260819.html'), 'utf8');

const BANNED = [0x2014, 0x2013, 0x2012, 0x2011, 0x2015, 0x2212].map((c) => String.fromCharCode(c));
let dashes = 0;
for (const ch of h) if (BANNED.includes(ch)) dashes++;

const data = JSON.parse(h.match(/const DATA = (\{[\s\S]*?\});\n/)[1]);

console.log(`size:            ${Math.round(h.length / 1024)} KB`);
console.log(`banned dashes:   ${dashes}`);
console.log(`title present:   ${/<title>[^<]+<\/title>/.test(h)}`);
console.log(`cells embedded:  ${data.cells.length}`);
console.log(`answers present: A ${data.cells.filter((c) => c.a.length > 0).length}, C ${data.cells.filter((c) => c.c.length > 0).length}`);
console.log(`rerun present:   ${data.rerun.a.length > 0 && data.rerun.c.length > 0}, verdict ${data.rerun.verdict}`);
console.log(`strata:          ${Object.keys(data.strata).sort().join(', ')}`);
console.log(`tally:           ${JSON.stringify(data.tally)}`);

/* Every color must be defined on bare :root, or the un-stamped system theme renders wrong. */
const rootBlock = h.match(/:root \{([\s\S]*?)\}/)[1];
const tokens = [...rootBlock.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]);
const used = [...new Set([...h.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]))];
const missing = used.filter((t) => !tokens.includes(t));
console.log(`tokens on :root: ${tokens.length}; used: ${used.length}; defined only in a theme block: ${missing.length ? missing.join(', ') : 'none'}`);

const openDetails = (h.match(/<details/g) || []).length;
console.log(`details elements rendered by script: ${openDetails} static (cells are built client side)`);
process.exit(dashes || missing.length ? 1 : 0);
