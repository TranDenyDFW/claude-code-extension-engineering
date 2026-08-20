#!/usr/bin/env node
/**
 * VERSION CONSISTENCY: every version claim in this repo must agree with evidence/VERIFIED_VERSION.
 *
 * WHY THIS EXISTS
 * ---------------
 * The repo asserted 2.1.229 across VERIFIED_VERSION, catalogVersion and 28 file headers while the
 * host that produced every benchmark result ran 2.1.233. Nothing compared those. Worse, one
 * source record already carried a build NEWER than the version the library claimed to be verified
 * at, and no gate looked at source builds at all.
 *
 * Bumping the number then failed in a way that took real work to read: capability-catalog printed
 * DRIFT_UNCLASSIFIED, "the semantic fingerprint changed but no field-level difference was
 * classified", because the docs mirror documented nothing above 2.1.229 and so had no 2.1.233
 * content to fingerprint. The true cause, that the EVIDENCE BASE was older than the claim, was
 * nowhere in the message. This gate names that condition directly.
 *
 * WHAT IT ASSERTS, all against VERIFIED_VERSION as the single source of truth:
 *
 *   VERSION_CATALOG_MISMATCH   data/capabilities/catalog.json catalogVersion differs.
 *   VERSION_HEADER_MISMATCH    a reference file's leading blockquote names a different build, or
 *                              names none at all. quote-check already requires the header to name
 *                              the verified build; this repeats it so a version bump has ONE gate
 *                              that reports every surface at once instead of three partial ones.
 *   VERSION_SOURCE_AHEAD       evidence/sources.json records a source captured at a build NEWER
 *                              than the verified one. That is not automatically wrong, but it is
 *                              always a decision: either the library is due a re-verification, or
 *                              the record is mistaken. Silence is the one thing it must not be.
 *   VERSION_MIRROR_BEHIND      the docs mirror documents no build at or above the verified one.
 *                              This is the condition that blocked the 2.1.233 bump, and the reason
 *                              a bump cannot be made true by editing numbers.
 *
 * WHAT IT DOES NOT TOUCH, deliberately: [vX.Y.Z] tags on claims record the build a BEHAVIOUR
 * belongs to, not a verification build, and a claim about 2.0.74 is correct forever. Source
 * `build` fields record the capture, and rewriting one to silence this gate would falsify a
 * retrieval record rather than fix anything. Historical run records are history.
 *
 *   node tools/version-consistency.mjs              check
 *   node tools/version-consistency.mjs --self-test  fixtures, including must-fail cases
 *   node tools/version-consistency.mjs --prove-fail mutate REAL files and require each code
 *   node tools/version-consistency.mjs --json       machine readable
 *
 * exit: 0 consistent, 1 a code was raised, 2 cannot check (no mirror on this machine)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const DEFAULT_MIRROR = 'P:/ClaudeExt/CCX-Extension-Research/sources/docs/md';

/** Numeric comparison, so 2.1.9 sorts below 2.1.10 rather than above it as a string would. */
export function cmpVersion(a, b) {
  const A = String(a).split('.').map(Number);
  const B = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function verifiedVersion(root = ROOT) {
  const v = readFileSync(join(root, 'evidence', 'VERIFIED_VERSION'), 'utf8').trim();
  if (!/^\d+(\.\d+)*$/.test(v)) throw new Error(`evidence/VERIFIED_VERSION is not a bare version: ${v.slice(0, 40)}`);
  return v;
}

/**
 * The build named in a file's LEADING blockquote, or null.
 *
 * Structural, not a grep: two reference files name a build in body text for correct reasons
 * (lsp.md cites 2.0.74 as the build a feature arrived in, permissions.md cites 2.1.223 from a
 * changelog), and a grep-based check would demand those be rewritten to match the verified build,
 * which would make them false.
 */
export function headerVersion(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('>')) { end = i; continue; }
    if (t === '' || t.startsWith('#')) continue;
    break;
  }
  if (end < 0) return null;
  const head = lines.slice(0, end + 1).filter((l) => l.trim().startsWith('>')).join(' ');
  const m = head.match(/Claude Code (\d+(?:\.\d+)+)/);
  return m ? m[1] : null;
}

/**
 * What the docs mirror documents, as a tri-state rather than a nullable string.
 *
 *   { state: 'absent'     }            no mirror on this machine. CI runners have none.
 *   { state: 'unreadable' }            the mirror is here but no release label could be read.
 *   { state: 'ok', newest }            the newest build it documents.
 *
 * The distinction is the whole point. ABSENT is "cannot check" and exits 2, which CI tolerates the
 * same way it tolerates capability-catalog and quote-check. UNREADABLE is a FAILURE: the mirror is
 * present and we could not read it, and returning null there would fail open, which is the exact
 * class of defect this gate already shipped once when it read IP addresses as version numbers.
 *
 * Labels only, never bare dotted numbers. The corpus contains 192.168.1.1 and 127.0.0.1, the
 * latter inside changelog.md itself, and a bare-number scan reported the newest build as
 * "192.168.1", which compares newer than any real build and made VERSION_MIRROR_BEHIND unable to
 * fire at all.
 */
