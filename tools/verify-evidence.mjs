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
 *      claims.jsonl. A claim in the ledger whose file:line no longer carries a
 *      tag, or a tagged line missing from the ledger, is a detected drift.
 *   4. evidence/observations/*.json each parse and carry id, claim, build,
 *      observed, method, reproduction.
 *   5. evidence/VERIFIED_VERSION is a bare semver line.
 *
 *   node tools/verify-evidence.mjs            run the gate
 *   node tools/verify-evidence.mjs --json     machine-readable result
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extract } from './extract-claims.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const EV = join(ROOT, 'evidence');
const AS_JSON = process.argv.includes('--json');

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
for (const c of claims) {
  if (!freshIds.has(c.id)) errors.push(`DRIFT: ${c.id} in ledger but its file:line no longer carries a tag (content moved or edited; re-run extraction and re-attribute)`);
}
for (const f of fresh) {
  if (!claimIds.has(f.id)) errors.push(`DRIFT: tagged line ${f.id} (${f.file}:${f.line}) has no ledger record`);
}

// 4. observations
const obsDir = join(EV, 'observations');
if (existsSync(obsDir)) {
  for (const f of readdirSync(obsDir).filter(x => x.endsWith('.json'))) {
    try {
      const o = JSON.parse(readFileSync(join(obsDir, f), 'utf8'));
      for (const field of ['id', 'claim', 'build', 'observed', 'method', 'reproduction']) {
        if (!o[field]) errors.push(`observations/${f}: missing ${field}`);
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
