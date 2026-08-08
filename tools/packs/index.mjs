#!/usr/bin/env node
/**
 * PURPOSE PACK REGISTRY.
 *
 * The creator used to be one scaffold that knew one thing. It is now a dispatcher
 * over packs, each owning the behaviour specific to its purpose: what it applies
 * to, how it analyses, what it emits, what its conformance asserts, what it does
 * NOT cover, and its own frozen gate probes.
 *
 * WHY A REGISTRY AND NOT A CHAIN OF ifs. A universal wrapper becomes
 * `if skill else if hook else if mcp ...`, and then the natural-language
 * classifier is the most important and least reliable component in the system.
 * Packs do not fix that by themselves: ten purpose buckets is the same classifier
 * with more labels, and moving a problem up a layer is not solving it.
 *
 * SO ROUTING HERE IS NOT A CLASSIFIER. Each pack declares REQUIRED INPUTS, and a
 * pack whose required inputs are absent can never be selected. `protect-path`
 * needs an extractable path; `validate-before-action` needs an explicit policy
 * file. Those conditions are disjoint by construction, so the router never
 * guesses:
 *
 *   exactly one pack applies  -> use it
 *   no pack applies           -> REFUSE, listing the packs and why each declined
 *   more than one applies     -> REFUSE and demand --pack
 *   --pack names an unknown   -> REFUSE
 *
 * "Unknown" never means "protect-path". There is no default generator, because a
 * default generator is how an unsupported requirement becomes a plausible wrong
 * answer.
 *
 * usage:
 *   node tools/packs/index.mjs --list        the same listing the CLI prints
 *   node tools/packs/index.mjs --self-test
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as protectPath from './protect-path.mjs';
import * as validateBeforeAction from './validate-before-action.mjs';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * Declaration order is the listing order and nothing else depends on it. Adding a
 * pack is one import plus one entry; the router, the CLI, the gate and the
 * injection harness all read the registry rather than naming packs.
 */
export const PACKS = new Map([
  [protectPath.id, protectPath],
  [validateBeforeAction.id, validateBeforeAction],
]);

export function listPacks() {
  return [...PACKS.values()].map((p) => ({
    id: p.id,
    summary: p.summary,
    requires: p.requires || [],
  }));
}

export class PackRefusal extends Error {
  constructor(msg, detail = []) { super(msg); this.detail = detail; this.exitCode = 2; }
}

/**
 * Resolve a pack from an explicit id, refusing anything unknown.
 *
 * The failure mode this exists to prevent: an unknown `--pack` silently falling
 * through to whatever generator happens to be first, which would turn a typo into
 * a wrong bundle that passes its own spec.
 */
export function packById(id) {
  const p = PACKS.get(String(id));
  if (!p) {
    throw new PackRefusal(`unknown pack "${id}"`, [
      `Known packs: ${[...PACKS.keys()].join(', ')}.`,
      'There is no default pack. An unknown id is refused rather than routed, because a',
      'default generator turns an unsupported requirement into a plausible wrong answer.',
    ]);
  }
  return p;
}

/**
 * Route by asking every pack whether it applies. Returns the single match or
 * throws a refusal that says what each pack decided and why.
 */
