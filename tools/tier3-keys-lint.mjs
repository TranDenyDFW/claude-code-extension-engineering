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
const MECHANISM_RULES = [
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

export function mechanismTag(text) {
  const t = String(text).toLowerCase();
  for (const [tag, re] of MECHANISM_RULES) if (re.test(t)) return tag;
  return 'other';
}

/**
 * EVERY mechanism a field names, not just the first. Single-tag matching is too
 * lossy for the primary-conceded rule below: S040's primary tags as `subagent`
 * under first-match but also carries `claude-md`, and its failure_mode names both
 * `hook` and `settings`. Comparing first-matches alone would miss the concession.
 */
export function mechanismTags(text) {
  const t = String(text).toLowerCase();
  return new Set(MECHANISM_RULES.filter(([, re]) => re.test(t)).map(([tag]) => tag));
}

/** Mechanisms the harness enforces regardless of what any agent decides. */
export const HARNESS_OWNED = new Set(['hook', 'settings']);

/**
 * The key CONCEDING, in its own enforcement_owner, that its primary is not enforced.
 * The lookahead keeps "model context protocol" from reading as "model owned".
 */
const MODEL_OWNED_RE = /\bmodel[- ]owned\b|\badvisory\b|^\s*model(?!\s+context\s+protocol)\b/i;

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
    /**
     * primary-conceded (S040 class). The key argues for a better primary than the
     * one it selects: its own failure_mode or rejection_reason names a HARNESS-owned
     * mechanism the primary does not, while its own enforcement_owner admits the
     * primary is model-owned or advisory.
     *
     * S040 is the witness. Its primary is "restate the rule in the delegation
     * prompt"; its failure_mode says "a hard guarantee needs a different mechanism
     * entirely, such as a permissions deny rule, a PreToolUse hook, or denying
     * Agent(Explore)". Every arm answered with one of those three and every arm
     * scored 0.00 on primary, both graders, because the key rewarded diagnosis of
     * the docs' prescription over satisfaction of the user's stated requirement.
     *
     * WARN, not ERROR, for three reasons and the third decides it: this is mechanism
     * tagging, which this file's header reserves for WARN; open-work item B2
     * prescribed WARN before the data existed; and an ERROR here would move the
     * FROZEN v1 set from 15 errors to 16, rewriting published history to make a new
     * rule look good. Promote to ERROR only after two further scenario sets lint
     * with zero human-judged false positives.
     */
    if (r.primary && r.enforcement_owner) {
      const owner = String(r.enforcement_owner);
      if (MODEL_OWNED_RE.test(owner)) {
        const inPrimary = mechanismTags(r.primary);
        const conceded = mechanismTags(`${r.failure_mode ?? ''}  ${r.rejection_reason ?? ''}`);
        const inRejected = mechanismTags(r.rejected_alternative ?? '');
        const better = [...conceded].filter(m =>
          HARNESS_OWNED.has(m) && !inPrimary.has(m) && !inRejected.has(m));
        if (better.length && ![...inPrimary].some(m => HARNESS_OWNED.has(m))) {
          warns.push(`${r.id}.primary: the key's own failure_mode/rejection_reason names a harness-owned mechanism (${better.join(', ')}) that the primary does not, while enforcement_owner calls the primary model-owned or advisory; the key argues for a better primary than the one it selects, so an answer that satisfies the scenario's stated requirement scores zero (S040 class; verify by eye)`);
        }
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

  // ---- primary-conceded (S040 class) ----------------------------------------
  // The refactor to a shared rules table must not change first-match behaviour.
  check('mechanismTags returns ALL matches while mechanismTag keeps first-match',
    (() => {
      const s = 'A PreToolUse hook wired in settings.json';
      const many = mechanismTags(s);
      return many.has('hook') && many.has('settings') && mechanismTag(s) === 'hook';
    })());

  const conceded = w => w.some(x => /argues for a better primary/.test(x));

  // KNOWN-BAD: must fire. This is S040's exact shape.
  check('MUST FIRE: advisory primary whose failure_mode names a deny rule and a hook',
    (() => {
      const r = lintKeys([{ ...good,
        primary: 'Restate the rule in the delegation prompt each time exploration is handed off, since sub-agents skip CLAUDE.md by design',
        enforcement_owner: 'split: the harness owns delegation, but the rule itself is model-owned and purely advisory',
        failure_mode: 'purely advisory; a hard guarantee needs a different mechanism entirely, such as a permissions deny rule in settings.json or a PreToolUse hook',
        rejected_alternative: 'moving the rule higher in the CLAUDE.md hierarchy',
        rejection_reason: 'the hierarchy does not reach a delegated worker either' }]);
      return r.errors.length === 0 && conceded(r.warns);
    })());

  check('MUST FIRE: the same concession made in rejection_reason instead of failure_mode',
    conceded(lintKeys([{ ...good,
      primary: 'A skill that reminds the model to check the manifest',
      enforcement_owner: 'model-owned',
      failure_mode: 'the model can simply not check it',
      rejected_alternative: 'documenting it in the README',
      rejection_reason: 'nobody reads it; only a PreToolUse hook actually stops the call' }]).warns));

  // KNOWN-GOOD: each isolates one suppression clause and must stay SILENT.
  check('stays silent: the sound key gains no new warning', !conceded(lintKeys([good]).warns));

  check('stays silent (clause 3): advisory primary, advisory owner, but NO harness mechanism conceded',
    !conceded(lintKeys([{ ...good,
      primary: 'A skill that instructs the model to check the manifest',
      enforcement_owner: 'model-owned, advisory',
      failure_mode: 'the model can decline the guidance and nothing detects it' }]).warns));

  check('stays silent (clause 4): the hook was CONSIDERED and rejected, which is correct behaviour',
    !conceded(lintKeys([{ ...good,
      primary: 'A skill that routes the decision',
      enforcement_owner: 'model-owned',
      rejected_alternative: 'A PreToolUse hook on Edit',
      rejection_reason: 'the hook fires per tool call and cannot see intent',
      failure_mode: 'a hook would be stricter but cannot read intent' }]).warns));

  check('stays silent (clause 2): the primary IS the harness mechanism',
    !conceded(lintKeys([{ ...good,
      primary: 'A permissions deny rule in settings.json',
      enforcement_owner: 'harness',
      failure_mode: 'a PreToolUse hook is still needed for shell reads' }]).warns));

  check('stays silent: "model context protocol" does not read as "model owned"',
    !conceded(lintKeys([{ ...good,
      primary: 'An MCP server exposing the query tool',
      enforcement_owner: 'the model context protocol server owns the contract',
      failure_mode: 'a PreToolUse hook would be needed to gate it' }]).warns));

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

  /**
   * LIVE-CORPUS WITNESS, and the row that keeps primary-conceded honest.
   *
   * Once S040 is repaired in v2, the rule fires on ZERO rows of the live set, and
   * a rule that never fires on real data is indistinguishable from one that does
   * not work. v1 is frozen and its S040 is untouchable, so it is a permanent
   * real-data witness: gut the rule and this row goes red.
   */
  check('the frozen v1 set still carries the S040-class self-contradiction (real-data witness)',
    conceded(r1.warns), `${r1.warns.filter(w => /argues for a better primary/.test(w)).length} hit(s)`);

  // The rule must be SELECTIVE, not a blanket fire on every advisory key. If this
  // count climbs, the conjunction has loosened and the warns will breed an
  // exemption list, which is exactly what the file's header forbids.
  const conc1 = r1.warns.filter(w => /argues for a better primary/.test(w)).length;
  check('primary-conceded is selective on the 60-key frozen set', conc1 >= 1 && conc1 <= 3, `${conc1} of 60`);

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
