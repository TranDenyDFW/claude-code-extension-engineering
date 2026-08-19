#!/usr/bin/env node
/**
 * Evidence-ledger integrity gate. Exits non-zero on any failure so CI can run it.
 *
 * Checks:
 *   1. evidence/sources.json parses; source ids unique; every URL well-formed;
 *      every source has retrieved date and status.
 *   2. evidence/claims.jsonl parses; claim ids unique; every claim's source id
 *      resolves in sources.json (or the claim is explicitly unattributed).
 *   3. DRIFT: re-runs the mechanical extraction and diffs it against
 *      claims.jsonl BY RECORD. A claim whose id has vanished, a tagged line with
 *      no ledger record, and a claim whose recorded file, line or text disagrees
 *      with the extraction are all drift. Until 2026-08-08 only the two id-set
 *      cases were checked, so a claim's file, line and text could be rewritten to
 *      anything and this gate exited 0 while this comment claimed otherwise.
 *   4. evidence/observations/*.json each parse and carry id, claim, build,
 *      observed, method, reproduction.
 *   5. evidence/VERIFIED_VERSION is a bare semver line.
 *
 *   node tools/verify-evidence.mjs            run the gate
 *   node tools/verify-evidence.mjs --json     machine-readable result
 *   node tools/verify-evidence.mjs --prove-can-fail   mutate the committed ledger
 *                                             and require a NAMED rejection each time
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extract } from './extract-claims.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
/**
 * The evidence directory is overridable for ONE reason: so `--prove-can-fail`
 * below can point this gate at a deliberately doctored copy of the ledger and
 * require it to complain. Nothing else sets it, and the committed ledger is never
 * written to. Same shape as COVERAGE_VALIDATION_RESULTS in coverage-report.mjs.
 */
const EV = process.env.CCX_EVIDENCE_DIR || join(ROOT, 'evidence');
const AS_JSON = process.argv.includes('--json');

/**
 * --prove-can-fail: mutate the COMMITTED ledger and require this gate to reject
 * each doctored copy for the reason the mutant DECLARES.
 *
 * This file had no self-test of any kind. It is 156 lines guarding 458 claims
 * across 29 sources, and the only thing standing behind it was that it happened
 * to exit 0. Six review rounds of this project's own tooling found roughly 33
 * defects, almost all assertions whose PASS did not depend on the code they
 * claimed to test, and this gate was never examined because nothing pointed at it.
 *
 * The gate under proof is THIS TOOL SPAWNED AS A PROCESS, not an internal
 * function. Five review rounds were lost to exactly that distinction: the thing
 * CI runs is the process, and a fix verified at the function boundary kept
 * relocating to the glue outside it.
 *
 * Runs before the checks below, which execute at module top level.
 */