export function route(input) {
  const votes = [...PACKS.values()].map((p) => ({ pack: p, ...p.applies(input) }));
  const yes = votes.filter((v) => v.applies);
  if (yes.length === 1) return yes[0].pack;
  if (yes.length === 0) {
    throw new PackRefusal('no pack handles this input', [
      ...votes.map((v) => `  ${v.pack.id.padEnd(24)} declined: ${v.why}`),
      '',
      'Nothing is force-fitted. If this is a path protection, name the path in backticks;',
      'if it is an action validation, pass --policy <file>. For anything else use',
      '`create-plugin` from plugin-dev and hand the result to extension-prove with a',
      'conformance.json you write.',
    ]);
  }
  throw new PackRefusal(`${yes.length} packs match this input, so the choice is yours and not a guess`, [
    ...yes.map((v) => `  ${v.pack.id.padEnd(24)} ${v.why}`),
    '',
    'Re-run with --pack <id>. The router refuses rather than picking, because picking',
    'would make the most important decision in the run the least visible one.',
  ]);
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const check = (n, ok, got) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `  (${got})`}`); if (!ok) fails++; };

  const ids = [...PACKS.keys()];
  check('both packs are registered', ids.length === 2 && ids.includes('protect-path') && ids.includes('validate-before-action'), ids.join(','));
  check('every pack carries the full interface',
    [...PACKS.values()].every((p) => p.id && p.summary && typeof p.applies === 'function'
      && typeof p.analyse === 'function' && typeof p.buildBundle === 'function'
      && Array.isArray(p.GATE_PROBES) && typeof p.filesFor === 'function'));
  check('--list reports a summary and required inputs for each',
    listPacks().every((p) => p.summary.length > 30 && Array.isArray(p.requires)));

  check('an explicit id resolves', packById('protect-path').id === 'protect-path');
  for (const bad of ['nope', '', 'PROTECT-PATH', 'protect_path', 'validate']) {
    let threw = null;
    try { packById(bad); } catch (e) { threw = e; }
    check(`MUST REFUSE: unknown pack ${JSON.stringify(bad)}`, threw instanceof PackRefusal);
  }
  {
    let threw = null;
    try { packById('nope'); } catch (e) { threw = e; }
    check('...and the refusal never names a fallback', threw && /no default pack/i.test(threw.detail.join(' ')));
    check('...and it carries exit code 2, not 0', threw && threw.exitCode === 2);
  }

  const P = 'Prevent any change to a file under `infra/`.';
  check('a path requirement with no policy routes to protect-path', route({ requirement: P }).id === 'protect-path');
  {
    const pol = { policySchema: 1, id: 'p', tool: 'Bash', matcher: 'Bash', precedence: 'first-match-wins-in-declared-order', rules: [{ id: 'R1', family: 'dangerous-operation', decision: 'deny', reason: 'x', when: { commandMatches: { exec: 'rm', anyFlag: ['-rf'] } } }] };
    check('a policy routes to validate-before-action', route({ requirement: 'block rm -rf', policy: pol }).id === 'validate-before-action');
    /**
     * THE ROW THAT KEEPS ROUTING HONEST. A path-shaped requirement WITH a policy
     * must not reach protect-path, and a policy-shaped requirement WITHOUT a
     * policy must not fall back to it. Those are the two directions a router
     * silently gets wrong.
     */
    check('a path requirement WITH a policy does NOT route to protect-path',
      route({ requirement: P, policy: pol }).id === 'validate-before-action');
  }
  for (const r of ['block rm -rf before it runs', 'validate commands before execution', 'gate deployments on tests']) {
    let threw = null;
    try { route({ requirement: r }); } catch (e) { threw = e; }
    check(`MUST REFUSE: validation-shaped prose with NO policy (${r.slice(0, 28)})`, threw instanceof PackRefusal);
    check('...and the refusal never silently becomes protect-path', threw && /no pack handles/.test(threw.message));
  }
  for (const r of ['Write me a Python script to parse a CSV.', '', 'make the tests faster']) {
    let threw = null;
    try { route({ requirement: r }); } catch (e) { threw = e; }
    check(`MUST REFUSE: out-of-family requirement ${JSON.stringify(r.slice(0, 24))}`, threw instanceof PackRefusal);
  }
  check('the no-match refusal explains what EACH pack decided',
    (() => { try { route({ requirement: 'zzz' }); return false; } catch (e) { return e.detail.filter((l) => /declined:/.test(l)).length === 2; } })());

  /**
   * A future pack must not be reachable by accident. Registering one that never
   * applies must leave routing unchanged, and must NOT create a fallthrough.
   */
  {
    const ghost = { id: 'ghost', summary: 'x'.repeat(40), requires: [], applies: () => ({ applies: false, why: 'never' }), analyse: () => ({}), buildBundle: () => ({}), GATE_PROBES: [], filesFor: () => [] };
    PACKS.set('ghost', ghost);
    try {
      check('an added pack that never applies does not change routing', route({ requirement: P }).id === 'protect-path');
      let threw = null;
      try { route({ requirement: 'zzz' }); } catch (e) { threw = e; }
      check('...and still refuses rather than falling through to it', threw instanceof PackRefusal);
      check('...and it does appear in --list, so it is discoverable', listPacks().some((p) => p.id === 'ghost'));
    } finally { PACKS.delete('ghost'); }
  }
  check('the ghost pack is gone again', !PACKS.has('ghost'));

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

if (IS_MAIN) {
  const a = process.argv.slice(2);
  if (a.includes('--self-test')) process.exit(selfTest());
  for (const p of listPacks()) {
    console.log(`${p.id}`);
    console.log(`  ${p.summary}`);
    if (p.requires.length) console.log(`  requires: ${p.requires.join(', ')}`);
  }
  process.exit(0);
}
