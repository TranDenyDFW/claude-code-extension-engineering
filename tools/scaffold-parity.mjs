#!/usr/bin/env node
/**
 * Byte parity for the generated protect-path bundles, across a refactor.
 *
 * WHY THIS EXISTS
 * ---------------
 * `extension-scaffold` is about to be split into purpose packs, and the
 * path-protection logic moves into one of them. Moving code cannot change its
 * output, but "cannot" is exactly the kind of claim this repo has learned to
 * distrust: the same file has already shipped four defects behind a green build,
 * and the gate that would have caught them asserted a PASS COUNT rather than an
 * artifact.
 *
 * So the refactor is bounded by evidence instead of by argument. Every frozen
 * gate probe is generated from the PRE-refactor code and its bytes committed
 * here. After the move, `--check` regenerates and compares byte for byte, per
 * file. Semantic similarity is not accepted where exact equality is checkable.
 *
 * A DIFFERENCE IS NOT AUTOMATICALLY A FAILURE, but it is automatically a
 * DECISION. `JUSTIFIED` below lists differences that are intended, each with a
 * reason and a per-file assertion of what may change. Anything not listed fails.
 * That is the difference between a reviewed change and drift.
 *
 * usage:
 *   node tools/scaffold-parity.mjs --capture    write the goldens (pre-refactor)
 *   node tools/scaffold-parity.mjs --check      regenerate and compare (post-refactor)
 *   node tools/scaffold-parity.mjs --self-test  includes must-fail cases
 *
 * exit: 0 parity holds, 1 an unjustified difference, 2 no goldens captured yet
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const GOLDEN_DIR = join(ROOT, 'tests', 'scaffold-parity');

/**
 * Differences that are INTENDED, listed before the refactor rather than
 * discovered after it. Empty at capture time on purpose: if the move is clean,
 * it stays empty, and every entry added later is a reviewed decision with a
 * stated reason rather than an accepted surprise.
 *
 * Shape: { probe, file, why, allow(oldText, newText) -> boolean }
 */
export const JUSTIFIED = [];

// LF-normalised, because a Windows checkout rewrites line endings and a parity
// gate that reports CRLF as tampering is a gate that gets ignored. The catalog
// crosscheck already learned this the hard way.
const norm = (s) => String(s).split('\r\n').join('\n');
const sha = (s) => createHash('sha256').update(norm(s), 'utf8').digest('hex');

/** Generate every frozen probe's bundle IN MEMORY, keyed by probe id. */
export async function generateAll() {
  const M = await import('./extension-scaffold.mjs');
  const out = new Map();
  for (const p of M.GATE_PROBES) {
    const a = M.analyse(p.requirement);
    if (!a.supported) { out.set(p.id, { unsupported: true, reason: a.reason }); continue; }
    const { files, conf } = M.buildBundle(p.id, p.requirement, a);
    out.set(p.id, { files, mechanism: a.mechanism, cases: conf.cases.length, strict: !!conf.strict });
  }
  return out;
}

function capture(all) {
  rmSync(GOLDEN_DIR, { recursive: true, force: true });
  mkdirSync(GOLDEN_DIR, { recursive: true });
  const index = {};
  for (const [id, b] of all) {
    if (b.unsupported) { index[id] = { unsupported: true, reason: b.reason }; continue; }
    const dir = join(GOLDEN_DIR, id);
    mkdirSync(dir, { recursive: true });
    const sums = {};
    for (const [rel, content] of Object.entries(b.files)) {
      writeFileSync(join(dir, rel), content);
      sums[rel] = sha(content);
    }
    index[id] = { mechanism: b.mechanism, cases: b.cases, strict: b.strict, files: sums };
  }
  writeFileSync(join(GOLDEN_DIR, 'INDEX.json'), JSON.stringify({
    _what: 'Byte goldens for the protect-path bundles, captured BEFORE the purpose-pack refactor.',
    _how: 'node tools/scaffold-parity.mjs --check regenerates and compares. Hashes are over LF-normalised bytes.',
    capturedFrom: 'tools/extension-scaffold.mjs GATE_PROBES, pre-refactor',
    probes: index,
  }, null, 2) + '\n');
  return index;
}