if (process.argv.includes('--prove-can-fail')) {
  const { proveArtifactGate } = await import('./artifact-mutation.mjs');
  const { mkdtempSync, cpSync, rmSync, writeFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');

  const asRows = (t) => t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  const asText = (v) => v.map((c) => JSON.stringify(c)).join('\n') + '\n';

  const gate = (candidate) => {
    const dir = mkdtempSync(join(tmpdir(), 'ccx-ev-'));
    try {
      cpSync(EV, dir, { recursive: true });
      writeFileSync(join(dir, 'claims.jsonl'), readFileSync(candidate, 'utf8'));
      const r = spawnSync(process.execPath, [join(HERE, 'verify-evidence.mjs'), '--json'],
        { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000,
          env: { ...process.env, CCX_EVIDENCE_DIR: dir } });
      // `errors` in the JSON output is a COUNT; the strings are in `errorDetail`.
      // Reading the count as a list silently yielded an empty iterable on the
      // first run, which would have scored every mutant SURVIVED for a reason
      // that had nothing to do with the gate.
      let errs = [];
      try { errs = JSON.parse(r.stdout).errorDetail || []; } catch { errs = r.status === 0 ? [] : ['UNPARSEABLE_OUTPUT']; }
      if (!Array.isArray(errs)) errs = ['UNEXPECTED_OUTPUT_SHAPE'];
      const codes = new Set();
      for (const e of errs) {
        if (/duplicate/i.test(e)) codes.add('DUPLICATE_ID');
        else if (/not in sources.json|unknown source|unattributed/i.test(e)) codes.add('UNRESOLVED_SOURCE');
        else if (/drift|ledger|no longer|missing from/i.test(e)) codes.add('DRIFT');
        else codes.add('OTHER');
      }
      return [...codes];
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  process.exit(proveArtifactGate({
    artifact: join(EV, 'claims.jsonl'),
    label: 'evidence ledger',
    parse: asRows,
    serialise: asText,
    gate,
    mutants: [
      { label: 'a claim id duplicated', expect: 'DUPLICATE_ID',
        mutate: (v) => { v.push({ ...v[0], text: `${v[0].text} (forged copy)` }); return v; } },
      { label: 'a claim attributed to a source that does not exist', expect: 'UNRESOLVED_SOURCE',
        mutate: (v) => { v[0].source = 'SRC_DOES_NOT_EXIST'; return v; } },
      { label: 'a claim deleted while its tagged line remains in the reference', expect: 'DRIFT',
        mutate: (v) => v.slice(1) },
      { label: 'a claim moved to a line that carries no tag', expect: 'DRIFT',
        mutate: (v) => { v[0].line = 999999; return v; } },
      { label: 'a claim re-attributed to a file it does not appear in', expect: 'DRIFT',
        mutate: (v) => { v[0].file = 'README.md'; return v; } },
      /**
       * The one that mattered most. The ledger is the provenance record for every
       * published claim, and its TEXT was unverified: this rewrites a claim to a
       * sentence that appears in no reference file.
       */
      { label: 'a claim text rewritten to something no reference file says', expect: 'DRIFT',
        mutate: (v) => { v[0].text = 'this sentence appears in no reference file anywhere'; return v; } },
      /**
       * The tag and version comparisons in check 3 shipped 2026-08-19 with NO mutant, so deleting
       * them left every gate green. That is the defect they were written to close, one layer up: a
       * check nothing proves can fail is indistinguishable from a check that is not there. Both
       * mutants below touch ONLY the ledger field and never the text, so they land exactly where
       * the text comparison is blind.
       */
      { label: 'a claim ledger tags out of sync with the tagged line', expect: 'DRIFT',
        mutate: (v) => {
          const r = v.find((x) => (x.tags || []).length) || v[0];
          r.tags = (r.tags || []).includes('COMMUNITY') ? ['OFFICIAL'] : ['COMMUNITY'];
          return v;
        } },
      { label: 'a claim ledger versions out of sync with the tagged line', expect: 'DRIFT',
        mutate: (v) => {
          const r = v.find((x) => !(x.versions || []).includes('9.9.9')) || v[0];
          r.versions = [...(r.versions || []), '9.9.9'];
          return v;
        } },
    ],
  }));
}

const errors = [];
const warnings = [];

// 1. sources.json
let sources = [];
try {
  sources = JSON.parse(readFileSync(join(EV, 'sources.json'), 'utf8'));
  if (!Array.isArray(sources)) errors.push('sources.json: not an array');
} catch (e) {
  errors.push(`sources.json: ${e.message}`);
}
const sourceIds = new Set();
for (const s of sources) {
  if (!s.id) { errors.push('sources.json: record with no id'); continue; }
  if (sourceIds.has(s.id)) errors.push(`sources.json: duplicate id ${s.id}`);
  sourceIds.add(s.id);
  if (!s.retrieved) errors.push(`sources.json ${s.id}: no retrieved date`);
  if (!s.status) errors.push(`sources.json ${s.id}: no status`);
  if (s.url && s.url !== 'internal') {
    try { new URL(s.url); } catch { errors.push(`sources.json ${s.id}: malformed url ${s.url}`); }
  }
}

// 2. claims.jsonl
let claims = [];
const claimsPath = join(EV, 'claims.jsonl');
if (!existsSync(claimsPath)) {
  errors.push('claims.jsonl: missing');
} else {
  readFileSync(claimsPath, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try { claims.push(JSON.parse(t)); }
    catch (e) { errors.push(`claims.jsonl line ${i + 1}: ${e.message}`); }
  });
}
const claimIds = new Set();
for (const c of claims) {
  if (claimIds.has(c.id)) errors.push(`claims.jsonl: duplicate id ${c.id}`);
  claimIds.add(c.id);
  if (c.status === 'attributed') {
    if (!sourceIds.has(c.source)) errors.push(`${c.id}: source ${c.source} not in sources.json`);
  } else if (c.status !== 'unattributed') {
    errors.push(`${c.id}: status must be attributed or unattributed, got ${c.status}`);
  }
}

// 3. drift against mechanical extraction
const fresh = extract();
const freshIds = new Set(fresh.map(c => c.id));
/**
 * COMPARED BY RECORD, NOT BY ID SET.
 *
 * This loop used to test `freshIds.has(c.id)` and nothing else, so only a
 * DISAPPEARING claim was drift. A claim's recorded `file`, `line` and `text`
 * could be rewritten to anything and this gate exited 0, while the docstring
 * above promised that "a claim in the ledger whose file:line no longer carries a
 * tag" is detected. Found 2026-08-08 by pointing the new --prove-can-fail proof
 * at the committed ledger: setting a claim's line to 999999 was not rejected, and
 * neither was rewriting its text to a sentence that appears in no reference file.
 *
 * Safe to tighten: all 458 committed claims were measured against a fresh
 * extraction first and agree exactly on file, line and text, so this adds no
 * pre-existing failure. It is the provenance record the whole project rests on,
 * and it was guarded by a set-membership test.
 */
/**
 * A Map keyed by id LOSES the earlier record when two extracted lines share an id, and the reverse
 * sweep below then reports both as accounted for, so one line's tags go unchecked with the gate
 * green. Reproduced by an independent reviewer with a second reference file colliding on
 * CLM-agent-sdk-012: 786 extraction rows, 785 distinct ids, exit 0.
 *
 * Latent today (0 duplicate ids) and not latent by design: data/routing/skill-split.json plans to
 * duplicate four reference files into every skill, which is exactly the shape that produces
 * byte-identical colliding ids. Detected here rather than at cutover.
 */
/**
 * A CLAIM MAY NOT LIVE IN A FILE HEADER. On 2026-08-19 a header sentence naming [ENGINEERING] in
 * prose minted a claim from the header itself: the extractor is right to read tags anywhere, and a
 * provenance record pointing at a file's own verification blockquote is meaningless. Caught by hand
 * that round, so nothing stopped the next one.
 */
const headerLines = new Map();
for (const c of fresh) {
  if (!headerLines.has(c.file)) {
    const lines = readFileSync(join(ROOT, c.file), 'utf8').split(/\r?\n/);
    const block = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*>/.test(lines[i])) block.add(i + 1);
      else if (block.size && lines[i].trim()) break;
      else if (block.size) break;
    }
    headerLines.set(c.file, block);
  }
  if (headerLines.get(c.file).has(c.line)) {
    errors.push(`HEADER_CLAIM: ${c.id} is a line of ${c.file}'s own verification header, not a claim; backtick the tag name so it reads as a mention`);
  }
}

