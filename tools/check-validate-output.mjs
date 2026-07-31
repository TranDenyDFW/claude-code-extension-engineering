#!/usr/bin/env node
/**
 * Gate over `claude plugin validate` output.
 *
 * The repo uses commit-SHA versioning deliberately, so exactly ONE advisory is
 * expected: "No version specified". This checker enforces, by set subtraction,
 * that the advisory is the only warning:
 *
 *   - validation failed            -> exit 1
 *   - any warning line that is NOT the known advisory -> exit 1
 *   - otherwise                    -> exit 0
 *
 * The previous inline-shell version failed only when warnings existed AND the
 * advisory was absent, so an unexpected warning arriving alongside the
 * advisory passed. That backwards boolean is why this logic lives in a
 * testable script with a self-test instead of in yaml.
 *
 *   node tools/check-validate-output.mjs <file>     check a captured output
 *   ... | node tools/check-validate-output.mjs      check stdin
 *   node tools/check-validate-output.mjs --self-test
 */
import { readFileSync } from 'fs';

// Anchored to the version field's own detail line, not a substring match, so
// an unrelated future warning that merely QUOTES the advisory phrase cannot
// slip the gate (independent-review finding, 2026-07-31).
const KNOWN_ADVISORY = /^\s*[>❯]\s*(plugin\.json\s*(→|->)\s*)?version:\s*No version specified/;

export function judge(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.some(l => /Validation passed/.test(l))) {
    return { pass: false, reason: 'validation did not pass' };
  }
  // Warning lines are the indented "> path -> message" lines that follow the
  // "Found N warning" banner, plus any line that itself says "warning" outside
  // the banner and the pass line. Collect conservatively: every line mentioning
  // "warning" (banner included) and every "  > " detail line.
  // Detail-line marker differs by platform: ">" on Windows, "❯" on Linux.
  const details = lines.filter(l => /^\s*[>❯]\s+/.test(l));
  const banners = lines.filter(l => /warning/i.test(l) && !/Validation passed/.test(l));
  if (banners.length === 0 && details.length === 0) {
    return { pass: true, reason: 'clean pass, no warnings' };
  }
  const unexpected = details.filter(l => !KNOWN_ADVISORY.test(l));
  if (details.length === 0 && banners.length > 0) {
    // A banner with no parseable detail lines is unclassifiable: fail closed.
    return { pass: false, reason: 'warning banner present but no detail lines to classify; failing closed' };
  }
  if (unexpected.length > 0) {
    return { pass: false, reason: `unexpected warning(s) beyond the version advisory: ${unexpected.map(l => l.trim()).join(' | ')}` };
  }
  return { pass: true, reason: 'only the known version advisory present' };
}

const FIXTURES = [
  {
    name: 'clean pass',
    text: 'Validating plugin manifest: x\n\n√ Validation passed\n',
    expect: true,
  },
  {
    name: 'only the version advisory',
    text: 'Validating plugin manifest: x\n\n‼ Found 1 warning:\n\n  > plugin.json → version: No version specified. Consider adding a version following semver (e.g., "1.0.0")\n\n√ Validation passed with warnings\n',
    expect: true,
  },
  {
    name: 'advisory PLUS an unexpected warning (the backwards-boolean counterexample)',
    text: 'Validating plugin manifest: x\n\n‼ Found 2 warnings:\n\n  > plugin.json → version: No version specified. Consider adding a version following semver (e.g., "1.0.0")\n  > plugin.json → unknownField: Unrecognized field will be ignored\n\n√ Validation passed with warnings\n',
    expect: false,
  },
  {
    name: 'validation failed',
    text: 'Validating plugin manifest: x\n\n× Validation failed\n',
    expect: false,
  },
  {
    name: 'two unexpected warnings, no advisory',
    text: 'Validating plugin manifest: x\n\n‼ Found 2 warnings:\n\n  > plugin.json → a: Something odd\n  > plugin.json → b: Something else\n\n√ Validation passed with warnings\n',
    expect: false,
  },
  {
    name: 'banner with no classifiable detail lines fails closed',
    text: 'Validating plugin manifest: x\n\nwarning: something unstructured\n√ Validation passed with warnings\n',
    expect: false,
  },
  {
    name: 'Linux glyphs: ❯ detail marker with only the advisory',
    text: 'Validating plugin manifest: x\n\n⚠ Found 1 warning:\n\n  ❯ version: No version specified. Consider adding a version following semver (e.g., "1.0.0")\n\n✔ Validation passed with warnings\n',
    expect: true,
  },
  {
    name: 'Linux glyphs: advisory plus unexpected warning still fails',
    text: 'Validating plugin manifest: x\n\n⚠ Found 2 warnings:\n\n  ❯ version: No version specified. Consider adding a version following semver (e.g., "1.0.0")\n  ❯ unknownField: Unrecognized field will be ignored\n\n✔ Validation passed with warnings\n',
    expect: false,
  },
  {
    name: 'unrelated warning QUOTING the advisory phrase does not slip the gate',
    text: 'Validating plugin manifest: x\n\n‼ Found 1 warning:\n\n  > docs: description says "No version specified" which may confuse readers\n\n√ Validation passed with warnings\n',
    expect: false,
  },
];

function selfTest() {
  let bad = 0;
  for (const f of FIXTURES) {
    const r = judge(f.text);
    const ok = r.pass === f.expect;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${f.name}  (judged ${r.pass ? 'pass' : 'fail'}: ${r.reason})`);
    if (!ok) bad++;
  }
  console.log(bad ? `SELF-TEST FAIL: ${bad} fixture(s) misjudged` : 'SELF-TEST PASS: all fixtures judged correctly, including the must-fail cases');
  process.exit(bad ? 1 : 0);
}

const arg = process.argv[2];
if (arg === '--self-test') selfTest();
else {
  const text = arg ? readFileSync(arg, 'utf8') : readFileSync(0, 'utf8');
  const r = judge(text);
  console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.reason}`);
  process.exit(r.pass ? 0 : 1);
}
