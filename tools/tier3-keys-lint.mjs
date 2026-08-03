#!/usr/bin/env node
/**
 * Tier 3 key lint: expected-key quality as a GATE instead of a grader
 * complaint filed after the run.
 *
 *   node tools/tier3-keys-lint.mjs [--set v1|v2]   lint the scenario set
 *   node tools/tier3-keys-lint.mjs --defects       lint key-defects.jsonl schema
 *   node tools/tier3-keys-lint.mjs --self-test
 *
 * Why this exists. The 2026-08-02 four-arm run was graded against keys that
 * graders then filed 27 defect records about: 14 of 60 scenarios carried
 * `context_boundary` as the literal string "n/a" (every sheet scores 1.0, the
 * field carries zero signal), 6 keys asserted `version_caveat` is "none" while
 * ANOTHER FIELD OF THE SAME KEY conceded a version-gated fact, and ten keys
 * asked a different failure_mode question than every arm answered. None of
 * that needed a grader to find; all of it is mechanical. So now it is.
 *
 * ERROR exits 1; WARN reports without failing, because the warn rules are
 * heuristics (mechanism tagging) whose false positives would otherwise breed
 * an exemption list. The results doc records the v1 baseline as RED.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const GRADED = ['primary', 'rejected_alternative', 'enforcement_owner', 'context_boundary', 'lifecycle', 'failure_mode', 'version_caveat'];

/**
 * Placeholder values that make a graded field ungradeable. `none` is treated
 * differently for version_caveat only: there it is a substantive claim (no
 * gate exists) that a wrong sheet can contradict, so it stays gradeable, but
 * BARE none draws a WARN because grader record S031 showed its scope is
 * ambiguous ("none for which mechanism, as of which build?"); v2 keys phrase
 * it scoped, e.g. "none (no version gate on hooks as of 2.1.220)".
 */
const PLACEHOLDER = /^(n\/?a|tbd|todo|-|\?)$/i;
const PLACEHOLDER_WITH_NONE = /^(n\/?a|none|tbd|todo|-|\?)$/i;

/**
 * A version-gate mention: an explicit build number, experimental status, or an
 * enabling env flag. Used to catch "version_caveat: none" keys whose OWN other
 * fields concede such a fact (S037's failure_mode requires workspace trust on
 * v2.1.218+ while its version_caveat said none).
 */
const GATE_RE = /v?2\.\d+\.\d+|experimental|CLAUDE_CODE_[A-Z_]+/;

/**
 * Coarse mechanism tagger, the heuristic prototyped in the v1 analysis. Only
 * used for the WARN rule (rejected_alternative same class as primary), never
 * for an ERROR.
 */
export function mechanismTag(text) {
  const t = String(text).toLowerCase();
  const rules = [
    ['team', /agent team|teammate/],
    ['workflow', /dynamic workflow|workflow runtime|\bworkflow\b/],
    ['subagent', /sub-?agent|delegated worker/],
    ['hook', /\bhook\b/],
    ['skill', /\bskill\b/],
    ['mcp', /\bmcp\b|model context protocol/],
    ['plugin', /\bplugin\b|marketplace/],
    ['output-style', /output style/],
    ['claude-md', /claude\.md|\.claude\/rules|memory file/],
    ['settings', /managed settings|settings\.json|permission/],
    ['lsp', /\blsp\b|language server/],
    ['sdk', /agent sdk|\bsdk\b/],
    ['command', /slash command|\/[a-z-]+ command/],
  ];
  for (const [tag, re] of rules) if (re.test(t)) return tag;
  return 'other';
}

export function lintKeys(rows) {
  const errors = [];
  const warns = [];
  for (const r of rows) {
    for (const f of GRADED) {
      const v = String(r[f] ?? '').trim();
      const re = f === 'version_caveat' ? PLACEHOLDER : PLACEHOLDER_WITH_NONE;
      if (!v || re.test(v)) {
        errors.push(`${r.id}.${f}: ungradeable placeholder value ${JSON.stringify(v)}; every sheet scores identically and the field carries zero signal`);
      }
    }
    if (/^none$/i.test(String(r.version_caveat ?? '').trim())) {
      warns.push(`${r.id}.version_caveat: bare "none" has ambiguous scope (S031 class); phrase it scoped, e.g. "none (no version gate on <mechanism> as of <build>)"`);
    }
    const vc = String(r.version_caveat ?? '').trim();
    if (/^none\b/i.test(vc)) {
      const others = ['primary', 'rejected_alternative', 'rejection_reason', 'enforcement_owner', 'context_boundary', 'lifecycle', 'failure_mode']
        .map(f => String(r[f] ?? '')).join('  ');
      const hit = others.match(GATE_RE);
      if (hit) {
        errors.push(`${r.id}.version_caveat: says none while the SAME key mentions "${hit[0]}" elsewhere; the key contradicts itself`);
      }
    }
    if (r.primary && r.rejected_alternative) {
      const p = mechanismTag(r.primary), a = mechanismTag(r.rejected_alternative);
      if (p !== 'other' && p === a) {
        warns.push(`${r.id}.rejected_alternative: same mechanism class as primary (${p}); the field may discriminate nothing (S022 class; verify by eye)`);
      }
    }
    const lc = String(r.lifecycle ?? '');
    if (vc && !/^none\b/i.test(vc)) {
      const flag = vc.match(/CLAUDE_CODE_[A-Z_]+|v?2\.\d+\.\d+/);
      if (flag && lc.includes(flag[0])) {
        warns.push(`${r.id}: the fact "${flag[0]}" is keyed into BOTH lifecycle and version_caveat; a sheet stating it once gets scored down in the other field (S002 class)`);
      }
    }
  }
  return { errors, warns };
}