const seenIds = new Map();
for (const c of fresh) {
  const prior = seenIds.get(c.id);
  if (prior) {
    errors.push(`DUPLICATE_EXTRACTION_ID: ${c.id} is produced by both ${prior.file}:${prior.line} and ${c.file}:${c.line}; one of the two would be invisible to every check below`);
  } else {
    seenIds.set(c.id, c);
  }
}
const freshById = new Map(fresh.map(c => [c.id, c]));
for (const c of claims) {
  if (!freshIds.has(c.id)) {
    errors.push(`DRIFT: ${c.id} in ledger but its file:line no longer carries a tag (content moved or edited; re-run extraction and re-attribute)`);
    continue;
  }
  const f = freshById.get(c.id);
  if (f.file !== c.file) errors.push(`DRIFT: ${c.id} ledger says ${c.file}, extraction found it in ${f.file}`);
  if (f.line !== c.line) errors.push(`DRIFT: ${c.id} ledger says line ${c.line}, extraction found it at line ${f.line}`);
  if (f.text !== c.text) errors.push(`DRIFT: ${c.id} ledger text does not match the tagged line it cites`);
  /**
   * Tags were compared by NOTHING until 2026-08-19, and an independent review found the gap the
   * hard way. The extractor change that stopped reading a tag written inside backticks correctly
   * dropped [OFFICIAL] from permissions.md:100, whose own prose says that tag was withdrawn as
   * wrong. The ledger kept both tags. It stayed invisible because the claim retained [ENGINEERING]
   * and never moved the total, this tool diffed only file, line and text, and attrib-check compares
   * two LEDGERS, so the unchanged value matched itself. The record asserted official documentation
   * for the one claim whose sentence retracts it.
   */
  /**
   * WHAT THIS PROVES, AND WHAT IT DOES NOT. Both sides are the same regex over the same line, so
   * this catches a ledger that stopped matching the FILE and nothing else. It does not read
   * sources.json's URL, the mirrored page, or the claim's note, so a bullet retagged to [OFFICIAL]
   * in BOTH places, with its source swapped to an unrelated real page, passes here. An independent
   * reviewer demonstrated exactly that end to end on 2026-08-19. Whether a tag is DESERVED is
   * settled by quote-check for lines carrying a 25-character verbatim span, and by a human reading
   * the cited page for everything else. Do not read a green run as a check on attribution truth.
   *
   * The `text` compared just above is the extractor's 400-CHARACTER PREFIX. An edit beyond that
   * point is invisible here by construction; `text_sha256` holds a hash of the FULL claim text and
   * tools/claim-drift.mjs is the gate that checks it.
   */
  const ft = JSON.stringify([...(f.tags || [])].sort());
  const ct = JSON.stringify([...(c.tags || [])].sort());
  if (ft !== ct) errors.push(`DRIFT: ${c.id} ledger tags ${ct} do not match the tagged line, which carries ${ft}`);
  const fv = JSON.stringify([...(f.versions || [])].sort());
  const cv = JSON.stringify([...(c.versions || [])].sort());
  if (fv !== cv) errors.push(`DRIFT: ${c.id} ledger versions ${cv} do not match the tagged line, which carries ${fv}`);
}
for (const f of fresh) {
  if (!claimIds.has(f.id)) errors.push(`DRIFT: tagged line ${f.id} (${f.file}:${f.line}) has no ledger record`);
}