export function mirrorStatus(mirror = DEFAULT_MIRROR) {
  const changelog = join(mirror, 'changelog.md');
  if (!existsSync(changelog)) return { state: 'absent' };
  let newest = null;
  const LABEL = /label="(\d+\.\d+\.\d+)"/g;
  for (const m of readFileSync(changelog, 'utf8').matchAll(LABEL)) {
    if (!newest || cmpVersion(m[1], newest) > 0) newest = m[1];
  }
  if (!newest) return { state: 'unreadable' };
  return { state: 'ok', newest };
}

/** Back-compat shim: the newest documented build, or null. */
export function mirrorNewestVersion(mirror = DEFAULT_MIRROR) {
  const st = mirrorStatus(mirror);
  return st.state === 'ok' ? st.newest : null;
}

/**
 * Top-level markdown that may carry a verification claim. Deliberately a short, named list rather
 * than a recursive walk: a walk would pull in .md/ review artifacts and historical run notes,
 * which record what WAS true at the time and must not be rewritten to match today.
 */
export function docsCiting(root = ROOT) {
  return ['IMPROVEMENTS.md', 'README.md', 'CONTRIBUTING.md', join('docs', 'RESULTS.md'), join('docs', 'SUBMISSION.md')]
    .filter((rel) => existsSync(join(root, rel)));
}

/** Every problem, as {code, detail}. */
export function problems({ root = ROOT, mirror = DEFAULT_MIRROR } = {}) {
  const out = [];
  const V = verifiedVersion(root);

  const catPath = join(root, 'data', 'capabilities', 'catalog.json');
  if (existsSync(catPath)) {
    const cat = JSON.parse(readFileSync(catPath, 'utf8'));
    if (cat.catalogVersion !== V) {
      out.push({ code: 'VERSION_CATALOG_MISMATCH', detail: `catalog.json catalogVersion is ${cat.catalogVersion}, VERIFIED_VERSION is ${V}` });
    }
  }

  const skillsDir = join(root, 'skills');
  if (existsSync(skillsDir)) {
    for (const skill of readdirSync(skillsDir)) {
      const files = [];
      const refs = join(skillsDir, skill, 'references');
      if (existsSync(refs)) for (const n of readdirSync(refs).filter((x) => x.endsWith('.md'))) files.push([`skills/${skill}/references/${n}`, join(refs, n)]);
      const sk = join(skillsDir, skill, 'SKILL.md');
      if (existsSync(sk)) files.push([`skills/${skill}/SKILL.md`, sk]);
      for (const [rel, abs] of files) {
        const hv = headerVersion(readFileSync(abs, 'utf8'));
        if (hv === null) continue;          /* no leading blockquote, or it names no build: legal */
        if (hv !== V) out.push({ code: 'VERSION_HEADER_MISMATCH', detail: `${rel} header names ${hv}, VERIFIED_VERSION is ${V}` });
      }
    }
  }

  const srcPath = join(root, 'evidence', 'sources.json');
  if (existsSync(srcPath)) {
    const raw = JSON.parse(readFileSync(srcPath, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.sources || Object.values(raw).find(Array.isArray) || []);
    for (const s of arr) {
      if (s && s.build && /^\d+(\.\d+)+$/.test(s.build) && cmpVersion(s.build, V) > 0) {
        out.push({ code: 'VERSION_SOURCE_AHEAD', detail: `${s.id} was captured at build ${s.build}, ahead of VERIFIED_VERSION ${V}` });
      }
    }
  }

  /* Prose that cites VERIFIED_VERSION by name and states a build must state the CURRENT one.
     An independent reviewer's mutant, a README sentence claiming verification against 1.0.0,
     survived every gate in the repo. It was not hypothetical: IMPROVEMENTS.md carried exactly
     that shape, stale, and the commit adding this gate shipped it unchanged. Scoped to lines
     that NAME evidence/VERIFIED_VERSION, so ordinary prose mentioning a build is untouched. */
  for (const rel of docsCiting(root)) {
    const abs = join(root, rel);
    const lines = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('VERIFIED_VERSION')) continue;
      for (const m of lines[i].matchAll(/\b(\d+\.\d+\.\d+)\b/g)) {
        if (m[1] !== V) out.push({ code: 'VERSION_PROSE_STALE', detail: `${rel}:${i + 1} cites VERIFIED_VERSION alongside ${m[1]}, but it is ${V}` });
      }
    }
  }

  const st = mirrorStatus(mirror);
  if (st.state === 'unreadable') {
    out.push({ code: 'VERSION_MIRROR_UNREADABLE', detail: `the docs mirror at ${mirror} carries a changelog with no readable release label. Present but unreadable is a failure, not a skip: treating it as absent would fail open.` });
  } else if (st.state === 'ok' && cmpVersion(st.newest, V) < 0) {
    out.push({ code: 'VERSION_MIRROR_BEHIND', detail: `the docs mirror documents nothing above ${st.newest}, but VERIFIED_VERSION is ${V}. The evidence base is older than the claim; refresh the mirror into a dated revision before bumping.` });
  }

  return { version: V, mirror: st, mirrorNewest: st.state === 'ok' ? st.newest : null, problems: out };
}

