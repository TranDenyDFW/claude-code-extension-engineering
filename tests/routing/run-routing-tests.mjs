#!/usr/bin/env node
/**
 * ROUTING SURFACE TEST: does a row exist that sends this question to the right file, and
 * does that file actually contain the answer?
 *
 * WHY THE EXISTING SUITE CANNOT SEE THIS
 * --------------------------------------
 * tests/run-tests.mjs asserts that CONTENT EXISTS in a shipped file. It cannot detect that
 * the wrong file was opened, or that the right one was never reached. Both measured failures
 * on 2026-08-13 were of that kind, and the suite was green throughout.
 *
 * WHAT THIS ADDS BEYOND "A ROW EXISTS"
 * ------------------------------------
 * Two checks carry most of the weight, and neither is about presence:
 *
 *   ROUTE_ANSWER_KEY_MATCHES_DECOY  the answer key also matches the decoy file, so the row
 *                                   cannot tell the two apart and asserts nothing about
 *                                   routing. This is the routing analogue of a hollow suite.
 *   ROUTE_DECOY_UNGUARDED           the decoy carries no disambiguation naming the right
 *                                   destination, so a reader who routes wrong lands
 *                                   somewhere that will not correct them.
 *
 * A fixture with no decoy asserts nothing either, and is rejected as FIXTURE_NO_DECOY.
 *
 *   node tests/routing/run-routing-tests.mjs
 *   node tests/routing/run-routing-tests.mjs --skill-dir <path>   (used by the prove-fail)
 *   node tests/routing/prove-routing.mjs            the 11-mutant must-fail proof
 *   node tests/routing/run-routing-tests.mjs --json
 *
 * exit: 0 all fixtures resolve, 1 a code was raised, 2 cannot run
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referenceDirs } from '../../tools/skill-roots.mjs';
import { disambiguationSection } from '../../tools/collision-check.mjs';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DEFAULT_SKILL_DIR = join(ROOT, 'skills', 'claude-code-extension-engineering');
const MAP = join(HERE, 'routing-map.jsonl');

/** Parse every markdown table row into { cell, files[] } across the routing surface. */
export function parseRoutingRows(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim().startsWith('|') || /^\s*\|[-: ]+\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const files = [];
    for (const c of cells.slice(1)) {
      for (const m of c.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) files.push(basename(m[2]));
      for (const m of c.matchAll(/`([\w.-]+\.md)`/g)) files.push(basename(m[1]));
    }
    rows.push({ cell: cells[0], rest: cells.slice(1).join(' '), files: [...new Set(files)] });
  }
  return rows;
}

export function loadSurface(skillDir) {
  const refDir = join(skillDir, 'references');
  const text = [readFileSync(join(skillDir, 'SKILL.md'), 'utf8'), readFileSync(join(refDir, 'INDEX.md'), 'utf8')].join('\n');
  return { rows: parseRoutingRows(text), refDir };
}

const matchesAll = (cell, rest, pats) => pats.every((p) => new RegExp(p, 'i').test(`${cell} ${rest}`));

export function checkFixture(fx, surface, readRef) {
  const codes = [];
  const wanted = fx.expect.files || [];
  const decoys = (fx.decoys || []).map((d) => d.file);

  if (!fx.provenance || !fx.provenance.kind || !fx.provenance.id) codes.push('FIXTURE_UNSOURCED');
  if (!decoys.length) codes.push('FIXTURE_NO_DECOY');
  if (!['reference', 'out-of-scope', 'refuse'].includes(fx.expect.kind)) codes.push('FIXTURE_UNKNOWN_KIND');

  const hits = surface.rows.filter((r) => matchesAll(r.cell, r.rest, fx.match || []));

  if (fx.expect.kind === 'reference') {
    const reach = hits.filter((r) => r.files.some((f) => wanted.includes(f) || (fx.expect.also_ok || []).includes(f)));
    if (!reach.length) codes.push('ROUTE_UNREACHABLE');
    /* A stricter-matching row that sends the reader to the decoy outranks the correct one:
       more of the question's words match it, so it wins. */
    const decoyRows = hits.filter((r) => r.files.some((f) => decoys.includes(f)));
    for (const d of decoyRows) {
      if (reach.every((r) => d.cell.length > r.cell.length)) { codes.push('ROUTE_DECOY_OUTRANKS'); break; }
    }
  } else if (fx.expect.kind === 'out-of-scope') {
    const slug = String(fx.expect.official || '').replace(/\.md$/, '');
    const named = surface.rows.some((r) => new RegExp(`\\b${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${r.cell} ${r.rest}`));
    if (!named) codes.push('OOS_NO_POINTER');
  }

  for (const f of [...wanted, ...decoys]) if (!readRef(f)) codes.push('ROUTE_DEST_MISSING');

  if (fx.answer_key) {
    const key = new RegExp(fx.answer_key, 'i');
    const inDest = wanted.some((f) => key.test(readRef(f) || ''));
    if (wanted.length && !inDest) codes.push('ROUTE_DEST_LACKS_ANSWER');
    /* The hollowness check. If the key also matches a decoy, the row would pass with the
       reader on the wrong file, so it asserts nothing about routing. */
    if (decoys.some((f) => key.test(readRef(f) || ''))) codes.push('ROUTE_ANSWER_KEY_MATCHES_DECOY');
  }

  /* The reader who took the wrong path still lands somewhere. It must correct them. */
  for (const d of (fx.decoys || [])) {
    if (!d.must_guard) continue;
    /* Reuse the collision gate's extractor rather than writing a second one. The first
       version here matched `[\s\S]*?(?=\n#{1,6}\s|$)` under the /m flag, where `$` is
       end-of-LINE, so the lazy match stopped at the heading and every guarded decoy looked
       unguarded. Two copies of the same parser is how they drift apart. */
    const section = disambiguationSection(readRef(d.file) || '');
    const target = fx.expect.kind === 'out-of-scope' ? String(fx.expect.official || '').replace(/\.md$/, '') : (wanted[0] || '').replace(/\.md$/, '');
    if (!section || !new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(section)) codes.push('ROUTE_DECOY_UNGUARDED');
  }
  return [...new Set(codes)];
}

