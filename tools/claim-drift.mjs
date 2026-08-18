/**
 * claim-drift: detect a claim edited BEYOND the 400 characters the ledger stores.
 *
 * WHY THIS EXISTS. `extract-claims.mjs` stores `text` as
 *   line.trim().replace(/^[-|*\d.\s]+/, '').slice(0, 400)
 * and `rekey-claims.mjs` pairs ledger records against the file by that stored text. So the whole
 * reconciliation, including the `vanished 0` result this project relies on to prove nothing was
 * silently lost, only ever certifies the first 400 characters of each claim.
 *
 * MEASURED 2026-08-18: 62 of 657 claims are stored truncated, hiding 9,129 characters, mean 149
 * per affected claim. Those are the LONGEST claims, which is exactly where nuance and corrections
 * live. Found because a correction at offset 591 of a 978-character claim left rekey reporting
 * `unchanged`: the sentence had changed meaning and the gate could not see it.
 *
 * WHAT THIS ADDS. A `text_sha256` field on each ledger record, holding a hash of the FULL claim
 * text after the same transform and before the truncation. Additive: it does not rewrite the
 * stored `text`, so the existing pairing keeps working unchanged. Drift past the prefix now fails.
 *
 *   node tools/claim-drift.mjs              check every claim, fail on drift or a missing hash
 *   node tools/claim-drift.mjs --backfill   populate text_sha256 from the current files
 *   node tools/claim-drift.mjs --self-test  prove the check can fail
 */
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = join(dirname(HERE), '..');
const IS_ENTRY = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(HERE);

/** The extractor's transform, WITHOUT its slice(0, 400). Must stay identical to the prefix part. */
export function fullClaimText(line) {
  return line.trim().replace(/^[-|*\d.\s]+/, '');
}

export function sha(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Returns { drift, missing, checked }. `drift` is a record whose stored hash disagrees with the
 * file, i.e. an edit the prefix pairing cannot see. `missing` has no stored hash to compare.
 */
export function check(ledger, readFile) {
  const drift = [];
  const missing = [];
  let checked = 0;
  const cache = new Map();
  for (const rec of ledger) {
    let lines = cache.get(rec.file);
    if (!lines) {
      try {
        lines = readFile(rec.file).split('\n');
      } catch {
        drift.push({ id: rec.id, file: rec.file, why: 'file in the ledger could not be read' });
        continue;
      }
      cache.set(rec.file, lines);
    }
    const raw = lines[rec.line - 1];
    if (raw === undefined) {
      drift.push({ id: rec.id, file: rec.file, line: rec.line, why: 'line no longer exists' });
      continue;
    }
    const full = fullClaimText(raw);
    if (!rec.text_sha256) { missing.push(rec.id); continue; }
    checked++;
    if (rec.text_sha256 !== sha(full)) {
      drift.push({ id: rec.id, file: rec.file, line: rec.line,
                   why: `claim text changed beyond the stored ${rec.text.length}-char prefix`,
                   stored: rec.text_sha256.slice(0, 12), actual: sha(full).slice(0, 12),
                   length: full.length });
    }
  }
  return { drift, missing, checked };
}

function selfTest() {
  const LINE = '- ' + 'A'.repeat(600) + ' and then the tail that the prefix cannot see  [OFFICIAL]';
  const base = { id: 'demo', file: 'a.md', line: 1, text: fullClaimText(LINE).slice(0, 400) };
  const cases = [
    { label: 'an unchanged claim passes',
      rec: { ...base, text_sha256: sha(fullClaimText(LINE)) }, file: LINE, drift: 0, missing: 0 },
    { label: 'an edit BEYOND the 400-char prefix is CAUGHT (the whole point)',
      rec: { ...base, text_sha256: sha(fullClaimText(LINE)) },
      file: LINE.replace('the tail that the prefix cannot see', 'a tail that says something else'),
      drift: 1, missing: 0 },
    { label: 'an edit INSIDE the prefix is caught too',
      rec: { ...base, text_sha256: sha(fullClaimText(LINE)) },
      file: '- B' + 'A'.repeat(599) + ' and then the tail that the prefix cannot see  [OFFICIAL]',
      drift: 1, missing: 0 },
    { label: 'a record with no stored hash is reported MISSING, not silently passed',
      rec: { ...base }, file: LINE, drift: 0, missing: 1 },
    { label: 'a vanished line is drift, not a pass',
      rec: { ...base, line: 99, text_sha256: sha(fullClaimText(LINE)) }, file: LINE, drift: 1, missing: 0 },
    { label: 'an unreadable file is a FAILURE, not a pass',
      rec: { ...base, text_sha256: sha(fullClaimText(LINE)) }, file: null, drift: 1, missing: 0 },
  ];
  let pass = 0;
  for (const c of cases) {
    const read = () => { if (c.file === null) throw new Error('ENOENT'); return c.file; };
    const r = check([c.rec], read);
    const ok = r.drift.length === c.drift && r.missing.length === c.missing;
    if (ok) pass++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}  (drift ${r.drift.length}/${c.drift}, missing ${r.missing.length}/${c.missing})`);
  }
  console.log(`\n${pass === cases.length ? 'PASS' : 'FAIL'}  ${pass}/${cases.length} self-test rows.`);
  return pass === cases.length ? 0 : 1;
}

function load() {
  return readFileSync(join(ROOT, 'evidence', 'claims.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
const readRepoFile = (f) => readFileSync(join(ROOT, f), 'utf8');

function backfill() {
  const ledger = load();
  let n = 0;
  for (const rec of ledger) {
    const raw = readRepoFile(rec.file).split('\n')[rec.line - 1];
    if (raw === undefined) { console.error(`SKIP ${rec.id}: line ${rec.line} does not exist`); continue; }
    const h = sha(fullClaimText(raw));
    if (rec.text_sha256 !== h) { rec.text_sha256 = h; n++; }
  }
  writeFileSync(join(ROOT, 'evidence', 'claims.jsonl'),
    ledger.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.log(`backfilled text_sha256 on ${n} of ${ledger.length} record(s)`);
  return 0;
}

function run() {
  const { drift, missing, checked } = check(load(), readRepoFile);
  if (missing.length) {
    console.error(`FAIL  ${missing.length} record(s) carry no text_sha256, so drift past the stored`);
    console.error(`      prefix cannot be detected for them. Run --backfill.`);
    for (const id of missing.slice(0, 10)) console.error(`        ${id}`);
    return 1;
  }
  if (drift.length === 0) {
    console.log(`PASS  ${checked} claim(s) match their full-text hash, not just the stored prefix.`);
    return 0;
  }
  for (const d of drift) {
    console.error(`FAIL  ${d.id}  ${d.file}:${d.line ?? '?'}  ${d.why}`);
    if (d.stored) console.error(`        stored ${d.stored}... actual ${d.actual}... (full length ${d.length})`);
  }
  console.error(`\n${drift.length} claim(s) drifted. The ledger text pairing cannot see these.`);
  return 1;
}

if (IS_ENTRY) {
  const a = process.argv;
  process.exit(a.includes('--self-test') ? selfTest() : a.includes('--backfill') ? backfill() : run());
}
