#!/usr/bin/env node
/**
 * OUT-OF-SCOPE CHECK: every question shape this library deliberately does NOT answer must
 * carry a pointer to the official page that does, and that pointer must be real.
 *
 * WHY A COVERAGE LEDGER IS DANGEROUS, AND WHAT MAKES THIS ONE SAFE
 * ---------------------------------------------------------------
 * This is a coverage metric, which is the exact shape that rewards fabrication: the cheapest
 * way to raise "shapes covered" is to invent shapes, and the cheapest way to satisfy a
 * pointer check is to paste the official page's vocabulary into a reference file. Both would
 * make the number go up while making the library worse.
 *
 * Three properties stop that, and none of them is a promise:
 *
 *   1. PROVENANCE-ONLY GROWTH. An entry is admissible only with `benchmark` (a question id
 *      from a measured run, plus its run directory), `harvested` (an id from the GitHub or
 *      Google-demand corpus), or `collision` (auto-implied: every `different-subject` row in
 *      collisions.json REQUIRES an entry). The list cannot grow from someone imagining a
 *      question, because there is nowhere to put an unsourced one.
 *   2. THE POINTER MUST RESOLVE. `official_page` has to exist in the docs mirror AND contain
 *      the entry's own subject terms. A fabricated entry with a fabricated pointer dies on
 *      OOS_POINTER_PAGE_LACKS_SUBJECT.
 *   3. FABRICATED COVERAGE IS A FAILURE, NOT A WIN. Subject terms appearing in a reference
 *      file OUTSIDE a declared pointer block raise OOS_FABRICATED_COVERAGE. Pasting
 *      `OpenTelemetry` into monitors.md to look covered fails the gate rather than passing it.
 *
 * And the ratio is REPORTED, never the pass criterion. Padding the ledger lowers the score,
 * because a padded entry fails two codes.
 *
 *   node tools/out-of-scope-check.mjs              full check (needs the docs mirror)
 *   node tools/out-of-scope-check.mjs --offline    ledger + pointer presence, CI-safe
 *   node tools/out-of-scope-check.mjs --self-test  fixtures, including must-fail cases
 *   node tools/out-of-scope-check.mjs --prove-fail six mutants of the REAL tree
 *   node tools/out-of-scope-check.mjs --json
 *
 * --self-test proves the judgement; --prove-fail proves the gate WIRED TO THE REAL LIBRARY
 * can fail, which is not the same thing and caught a defect the fixtures could not see.
 *
 * exit: 0 clean, 1 a code was raised, 2 cannot check (no mirror; the message says so)
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, cpSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referenceDirs, skillDirs } from './skill-roots.mjs';
import { tmpdir } from 'node:os';
import { disambiguationSection } from './collision-check.mjs';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SKILL_DIR = join(ROOT, 'skills', 'claude-code-extension-engineering');
const REF_DIR = join(SKILL_DIR, 'references');
const LEDGER = join(ROOT, 'data', 'routing', 'out-of-scope.json');
const COLLISIONS = join(ROOT, 'data', 'routing', 'collisions.json');
const SOURCES = join(ROOT, 'evidence', 'sources.json');
export const DEFAULT_MIRROR = 'P:/ClaudeExt/CCX-Extension-Research/sources/docs/md';

export const PROVENANCE_KINDS = ['benchmark', 'harvested', 'collision'];

/**
 * Where a redirect is allowed to live.
 *
 * Getting this set right is what separates a useful gate from a noisy one. The first
 * version counted only per-file `Read this first` sections plus SKILL.md's boundary table,
 * and would have raised OOS_FABRICATED_COVERAGE on `OpenTelemetry` appearing in INDEX.md's
 * word-collision table, in the SKILL.md frontmatter that names out-of-scope topics on
 * purpose, and in the sources.md bibliography row for the page itself. All three are the
 * redirect machinery doing its job. A gate that fires on its own design cries wolf, and a
 * gate nobody believes is worse than no gate.
 *
 * So a pointer region is any of:
 *   - a `## Read this first` section in a reference file
 *   - SKILL.md's `## What this skill does NOT own` table
 *   - SKILL.md's frontmatter description, which enumerates what the skill declines
 *   - INDEX.md from its false-match guard through the end of the word-collision table
 *   - sources.md in full: a bibliography cites pages, it does not restate them
 */
