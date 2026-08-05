#!/usr/bin/env node
/**
 * docs-revision-check.mjs - prove a frozen documentation revision is still intact.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-03 20:42 the mirror collector re-ran and wrote every page straight
 * over sources/docs/md/, then regenerated its own MANIFEST.json over the old
 * hashes. That destroyed 16 of the 20 pages Tier 3 replicate 1 was measured
 * against AND the record of what those bytes had been. No error, no log line.
 * It was recoverable only because three unrelated copies survived by accident
 * and tests/tier3/docs-manifest.json happened to be committed to git.
 *
 * A published measurement is only reproducible if the exact inputs are still
 * provable. This gate is what makes that claim checkable rather than asserted:
 * it re-derives the sha256 of every page in a committed manifest against a dated
 * revision directory and refuses to pass on any drift.
 *
 * It is READ-ONLY. It never repairs the drift it detects, because a gate that
 * silently regenerates its own expected input cannot fail twice.
 *
 * usage:
 *   node tools/docs-revision-check.mjs                       check the default manifest and revision
 *   node tools/docs-revision-check.mjs --rev 2026-08-02      pick a revision
 *   node tools/docs-revision-check.mjs --manifest <path>     pick a manifest
 *   node tools/docs-revision-check.mjs --sources <dir>       point at another mirror root
 *   node tools/docs-revision-check.mjs --json                machine-readable
 *   node tools/docs-revision-check.mjs --self-test           includes a must-fail case
 *
 * exit: 0 intact, 1 drift or missing pages, 2 cannot check (no mirror on this machine)
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

export const DEFAULT_MANIFEST = join(REPO, 'tests', 'tier3', 'docs-manifest.json');
export const DEFAULT_SOURCES = 'P:\\ClaudeExt\\CCX-Extension-Research\\sources';
export const DEFAULT_REV = '2026-08-02';

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Manifests in this project are not all the same shape: tier3's wraps its rows in
 * a `pages` key alongside provenance fields, while others are a bare array. Accept
 * either rather than making the caller know which, and fail loudly on neither.
 */
export function manifestPages(raw) {
  const arr = Array.isArray(raw) ? raw : (raw.pages || raw.docs || Object.values(raw).find(Array.isArray));
  if (!Array.isArray(arr) || !arr.length) throw new Error('manifest contains no page array');
  for (const p of arr) {
    if (!p.slug || !p.sha256) throw new Error(`manifest row missing slug or sha256: ${JSON.stringify(p).slice(0, 120)}`);
  }
  return arr;
}

/**
 * Check every page in `pages` against `revDir`.
 * Pure over the filesystem it is handed, so the self-test can point it at a
 * deliberately corrupted temp tree and watch it go red.
 */
