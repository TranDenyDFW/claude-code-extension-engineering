#!/usr/bin/env node
/**
 * extension-scaffold: turn a requirement into an extension bundle THAT CARRIES
 * ITS OWN FALSIFIABLE ACCEPTANCE TEST.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a general generator. Anthropic's `create-plugin` already scaffolds skills,
 * agents, hooks, MCP and settings, and it is on this machine. Rebuilding that is
 * duplication. This composes with it rather than competing.
 *
 * Not a natural-language miracle. It handles ONE documented requirement family,
 * path protection ("prevent changes to X"), because that is the family the
 * full-population GitHub study found users get wrong most often. For anything
 * else it says so and refuses, rather than emitting a confident wrong answer.
 *
 * WHAT IT ADDS THAT NOTHING ELSE DOES
 * -----------------------------------
 * The deliverable is not the extension. It is the extension PLUS a
 * conformance.json that `extension-prove` can fail. No project in the surveyed
 * corpus ships an expected-outcome spec beside the artifact.
 *
 * THE SELECTION RULE, and why it is not a style preference
 * -------------------------------------------------------
 * Measured 2026-08-03 across the then-complete 81,002 anthropics/claude-code
 * issues. The corpus has since been re-harvested to 81,291 (data/gh/corpus-stats.json,
 * 2026-08-06); the ANALYSIS was not re-run, so the population it speaks for is the
 * smaller one and the number is left as measured rather than silently refreshed to
 * match a corpus the finding never saw. The dominant confusion is
 * users writing advisory prose and expecting a hard guarantee (#17908, #56383,
 * #80211, #16011), and in every one of those the permissions deny rule went
 * unconsidered. So:
 *
 *   ANY guarantee language -> permissions deny rule.
 *   no guarantee language  -> advisory (CLAUDE.md) is legitimate.
 *
 * That first branch used to be two, with a bare guarantee selecting a PreToolUse
 * hook and only an explicit fail-closed clause reaching the deny rule. Reversed
 * 2026-08-05 after measurement, not preference: a hook matcher of `Write|Edit`
 * cannot match a Bash tool call, so the hook bundle did not stop
 * `cp infra/main.tf infra/main.tf.bak` in a live session while the deny rule it
 * named as REJECTED did. The tool was recommending the weaker mechanism, and
 * requiring the user to name the tool's own failure mode before it offered the
 * stronger one.
 *
 * A deny rule for a file path MUST be written Edit(...), never Write(...):
 * "Claude Code checks file permissions against Edit(path) and Read(path) rules
 * only ... accepts the rule but never consults it" otherwise.
 *
 * WHAT THE BUNDLE DOES NOT CLAIM
 * ------------------------------
 * A deny rule reaches the built-in file tools and the Bash file commands Claude
 * Code recognises. It does NOT reach an arbitrary subprocess that opens the file
 * itself. Every enforcing bundle therefore carries a `residual` case naming that
 * vector and asserting it is NOT covered, so the disclosure is falsifiable
 * rather than prose: it reddens if the product closes the gap, and it reddens if
 * someone widens the bundle. A warning line cannot do either.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ analysis
/**
 * THE PACKS. Everything path-protection specific moved into protect-path when the
 * creator became pack-based; this file kept the parts that were never about paths:
 * the CLI, bundle writing, the prove-and-report loop, the frozen-probe gate and
 * the injection harness. Re-exported so tools/scaffold-parity.mjs and any external
 * caller keep resolving the same names.
 */
import * as protectPath from './packs/protect-path.mjs';
import * as vba from './packs/validate-before-action.mjs';
import { PACKS, listPacks, packById, route, PackRefusal } from './packs/index.mjs';
import { loadPolicy } from './packs/policy-schema.mjs';
import { proveBundle, report, failureKind } from './extension-prove.mjs';

export const {
  GUARANTEE, FAIL_CLOSED, PROTECT, ABSOLUTE,
  extractTarget, toGlob, casePathsFor, analyse, conformanceFor, sandboxProposal, buildBundle,
  extractTargetLegacy, toGlobLegacy,
  GATE_PROBES,
} = protectPath;

export function writeBundle(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(dir, rel);
    // A bundle can now ship a nested path (.claude/hooks/validate.mjs). Without
    // this the write was an ENOENT the moment a pack emitted anything but a flat
    // file list.
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
}

export function emit(dir, name, requirement, a) {
  const { files, conf } = buildBundle(name, requirement, a);
  writeBundle(dir, files);
  return conf;
}

// ------------------------------------------------------------------- verify