export const BIBLIOGRAPHY = 'sources.md';

function regionsOf(name, text) {
  const t = String(text);
  if (name === BIBLIOGRAPHY) return [t];
  if (name === 'SKILL.md') {
    const out = [];
    const fm = t.match(/^---\n[\s\S]*?\n---/);
    if (fm) out.push(fm[0]);
    const tbl = t.match(/## What this skill does NOT own[\s\S]*?(?=\n## |$)/);
    if (tbl) out.push(tbl[0]);
    return out;
  }
  if (name === 'INDEX.md') {
    const m = t.match(/There are two ways to be wrong here[\s\S]*?(?=\n## You were told|$)/);
    return m ? [m[0]] : [];
  }
  const s = disambiguationSection(t);
  return s ? [s] : [];
}

export function pointerText(files) {
  return Object.entries(files).flatMap(([n, t]) => regionsOf(n, t)).join('\n');
}

/** Everything that is NOT a pointer region. Subject terms here are fabricated coverage. */
export function nonPointerText(files) {
  return Object.entries(files).map(([n, t]) => {
    let rest = String(t);
    for (const r of regionsOf(n, t)) rest = rest.replace(r, '');
    return rest;
  }).join('\n');
}

/**
 * The whole judgement, pure so the self-test drives it without a corpus.
 * `mirrorPage` is the official page text, or null when the mirror is absent.
 */
/**
 * The pointer is checked in the file the entry DECLARES, not anywhere in the library.
 *
 * A global search made the check nearly unfailable: deleting the whole `Read this first`
 * section from monitors.md still passed, because SKILL.md's boundary table names
 * `monitoring-usage` too. A must-fail probe against the real tree caught it. The redirect
 * has to be where the reader who took the wrong path will actually land, which is exactly
 * what `pointer_location` records, so that is the file the gate reads.
 */
export function judge({ entry, pointerBlob, outsideBlob, sourceIds, mirrorPage, locationBlob }) {
  const codes = [];
  const p = entry.provenance;
  if (!p || !PROVENANCE_KINDS.includes(p.kind) || !p.id) { codes.push('OOS_UNSOURCED'); }

  const slug = String(entry.official_page || '').replace(/\.md$/, '');
  if (!slug) { codes.push('OOS_NO_POINTER'); return codes; }

  /* Prefer the declared location. Fall back to the library-wide pointer regions only when
     an entry declares no location, so an entry cannot dodge the check by omitting it. */
  const haystack = entry.pointer_location ? (locationBlob || '') : (pointerBlob || '');
  const named = new RegExp(`\\b${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
  if (!named) codes.push('OOS_NO_POINTER');

  if (entry.src_id && sourceIds && !sourceIds.has(entry.src_id)) codes.push('OOS_SRC_MISSING');
  if (!entry.src_id) codes.push('OOS_SRC_MISSING');

  /* The gate against pasting the official page's vocabulary in to look covered. Terms are
     allowed inside a declared pointer block and nowhere else. */
  for (const term of entry.subject_terms || []) {
    if (new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(outsideBlob || '')) {
      codes.push('OOS_FABRICATED_COVERAGE');
      break;
    }
  }

  if (mirrorPage !== null && mirrorPage !== undefined) {
    if (mirrorPage === false) codes.push('OOS_POINTER_WRONG_PAGE');
    else {
      const missing = (entry.subject_terms || []).filter((t) => !new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(mirrorPage));
      if (missing.length) codes.push('OOS_POINTER_PAGE_LACKS_SUBJECT');
    }
  }
  return codes;
}

function loadJson(path) {
  if (!existsSync(path)) return { _missing: true };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { _parseError: e.message }; }
}

function readSkillFiles(refDir = REF_DIR, skillDir = SKILL_DIR) {
  const files = {};
  for (const f of readdirSync(refDir).filter((x) => x.endsWith('.md'))) files[f] = readFileSync(join(refDir, f), 'utf8');
  const sk = join(skillDir, 'SKILL.md');
  if (existsSync(sk)) files['SKILL.md'] = readFileSync(sk, 'utf8');
  return files;
}

export function check({ mirror = null, ledgerPath = LEDGER, collisionsPath = COLLISIONS, sourcesPath = SOURCES, refDir = REF_DIR, skillDir = SKILL_DIR } = {}) {
  const led = loadJson(ledgerPath);
  if (led._missing) return { problems: [{ code: 'OOS_LEDGER_MISSING', detail: `no ledger at ${ledgerPath}; absent is a failure, not empty` }], entries: [] };
  if (led._parseError) return { problems: [{ code: 'OOS_LEDGER_UNPARSEABLE', detail: led._parseError }], entries: [] };

  const files = readSkillFiles(refDir, skillDir);
  const pointerBlob = pointerText(files);
  const outsideBlob = nonPointerText(files);

  const srcDoc = loadJson(sourcesPath);
  const srcArr = Array.isArray(srcDoc) ? srcDoc : (srcDoc.sources || []);
  const sourceIds = new Set(srcArr.map((s) => s.id));

  const problems = [];
  const entries = led.entries || [];
  const byPage = new Map(entries.map((e) => [String(e.official_page).replace(/\.md$/, ''), e]));

  for (const e of entries) {
    let mirrorPage = null;
    if (mirror) {
      const p = join(mirror, `${String(e.official_page).replace(/\.md$/, '')}.md`);
      mirrorPage = existsSync(p) ? readFileSync(p, 'utf8') : false;
    }
    /* Only the pointer regions OF THE DECLARED FILES. A location naming a file that does
       not exist yields an empty blob, which fails OOS_NO_POINTER rather than passing. */
    const locs = String(e.pointer_location || '').split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.split(/[\\/]/).pop());
    const locFiles = Object.fromEntries(Object.entries(files).filter(([n]) => locs.includes(n)));
    const locationBlob = pointerText(locFiles);
    for (const code of judge({ entry: e, pointerBlob, outsideBlob, sourceIds, mirrorPage, locationBlob })) {
      problems.push({ code, detail: `${e.shape} -> ${e.official_page}${e.pointer_location ? ` (expected in ${e.pointer_location})` : ''}` });
    }
  }

  /* THE JOIN that makes this and collision-check one system rather than two lists: every
     different-subject collision implies an out-of-scope shape, so a collision adjudicated
     and then forgotten here is a failure. */
  const col = loadJson(collisionsPath);
  if (!col._missing && !col._parseError) {
    for (const pair of (col.pairs || []).filter((p) => p.verdict === 'different-subject')) {
      const slug = String(pair.official).replace(/\.md$/, '');
      if (!byPage.has(slug)) problems.push({ code: 'OOS_COLLISION_NOT_LISTED', detail: `${pair.extension} declares ${slug} out of scope but no ledger entry exists` });
    }
  }
  return { problems, entries };
}

// --------------------------------------------------------------------- self-test

function selfTest() {
  let fails = 0; let ran = 0;
  const ok = (n, c, d) => { ran++; if (!c) fails++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d || ''})`}`); };
  const E = (over = {}) => ({
    shape: 'watching usage and cost', official_page: 'monitoring-usage', src_id: 'SRC_MONITORING_USAGE',
    subject_terms: ['OpenTelemetry'], provenance: { kind: 'benchmark', id: 'GQ-55', run: 'rev/2026-08-13-LT' }, ...over,
  });
  const SRC = new Set(['SRC_MONITORING_USAGE']);
  const POINTER = '- see monitoring-usage for telemetry';

  ok('a well-formed entry with a resolving pointer is clean',
    judge({ entry: E(), pointerBlob: POINTER, outsideBlob: 'nothing', sourceIds: SRC, mirrorPage: 'OpenTelemetry setup' }).length === 0);
  ok('MUST FLAG an entry with no pointer anywhere',
    judge({ entry: E(), pointerBlob: 'unrelated', outsideBlob: '', sourceIds: SRC, mirrorPage: 'OpenTelemetry' }).includes('OOS_NO_POINTER'));
  ok('MUST FLAG a pointer to a page that does not exist in the mirror',
    judge({ entry: E(), pointerBlob: POINTER, outsideBlob: '', sourceIds: SRC, mirrorPage: false }).includes('OOS_POINTER_WRONG_PAGE'));
  ok('MUST FLAG a cited page that does not contain the subject',
    judge({ entry: E(), pointerBlob: POINTER, outsideBlob: '', sourceIds: SRC, mirrorPage: 'a page about themes' }).includes('OOS_POINTER_PAGE_LACKS_SUBJECT'));
  ok('MUST FLAG an entry with no admissible provenance, which is what stops an imagined shape',
    judge({ entry: E({ provenance: undefined }), pointerBlob: POINTER, outsideBlob: '', sourceIds: SRC, mirrorPage: 'OpenTelemetry' }).includes('OOS_UNSOURCED'));
  ok('MUST FLAG a provenance kind outside the vocabulary',
    judge({ entry: E({ provenance: { kind: 'seemed-likely', id: 'x' } }), pointerBlob: POINTER, outsideBlob: '', sourceIds: SRC, mirrorPage: 'OpenTelemetry' }).includes('OOS_UNSOURCED'));
  ok('MUST FLAG a src_id that is not in the evidence ledger',
    judge({ entry: E({ src_id: 'SRC_INVENTED' }), pointerBlob: POINTER, outsideBlob: '', sourceIds: SRC, mirrorPage: 'OpenTelemetry' }).includes('OOS_SRC_MISSING'));
  /* The one that makes the metric safe: raising coverage by pasting the page's vocabulary
     into the library FAILS instead of passing. */
  ok('MUST FLAG subject terms pasted into the library outside a pointer block',
    judge({ entry: E(), pointerBlob: POINTER, outsideBlob: 'monitors run on OpenTelemetry internally', sourceIds: SRC, mirrorPage: 'OpenTelemetry' }).includes('OOS_FABRICATED_COVERAGE'));
  ok('a fabricated entry fails MORE than one code, so padding lowers the score',
    judge({ entry: E({ official_page: 'invented-page', src_id: 'SRC_NOPE', provenance: undefined }), pointerBlob: 'x', outsideBlob: '', sourceIds: SRC, mirrorPage: false }).length >= 3);

  /* Region recognition, frozen because the first version of this gate would have fired on
     its own redirect machinery. Each of these is a place a slug legitimately appears. */
  const F = {
    'SKILL.md': '---\nname: x\ndescription: "NOT for telemetry"\n---\n\n## What this skill does NOT own\n\n| a | b | `monitoring-usage` |\n\n## The layers\n\nbody OpenTelemetry-free\n',
    'INDEX.md': '# i\n\nThere are two ways to be wrong here, and OpenTelemetry is the example.\n\n| monitor | x | y | `monitoring-usage` |\n\n## You were told to BUILD something\n\nrest\n',
    'sources.md': '# Sources\n\n| SRC_MONITORING_USAGE | Claude Code Monitoring: OpenTelemetry usage | url |\n',
    'monitors.md': '# M\n\n## Read this first: not monitoring\n\n- see monitoring-usage\n\n## Other\n\nplain body\n',
  };
  const pt = pointerText(F); const np = nonPointerText(F);
  ok('SKILL.md frontmatter counts as a pointer region', /NOT for telemetry/.test(pt) && !/NOT for telemetry/.test(np));
  ok('the SKILL.md boundary table counts as a pointer region', /## What this skill does NOT own/.test(pt));
  ok('INDEX.md guard and word table count as a pointer region', /two ways to be wrong/.test(pt) && !/two ways to be wrong/.test(np));
  ok('sources.md is a bibliography, never fabricated coverage', !/SRC_MONITORING_USAGE/.test(np));
  ok('MUST still see ordinary body prose as outside a pointer region', /plain body/.test(np) && /body OpenTelemetry-free/.test(np));

  const tmp = mkdtempSync(join(tmpdir(), 'ccx-oos-self-'));
  try {
    const refs = join(tmp, 'references'); const skd = join(tmp, 'skill');
    mkdirSync(refs, { recursive: true }); mkdirSync(skd, { recursive: true });
    writeFileSync(join(refs, 'monitors.md'), '# Monitors\n\n## Read this first: not monitoring\n\n- see monitoring-usage for OpenTelemetry\n');
    writeFileSync(join(skd, 'SKILL.md'), '# s\n');
    const lp = join(tmp, 'oos.json'); const cp = join(tmp, 'col.json'); const sp = join(tmp, 'src.json');
    writeFileSync(sp, JSON.stringify([{ id: 'SRC_MONITORING_USAGE' }]));
    writeFileSync(cp, JSON.stringify({ pairs: [{ extension: 'monitors.md', official: 'monitoring-usage.md', verdict: 'different-subject' }] }));
    writeFileSync(lp, JSON.stringify({ entries: [E()] }));
    let r = check({ ledgerPath: lp, collisionsPath: cp, sourcesPath: sp, refDir: refs, skillDir: skd });
    ok('offline check passes a consistent ledger', r.problems.length === 0, JSON.stringify(r.problems));

    writeFileSync(lp, JSON.stringify({ entries: [] }));
    r = check({ ledgerPath: lp, collisionsPath: cp, sourcesPath: sp, refDir: refs, skillDir: skd });
    ok('MUST FAIL: a different-subject collision with no out-of-scope entry, which is the join between the two ledgers',
      r.problems.some((p) => p.code === 'OOS_COLLISION_NOT_LISTED'));

    r = check({ ledgerPath: join(tmp, 'gone.json'), collisionsPath: cp, sourcesPath: sp, refDir: refs, skillDir: skd });
    ok('MUST FAIL: a DELETED ledger is a failure, not an empty one', r.problems.some((p) => p.code === 'OOS_LEDGER_MISSING'));

    writeFileSync(lp, '{ nope');
    r = check({ ledgerPath: lp, collisionsPath: cp, sourcesPath: sp, refDir: refs, skillDir: skd });
    ok('MUST FAIL: an unparseable ledger', r.problems.some((p) => p.code === 'OOS_LEDGER_UNPARSEABLE'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  console.log(`\n${fails ? `SELF-TEST FAIL: ${fails}` : 'SELF-TEST PASS'} (${ran} checks)`);
  return fails ? 1 : 0;
}

// -------------------------------------------------------------------- prove-fail

/**
 * Feed the gate known-bad versions of the REAL tree, not fixtures.
 *
 * Fixtures proved the judgement function; they did NOT prove the gate wired to the actual
 * library can fail. The difference was not academic: with fixtures green, deleting the whole
 * disambiguation section from monitors.md still PASSED, because the pointer search was
 * library-wide and SKILL.md's boundary table names the same page. Only a probe against the
 * real tree surfaced that, so this mode exists and runs in CI.
 */
export function proveFail({ mirror = DEFAULT_MIRROR, refDir = REF_DIR, skillDir = SKILL_DIR, ledgerPath = LEDGER } = {}) {
  if (!existsSync(mirror)) {
    console.log('CANNOT PROVE: the docs mirror is not committed, and three of the five probes need it.');
    console.log(`  looked in ${mirror}`);
    return 2;
  }
  const tmp = mkdtempSync(join(ROOT, 'tmp', 'oos-pf-'));
  let bad = 0;
  const ok = (n, c, d) => { if (!c) bad++; console.log(`  ${c ? 'rejected ' : 'SURVIVED '} ${n}${c ? '' : `  <- ${d}`}`); };
  try {
    const refs = join(tmp, 'references');
    cpSync(refDir, refs, { recursive: true });
    writeFileSync(join(tmp, 'SKILL.md'), readFileSync(join(skillDir, 'SKILL.md'), 'utf8'));
    const base = { mirror, refDir: refs, skillDir: tmp };

    /* Baseline sanity, the guard capability-catalog taught: a proof run against an already
       failing gate passes vacuously, because every mutant is "rejected" by what was already
       wrong. */
    const b = check(base);
    if (b.problems.length) {
      console.log(`CANNOT PROVE: the committed tree already fails its own gate (${b.problems.map((p) => p.code).join(', ')}).`);
      console.log('Every mutant below would be "rejected" by that pre-existing failure, which proves nothing.');
      return 1;
    }
    console.log('  ok        the committed tree passes, so a rejection below means something');

    const led = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    const mutate = (fn) => { const c = JSON.parse(JSON.stringify(led)); fn(c); const p = join(tmp, `m-${Math.abs(JSON.stringify(c).length)}.json`); writeFileSync(p, JSON.stringify(c)); return p; };

    appendFileSync(join(refs, 'monitors.md'), '\n\nMonitors emit OTEL_METRICS_EXPORTER data internally.\n');
    ok('a subject term pasted into body prose outside a pointer block [OOS_FABRICATED_COVERAGE]',
      check(base).problems.some((p) => p.code === 'OOS_FABRICATED_COVERAGE'), 'no code raised');
    cpSync(join(refDir, 'monitors.md'), join(refs, 'monitors.md'));

    const mon = readFileSync(join(refs, 'monitors.md'), 'utf8');
    writeFileSync(join(refs, 'monitors.md'), mon.replace(/## Read this first[\s\S]*?(?=\n## )/, ''));
    ok('the disambiguation section deleted from the destination file [OOS_NO_POINTER]',
      check(base).problems.some((p) => p.code === 'OOS_NO_POINTER'), 'no code raised');
    cpSync(join(refDir, 'monitors.md'), join(refs, 'monitors.md'));

    ok('a pointer at a page absent from the mirror [OOS_POINTER_WRONG_PAGE]',
      check({ ...base, ledgerPath: mutate((c) => { c.entries[0].official_page = 'monitoring-usage-that-does-not-exist'; }) })
        .problems.some((p) => ['OOS_POINTER_WRONG_PAGE', 'OOS_NO_POINTER'].includes(p.code)), 'no code raised');

    ok('a real page that does not carry the claimed subject [OOS_POINTER_PAGE_LACKS_SUBJECT]',
      check({ ...base, ledgerPath: mutate((c) => { c.entries[0].official_page = 'costs'; c.entries[0].subject_terms = ['CLAUDE_CODE_ENABLE_TELEMETRY']; }) })
        .problems.some((p) => p.code === 'OOS_POINTER_PAGE_LACKS_SUBJECT'), 'no code raised');

    ok('an entry deleted while its collision row still demands one [OOS_COLLISION_NOT_LISTED]',
      check({ ...base, ledgerPath: mutate((c) => { c.entries = c.entries.filter((e) => e.official_page !== 'monitoring-usage'); }) })
        .problems.some((p) => p.code === 'OOS_COLLISION_NOT_LISTED'), 'no code raised');

    ok('an entry stripped of its provenance [OOS_UNSOURCED]',
      check({ ...base, ledgerPath: mutate((c) => { delete c.entries[0].provenance; }) })
        .problems.some((p) => p.code === 'OOS_UNSOURCED'), 'no code raised');
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  if (bad) { console.log(`\nOUT-OF-SCOPE GATE IS HOLLOW: ${bad} mutant(s) were not rejected`); return 1; }
  console.log('\nOUT-OF-SCOPE GATE CAN FAIL: every mutant was rejected by the gate that names it.');
  return 0;
}

// ------------------------------------------------------------------------- main

if (IS_MAIN) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (argv.includes('--prove-fail')) process.exit(proveFail());

  const offline = argv.includes('--offline');
  const mi = argv.indexOf('--mirror');
  const mirror = mi >= 0 ? argv[mi + 1] : DEFAULT_MIRROR;
  if (!offline && !existsSync(mirror)) {
    console.log('CANNOT CHECK: the docs mirror is not committed (copyright), so this gate needs one locally.');
    console.log(`  looked in ${mirror}`);
    console.log('  run with --offline for the half that needs no mirror.');
    process.exit(2);
  }
  const { problems, entries } = check({ mirror: offline ? null : mirror });
  if (argv.includes('--json')) { console.log(JSON.stringify({ problems, entries }, null, 2)); process.exit(problems.length ? 1 : 0); }

  const byKind = {};
  for (const e of entries) byKind[e.provenance?.kind || 'none'] = (byKind[e.provenance?.kind || 'none'] || 0) + 1;
  if (problems.length) {
    for (const p of problems) console.log(`${p.code}  ${p.detail}`);
    console.log(`\nOUT-OF-SCOPE FAIL: ${entries.length} shapes, ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(`OUT-OF-SCOPE OK${offline ? ' (offline)' : ''}: ${entries.length} shapes, ${entries.length} pointers resolved, ${entries.length} SRC ids present.`);
  console.log(`  provenance: ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  console.log('  This count is REPORTED, not a pass criterion. A padded entry fails at least two codes.');
  process.exit(0);
}