/**
 * Compare freshly generated bundles against the goldens. Pure over its inputs so
 * the self-test can feed it a known-bad pair; the previous generation of gates in
 * this repo compared a value against itself and could not fail.
 */
export function parityLines(golden, fresh, justified = JUSTIFIED) {
  const out = [];
  const gp = golden.probes || {};
  for (const [id, g] of Object.entries(gp)) {
    const f = fresh.get(id);
    if (!f) { out.push(`PARITY ${id}: probe present in the goldens, ABSENT from this run`); continue; }
    if (g.unsupported || f.unsupported) {
      if (!!g.unsupported !== !!f.unsupported) out.push(`PARITY ${id}: unsupported was ${!!g.unsupported}, now ${!!f.unsupported}`);
      continue;
    }
    if (g.mechanism !== f.mechanism) out.push(`PARITY ${id}: mechanism was ${g.mechanism}, now ${f.mechanism}`);
    if (g.cases !== f.cases) out.push(`PARITY ${id}: case count was ${g.cases}, now ${f.cases}`);
    if (!!g.strict !== !!f.strict) out.push(`PARITY ${id}: strict was ${!!g.strict}, now ${!!f.strict}`);
    const gFiles = Object.keys(g.files || {}).sort();
    const fFiles = Object.keys(f.files || {}).sort();
    if (gFiles.join(',') !== fFiles.join(',')) {
      out.push(`PARITY ${id}: file list was [${gFiles.join(', ')}], now [${fFiles.join(', ')}]`);
      continue;
    }
    for (const rel of gFiles) {
      const want = g.files[rel];
      const got = sha(f.files[rel]);
      if (want === got) continue;
      const j = justified.find((x) => x.probe === id && x.file === rel);
      if (j) {
        const oldText = readFileSync(join(GOLDEN_DIR, id, rel), 'utf8');
        if (j.allow(oldText, f.files[rel])) continue;
        out.push(`PARITY ${id}/${rel}: differs, and the JUSTIFIED entry's own allow() rejected it (${j.why})`);
        continue;
      }
      out.push(`PARITY ${id}/${rel}: bytes differ and no justified difference is recorded`);
    }
  }
  for (const id of fresh.keys()) if (!(id in gp)) out.push(`PARITY ${id}: probe in this run, ABSENT from the goldens`);
  return out;
}

