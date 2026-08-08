#!/usr/bin/env node
/**
 * THE CLI CONTRACT: spawn the tool as a PROCESS and assert what it prints.
 *
 * WHY THIS EXISTS, and it is the most useful thing five review rounds produced.
 *
 * One sentence, the final verdict `extension-scaffold` prints, was wrong in four
 * consecutive fixes. It moved location every time: a stdout substring match, then
 * the prover's reporter, then a branch inside `scaffold()`, then the three lines
 * that call `finalVerdict`. Every fix was validated at the FUNCTION boundary and
 * every one was correct there. Not one gate in this repository ran the CLI and read
 * its output, so at each step the sentence simply relocated to the nearest place
 * nothing was looking.
 *
 * The reviewer who found the fourth instance put it exactly right: the technique
 * was fine and the scope was one step behind the defect. Four rounds of numbered
 * checks produced zero failures on their own terms; four rounds of open-ended
 * hunting produced fourteen issues. So the boundary moves here. The product's claim
 * is emitted by a process, and this asserts the process.
 *
 * What it does NOT do: re-test the generator. `--gate` already proves the bundles.
 * This asserts the ONE thing a function-level test structurally cannot, which is
 * what a user reading the terminal is told.
 *
 * usage:
 *   node tests/cli-contract.mjs             assert every contract
 *   node tests/cli-contract.mjs --self-test same thing, plus proving it can fail
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SCAFFOLD = join(REPO, 'tools', 'extension-scaffold.mjs');
const OUT = join(REPO, 'tmp', 'cli-contract');
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function runCli(args, { tool = SCAFFOLD } = {}) {
  const r = spawnSync(process.execPath, [tool, ...args], {
    cwd: REPO, encoding: 'utf8', windowsHide: true, timeout: 300_000,
  });
  return { exit: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/**
 * Every contract is a (exit code, must-contain, must-NOT-contain) triple. The
 * negative half is load-bearing: "does not satisfy its own conformance spec" is a
 * true sentence in one case and a falsehood in the other, so asserting only its
 * presence would pass in both.
 */
export const CONTRACTS = [
  {
    id: 'strict-policy-says-the-spec-is-satisfied',
    why: 'the exact sentence that was wrong in four consecutive fixes',
    args: ['--policy', 'examples/policies/block-recursive-delete-absolute.json', '--out', join(OUT, 'strict'), '--name', 'strict'],
    exit: 1,
    must: [
      '8 case(s): 8 passed, 0 failed.',
      'NOT DONE: the bundle satisfies its own conformance spec, and the spec is STRICT because the',
      'A residual vector is confirmed open, so the claim is refused rather',
    ],
    mustNot: ['NOT DONE: the generated bundle does not satisfy its own conformance spec.'],
  },
  {
    id: 'passing-policy-says-DONE',
    why: 'the other side of the same decision, so neither sentence can print unconditionally',
    args: ['--policy', 'examples/policies/npm-allowlist.json', '--out', join(OUT, 'ok'), '--name', 'ok'],
    exit: 0,
    must: ['DONE: the generated bundle satisfies its own conformance spec.'],
    mustNot: ['NOT DONE'],
  },
  {
    id: 'legacy-prose-path-still-works',
    why: 'protect-path is reached by a different argument shape and prints different analysis lines',
    args: ['--requirement', 'Prevent any change to a file under `infra/`. The protection must still hold if the guard script is deleted or crashes.',
      '--out', join(OUT, 'legacy'), '--name', 'legacy'],
    exit: 1,
    must: ['pack        : protect-path', '7 case(s): 7 passed, 0 failed.', 'NOT DONE: the bundle satisfies its own conformance spec'],
    mustNot: ['NOT DONE: the generated bundle does not satisfy its own conformance spec.'],
  },
  {
    /**
     * The OTHER exit-1 reason, asserted on the PROVER's process because the
     * scaffold regenerates its bundle before proving and can therefore never reach
     * this state in normal operation. That branch of the scaffold is exercised by
     * the gate injections; what belongs here is the sentence a user actually sees
     * when they point the prover at a bundle whose handler has rotted.
     */
    id: 'a-strict-bundle-with-failing-cases-is-not-called-satisfied',
    why: 'a strict spec whose cases FAIL must not print the paragraph claiming every case passed',
    prepare: (dir) => {
      const f = join(dir, '.claude', 'hooks', 'validate.mjs');
      writeFileSync(f, readFileSync(f, 'utf8').replace("  if (out.decision !== 'deny') process.exit(0);", '  process.exit(0);'));
    },
    prepareFrom: ['--policy', 'examples/policies/block-recursive-delete-absolute.json'],
    proveOnly: join(OUT, 'broken'),
    exit: 1,
    must: ['8 case(s): 5 passed, 3 failed.', 'not the reason'],
    mustNot: ['Every case above passed', 'NOT DONE: the requirement is ABSOLUTE'],
  },
  {
    id: 'routing-refuses-validation-prose-with-no-policy',
    why: 'a refusal that generates nothing is the pack architecture\'s central claim',
    args: ['--requirement', 'block rm -rf before it runs', '--out', join(OUT, 'refused')],
    exit: 2,
    must: ['no pack handles this input', 'declined:'],
    mustNot: ['wrote ', 'DONE:'],
  },
  {
    id: 'an-unknown-pack-is-refused-and-never-defaulted',
    why: 'a typo must not silently become protect-path',
    args: ['--pack', 'nope', '--requirement', 'x', '--out', join(OUT, 'refused')],
    exit: 2,
    must: ['unknown pack "nope"', 'no default pack'],
    mustNot: ['wrote '],
  },
  {
    id: 'an-invalid-policy-is-refused-with-its-reason',
    why: 'the policy validator is most of this pack, and its refusals are what a user meets first',
    args: ['--policy', join(OUT, 'bad-policy.json'), '--out', join(OUT, 'refused')],
    exit: 1,
    must: ['REFUSED', 'cannot fail', 'Nothing was generated'],
    mustNot: ['wrote '],
  },
  {
    id: 'list-packs-names-both-and-what-each-needs',
    why: 'discoverability of the routing rule the whole design rests on',
    args: ['--list-packs'],
    exit: 0,
    must: ['protect-path', 'validate-before-action', 'requires:', '--policy'],
    mustNot: [],
  },
];

