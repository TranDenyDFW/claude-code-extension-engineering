/**
 * fact-sweep: catch a corrected fact that was fixed in one artifact and left stale in a sibling.
 *
 * WHY THIS EXISTS. On 2026-08-17 one measured figure lived in five artifacts. It was corrected
 * twice, and BOTH times an independent review found a sibling copy still carrying the old value.
 * A third round found a third. Reading more carefully caught none of them; a short script found the
 * last one immediately. This is that script, made permanent.
 *
 * TWO DEFECTS THIS TOOL ALREADY HAD, both worth keeping in view because each made it BLIND rather
 * than noisy, which is the failure mode a gate must not have:
 *
 *   1. Importing it ran the live sweep. A must-fail harness that imported it never reached its own
 *      assertions: the live run printed PASS and exited, and the harness reported that as its
 *      result. A check that could not run is a failure, never a pass. Hence IS_ENTRY.
 *   2. Units were paragraph-scoped for every format. A line-oriented file (JSONL) has no blank
 *      lines, so the whole file collapsed into ONE unit and a retraction marker anywhere in it
 *      whitelisted every row. The synthetic self-test passed 6 of 6 while the tool could not see an
 *      injected stale value in the real tests/questions.jsonl. Hence unitsFor().
 *
 * Defect 2 is the reason the must-fail harness runs against REAL artifacts and not only fixtures.
 *
 * Paragraph scoping (for prose) is itself load-bearing: superseded values legitimately appear
 * inside retractions, so the job is telling a retraction from a claim, and a line-scoped version of
 * this check produced a false positive on a retraction whose marker words sat on the wrapped
 * previous line.
 *
 * Manifest: evidence/facts.json, an array of
 *   { id, canonical: [..], superseded: [..], files: [..], note }
 * A superseded value is a FAILURE unless its unit also carries a retraction marker.
 *
 *   node tools/fact-sweep.mjs              run the sweep
 *   node tools/fact-sweep.mjs --self-test  prove the sweep can fail
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = join(dirname(HERE), '..');
const IS_ENTRY = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(HERE);

/** Words that mark a unit as retracting a value rather than asserting it. */
const RETRACTION = [
  'earlier version', 'previously', 'superseded', 'retracted', 'does not reproduce',
  'do not cite', 'was transcribed', 'overstat', 'overcount', 'instead of', 'without the ismeta',
  'produces the', 'claimed', 'the first version', 'corrected',
];

/** One unit per non-blank line, for formats where a record IS a line. */
export function lines(text) {
  return text.split('\n')
    .map((t, i) => ({ text: t, line: i + 1 }))
    .filter((u) => u.text.trim() !== '');
}

/** Split prose into paragraphs, so a wrapped sentence is judged whole. */
export function paragraphs(text) {
  const src = text.split('\n');
  const out = [];
  let buf = [];
  let start = 1;
  const flush = () => {
    if (buf.length) out.push({ text: buf.join(' '), line: start });
    buf = [];
  };
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    if (l.trim() === '' || l.trim() === '*' || l.trim() === '*/') {
      flush();
    } else {
      if (!buf.length) start = i + 1;
      buf.push(l.replace(/^\s*\*\s?/, '').trim());
    }
  }
  flush();
  return out;
}

/** Pick the unit by FORMAT. Getting this wrong makes the gate blind; see the header. */
export function unitsFor(file, text) {
  return /\.(jsonl|ndjson|csv|tsv)$/i.test(file) ? lines(text) : paragraphs(text);
}

export function isRetraction(unitText) {
  const lower = unitText.toLowerCase();
  return RETRACTION.some((m) => lower.includes(m));
}

/** Returns a list of violations: a superseded value asserted as fact. */
export function sweep(facts, readFile) {
  const violations = [];
  for (const fact of facts) {
    for (const file of fact.files) {
      let body;
      try {
        body = readFile(file);
      } catch {
        violations.push({ fact: fact.id, file, line: 0, value: null,
                          why: 'file listed in the manifest could not be read' });
        continue;
      }
      for (const unit of unitsFor(file, body)) {
        if (isRetraction(unit.text)) continue;
        for (const bad of fact.superseded) {
          if (unit.text.includes(bad)) {
            violations.push({ fact: fact.id, file, line: unit.line, value: bad,
                              why: 'superseded value asserted outside a retraction',
                              context: unit.text.slice(0, 150) });
          }
        }
      }
    }
  }
  return violations;
}

function selfTest() {
  const BASE = { id: 'demo', canonical: ['10,670'], superseded: ['13,598'] };
  const cases = [
    { label: 'a superseded value asserted as fact is CAUGHT',
      body: 'The measurement gave 13,598 real user turns.', expect: 1 },
    { label: 'the same value inside a retraction is ALLOWED',
      body: 'An earlier version claimed 13,598, which does not reproduce.', expect: 0 },
    { label: 'a retraction WRAPPED across lines is still allowed (the line-scoped bug)',
      body: 'An earlier version of this comment\nclaimed 13,598 real turns, which is wrong.', expect: 0 },
    { label: 'a stale value in a LATER paragraph is CAUGHT even if an earlier one retracts',
      body: 'An earlier version claimed 13,598 and was wrong.\n\nThere are 13,598 real user turns.', expect: 1 },
    { label: 'the canonical value alone is clean',
      body: 'There are 10,670 real user turns.', expect: 0 },
    { label: 'an unreadable manifest file is a FAILURE, not a pass',
      body: null, expect: 1 },
    { label: 'JSONL is judged PER LINE, so one row retracting cannot whitelist another',
      file: 'rows.jsonl', expect: 1,
      body: '{"a":"an earlier version claimed 13,598 and was wrong"}\n{"b":"there are 13,598 real turns"}' },
    { label: 'JSONL carrying only a retraction row stays clean',
      file: 'rows.jsonl', expect: 0,
      body: '{"a":"an earlier version claimed 13,598 and was wrong"}' },
  ];
  let pass = 0;
  for (const c of cases) {
    const read = () => { if (c.body === null) throw new Error('ENOENT'); return c.body; };
    const got = sweep([{ ...BASE, files: [c.file || 'a.md'] }], read).length;
    const ok = got === c.expect;
    if (ok) pass++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}  (expected ${c.expect}, got ${got})`);
  }
  console.log(`\n${pass === cases.length ? 'PASS' : 'FAIL'}  ${pass}/${cases.length} self-test rows.`);
  return pass === cases.length ? 0 : 1;
}

function liveRun() {
  const manifestPath = join(ROOT, 'evidence', 'facts.json');
  if (!existsSync(manifestPath)) {
    console.error(`no manifest at ${relative(ROOT, manifestPath)}`);
    return 1;
  }
  const facts = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const violations = sweep(facts, (f) => readFileSync(/^[A-Za-z]:/.test(f) ? f : join(ROOT, f), 'utf8'));
  const checked = facts.reduce((n, f) => n + f.files.length, 0);
  if (violations.length === 0) {
    console.log(`PASS  ${facts.length} fact(s) consistent across ${checked} artifact reads.`);
    return 0;
  }
  for (const v of violations) {
    console.error(`FAIL  ${v.fact}  ${v.file}:${v.line}  [${v.value ?? 'unreadable'}]  ${v.why}`);
    if (v.context) console.error(`        ${v.context}`);
  }
  console.error(`\n${violations.length} violation(s). A corrected fact was left stale in a sibling artifact.`);
  return 1;
}

if (IS_ENTRY) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : liveRun());
}