export function lintDefects(records) {
  const errors = [];
  records.forEach((d, i) => {
    for (const k of ['scenario', 'field', 'problem']) {
      if (typeof d[k] !== 'string' || !d[k].trim()) errors.push(`record ${i + 1}: missing or empty ${k}`);
    }
    if (d.scenario && !/^S\d{3}$/.test(d.scenario)) {
      errors.push(`record ${i + 1}: scenario ${JSON.stringify(d.scenario.slice(0, 50))} is not a single S0NN id; ranges and lists undercounted coverage by ten scenarios in the v1 writeup, split them`);
    }
    const extra = Object.keys(d).filter(k => !['scenario', 'field', 'problem', 'batch'].includes(k));
    if (extra.length) errors.push(`record ${i + 1}: unknown field(s) ${extra.join(', ')}`);
  });
  return errors;
}

function loadJsonl(p) {
  return readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

// ---------------------------------------------------------------- self-test --

function selfTest() {
  let bad = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) bad++; };

  const good = {
    id: 'S900', focus: 'x', scenario: 's',
    primary: 'A PreToolUse hook that rejects the edit', rejected_alternative: 'A skill instructing the model',
    rejection_reason: 'the model can decline guidance', enforcement_owner: 'harness',
    context_boundary: 'main conversation context', lifecycle: 'fires on every matching tool call',
    failure_mode: 'a missing handler fails open', version_caveat: 'none',
  };
  check('a sound key passes', lintKeys([good]).errors.length === 0, lintKeys([good]).errors[0] || '');

  check('n/a context_boundary is an ERROR',
    lintKeys([{ ...good, context_boundary: 'n/a' }]).errors.some(e => /ungradeable/.test(e)));
  check('empty graded field is an ERROR',
    lintKeys([{ ...good, lifecycle: '' }]).errors.some(e => /ungradeable/.test(e)));
  check('version_caveat none beside a conceded gate is an ERROR (S037 class)',
    lintKeys([{ ...good, failure_mode: 'requires workspace trust on v2.1.218+ or hooks are skipped' }]).errors.some(e => /contradicts itself/.test(e)));
  check('version_caveat none beside an env flag is an ERROR',
    lintKeys([{ ...good, lifecycle: 'requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 at start' }]).errors.some(e => /contradicts itself/.test(e)));
  check('a real version_caveat with the same fact elsewhere is only a WARN (S002 class)',
    (() => { const r = lintKeys([{ ...good, version_caveat: 'requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1', lifecycle: 'spawn after CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set' }]); return r.errors.length === 0 && r.warns.some(w => /BOTH lifecycle and version_caveat/.test(w)); })());
  check('same-mechanism alternative is a WARN, not an ERROR (S022 class)',
    (() => { const r = lintKeys([{ ...good, primary: 'An LSP plugin from the marketplace', rejected_alternative: 'a hand-rolled LSP plugin' }]); return r.errors.length === 0 && r.warns.some(w => /same mechanism class/.test(w)); })());
  check('mechanismTag distinguishes hook from skill',
    mechanismTag('A PreToolUse hook') === 'hook' && mechanismTag('A skill with guidance') === 'skill');

  check('defect record with a range id is an ERROR',
    lintDefects([{ scenario: 'all ten (S041 through S050)', field: 'failure_mode', problem: 'x' }]).some(e => /not a single S0NN/.test(e)));
  check('sound defect record passes', lintDefects([{ scenario: 'S041', field: 'failure_mode', problem: 'x', batch: 5 }]).length === 0);

  // The v1 set must be RED under this lint: that is the recorded baseline and
  // the proof this gate would have caught the instrument's defects before the
  // run instead of after. If v1 ever lints green, either the lint was gutted
  // or someone edited frozen history; both are failures.
  const v1 = loadJsonl(join(ROOT, 'tests', 'architecture-scenarios.jsonl'));
  const r1 = lintKeys(v1);
  // 15 on the current frozen set: 14 n/a context_boundary fields plus the
  // S037-class self-contradiction that survives the tighter gate regex. The
  // floor is 10 so the assertion states "red and substantial" without
  // memorizing the exact figure.
  check('the frozen v1 set is RED under this lint (baseline)', r1.errors.length >= 10, `${r1.errors.length} error(s)`);

  console.log(bad ? `SELF-TEST FAIL: ${bad} check(s) failed` : 'SELF-TEST PASS: every defect class detected, sound keys pass, v1 baseline red.');
  process.exit(bad ? 1 : 0);
}

// --------------------------------------------------------------------- main --

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) main();

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();

  if (argv.includes('--defects')) {
    const p = join(ROOT, 'tests', 'tier3', 'key-defects.jsonl');
    const errs = lintDefects(loadJsonl(p));
    for (const e of errs) console.log(`ERROR  ${e}`);
    console.log(errs.length ? `${errs.length} schema error(s)` : 'PASS: key-defects.jsonl schema clean');
    process.exit(errs.length ? 1 : 0);
  }

  const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'v1';
  const file = set === 'v2' ? 'architecture-scenarios-v2.jsonl' : 'architecture-scenarios.jsonl';
  const p = join(ROOT, 'tests', file);
  if (!existsSync(p)) { console.log(`FAIL: ${file} does not exist`); process.exit(1); }
  const { errors, warns } = lintKeys(loadJsonl(p));
  for (const e of errors) console.log(`ERROR  ${e}`);
  for (const w of warns) console.log(`WARN   ${w}`);
  console.log(`${file}: ${errors.length} error(s), ${warns.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