/**
 * THE FINAL VERDICT, AS DATA, because three rounds of review have now caught a
 * falsehood in this one decision and none of the first two fixes were reachable by
 * a test.
 *
 * `reportCode` returns 1 both when a case FAILED and when every case passed but a
 * strict spec's residual survived. Reading only the exit code summarised a bundle
 * that satisfied its spec exactly as "does not satisfy its own conformance spec".
 * Fix one substring-matched the prover's stdout, which printed that sentence
 * whenever a residual survived, failing cases or not. Fix two stopped the prover
 * printing it in the wrong case and left the caller still parsing text.
 *
 * Fix three called `failureKind` on the result object, which was right and STILL
 * untestable: it sat inside `scaffold()`, whose only caller is the CLI main block,
 * so flipping the branch to `false` restored the original falsehood with all
 * fifteen gates green. Independent review 2026-08-08 proved exactly that.
 *
 * So the decision is a pure function returning lines and an exit code, the printing
 * is the caller's job, and the self-test asserts the sentences.
 */
export function finalVerdict(res) {
  const kind = failureKind(res);
  if (kind === 'strict') {
    return {
      code: 1,
      lines: [
        'NOT DONE: the bundle satisfies its own conformance spec, and the spec is STRICT because the',
        'requirement is absolute. A residual vector is confirmed open, so the claim is refused rather',
        'than the work. The bundle is written and is the strongest configuration available here.',
      ],
    };
  }
  if (kind) return { code: 1, lines: ['NOT DONE: the generated bundle does not satisfy its own conformance spec.'] };
  return { code: 0, lines: ['DONE: the generated bundle satisfies its own conformance spec.'] };
}

/**
 * Generate, write and PROVE, for whichever pack the router selected. The
 * per-pack analysis lines are printed from what the pack reports rather than from
 * fields this file knows about: the previous version printed `guarantee`,
 * `failClosed` and `target`, which only one pack has.
 */
function scaffold(pack, input, outDir, name) {
  console.log('extension-scaffold');
  console.log(`  pack        : ${pack.id}`);
  if (input.requirement) console.log(`  requirement : ${input.requirement}`);
  if (input.policyPath) console.log(`  policy      : ${input.policyPath}`);
  console.log('');

  let a;
  try {
    a = pack.analyse(pack.id === 'protect-path' ? input.requirement : input);
  } catch (e) {
    console.log(`REFUSED: ${e.message}`);
    for (const d of (e.detail || [])) console.log(`  ${d}`);
    console.log('');
    console.log('Nothing was generated. An incomplete or self-contradictory input is refused');
    console.log('rather than guessed at, because a generated validator is TRUSTED.');
    return e.exitCode || 2;
  }
  if (!a.supported) {
    console.log(`UNSUPPORTED: ${a.reason}`);
    console.log('');
    console.log(`Pack "${pack.id}" refuses rather than emitting a confident wrong answer. Use`);
    console.log('`create-plugin` from plugin-dev to scaffold, then hand the result to');
    console.log('`extension-prove` with a conformance.json you write.');
    return 2;
  }
  for (const [k, v] of [
    ['guarantee language', a.guarantee === undefined ? null : (a.guarantee ? 'YES' : 'no')],
    ['fail-closed clause', a.failClosed === undefined ? null : (a.failClosed ? 'YES' : 'no')],
    ['target', a.target ? `${a.target}  ->  ${a.glob}` : null],
    ['families', a.families ? a.families.join(', ') : null],
    ['rules', a.policy && a.policy.rules ? String(a.policy.rules.length) : null],
    ['mechanism', a.mechanism],
    ['strict', a.strict === undefined ? null : (a.strict ? 'YES, an absolute requirement' : 'no')],
    ['rejected', a.rejected || null],
  ]) if (v !== null && v !== undefined) console.log(`  ${k.padEnd(18)} : ${v}`);
  for (const n of (a.notes || [])) console.log(`  note               : ${n}`);
  console.log('');

  const { files, conf } = pack.buildBundle(name, pack.id === 'protect-path' ? input.requirement : input, a);
  writeBundle(outDir, files);
  console.log(`wrote ${outDir}`);
  console.log(`  ${Object.keys(files).sort().join(', ')}  (${conf.cases.length} cases)`);
  console.log('');

  const res = proveBundle(outDir);
  report(res, false);
  console.log('');
  const verdict = finalVerdict(res);
  for (const l of verdict.lines) console.log(l);
  return verdict.code;
}

// ------------------------------------------------------------ end-to-end gate
/**
 * THE GATE THAT WAS MISSING, AND WHY EVERY DEFECT BELOW SURVIVED.
 *
 * CI ran only `--self-test`, which exercises `analyse` and `conformanceFor` as
 * functions and never once GENERATES a bundle and PROVES it. So four defects
 * shipped simultaneously, and all four were invisible to a green build:
 *
 *   A  hook bundles failed their own spec from commit 63a3ecc, when the prover
 *      began feeding absolute paths and the six prove-bench fixtures were
 *      updated but the generator was not
 *   B  a sentence-final period was swallowed into the target, so `infra/.`
 *      became the glob `infra/./**`, which matches nothing
 *   C  permission-deny shipped the very hook its README named as rejected
 *   D  advisory bundles emitted enforce cases against an empty settings.json
 *
 * This gate asserts a FROZEN case-id-to-verdict map and a FROZEN file list per
 * probe. Not "all green": an advisory bundle must NOT be green on an enforce
 * case, and a residual case is green precisely by expecting `allow`. A pass
 * count would have missed defect D entirely.
 */
