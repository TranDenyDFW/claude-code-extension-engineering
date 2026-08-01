#!/usr/bin/env node
/**
 * Advisory coverage report: which evidence-tagged claims have no Tier 1 answer
 * key matching their text. NOT a CI gate, and full coverage is NOT a goal;
 * the point is that "did the suite keep up with the content?" gets a
 * mechanical answer instead of a manual sweep.
 *
 *   node tools/coverage-report.mjs             per-file summary + uncovered list
 *   node tools/coverage-report.mjs --summary   per-file summary only
 *   node tools/coverage-report.mjs --doc-numbers
 *       Re-derives the live counts and fails on any documentation sentence that
 *       states a DIFFERENT number for the same thing. Three stale-count reports
 *       across two audit rounds is why this exists: prose drifts from the
 *       artifacts it describes, and only re-derivation catches it.
 *       This IS a gate (exit 1 on any hit) and CI runs it. That is affordable
 *       only because the fact list is deliberately narrow: each pattern is
 *       phrased so that a match can only be a claim about current state. A
 *       first version matched generic shapes like "N questions" and produced
 *       ten hits, all legitimate historical quotes; those were dropped rather
 *       than ship a gate that cries wolf. If a future document needs to quote a
 *       superseded count, rephrase it away from the canonical wording, and say
 *       in the text that it is historical.
 *
 * Ignore-list: claim classes never meant for one-question-per-line coverage.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SUMMARY_ONLY = process.argv.includes('--summary');
const DOC_NUMBERS = process.argv.includes('--doc-numbers');

const IGNORE = [
  /^#/,
  /Definition of Done/i,
  /\[LEGACY\]|\[DEPRECATED\]/,
  /^Layer:|^\*\*Layer:/,
];

const claims = readFileSync(join(ROOT, 'evidence', 'claims.jsonl'), 'utf8')
  .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));

if (DOC_NUMBERS) {
  const checker = readFileSync(join(ROOT, 'tools', 'check-validate-output.mjs'), 'utf8');

  // Only facts whose PHRASING is unique enough that a match is unambiguously a
  // claim about current state. Generic shapes like "N questions" or "N rows"
  // were tried and dropped: historical tables quote superseded numbers by
  // design, so those patterns produced ten hits and zero real findings. A
  // checker that cries wolf gets ignored, which is worse than no checker.
  const FACTS = [
    { label: 'checker fixtures', live: (checker.match(/^\s+name:/gm) || []).length, re: /(?:grown to\s+)?(\w+)\s+fixtures/gi },
    { label: 'ledger claims', live: claims.length, re: /(\d+)\s+source assignments/gi },
  ];
  const WORDS = { six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 };

  const docs = ['README.md', 'IMPROVEMENTS.md', ...readdirSync(join(ROOT, 'tests'))
    .filter(f => /^results.*\.md$/.test(f)).map(f => join('tests', f))];

  console.log('Live values re-derived from the artifacts:');
  for (const f of FACTS) console.log(`  ${f.label.padEnd(22)}${f.live}`);
  console.log('\nDocumentation statements that disagree:');
  let hits = 0;
  for (const rel of docs) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const f of FACTS) {
        f.re.lastIndex = 0;
        let m;
        while ((m = f.re.exec(line)) !== null) {
          const raw = m[1].replace(/,/g, '').toLowerCase();
          const n = WORDS[raw] !== undefined ? WORDS[raw] : Number(raw);
          if (!Number.isFinite(n) || n === f.live) continue;
          hits++;
          console.log(`  ${rel}:${i + 1}  ${f.label}: doc says ${m[1]}, live is ${f.live}`);
          console.log(`      ${line.trim().slice(0, 110)}`);
        }
      }
    });
  }
  // Stale "Last reviewed" header: the specific defect that prompted this mode.
  const impText = readFileSync(join(ROOT, 'IMPROVEMENTS.md'), 'utf8');
  const header = impText.match(/^Last reviewed (\d{4}-\d{2}-\d{2})/m);
  const allDates = [...impText.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m => m[1]).sort();
  const newest = allDates[allDates.length - 1];
  if (!header) {
    // Fail closed: a missing header is indistinguishable from a moved one, and
    // silently passing is how the stale header survived three rounds.
    hits++;
    console.log('  IMPROVEMENTS.md  header date: no "Last reviewed YYYY-MM-DD" line found; the check cannot run, so it fails');
  } else if (newest && header[1] < newest) {
    hits++;
    console.log(`  IMPROVEMENTS.md  header date: says ${header[1]}, but the file carries content dated ${newest}`);
  }

  if (!hits) console.log('  none');
  else console.log(`\n${hits} disagreement(s). Update the prose to the live value, or rephrase a deliberately historical quote away from the canonical wording.`);
  process.exit(hits ? 1 : 0);
}
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