export function run({ skillDir = DEFAULT_SKILL_DIR, mapPath = MAP } = {}) {
  if (!existsSync(mapPath)) return { problems: [{ id: '-', codes: ['FIXTURE_FILE_MISSING'], detail: mapPath }], total: 0 };
  const fixtures = readFileSync(mapPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const ids = fixtures.map((f) => f.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const surface = loadSurface(skillDir);
  const cache = new Map();
  /* Look in THIS skill first, then in every sibling. After the split a decoy usually lives in
     another skill: "hooks in the Agent SDK" is answered in packaging while `hooks.md` sits in the
     hooks skill, and a reader who takes the wrong path lands there. A resolver that only saw one
     skill would report ROUTE_DEST_MISSING for exactly the fixtures that test the seam, so the
     cross-skill cases would be the ones you could not write a test for. */
  const searchDirs = [surface.refDir, ...referenceDirs(ROOT).filter((d) => d !== surface.refDir)];
  const readRef = (f) => {
    if (!cache.has(f)) {
      const hit = searchDirs.map((d) => join(d, f)).find((x) => existsSync(x));
      cache.set(f, hit ? readFileSync(hit, 'utf8') : null);
    }
    return cache.get(f);
  };
  const problems = [];
  if (dupes.length) problems.push({ id: dupes.join(','), codes: ['FIXTURE_DUP_ID'], detail: 'an id addressed by two rows means an edit to one silently rewrites the other' });
  /* A fixture may name the skill whose surface it belongs to. Routing is a property of ONE skill's
     tables, so after the split a fixture for the packaging skill checked against the delegation
     skill's surface would report ROUTE_UNREACHABLE for a route that is perfectly fine. Fixtures
     without a `skill` are checked against the surface passed in, which is how every pre-split
     fixture keeps working unchanged. */
  const surfaces = new Map();
  const surfaceFor = (fx) => {
    if (!fx.skill) return surface;
    if (!surfaces.has(fx.skill)) {
      const d = join(ROOT, 'skills', fx.skill);
      surfaces.set(fx.skill, existsSync(join(d, 'SKILL.md')) ? loadSurface(d) : null);
    }
    return surfaces.get(fx.skill);
  };
  for (const fx of fixtures) {
    const sf = surfaceFor(fx);
    if (!sf) { problems.push({ id: fx.id, codes: ['FIXTURE_SKILL_MISSING'], detail: fx.skill }); continue; }
    const codes = checkFixture(fx, sf, readRef);
    if (codes.length) problems.push({ id: fx.id, codes, detail: fx.question });
  }
  const allRows = surface.rows.length + [...surfaces.values()].filter(Boolean).reduce((n, x) => n + x.rows.length, 0);
  return { problems, total: fixtures.length, surfaceRows: allRows };
}

if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const si = argv.indexOf('--skill-dir');
  const skillDir = si >= 0 ? argv[si + 1] : DEFAULT_SKILL_DIR;
  if (argv.includes('--prove-fail')) {
    /* Deliberately NOT a dynamic import from here. prove-routing.mjs imports run() from
       this module, so importing it back created a circular top-level await that deadlocked
       and printed "unsettled top-level await" instead of running. The prover is its own
       entry point. */
    console.error('run the prover directly: node tests/routing/prove-routing.mjs');
    process.exit(2);
  }
  const r = run({ skillDir });
  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.problems.length ? 1 : 0); }
  for (const p of r.problems) console.log(`FAIL ${p.id}  ${p.codes.join(',')}  ${String(p.detail).slice(0, 90)}`);
  if (r.problems.length) { console.log(`\nROUTING FAIL: ${r.problems.length} of ${r.total} fixtures raised a code (surface: ${r.surfaceRows} table rows).`); process.exit(1); }
  console.log(`PASS: ${r.total} of ${r.total} routing fixtures resolved against ${r.surfaceRows} table rows.`);
  process.exit(0);
}