// ------------------------------------------------------------------ self-test

function selfTest() {
  let fails = 0; let ran = 0;
  const ok = (label, cond, detail) => { ran++; if (!cond) fails++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${cond ? '' : `  (${detail || ''})`}`); };

  ok('version compare is numeric, not lexical', cmpVersion('2.1.10', '2.1.9') > 0 && cmpVersion('2.1.9', '2.1.10') < 0);
  ok('equal versions compare equal', cmpVersion('2.1.233', '2.1.233') === 0);
  ok('shorter versions pad with zero', cmpVersion('2.1', '2.1.0') === 0 && cmpVersion('2.2', '2.1.9') > 0);

  ok('a header build is read from the leading blockquote',
    headerVersion('# T\n\n> Claude Code 2.1.233. What that means here: nothing.\n\ntext') === '2.1.233');
  ok('MUST IGNORE a build that appears only in body text',
    headerVersion('# T\n\n> Claude Code 2.1.233. Nothing.\n\n- LSP arrived in Claude Code 2.0.74\n') === '2.1.233',
    'body mentions are legitimate and must not be rewritten');
  ok('a file with no leading blockquote yields null',
    headerVersion('# T\n\nplain text only, mentions Claude Code 2.0.74\n') === null);
  ok('a later blockquote in the body is not mistaken for the header',
    headerVersion('# T\n\nprose\n\n> Claude Code 2.0.74 quoted later\n') === null);

  ok('MUST NOT read a bare dotted number as a version',
    !/label="(\d+\.\d+\.\d+)"/.test('connect to 192.168.1.5 for the proxy'),
    'the corpus contains IP addresses; only labelled releases count');
  ok('...and DOES read a labelled release',
    /label="(\d+\.\d+\.\d+)"/.test('<Update label="2.1.237" description="x">'));
  ok('an absent mirror is reported as absent, not as ok',
    mirrorStatus('P:/definitely/not/a/mirror/anywhere').state === 'absent');

  console.log(`\nSELF-TEST ${fails ? 'FAIL' : 'PASS'} (${ran - fails}/${ran} checks)`);
  return fails ? 1 : 0;
}

// ------------------------------------------------------------------ prove-fail

/**
 * Mutate the REAL tree and require each code to fire.
 *
 * Fixtures prove the judgement; this proves the gate as wired. A gate can be right in the abstract
 * and still read the wrong directory, or skip the file that matters.
 */
function proveFail() {
  const targets = {
    VERSION_CATALOG_MISMATCH: join(ROOT, 'data', 'capabilities', 'catalog.json'),
    VERSION_HEADER_MISMATCH: join(ROOT, 'skills', 'claude-code-extension-engineering', 'references', 'hooks.md'),
    VERSION_SOURCE_AHEAD: join(ROOT, 'evidence', 'sources.json'),
    VERSION_MIRROR_BEHIND: join(ROOT, 'evidence', 'VERIFIED_VERSION'),
  };
  const originals = new Map();
  for (const p of Object.values(targets)) originals.set(p, readFileSync(p, 'utf8'));
  for (const rel of docsCiting()) originals.set(join(ROOT, rel), readFileSync(join(ROOT, rel), 'utf8'));

  const V = verifiedVersion();
  let bad = 0;
  const run = (label, code, mutate) => {
    try {
      mutate();
      const got = problems().problems.map((x) => x.code);
      const caught = got.includes(code);
      console.log(`  ${caught ? 'rejected' : 'SURVIVED'}  ${label} [${code}]${caught ? '' : `  saw: ${got.join(', ') || 'nothing'}`}`);
      if (!caught) bad++;
    } finally {
      for (const [p, s] of originals) writeFileSync(p, s);
    }
  };

  run('a catalogVersion that disagrees', 'VERSION_CATALOG_MISMATCH', () => {
    const p = targets.VERSION_CATALOG_MISMATCH;
    writeFileSync(p, readFileSync(p, 'utf8').replace(`"catalogVersion": "${V}"`, '"catalogVersion": "9.9.9"'));
  });

  run('a header naming a different build', 'VERSION_HEADER_MISMATCH', () => {
    const p = targets.VERSION_HEADER_MISMATCH;
    writeFileSync(p, readFileSync(p, 'utf8').replace(`Claude Code ${V}`, 'Claude Code 9.9.9'));
  });

  run('a source captured ahead of the verified build', 'VERSION_SOURCE_AHEAD', () => {
    const p = targets.VERSION_SOURCE_AHEAD;
    const arr = JSON.parse(readFileSync(p, 'utf8'));
    const list = Array.isArray(arr) ? arr : (arr.sources || []);
    list[0].build = '9.9.9';
    writeFileSync(p, JSON.stringify(arr, null, 2) + '\n');
  });

  /* Only meaningful with a mirror. Claiming HOLLOW for a check that could not run is the
     "could not check equals failure" confusion in reverse, and on a mirror-less runner it made
     --prove-fail exit 1 and fail the build. */
  if (mirrorStatus().state === 'ok') {
    run('a verified build the mirror has never documented', 'VERSION_MIRROR_BEHIND', () => {
      writeFileSync(targets.VERSION_MIRROR_BEHIND, '99.9.9\n');
    });
  } else {
    console.log('  skipped   a verified build the mirror has never documented [VERSION_MIRROR_BEHIND] (no mirror here)');
  }

  run('prose citing VERIFIED_VERSION with the wrong build', 'VERSION_PROSE_STALE', () => {
    const docs = docsCiting();
    if (!docs.length) throw new Error('no citing doc to mutate');
    const p2 = join(ROOT, docs[0]);
    originals.set(p2, originals.get(p2) ?? readFileSync(p2, 'utf8'));
    writeFileSync(p2, readFileSync(p2, 'utf8') + '\n\nSpurious: verified against 0.0.1, the build in `evidence/VERIFIED_VERSION`.\n');
  });

  let restored = true;
  for (const [p, s] of originals) if (readFileSync(p, 'utf8') !== s) restored = false;
  console.log(`  tree restored: ${restored}`);
  if (!restored) bad++;

  const clean = problems().problems.length === 0;
  console.log(`  gate clean again after restore: ${clean}`);
  if (!clean) bad++;

  console.log(bad ? '\nVERSION GATE IS HOLLOW: a mutant survived' : '\nVERSION GATE CAN FAIL: every mutant was rejected.');
  return bad ? 1 : 0;
}

// ------------------------------------------------------------------ main

if (IS_MAIN) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (argv.includes('--prove-fail')) process.exit(proveFail());

  const mi = argv.indexOf('--mirror');
  const mirror = mi >= 0 && argv[mi + 1] ? argv[mi + 1] : DEFAULT_MIRROR;
  const r = problems({ mirror });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.problems.length ? 1 : 0);
  }

  /* An absent mirror is CANNOT CHECK, not a pass. CI runners have no mirror, and the siblings
     already model this: freshness.yml invokes capability-catalog and quote-check as
     `... || [ $? -eq 2 ]`. Documenting exit 2 and never emitting it, which is what shipped in
     f2d7375, is worse than not documenting it: the live check then passed on every runner with
     VERSION_MIRROR_BEHIND silently unreachable. */
  if (r.mirror.state === 'absent') {
    for (const p2 of r.problems) console.error(`${p2.code}  ${p2.detail}`);
    console.error(`\nCANNOT CHECK the mirror on this machine (${mirror} is absent).`);
    console.error(`${r.problems.length} non-mirror problem(s) found against VERIFIED_VERSION ${r.version}.`);
    process.exit(r.problems.length ? 1 : 2);
  }

  if (r.problems.length) {
    for (const p of r.problems) console.error(`${p.code}  ${p.detail}`);
    console.error(`\nVERSION CONSISTENCY FAIL: ${r.problems.length} problem(s) against VERIFIED_VERSION ${r.version}.`);
    console.error('Every version claim in the repo is measured against evidence/VERIFIED_VERSION.');
    console.error('A bump is not an edit to a number: the mirror must document the build first.');
    process.exit(1);
  }

  console.log(`VERSION CONSISTENCY OK: every version claim agrees with VERIFIED_VERSION ${r.version}.`);
  console.log(`  docs mirror documents up to ${r.mirrorNewest === null ? '(mirror absent, that check skipped)' : r.mirrorNewest}.`);
}