// 4. observations
//
// EXPIRY. An observation records what was true on a date. When the world moves,
// the record is marked expired rather than deleted: deleting it destroys the
// only evidence of how long the gap lasted, and a repo that quietly drops its
// superseded observations cannot tell anyone how fast its sources change.
// `expired` is the ISO date the record stopped being current and `expiredBy`
// says what closed it and how that was verified, so an expired record is
// readable as history and unusable as current evidence. Both fields or neither:
// an `expired` with no `expiredBy` is a claim with no evidence behind it, which
// is the exact failure the ledger exists to prevent.
//
// The walk is deliberately NON-RECURSIVE and expired records stay in this
// directory. Moving them to observations/expired/ would drop them out of
// validation entirely, and an unvalidated record is worse than a deleted one:
// it looks like it is being checked.
const obsDir = join(EV, 'observations');
if (existsSync(obsDir)) {
  for (const f of readdirSync(obsDir).filter(x => x.endsWith('.json'))) {
    try {
      const o = JSON.parse(readFileSync(join(obsDir, f), 'utf8'));
      for (const field of ['id', 'claim', 'build', 'observed', 'method', 'reproduction']) {
        if (!o[field]) errors.push(`observations/${f}: missing ${field}`);
      }
      const hasExpired = o.expired !== undefined;
      const hasExpiredBy = o.expiredBy !== undefined;
      if (hasExpired || hasExpiredBy) {
        if (!hasExpired) errors.push(`observations/${f}: expiredBy without expired; an expiry needs the date it happened`);
        if (!hasExpiredBy) errors.push(`observations/${f}: expired without expiredBy; an expiry with no stated cause is an unevidenced claim`);
        if (hasExpired && !/^\d{4}-\d{2}-\d{2}$/.test(String(o.expired))) {
          errors.push(`observations/${f}: expired is not an ISO date: ${JSON.stringify(o.expired)}`);
        }
        if (hasExpired && hasExpiredBy && String(o.expired) < String(o.observed)) {
          errors.push(`observations/${f}: expired ${o.expired} precedes observed ${o.observed}`);
        }
        if (hasExpiredBy && String(o.expiredBy).trim().length < 40) {
          errors.push(`observations/${f}: expiredBy is too short to be evidence (needs what closed it and how that was checked)`);
        }
      }
    } catch (e) { errors.push(`observations/${f}: ${e.message}`); }
  }
} else {
  warnings.push('observations/ directory missing');
}

// 5. VERIFIED_VERSION
try {
  const v = readFileSync(join(EV, 'VERIFIED_VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) errors.push(`VERIFIED_VERSION: not a bare semver: ${JSON.stringify(v)}`);
} catch (e) { errors.push(`VERIFIED_VERSION: ${e.message}`); }

const result = {
  sources: sources.length,
  claims: claims.length,
  freshTagged: fresh.length,
  attributed: claims.filter(c => c.status === 'attributed').length,
  unattributed: claims.filter(c => c.status === 'unattributed').length,
  errors: errors.length,
  warnings: warnings.length,
};

if (AS_JSON) {
  console.log(JSON.stringify({ ...result, errorDetail: errors, warningDetail: warnings }, null, 2));
} else {
  console.log(`sources=${result.sources} claims=${result.claims} (attributed=${result.attributed}, unattributed=${result.unattributed}) tagged-lines=${result.freshTagged}`);
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`FAIL  ${e}`);
  console.log(errors.length ? `FAIL: ${errors.length} error(s)` : 'PASS: evidence ledger is internally consistent');
}
process.exit(errors.length ? 1 : 0);
