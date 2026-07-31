#!/usr/bin/env node
/**
 * Advisory coverage report: which evidence-tagged claims have no Tier 1 answer
 * key matching their text. NOT a CI gate, and full coverage is NOT a goal;
 * the point is that "did the suite keep up with the content?" gets a
 * mechanical answer instead of a manual sweep.
 *
 *   node tools/coverage-report.mjs           per-file summary + uncovered list
 *   node tools/coverage-report.mjs --summary per-file summary only
 *
 * Ignore-list: claim classes never meant for one-question-per-line coverage.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SUMMARY_ONLY = process.argv.includes('--summary');

const IGNORE = [
  /^#/,
  /Definition of Done/i,
  /\[LEGACY\]|\[DEPRECATED\]/,
  /^Layer:|^\*\*Layer:/,
];

const claims = readFileSync(join(ROOT, 'evidence', 'claims.jsonl'), 'utf8')
  .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
const questions = readFileSync(join(ROOT, 'tests', 'questions.jsonl'), 'utf8')
  .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
  .filter(q => q.answer_key);

const keys = questions.map(q => {
  try { return new RegExp(q.answer_key, 'i'); } catch { return null; }
}).filter(Boolean);

const byFile = new Map();
let covered = 0, uncovered = 0, ignored = 0;
const uncoveredList = [];
for (const c of claims) {
  if (IGNORE.some(re => re.test(c.text))) { ignored++; continue; }
  const hit = keys.some(re => re.test(c.text));
  const f = c.file.replace(/^skills\/claude-code-extension-engineering\//, '');
  if (!byFile.has(f)) byFile.set(f, { covered: 0, uncovered: 0 });
  if (hit) { covered++; byFile.get(f).covered++; }
  else { uncovered++; byFile.get(f).uncovered++; uncoveredList.push(c); }
}

console.log('file                                   covered  uncovered');
for (const [f, s] of [...byFile.entries()].sort((a, b) => b[1].uncovered - a[1].uncovered)) {
  console.log(`${f.padEnd(40)}${String(s.covered).padStart(5)}${String(s.uncovered).padStart(10)}`);
}
console.log(`\nTOTAL tagged claims: ${claims.length}  covered: ${covered}  uncovered: ${uncovered}  ignored (checklists/legacy/headers): ${ignored}`);
console.log('Advisory only: full coverage is not a goal; rising uncovered counts after content edits are the signal.');

if (!SUMMARY_ONLY && uncoveredList.length) {
  console.log('\nUncovered claims:');
  for (const c of uncoveredList) console.log(`  ${c.id}  ${c.text.slice(0, 100)}`);
}