async function check() {
  const idxPath = join(GOLDEN_DIR, 'INDEX.json');
  if (!existsSync(idxPath)) {
    console.log(`scaffold-parity: no goldens at ${GOLDEN_DIR}`);
    console.log('CANNOT CHECK: run --capture on the pre-refactor tree first.');
    return 2;
  }
  const golden = JSON.parse(readFileSync(idxPath, 'utf8'));
  const fresh = await generateAll();
  const lines = parityLines(golden, fresh);
  const n = Object.keys(golden.probes || {}).length;
  console.log(`scaffold-parity: ${n} frozen probe(s) against the pre-refactor goldens`);
  for (const [id, g] of Object.entries(golden.probes || {})) {
    const files = g.unsupported ? 'UNSUPPORTED, as captured' : `${Object.keys(g.files).length} file(s), ${g.cases} cases, ${g.mechanism}${g.strict ? ', strict' : ''}`;
    console.log(`  ${id.padEnd(4)} ${files}`);
  }
  if (JUSTIFIED.length) {
    console.log('  justified differences:');
    for (const j of JUSTIFIED) console.log(`    ${j.probe}/${j.file}  ${j.why}`);
  }
  if (lines.length) {
    console.log('');
    for (const l of lines) console.log(`  ${l}`);
    console.log(`\nFAIL ${lines.length} parity difference(s). Moving code cannot change output:`);
    console.log('either the move was not a move, or the difference is intended and belongs in JUSTIFIED.');
    return 1;
  }
  console.log('\nPASS every frozen probe generates byte-identical artifacts.');
  return 0;
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const check2 = (n, ok, got) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `  (${got})`}`); if (!ok) fails++; };

  const G = { probes: { P1: { mechanism: 'permission-deny', cases: 7, strict: true, files: { 'a.txt': sha('hello') } } } };
  const same = new Map([['P1', { mechanism: 'permission-deny', cases: 7, strict: true, files: { 'a.txt': 'hello' } }]]);
  check2('identical artifacts report no difference', parityLines(G, same, []).length === 0);

  check2('MUST FAIL: changed bytes are reported',
    parityLines(G, new Map([['P1', { mechanism: 'permission-deny', cases: 7, strict: true, files: { 'a.txt': 'HELLO' } }]]), []).some((l) => /bytes differ/.test(l)));
  check2('MUST FAIL: a changed mechanism is reported',
    parityLines(G, new Map([['P1', { mechanism: 'advisory', cases: 7, strict: true, files: { 'a.txt': 'hello' } }]]), []).some((l) => /mechanism was/.test(l)));
  check2('MUST FAIL: a changed case count is reported',
    parityLines(G, new Map([['P1', { mechanism: 'permission-deny', cases: 6, strict: true, files: { 'a.txt': 'hello' } }]]), []).some((l) => /case count/.test(l)));
  check2('MUST FAIL: a lost strict flag is reported',
    parityLines(G, new Map([['P1', { mechanism: 'permission-deny', cases: 7, strict: false, files: { 'a.txt': 'hello' } }]]), []).some((l) => /strict was/.test(l)));
  check2('MUST FAIL: an added file is reported',
    parityLines(G, new Map([['P1', { mechanism: 'permission-deny', cases: 7, strict: true, files: { 'a.txt': 'hello', 'b.txt': 'x' } }]]), []).some((l) => /file list/.test(l)));
  check2('MUST FAIL: a vanished probe is reported', parityLines(G, new Map(), []).some((l) => /ABSENT from this run/.test(l)));
  check2('MUST FAIL: a brand new probe is reported',
    parityLines(G, new Map([...same, ['P9', { mechanism: 'x', cases: 1, strict: false, files: {} }]]), []).some((l) => /ABSENT from the goldens/.test(l)));
  check2('an unsupported probe matching its captured state is fine',
    parityLines({ probes: { P7: { unsupported: true } } }, new Map([['P7', { unsupported: true }]]), []).length === 0);
  check2('MUST FAIL: a probe that STOPS being unsupported is reported',
    parityLines({ probes: { P7: { unsupported: true } } }, new Map([['P7', { mechanism: 'advisory', cases: 2, files: {} }]]), []).some((l) => /unsupported was/.test(l)));
  check2('CRLF alone is not a difference, or a Windows checkout fails the gate',
    parityLines({ probes: { P1: { mechanism: 'm', cases: 1, strict: false, files: { 'a.txt': sha('a\nb\n') } } } },
      new Map([['P1', { mechanism: 'm', cases: 1, strict: false, files: { 'a.txt': 'a\r\nb\r\n' } }]]), []).length === 0);
  check2('JUSTIFIED starts EMPTY, so a clean move stays clean', JUSTIFIED.length === 0 || JUSTIFIED.every((j) => j.why && j.allow));

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

if (IS_MAIN) {
  const a = process.argv.slice(2);
  if (a.includes('--self-test')) process.exit(selfTest());
  if (a.includes('--capture')) {
    const all = await generateAll();
    const idx = capture(all);
    console.log(`captured ${Object.keys(idx).length} probe(s) into ${relative(ROOT, GOLDEN_DIR)}`);
    for (const [id, g] of Object.entries(idx)) {
      console.log(`  ${id.padEnd(4)} ${g.unsupported ? 'UNSUPPORTED' : `${Object.keys(g.files).length} file(s), ${g.cases} cases, ${g.mechanism}`}`);
    }
    process.exit(0);
  }
  process.exit(await check());
}