const BAD_POLICY = {
  policySchema: 1, id: 'bad', tool: 'Bash', matcher: 'Bash',
  precedence: 'first-match-wins-in-declared-order', defaultDecision: 'allow',
  rules: [{ id: 'r', family: 'dangerous-operation', decision: 'allow', reason: 'x', when: { commandMatches: { exec: 'rm', anyFlag: ['-rf'] } } }],
};

function prepare() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'bad-policy.json'), JSON.stringify(BAD_POLICY, null, 2));
}

/** Run one contract and return the problems it found, empty when it holds. */
export function checkContract(c) {
  let res;
  if (c.proveOnly) {
    /**
     * Generate a real bundle through the CLI, damage it, then run the PROVER over
     * it as a process. The scaffold regenerates before proving, so damaging it and
     * re-running the scaffold would simply repair it; the prover is the tool a user
     * points at an existing bundle, and it is the one whose sentence is asserted.
     */
    const gen = runCli([...c.prepareFrom, '--out', c.proveOnly, '--name', 'broken']);
    if (gen.exit === null) return [`${c.id}: the preparation run did not complete`];
    c.prepare(c.proveOnly);
    res = runCli(['--bundle', c.proveOnly], { tool: join(REPO, 'tools', 'extension-prove.mjs') });
  } else {
    res = runCli(c.args);
  }
  const bad = [];
  if (res.exit !== c.exit) bad.push(`exit ${res.exit}, expected ${c.exit}`);
  for (const m of c.must) if (!res.out.includes(m)) bad.push(`missing from output: ${JSON.stringify(m.slice(0, 70))}`);
  for (const m of c.mustNot) if (res.out.includes(m)) bad.push(`MUST NOT be in the output but is: ${JSON.stringify(m.slice(0, 70))}`);
  return bad;
}

function run({ quiet = false } = {}) {
  prepare();
  let bad = 0;
  for (const c of CONTRACTS) {
    const problems = checkContract(c);
    if (problems.length) { bad++; if (!quiet) { console.log(`  FAIL ${c.id}`); for (const p of problems) console.log(`         ${p}`); } }
    else if (!quiet) console.log(`  ok   ${c.id}`);
  }
  if (!quiet) console.log(bad ? `\nCLI CONTRACT BROKEN: ${bad} of ${CONTRACTS.length}.` : `\nCLI CONTRACT HOLDS: ${CONTRACTS.length} contracts, asserted against the process's own stdout.`);
  return bad;
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const ok = (n, c, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d})`}`); if (!c) fails++; };

  ok('every contract asserts an exit code and at least one sentence',
    CONTRACTS.every((c) => Number.isInteger(c.exit) && c.must.length > 0));
  ok('every contract explains why it exists', CONTRACTS.every((c) => c.why && c.why.length > 30));
  ok('contract ids are unique', new Set(CONTRACTS.map((c) => c.id)).size === CONTRACTS.length);
  /**
   * The negative half is what makes the verdict contracts meaningful: the two
   * sentences differ by three words, and asserting only presence would pass on
   * either.
   */
  ok('both halves of the verdict decision carry a mustNot',
    CONTRACTS.filter((c) => /says-the-spec-is-satisfied|says-DONE|failing-cases/.test(c.id)).every((c) => c.mustNot.length > 0));

  console.log('the contracts themselves:');
  const bad = run({ quiet: false });
  ok('every contract holds against the shipped CLI', bad === 0, `${bad} broken`);

  /**
   * MUST FAIL: the contract has to notice the sentence being wrong. Fed a mutated
   * expectation, the checker must complain. This is the cheap direction; the
   * expensive one, mutating the tool, is what CI's --gate neighbours already do.
   */
  const swapped = { ...CONTRACTS[0], must: ['NOT DONE: the generated bundle does not satisfy its own conformance spec.'], mustNot: [] };
  ok('MUST SEE: the strict run NOT printing the wrong sentence', checkContract(swapped).length > 0,
    'the CLI printed the falsehood and the contract accepted it');
  const wrongExit = { ...CONTRACTS[1], exit: 3 };
  ok('MUST SEE: a wrong exit code', checkContract(wrongExit).length > 0);
  const wrongText = { ...CONTRACTS[1], must: [...CONTRACTS[1].must, 'a sentence this tool never prints'] };
  ok('MUST SEE: a missing sentence', checkContract(wrongText).length > 0);

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

if (IS_MAIN) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : (run() ? 1 : 0));
}
