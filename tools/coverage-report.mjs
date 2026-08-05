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
import { readFileSync, readdirSync, existsSync } from 'fs';
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
  const qRows = readFileSync(join(ROOT, 'tests', 'questions.jsonl'), 'utf8')
    .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));

  const SK = join(ROOT, 'skills', 'claude-code-extension-engineering', 'references');
  // Count the numbered card rows and the event rows from the reference files
  // themselves, so the manifest is checked against content rather than against
  // another sentence that could be equally stale.
  // Count DATA rows of a markdown table, skipping the header and the |---| rule.
  // `skipCol1` drops values that are themselves column headings: hook-events.md
  // holds two tables, and the second one's "Field" header would otherwise count as
  // a 32nd hook event. Getting this wrong makes the gate cry wolf, which this
  // file's own header warns is worse than having no gate.
  // Count DATA rows of ONE table, the one whose header row starts with `header`,
  // stopping at the first non-table line. Scoping to a single table matters:
  // hook-events.md holds several, and counting every pipe row in the file gave 36
  // against a real 31. A gate that miscounts cries wolf, which this file's own
  // header warns is worse than having no gate at all.
  const tableRows = (file, header) => {
    if (!existsSync(join(SK, file))) return 0;
    const lines = readFileSync(join(SK, file), 'utf8').split(/\r?\n/);
    const start = lines.findIndex((l) => l.startsWith(`| ${header} `) || l.startsWith(`| ${header}|`));
    if (start < 0) return 0;
    const seen = new Set();
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].startsWith('|')) break;
      const col1 = (lines[i].split('|')[1] || '').trim().replace(/`/g, '');
      if (!col1 || /^-+$/.test(col1)) continue;
      seen.add(col1);
    }
    return seen.size;
  };
  const cardCount = tableRows('composition-cards.md', 'Pairing');
  const eventCount = tableRows('hook-events.md', 'Event');
  const FACTS = [
    { label: 'checker fixtures', live: (checker.match(/^\s+name:/gm) || []).length, re: /(?:grown to\s+)?(\w+)\s+fixtures/gi },
    { label: 'ledger claims', live: claims.length, re: /(\d+)\s+source assignments/gi },
    // Added 2026-08-02 after the README was found claiming 184 questions and 174
    // positive assertions against a live 191 and 181. Both phrasings are specific
    // enough that a match can only be a claim about CURRENT state: a historical
    // quote does not say "questions (set v2)" or "all N positive assertions".
    { label: 'suite rows', live: qRows.length, re: /(\d+)\s+questions \(set v2\)/gi },
    { label: 'positive assertions', live: qRows.filter(r => r.answer_key && !r.must_not_match).length, re: /all\s+(\d+)\s+positive assertions/gi },
    // Added 2026-08-05 after independent review found .claude-plugin/plugin.json
    // advertising "18 composition cards, 30 hook-event contracts" against a live 24
    // and 31, while this gate reported "none disagree". The gate was real; it simply
    // did not scan the manifest, which is the FIRST surface a marketplace reader sees.
    { label: 'composition cards', live: cardCount, re: /(\d+)\s+composition cards/gi },
    { label: 'hook-event contracts', live: eventCount, re: /(\d+)\s+hook-event contracts/gi },
  ];
  const WORDS = { six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 };

  // docs/SUBMISSION.md and .claude-plugin/plugin.json are the two MARKETPLACE-FACING
  // surfaces, and both were omitted here until 2026-08-05. A drift gate that skips the
  // listing copy protects the document nobody reads first.
  const docs = ['README.md', 'IMPROVEMENTS.md', 'docs/SUBMISSION.md', '.claude-plugin/plugin.json',
    ...readdirSync(join(ROOT, 'tests'))
      .filter(f => /^results.*\.md$/.test(f)).map(f => join('tests', f))]
    .filter(rel => existsSync(join(ROOT, rel)));

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
  // Key ambiguity: an answer key that matches more than once in its own source
  // file can survive deletion of the passage it guards. Item 13 was closed by
  // rescoping, then silently REOPENED when unrelated content added a second
  // occurrence of one key, and only a human reviewer noticed. Closing it by
  // construction instead: the ledger of intentional exceptions is explicit, and
  // anything else is a failure.
  //
  // Two exemptions, and they hold for DIFFERENT reasons. Keep them distinct:
  // an independent review caught this comment justifying both on A015's
  // grounds, which are wrong for A001.
  //
  // A015 ("are all upstream sources redistributable?"): each of the 13
  // Proprietary rows in sources.md is a separate falsifier, so the plurality
  // genuinely IS the answer, and the row degrades to red if they all go.
  //
  // A001 ("is Agent Teams stable and on by default?"): its 7 hits are
  // restatements of ONE fact, not joint evidence. It is exempt on a narrower
  // ground: every occurrence concerns the same feature's experimental status,
  // so no unrelated passage can prop the row up if the real answer changes.
  //
  // Adding to this list is not a fix. Rescope first; exempt only when
  // narrowing would make the test assert something false, and write down
  // which of the two grounds applies.
  const AMBIGUITY_EXEMPT = new Set(['A001', 'A015']);
  const qAll = readFileSync(join(ROOT, 'tests', 'questions.jsonl'), 'utf8')
    .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
  for (const q of qAll) {
    if (!q.answer_key || AMBIGUITY_EXEMPT.has(q.id)) continue;
    let src;
    try { src = readFileSync(join(ROOT, q.source_file), 'utf8'); } catch { continue; }
    let re;
    try { re = new RegExp(q.answer_key, 'gi'); } catch { continue; }
    const n = (src.match(re) || []).length;
    if (n > 1) {
      hits++;
      console.log(`  ${q.source_file}  ${q.id}: answer key matches ${n} times, so the row can survive deletion of the passage it guards. Rescope it, or add it to AMBIGUITY_EXEMPT with a reason.`);
    }
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