async function runGate({ quiet = false } = {}) {
  // proveBundle is already imported statically at the top of this file; binding it
  // a second time here was harmless and misleading. Only proveFailSurvivors needs
  // the dynamic import, which exists to keep the module graph acyclic at load time.
  const { proveFailSurvivors } = await import('./extension-prove.mjs');
  let bad = 0;
  for (const pack of PACKS.values()) {
    const seam = SEAM.packs.get(pack.id) || pack;
    if (!quiet) console.log(`${pack.id}:`);
    for (const p of pack.GATE_PROBES) {
      const fail = (msg) => { bad++; if (!quiet) console.log(`  FAIL ${p.id} ${msg}`); };
      const input = pack.gateInput(p);

      /**
       * An UNSUPPORTED probe. A pack that stops refusing what it cannot handle is
       * as broken as one that stops generating, and this is the only frozen
       * expectation that asserts a refusal.
       */
      if (p.expectUnsupported) {
        let a = null;
        try { a = seam.analyse(input); } catch { a = { supported: false }; }
        if (a.supported !== false) fail(`expected UNSUPPORTED, got ${a.mechanism}`);
        else if (!quiet) console.log(`  ok   ${p.id} UNSUPPORTED, as frozen`);
        continue;
      }

      let a;
      try { a = seam.analyse(input); } catch (e) { fail(`analyse refused: ${e.message}`); continue; }
      if (!a.supported) { fail(`expected a bundle, got UNSUPPORTED: ${a.reason}`); continue; }

      const { files, conf } = seam.buildBundle(p.id, input, a);

      /**
       * EVERY CHECK RUNS ON EVERY PROBE. This used to `continue` on the first
       * problem, and the ordering made the strongest check in the function
       * UNREACHABLE: the frozen kind-map comparison sat in front of the hollowness
       * detector, so retagging a case reddened the gate through the kind map and
       * the detector was never evaluated. Independent review 2026-08-07 proved it
       * by doing exactly that and observing no survivor line.
       *
       * A gate whose later checks only run when its earlier ones pass reports the
       * cheapest failure and hides the expensive one. Problems accumulate now, and
       * the only hard bail left is a bundle too broken to prove at all.
       */
      const problems = [];
      if (!!conf.strict !== !!p.strict) problems.push(`strict=${!!conf.strict}, frozen ${!!p.strict}`);
      const list = Object.keys(files).sort().join(',');
      const expectFiles = pack.filesFor(p).slice().sort().join(',');
      if (list !== expectFiles) problems.push(`file list ${list}, frozen ${expectFiles}`);
      const kinds = conf.cases.map((c) => c.kind).join(',');
      if (kinds !== p.kinds) problems.push(`kinds ${kinds}, frozen ${p.kinds}`);
      // Assertions only the pack can make: the mechanism it selected, the deny
      // rule it emitted, the wiring and preamble of files it alone ships.
      problems.push(...pack.checkProbe(p, files, conf, a));

      const wantResiduals = p.strict ? (p.strictResiduals ?? 1) : 0;
      const tmp = mkdtempSync(join(tmpdir(), `scaffold-gate-${p.id}-`));
      try {
        writeBundle(tmp, files);
        // A missing settings.json makes proveBundle throw; that is the one state
        // where nothing further can be measured.
        if (!existsSync(join(tmp, 'settings.json'))) { fail([...problems, 'the bundle has no settings.json, so nothing can be proved'].join('; ')); continue; }
        const res = proveBundle(tmp);
        const red = res.cases.filter((c) => !c.ok);
        if (red.length) problems.push(`${red.length} case(s) red: ${red.map((c) => `${c.id}:${c.why && c.why[0]}`).join(' | ')}`);
        /**
         * A strict probe must report NOT DONE with every case green. That pairing
         * is the whole design: the cases are correct AND the requirement is not
         * met, and a gate that only counted red cases would call it a success.
         */
        const nr = (res.strictResidual || []).length;
        if (nr !== wantResiduals) problems.push(`${p.strict ? 'strict' : 'non-strict'} spec reported ${nr} surviving residual(s), frozen ${wantResiduals}`);

        /**
         * THE HOLLOWNESS DETECTOR, RUN AGAINST WHAT WE GENERATE.
         *
         * `--prove-fail` existed and only ever ran against the hand-written
         * prove-bench fixtures, so the contract it enforces was never applied to
         * the generator. Independent review found 27 survivors across three case
         * shapes on six generated bundles: assertions labelled `wiring` or
         * `fail-posture` whose PASS did not depend on the generated extension at
         * all, counted in the headline and in this gate's own "all green".
         *
         * `claimsEnforcement` READS THE FROZEN MAP, `p.kinds`, NEVER the generated
         * `kinds`, and the two operands being independent is the entire point.
         *
         * I broke this while tidying the comment: switching that one word to
         * `kinds` made both sides of `claimsEnforcement && hollow.checked === 0`
         * derive from the same generated case list, so the guard could no longer
         * fire. Independent review 2026-08-08 proved it with a counterfactual:
         * retagging every enforce case in the pack yields ZERO "detector ran
         * nothing" complaints on the self-referential version and SIX on this one.
         * It is the self-reference the previous round had just named, reintroduced
         * one line over.
         *
         * The guard is not about the probe, which the kind-map comparison already
         * pins. It guards the DETECTOR: if `proveFailSurvivors` ever returned
         * nothing, the survivors check below would pass vacuously on every probe
         * forever, and only an independent reference can notice that.
         */
        const hollow = proveFailSurvivors([tmp]);
        const claimsEnforcement = /\b(enforce|wiring|fail-posture)\b/.test(p.kinds);
        if (claimsEnforcement && hollow.checked === 0) problems.push('cases claim enforcement but the detector ran nothing, so the survivor check below asserts nothing');
        if (!claimsEnforcement && hollow.checked !== 0) problems.push(`an advisory spec produced ${hollow.checked} enforcing case-run(s); asserting enforcement from prose is exactly defect D`);
        if (hollow.survivors.length) problems.push(`${hollow.survivors.length} case(s) still PASS with nothing installed: ${hollow.survivors.map((s) => s.split(' :: ')[1]).join(' | ')}`);

        if (problems.length) { fail(problems.join('; ')); continue; }
        if (!quiet) console.log(`  ok   ${p.id} ${String(a.mechanism).padEnd(15)} ${conf.cases.length} cases, all green, frozen kinds match${p.strict ? `, NOT DONE on ${wantResiduals} residual(s) as frozen` : ''}`);
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    }
  }
  if (!quiet) console.log(bad === 0 ? '\nGATE PASS: every frozen probe generated and proved as recorded.' : `\nGATE FAIL: ${bad} probe(s) diverged.`);
  return bad;
}

/**
 * THE SEAM THE INJECTIONS CORRUPT.
 *
 * `runGate` calls these through the object rather than directly, so an injection
 * can put a SHIPPED DEFECT back and re-run the whole gate against it. That is the
 * difference between an injection and an assertion, and independent review found
 * that two of the four "injections" here were the latter: they restated the fixed
 * behaviour (`extractTarget(...) === 'infra/'`, `!('guard.mjs' in files)`) and
 * never ran the gate at all. A row like that passes whether or not the gate would
 * have caught anything, which is the defect class this file exists to name.
 *
 * The object that WOULD have made injection 1 real, `GATE_INJECTIONS`, existed
 * and was referenced nowhere. Dead code standing in for a check is worse than a
 * missing check, because it reads as coverage.
 */
const SEAM = { packs: new Map() };

/**
 * Install a defective override for ONE pack, run the whole gate against it, and
 * restore. Keyed by pack id so an injection into one pack cannot quietly change
 * the other's probes, which would make the row pass for the wrong reason.
 */
async function withDefect(packId, overrides, fn) {
  const pack = packById(packId);
  SEAM.packs.set(packId, { analyse: pack.analyse, buildBundle: pack.buildBundle, ...overrides });
  // AWAITED, not returned. `return fn()` would delete the override in the finally
  // block before the async gate run reached it, so every injection would have run
  // against a clean generator and passed only if the gate was already red.
  try { return await fn(); } finally { SEAM.packs.delete(packId); }
}

/**
 * The pre-fix extractor, kept verbatim so injection 1 restores the real defect
 * rather than a simulation of it. The final segment was `[\w.*-]*`, greedy over
 * `.`, so a sentence-terminating period was swallowed into the target and
 * `toGlob` turned "infra/." into "infra/./**", which matches nothing.
 */
/** The handler the scaffold used to emit. Injection 2 puts it back. */
const LEGACY_HANDLER = '#!/usr/bin/env node\n'
  + "import { readFileSync } from 'node:fs';\n"
  + "const i = JSON.parse(readFileSync(0, 'utf8'));\n"
  + "const p = String((i.tool_input || {}).file_path || '');\n"
  + "if (p.startsWith('infra/')) { console.error('denied'); process.exit(2); }\n";

async function proveGateCanFail() {
  let bad = 0;
  const check = (n, ok, d = '') => { if (ok) console.log(`  ok   ${n}`); else { bad++; console.log(`  FAIL ${n}${d ? ` (${d})` : ''}`); } };

  /**
   * THE BASELINE MUST BE GREEN FIRST, and this was missing.
   *
   * Found by independent review 2026-08-05: this ran to completion and printed
   * GATE IS NOT HOLLOW with exit 0 during a window when the real gate was RED
   * for an unrelated reason. That is the exact defect class this whole file
   * exists to name. "This injection reddens the gate" asserts nothing when the
   * gate is already red: every injection trivially agrees, and the strongest
   * check in the tool becomes a check that cannot fail.
   *
   * CI happened not to expose it, because --gate runs first under
   * `set -euo pipefail`. Relying on step ordering to make a hollow check look
   * sound is not a defence, it is the reason nobody would have noticed.
   */
  const baseline = await runGate({ quiet: true });
  if (baseline !== 0) {
    console.log(`  FAIL BASELINE: --gate is already RED (${baseline} probe(s) diverged), so no injection can be shown to redden it.`);
    console.log('');
    console.log('This is REFUSED rather than reported. An injection test against an already-failing');
    console.log('baseline passes vacuously: every injection "reddens" a gate that was never green.');
    console.log('Fix --gate first, then re-run this.');
    console.log('\nCANNOT PROVE THE GATE: baseline not green.');
    return 1;
  }
  console.log('  ok   BASELINE: --gate is green, so an injection reddening it means something');

  /**
   * Every injection below follows the same three steps: put a shipped defect
   * back, RE-RUN THE WHOLE GATE, and require it to go red, then restore and
   * require it green again. The restore assertion matters as much as the first:
   * an injection that leaves the tool broken would make every later row pass for
   * the wrong reason.
   */
  const inject = async (name, packId, overrides) => {
    let red = 0;
    await withDefect(packId, overrides, async () => { red = await runGate({ quiet: true }); });
    const back = await runGate({ quiet: true });
    check(`MUST FAIL: ${name}`, red > 0, `gate stayed green with the defect restored`);
    check(`...and the gate returns to green once it is undone`, back === 0, `${back} probe(s) still red`);
  };

  // Injection 1: the pre-fix extractor, which swallowed a sentence-final period
  // and produced the glob infra/./**, matching nothing.
  await inject('protect-path: the pre-fix extractor produces a target the deny rule cannot match', 'protect-path',
    { analyse: (r) => { const a = analyse(r); return a.supported ? { ...a, glob: toGlobLegacy(extractTargetLegacy(r) || '') } : a; } });

  // Injection 2: the permission-deny bundle shipping the hook its own README
  // names as the rejected alternative. Defect C, restored for real.
  await inject('protect-path: the bundle ships the rejected alternative alongside the deny rule', 'protect-path',
    { buildBundle: (n, r, a) => { const b = buildBundle(n, r, a); return { ...b, files: { ...b.files, 'guard.mjs': LEGACY_HANDLER } }; } });
  // Injection 3: an ADVISORY requirement emitting an ENFORCING spec, which is
  // defect D exactly. Routed through the seam like the others, so the assertion
  // is "the GATE catches it" rather than "proveBundle catches it": the second is
  // true even of a tool nobody wired into CI, and the first is the property that
  // actually protects anyone.
  await inject('protect-path: an advisory requirement emits an enforcing spec', 'protect-path',
    { analyse: (r) => { const a = analyse(r); return a.supported && a.mechanism === 'advisory' ? { ...a, mechanism: 'permission-deny' } : a; } });

  /**
   * INJECTIONS 5 TO 10, validate-before-action. Every one of them is a defect a
   * reasonable person could ship: a matcher naming the wrong tool, a decision
   * flipped, a near-miss over-blocked, a check result ignored, an invalid policy
   * waved through, a crash modelled as success. Each corrupts the generator and
   * RE-RUNS THE WHOLE GATE; none of them asserts anything about the corrupted
   * function directly, because that would restate the defect rather than prove the
   * gate catches it.
   */
  const V = vba;
  const overrideAnalyse = (f) => ({ analyse: (i) => f(V.analyse(i)) });

  await inject('validate-before-action: the hook matcher names a tool the policy is not about', 'validate-before-action',
    { buildBundle: (n, i, a) => {
      const b = V.buildBundle(n, i, a);
      const s = JSON.parse(b.files['settings.json']);
      s.hooks.PreToolUse[0].matcher = 'Write';
      return { ...b, files: { ...b.files, 'settings.json': JSON.stringify(s, null, 2) + '\n' } };
    } });

  await inject('validate-before-action: a deny decision is flipped to allow', 'validate-before-action',
    overrideAnalyse((a) => (a.supported
      ? { ...a, policy: { ...a.policy, rules: a.policy.rules.map((r) => (r.decision === 'deny' ? { ...r, decision: 'allow' } : r)) } }
      : a)));

  await inject('validate-before-action: a safe near-miss is blocked by an over-wide pattern', 'validate-before-action',
    overrideAnalyse((a) => {
      if (!a.supported) return a;
      const widen = (cm) => ({ exec: cm.exec, argsPattern: '^.*$' });
      return { ...a, policy: { ...a.policy, rules: a.policy.rules.map((r) => ({ ...r, when: { ...r.when, commandMatches: widen(r.when.commandMatches) } })) } };
    }));

  await inject('validate-before-action: a required-check result is ignored', 'validate-before-action',
    overrideAnalyse((a) => {
      if (!a.supported) return a;
      // Downgrade every gate rule to a plain match rule, which is exactly what
      // "run the check and then do not look at its exit code" produces.
      return { ...a, policy: { ...a.policy, rules: a.policy.rules.map((r) => (
        r.family === 'required-check' || r.family === 'deployment-gate'
          ? { ...r, family: 'dangerous-operation', when: { commandMatches: r.when.commandMatches } }
          : r)) } };
    }));

  /**
   * THIS INJECTION USED TO TEST THE WRONG SEAM. It called the REAL `V.analyse`,
   * which runs `validatePolicy`, and only then flipped decisions to allow, making
   * it a near-duplicate of the injection above and leaving `policy-schema`'s
   * refusal guarded by nothing. Independent review 2026-08-07: stubbing
   * `validatePolicy` to always return ok would not have reddened it.
   *
   * It now BYPASSES validation entirely, which is the actual defect, and feeds
   * through a policy the validator refuses: an UNANCHORED `argsPattern`. Unanchored
   * means substring, so `^run test` matches `run test; rm -rf /`, and the probe's
   * own near-miss example starts matching. The gate must catch that.
   */
  await inject('validate-before-action: policy validation is skipped, so an unanchored pattern ships', 'validate-before-action',
    { analyse: (i) => {
      const policy = JSON.parse(JSON.stringify(i.policy));
      for (const r of policy.rules) {
        if (!r.when.commandMatches) continue;
        delete r.when.commandMatches.anyFlag;
        delete r.when.commandMatches.anyArgPattern;
        r.when.commandMatches.argsPattern = '.*';       // no ^ or $: validatePolicy refuses this
      }
      // Hand-built analysis, so nothing here ever consults validatePolicy.
      return {
        supported: true, policy, mechanism: 'hook', strict: !!policy.absolute,
        families: [...new Set(policy.rules.map((r) => r.family))].sort(), notes: [],
        denyCandidates: policy.rules.filter((r) => r.decision === 'deny' && r.when.commandMatches),
      };
    } });

  await inject('validate-before-action: a crashing handler is modelled as still blocking', 'validate-before-action',
    { buildBundle: (n, i, a) => {
      const b = V.buildBundle(n, i, a);
      const conf = JSON.parse(b.files['conformance.json']);
      for (const c of conf.cases) {
        if (c.kind === 'fail-posture' || (c.kind === 'residual' && c.mutate)) c.expect = { decision: 'deny' };
      }
      return { ...b, files: { ...b.files, 'conformance.json': JSON.stringify(conf, null, 2) + '\n' } };
    } });
  /**
   * Injection 4, and now 11: the FROZEN MAP itself. Every other injection corrupts
   * a generator; these corrupt the EXPECTATION, which is the other way a gate goes
   * blind. Run once per pack, because a frozen map that only one pack's probes
   * consult would leave the other's unguarded.
   */
  for (const [pid, idx] of [['protect-path', 4], ['validate-before-action', 3]]) {
    const probes = packById(pid).GATE_PROBES;
    const saved = probes[idx].kinds;
    let red = 0;
    probes[idx].kinds = 'enforce,near-miss';
    try { red = await runGate({ quiet: true }); } finally { probes[idx].kinds = saved; }
    const back = await runGate({ quiet: true });
    check(`MUST FAIL: ${pid}: changing a frozen kind map reddens the gate`, red > 0);
    check('...and the gate returns to green once it is undone', back === 0, `${back} probe(s) still red`);
  }

  console.log(bad === 0 ? '\nGATE IS NOT HOLLOW: every injection was rejected.' : `\nGATE IS HOLLOW: ${bad} injection(s) survived.`);
  return bad === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- self-test
function selfTest() {
  let f = 0;
  const check = (n, c, d = '') => { if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n}${d ? ' :: ' + d : ''}`); f++; } };

  console.log('requirement analysis:');
  const A = (s) => analyse(s);
  const hard = A('Prevent any change to a file under `infra/`. The protection must still hold if the guard script is deleted or crashes.');
  check('guarantee + fail-closed selects the permission deny rule', hard.mechanism === 'permission-deny', hard.mechanism);
  check('...and rejects the hook FOR THE DOCUMENTED REASON', /fails OPEN/.test(hard.rejected));
  const soft = A('Block writes to `infra/` so people do not edit it casually.');
  /**
   * REVERSED 2026-08-05. This row previously asserted `soft.mechanism === 'hook'`,
   * which made recommending the weaker mechanism a CI-gated guarantee. Measured:
   * a `Write|Edit` hook matcher cannot match a Bash tool call, so the bundle this
   * used to emit did not stop `cp infra/main.tf infra/main.tf.bak` in a live
   * session while the deny rule it named as REJECTED did.
   */
  check('A GUARANTEE NEVER SELECTS A HOOK, however casually it is phrased',
    soft.mechanism === 'permission-deny', soft.mechanism);
  check('...and the rejected alternative names the hook and its documented failure',
    /hook/i.test(soft.rejected) && /fails OPEN/.test(soft.rejected), soft.rejected);
  check('no phrasing anywhere still selects a hook',
    ['Block writes to `infra/`.', 'Never modify `infra/`.', 'infra/ must never be modified, even if it crashes.',
      'Prevent any change to a file under `infra/`.']
      .every((s) => A(s).mechanism !== 'hook'));
  const advisory = A('It would be good to protect `infra/` from accidental edits.');
  check('a protection ask with no guarantee language leaves advisory legitimate',
    advisory.mechanism === 'advisory', advisory.mechanism || advisory.reason);
  const notprotection = A('Prefer to keep changes to `infra/` in a separate commit.');
  check('a non-protection ask about a path is REFUSED, not force-fitted',
    notprotection.supported === false, 'this is not a protection requirement at all');
  const nopath = A('Everything must always be safe and correct.');
  check('a requirement with no extractable path is REFUSED, not guessed', nopath.supported === false);
  const notprotect = A('Summarise `docs/**` into a changelog every session.');
  check('a non-protection requirement is REFUSED', notprotect.supported === false);

  console.log('target extraction and globbing:');
  check('backticked path', extractTarget('protect `infra/` please') === 'infra/');
  check('quoted path', extractTarget('protect "config/secrets" now') === 'config/secrets');
  check('bare directory token', extractTarget('nothing may change infra/prod files') === 'infra/prod');
  check('dotfile', extractTarget('never touch .env again') === '.env');
  check('directory becomes a subtree glob', toGlob('infra/') === 'infra/**');
  check('bare directory becomes a subtree glob', toGlob('infra') === 'infra/**');
  check('an existing glob is left alone', toGlob('infra/**') === 'infra/**');
  check('a single file is not turned into a subtree', toGlob('.env') === '.env');

  console.log('emitted spec:');
  const c1 = conformanceFor('x', 'r', hard);
  /**
   * `tamper` replaced `fail-posture` here. With no handler shipped, both handler
   * mutations iterate `settings.hooks`, find nothing, and mutate nothing, so the
   * case was byte-identical to the enforce case above it: a check that could not
   * fail, presenting as the strongest assertion in the spec. `add-allow-rule` is
   * falsifiable, because reordering the deny/ask/allow loop reddens it.
   */
  check('a fail-closed requirement emits a TAMPER case, not a dead fail-posture case',
    c1.cases.filter((c) => c.kind === 'tamper').length === 1
    && c1.cases.every((c) => c.kind !== 'fail-posture'),
    c1.cases.map((c) => c.kind).join(','));
  check('...and the tamper case survives an injected allow rule',
    c1.cases.find((c) => c.kind === 'tamper').mutate === 'add-allow-rule');
  const c2 = conformanceFor('x', 'r', soft);
  check('a non-fail-closed requirement emits NO tamper case', c2.cases.filter((c) => c.kind === 'tamper').length === 0);
  check('every spec carries a near-miss, so a deny-everything bundle cannot pass', c2.cases.some((c) => c.kind === 'near-miss'));
  check('every spec carries a wiring case', c2.cases.some((c) => c.kind === 'wiring'));

  /**
   * The residual is the answer to "the acceptance test is narrower than the
   * requirement". It names the uncovered vector as a CASE, so the disclosure can
   * go red rather than quietly rotting in prose.
   */
  const res = c2.cases.filter((c) => c.kind === 'residual');
  check('every enforcing spec names its uncovered vector as a case', res.length === 1, `${res.length}`);
  check('...the residual expects ALLOW, so it reddens if the gap ever closes',
    res[0].expect.decision === 'allow');
  check('...and it carries a vector id and a reason', !!res[0].vector && String(res[0].why || '').length > 40);
  check('an advisory spec asserts NON-enforcement and emits no enforce case',
    (() => {
      const c = conformanceFor('x', 'r', advisory);
      return c.cases.every((x) => x.kind !== 'enforce') && c.cases.some((x) => x.kind === 'residual');
    })());

  // Regression: a single-file target must not have "/main.tf" appended, or the
  // deny rule cannot match its own cases and the bundle fails its own spec.
  // Found by independent review 2026-08-04; no verify-spec check caught it.
  const fileHard = A('Never allow modification of `config/prod.secrets.yaml`. This must hold even if the guard crashes.');
  check('a single-file requirement is still supported', fileHard.supported === true, fileHard.reason || '');
  check('...and keeps the file as the glob, not a subtree', fileHard.glob === 'config/prod.secrets.yaml', fileHard.glob);
  const cFile = conformanceFor('x', 'r', fileHard);
  // A residual case drives Bash, so its tool_input carries `command` and no
  // `file_path`. Filter rather than assume, or this row crashes on the very case
  // that exists to disclose the Bash gap.
  const paths = cFile.cases.map((c) => c.input.tool_input.file_path).filter(Boolean);
  check('SINGLE-FILE REGRESSION: no case appends /main.tf to a file target',
    paths.length > 0 && !paths.some((p) => p.startsWith('config/prod.secrets.yaml/')), paths.join(' '));
  check('...every enforce and tamper case targets the file itself',
    cFile.cases.filter((c) => c.kind === 'enforce' || c.kind === 'tamper')
      .every((c) => c.input.tool_input.file_path === 'config/prod.secrets.yaml'));
  check('...and no nested case is invented for a file', !paths.some((p) => /nested/.test(p)));
  check('...case ids stay contiguous when the nested case is dropped',
    cFile.cases.map((c) => c.id).join(',') === 'C1,C2,C3,C4,C5,C6', cFile.cases.map((c) => c.id).join(','));

  /**
   * THE FINAL VERDICT SENTENCES. Three review rounds found a falsehood here and no
   * gate could reach any of the three fixes, because the decision lived inside a
   * function whose only caller is the CLI. It is a pure function now, so the
   * sentences themselves are asserted.
   */
  console.log('the sentence the CLI prints, which three rounds of review found wrong:');
  {
    const C = (ok) => ({ id: `c-${ok}`, kind: 'enforce', ok, why: ok ? [] : ['x'] });
    const R = (cases, strictResidual, strict = true) => ({ cases, strict, strictResidual, mutatedSource: false });
    const clean = finalVerdict(R([C(true)], [], false));
    check('a clean run says DONE and exits 0', clean.code === 0 && /^DONE: /.test(clean.lines[0]), clean.lines.join(' '));
    const failed = finalVerdict(R([C(false)], []));
    check('a failing case says the bundle does NOT satisfy its spec',
      failed.code === 1 && failed.lines.join(' ').includes('does not satisfy its own conformance spec'));
    const strictOnly = finalVerdict(R([C(true)], [{ id: 'r', vector: 'v' }]));
    check('a strict-only run says the bundle DOES satisfy its spec', strictOnly.code === 1
      && strictOnly.lines.join(' ').includes('satisfies its own conformance spec'), strictOnly.lines.join(' '));
    check('MUST NOT: tell the user a strict-only bundle failed its spec',
      !strictOnly.lines.join(' ').includes('does not satisfy'), 'this is the exact falsehood, back again');
    const both = finalVerdict(R([C(false)], [{ id: 'r', vector: 'v' }]));
    check('a failing case OUTRANKS a surviving residual in the summary too',
      both.lines.join(' ').includes('does not satisfy its own conformance spec'));
    check('...and never claims the bundle satisfied its spec', !/\bsatisfies its own conformance spec/.test(both.lines.join(' ')));
    check('every verdict returns at least one line and a numeric code',
      [clean, failed, strictOnly, both].every((v) => v.lines.length > 0 && Number.isInteger(v.code)));
  }

  console.log('vocabulary:');
  check('"Never allow modification of X" is recognised as protection',
    A('Never allow modification of `infra/`.').supported === true);
  check('"must not be overwritten" is recognised',
    A('The file `.env` must not be overwritten.').supported === true);

  console.log(`\n${f === 0 ? 'SELF-TEST PASS' : `SELF-TEST FAIL (${f})`}`);
  return f === 0 ? 0 : 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (argv.includes('--gate')) {
    process.exit(argv.includes('--prove-gate-can-fail')
      ? await proveGateCanFail()
      : ((await runGate()) === 0 ? 0 : 1));
  }
  if (argv.includes('--list-packs')) {
    for (const p of listPacks()) {
      console.log(p.id);
      console.log(`  ${p.summary}`);
      for (const r of p.requires) console.log(`  requires: ${r}`);
    }
    process.exit(0);
  }
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const outDir = arg('--out');
  const requirement = arg('--requirement');
  const policyPath = arg('--policy');
  const packId = arg('--pack');
  if (!outDir || (!requirement && !policyPath)) {
    console.error('usage: node tools/extension-scaffold.mjs --requirement "<text>" --out <dir> [--name <name>]');
    console.error('       node tools/extension-scaffold.mjs --policy <file> --out <dir> [--name <name>]');
    console.error('       node tools/extension-scaffold.mjs --list-packs');
    console.error('       node tools/extension-scaffold.mjs --self-test');
    console.error('       node tools/extension-scaffold.mjs --gate [--prove-gate-can-fail]');
    console.error('');
    console.error('--pack <id> forces a pack. Without it the pack is selected by REQUIRED INPUTS,');
    console.error('never by classifying the prose: a policy selects validate-before-action, an');
    console.error('extractable path selects protect-path, and anything else is refused.');
    process.exit(2);
  }

  const input = { requirement: requirement || '', policyPath };
  if (policyPath) {
    const loaded = loadPolicy(resolve(policyPath));
    if (!loaded.ok) {
      console.error(`REFUSED ${policyPath}`);
      for (const e of loaded.errors) console.error(`  ${e}`);
      console.error(`\n${loaded.errors.length} problem(s). Nothing was generated.`);
      process.exit(1);
    }
    input.policy = loaded.policy;
  }

  let pack;
  try {
    pack = packId ? packById(packId) : route(input);
  } catch (e) {
    console.error(e.message);
    for (const d of (e.detail || [])) console.error(d);
    process.exit(e.exitCode || 2);
  }
  process.exit(scaffold(pack, input, resolve(outDir), arg('--name') || 'generated-extension'));
}

if (IS_MAIN) main();