export function checkRevision(pages, revDir) {
  const rows = [];
  for (const p of pages) {
    const file = join(revDir, `${p.slug}.md`);
    if (!existsSync(file)) {
      rows.push({ slug: p.slug, status: 'MISSING', expected: p.sha256, actual: null, bytes: null });
      continue;
    }
    const buf = readFileSync(file);
    const actual = sha256(buf);
    if (actual !== p.sha256) {
      rows.push({ slug: p.slug, status: 'DRIFTED', expected: p.sha256, actual, bytes: buf.length, expectedBytes: p.bytes ?? null });
    } else if (p.bytes != null && buf.length !== p.bytes) {
      // Belt and braces: a sha256 match with a size mismatch is impossible, so if
      // it ever fires the hashing itself is wrong and that must not read as a pass.
      rows.push({ slug: p.slug, status: 'IMPOSSIBLE', expected: p.sha256, actual, bytes: buf.length, expectedBytes: p.bytes });
    } else {
      rows.push({ slug: p.slug, status: 'OK', expected: p.sha256, actual, bytes: buf.length });
    }
  }
  const ok = rows.filter((r) => r.status === 'OK').length;
  return { rows, ok, total: rows.length, intact: ok === rows.length && rows.length > 0 };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run() {
  const manifestPath = arg('--manifest', DEFAULT_MANIFEST);
  const sources = arg('--sources', process.env.CCX_SOURCES || DEFAULT_SOURCES);
  const rev = arg('--rev', DEFAULT_REV);
  const asJson = process.argv.includes('--json');
  const revDir = join(sources, 'docs', 'rev', rev);

  if (!existsSync(manifestPath)) {
    console.error(`cannot check: no manifest at ${manifestPath}`);
    return 2;
  }
  if (!existsSync(revDir)) {
    // Exit 2, not 1. CI runners have no mirror, and "I could not look" must never
    // be reported with the same code as "I looked and it was wrong".
    console.error(`cannot check: no revision directory at ${revDir}`);
    console.error('This machine has no mirror. That is not a failure, it is an absence of evidence.');
    return 2;
  }

  const pages = manifestPages(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const res = checkRevision(pages, revDir);

  if (asJson) {
    console.log(JSON.stringify({ manifest: manifestPath, revision: rev, revDir, ...res }, null, 2));
  } else {
    for (const r of res.rows) {
      if (r.status === 'OK') continue;
      console.log(`  ${r.status.padEnd(10)} ${r.slug.padEnd(22)} expected ${r.expected.slice(0, 12)}`
        + (r.actual ? ` got ${r.actual.slice(0, 12)}` : ''));
    }
    console.log(`${res.intact ? 'PASS' : 'FAIL'} ${res.ok}/${res.total} pages match ${manifestPath.replace(REPO, '.')} at revision ${rev}`);
    if (!res.intact) {
      console.log('\nThe frozen revision has drifted. Do NOT regenerate it from the live mirror:');
      console.log('the live mirror is the thing that drifted. Recover the bytes, or record that');
      console.log('the measurement depending on them is no longer reproducible.');
    }
  }
  return res.intact ? 0 : 1;
}

/** A gate that cannot fail is not a gate, so the self-test proves it fails. */
function selfTest() {
  let pass = 0; let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); }
  };

  const tmp = mkdtempSync(join(tmpdir(), 'docs-rev-check-'));
  try {
    const revDir = join(tmp, 'rev');
    mkdirSync(revDir, { recursive: true });
    const bodyA = '# Alpha\n\nbody of alpha\n';
    const bodyB = '# Beta\n\nbody of beta\n';
    writeFileSync(join(revDir, 'alpha.md'), bodyA);
    writeFileSync(join(revDir, 'beta.md'), bodyB);
    const pages = [
      { slug: 'alpha', sha256: sha256(Buffer.from(bodyA)), bytes: Buffer.byteLength(bodyA) },
      { slug: 'beta', sha256: sha256(Buffer.from(bodyB)), bytes: Buffer.byteLength(bodyB) },
    ];

    check('an intact revision passes', checkRevision(pages, revDir).intact);

    // THE MUST-FAIL CASE. One byte appended is the whole point: this is the exact
    // shape of what happened, a page quietly replaced by a slightly different one.
    writeFileSync(join(revDir, 'alpha.md'), bodyA + 'x');
    const drifted = checkRevision(pages, revDir);
    check('MUST FAIL: a one-byte change is caught', !drifted.intact);
    check('MUST FAIL: the drifted page is named', drifted.rows.find((r) => r.slug === 'alpha')?.status === 'DRIFTED');
    check('MUST FAIL: the untouched page still reads OK', drifted.rows.find((r) => r.slug === 'beta')?.status === 'OK');
    check('MUST FAIL: ok count drops to 1', drifted.ok === 1, `got ${drifted.ok}`);
    writeFileSync(join(revDir, 'alpha.md'), bodyA);
    check('restoring the bytes restores the pass', checkRevision(pages, revDir).intact);

    rmSync(join(revDir, 'beta.md'));
    const missing = checkRevision(pages, revDir);
    check('MUST FAIL: a deleted page is caught', !missing.intact);
    check('MUST FAIL: a deleted page reads MISSING, not OK',
      missing.rows.find((r) => r.slug === 'beta')?.status === 'MISSING');
    writeFileSync(join(revDir, 'beta.md'), bodyB);

    // An empty manifest must not report a vacuous pass. 0 of 0 matching is exactly
    // the shape of a gate that has quietly stopped checking anything.
    check('an empty page set is NOT intact', !checkRevision([], revDir).intact);

    let threw = false;
    try { manifestPages({ nothing: 'here' }); } catch { threw = true; }
    check('a manifest with no page array throws', threw);
    threw = false;
    try { manifestPages([{ slug: 'x' }]); } catch { threw = true; }
    check('a manifest row without sha256 throws', threw);

    check('the tier3 wrapper shape parses', manifestPages({ fetched: 'x', pages: pages }).length === 2);
    check('a bare array parses', manifestPages(pages).length === 2);

    // The real artifact, when this machine has it.
    const realRev = join(process.env.CCX_SOURCES || DEFAULT_SOURCES, 'docs', 'rev', DEFAULT_REV);
    if (existsSync(realRev) && existsSync(DEFAULT_MANIFEST)) {
      const real = checkRevision(manifestPages(JSON.parse(readFileSync(DEFAULT_MANIFEST, 'utf8'))), realRev);
      check(`the recovered ${DEFAULT_REV} revision is intact (${real.ok}/${real.total})`, real.intact);
    } else {
      console.log(`  skip the live check: no revision at ${realRev}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${fail === 0 ? 'SELF-TEST PASS' : 'SELF-TEST FAIL'} ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

if (IS_MAIN) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
