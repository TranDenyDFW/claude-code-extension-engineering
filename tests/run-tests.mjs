#!/usr/bin/env node
/**
 * Tier 1 deterministic suite for claude-code-extension-engineering.
 *
 * Answers exactly one question per row: does the shipped content contain the
 * answer? It does NOT measure whether a model can use that content. That is
 * Tier 2, which is model-graded and lives in tests/results.md.
 *
 *   node tests/run-tests.mjs               run the suite
 *   node tests/run-tests.mjs --json        emit machine-readable results
 *   node tests/run-tests.mjs --prove-fail  run against GUTTED content and
 *                                          assert the suite goes RED
 *
 * --prove-fail exists because a suite that stays green when the content is
 * removed proves nothing about the content. Success for that mode means the
 * suite REPORTS FAILURES. That is what makes the normal green run meaningful.
 *
 * Self-reporting: prints PASS or FAIL per row plus a summary, and exits
 * non-zero on failure.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const QUESTIONS = join(HERE, 'questions.jsonl');
const PROVE_FAIL = process.argv.includes('--prove-fail');
const AS_JSON = process.argv.includes('--json');

// ------------------------------------------------------------------ loading --

function loadQuestions() {
  const raw = readFileSync(QUESTIONS, 'utf8');
  const rows = [];
  raw.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      rows.push(JSON.parse(t));
    } catch (err) {
      console.error(`questions.jsonl line ${i + 1}: ${err.message}`);
      process.exit(2);
    }
  });
  /**
   * IDS MUST BE UNIQUE, and nothing checked that until 2026-08-13.
   *
   * Thirteen rows were appended reusing ids that already existed. The suite passed at the
   * new row count, so the collision was invisible. A later script that rescoped two answer
   * keys then matched the FIRST row carrying each id and silently overwrote two
   * PRE-EXISTING rows, replacing what they asserted while the totals still read green.
   *
   * That is the shape this whole suite exists to prevent: a change that looks like it added
   * coverage while actually removing some. Duplicate ids are now a hard refusal, because a
   * count of rows is not a count of distinct assertions.
   */
  const ids = rows.map((r) => r.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) {
    console.error(`questions.jsonl: DUPLICATE ids: ${dupes.join(', ')}`);
    console.error('An id addressed by two rows means an edit to one silently rewrites the other.');
    process.exit(2);
  }
  return rows;
}

/**
 * Gutted mode keeps the file present and keeps its title, and removes
 * everything else. That isolates the content as the variable: a row that still
 * passes is matching on a filename or a heading, not on shipped knowledge.
 */
function guttedText(original) {
  const first = original.split(/\r?\n/)[0] || '';
  return `${first}\n\n(content removed by --prove-fail)\n`;
}

const cache = new Map();
function sourceText(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    cache.set(relPath, null);
    return null;
  }
  const real = readFileSync(abs, 'utf8');
  const text = PROVE_FAIL ? guttedText(real) : real;
  cache.set(relPath, text);
  return text;
}

// ------------------------------------------------------------------ running --

function runRow(q) {
  const text = sourceText(q.source_file);
  if (text === null) {
    return { id: q.id, category: q.category, pass: false, reason: `source_file not found: ${q.source_file}` };
  }
  if (q.must_not_match) {
    const re = new RegExp(q.must_not_match, 'i');
    const hit = re.test(text);
    return {
      id: q.id, category: q.category, pass: !hit,
      reason: hit ? `must_not_match /${q.must_not_match}/ matched, so this prompt would over-trigger` : 'absent as required',
      assertion: 'negative',
    };
  }
  if (!q.answer_key) {
    return { id: q.id, category: q.category, pass: false, reason: 'row has neither answer_key nor must_not_match' };
  }
  const re = new RegExp(q.answer_key, 'i');
  const m = text.match(re);
  return {
    id: q.id, category: q.category, pass: Boolean(m),
    reason: m ? `matched: ${JSON.stringify(m[0]).slice(0, 80)}` : `answer_key /${q.answer_key}/ not found in ${q.source_file}`,
    assertion: 'positive',
  };
}

const questions = loadQuestions();
const results = questions.map(runRow);

const positives = results.filter(r => r.assertion === 'positive');
const failed = results.filter(r => !r.pass);

// ----------------------------------------------------------------- reporting --

if (AS_JSON) {
  const byId = Object.fromEntries(questions.map(q => [q.id, q]));
  console.log(JSON.stringify({
    mode: PROVE_FAIL ? 'prove-fail' : 'normal',
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    rows: results.map(r => ({ ...r, question: byId[r.id].question, source_file: byId[r.id].source_file })),
  }, null, 2));
} else {
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass || process.env.VERBOSE) console.log(`${tag}  ${r.id}  ${r.reason}`);
  }

  const cats = [...new Set(results.map(r => r.category))].sort();
  console.log('');
  console.log('category            n   pass   fail   rate');
  console.log('-------------------------------------------');
  for (const c of cats) {
    const rows = results.filter(r => r.category === c);
    const p = rows.filter(r => r.pass).length;
    const rate = ((100 * p) / rows.length).toFixed(0);
    console.log(`${c.padEnd(20)}${String(rows.length).padStart(2)}   ${String(p).padStart(4)}   ${String(rows.length - p).padStart(4)}   ${rate.padStart(3)}%`);
  }
  console.log('-------------------------------------------');
  const total = results.length;
  const passed = total - failed.length;
  console.log(`${'TOTAL'.padEnd(20)}${String(total).padStart(2)}   ${String(passed).padStart(4)}   ${String(failed.length).padStart(4)}   ${((100 * passed) / total).toFixed(0).padStart(3)}%`);
  console.log('');
}

// --------------------------------------------------------------- verdicts --

if (PROVE_FAIL) {
  // Every POSITIVE assertion must break when the content is gone. Negative
  // assertions are excluded on purpose: "this term is absent" is trivially
  // true against gutted content and would mask a hollow suite.
  const survivors = positives.filter(r => r.pass);
  if (!AS_JSON) {
    console.log(`prove-fail: ${positives.length - survivors.length}/${positives.length} positive assertions correctly went RED.`);
  }
  if (survivors.length > 0) {
    if (!AS_JSON) {
      console.log('');
      console.log('SUITE IS HOLLOW. These rows passed against gutted content:');
      for (const s of survivors) console.log(`  ${s.id}  ${s.reason}`);
    }
    process.exit(1);
  }
  if (!AS_JSON) console.log('PASS: the suite is not self-certifying.');
  process.exit(0);
}

if (failed.length > 0) {
  if (!AS_JSON) console.log(`FAIL: ${failed.length} of ${results.length} rows failed.`);
  process.exit(1);
}
if (!AS_JSON) console.log(`PASS: ${results.length} of ${results.length} rows passed.`);
process.exit(0);
