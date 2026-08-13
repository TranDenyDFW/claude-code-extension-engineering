#!/usr/bin/env node
/**
 * ARTIFACT MUTATION: prove that a gate reading a COMMITTED artifact can reject a
 * doctored one, and reject it for the NAMED reason.
 *
 * WHY THIS SHAPE AND NOT A SOURCE-MUTATION HARNESS
 * ------------------------------------------------
 * Six independent review rounds found ~33 defects in this repository's own
 * tooling. Three of them were artifact defects that no source mutation can reach,
 * because the code was correct and the DATA was fabricated:
 *
 *   - a fixture's `failedIds`, `exit`, `parsed` and `detail` rewritten wholesale
 *     behind an unchanged `score`, leaving `--verify-record` at exit 0
 *   - two fixtures' competitor results swapped, which leaves every aggregate
 *     tally identical and was therefore invisible to a comparison of sums
 *   - a results file replaced with garbage, which made a published number's only
 *     guard disappear rather than complain
 *
 * Each was fixed. None of the fixes had a proof that mutates the committed file,
 * so each fix was itself only as good as the next reviewer's hand.
 *
 * THE ONE RULE THAT MAKES THIS WORTH ANYTHING. A mutant is rejected only when the
 * gate complains for the reason the mutant DECLARES. A mutant caught by a
 * different rule scores WRONG GATE and counts as survived, because "the gate went
 * red" is not evidence that the gate saw what you broke: review round 3 found a
 * guard that never fired while its own gate went red for an unrelated reason, and
 * an exit-code-only proof would have scored that mutant killed.
 *
 * The vocabulary (`rejected` / `SURVIVED` / `WRONG GATE` / the HOLLOW banner) is
 * copied verbatim from tools/capability-catalog.mjs `proveFail`, which is the
 * strongest must-fail proof in this repository, rather than invented here. Two
 * proofs that mean the same thing and word it differently are two things to read.
 *
 * usage: imported. See the --prove-can-fail mode of each consumer.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * Run a set of declared mutants against one committed artifact.
 *
 * @param {object} o
 * @param {string} o.artifact   path to the COMMITTED file. Never written to.
 * @param {string} o.label      what it is, for the banner
 * @param {(text:string)=>any} o.parse    read the artifact into a value
 * @param {(value:any)=>string} o.serialise  write a mutated value back to text
 * @param {(path:string)=>string[]} o.gate   run the real gate over a candidate file
 *                                           and return the REASON CODES it raised
 * @param {Array<{label:string, expect:string, mutate:(v:any)=>any}>} o.mutants
 * @returns {number} process exit code
 */
export function proveArtifactGate({ artifact, label, parse, serialise, gate, mutants }) {
  if (!existsSync(artifact)) {
    console.log(`CANNOT PROVE: no ${label} at ${artifact}`);
    return 2;
  }
  const beforeHash = sha256(readFileSync(artifact));
  const base = parse(readFileSync(artifact, 'utf8'));

  /**
   * THE BASELINE MUST BE CLEAN FIRST. An artifact proof run against an already
   * failing gate passes vacuously: every mutant "is rejected" by whatever was
   * already wrong. extension-scaffold's injection harness shipped without this
   * once and printed its success banner while the gate underneath was red.
   */
  const tmp = mkdtempSync(join(tmpdir(), 'ccx-artifact-pf-'));
  let survived = 0;
  let checked = 0;
  try {
    const clean = join(tmp, `clean-${basename(artifact)}`);
    writeFileSync(clean, serialise(base));
    const baseline = gate(clean);
    if (baseline.length) {
      console.log(`CANNOT PROVE: the committed ${label} already fails its own gate (${baseline.join(', ')}).`);
      console.log('Every mutant below would be "rejected" by that pre-existing failure, which proves nothing.');
      return 1;
    }
    console.log(`  ok        the committed ${label} passes its gate, so a rejection below means something`);

    if (!mutants.length) {
      // A proof with no mutants is the defect it exists to catch.
      console.log(`\n${label.toUpperCase()} GATE IS HOLLOW: no mutants were declared, so nothing was proved`);
      return 1;
    }

    for (const [i, m] of mutants.entries()) {
      const mutated = m.mutate(JSON.parse(JSON.stringify(base)));
      const p = join(tmp, `mutant-${i}-${basename(artifact)}`);
      const text = serialise(mutated);
      writeFileSync(p, text);
      /**
       * A mutant that did not change the bytes proves nothing and must say so
       * rather than being counted. validation-family-breaks learned this one:
       * a transform whose anchor had moved silently produced a fixture identical
       * to the control and scored a MISS that looked like a tool failure.
       */
      if (text === serialise(base)) {
        survived++;
        checked++;
        console.log(`  SURVIVED  ${m.label}  <- the mutation changed nothing, so it asserts nothing`);
        continue;
      }
      const got = gate(p);
      checked++;
      if (!got.length) {
        survived++;
        console.log(`  SURVIVED  ${m.label}  <- no gate rejected it`);
      } else if (!got.includes(m.expect)) {
        survived++;
        console.log(`  WRONG GATE  ${m.label}  expected ${m.expect}, got ${got.join(',')}`);
      } else {
        console.log(`  rejected  ${m.label}  [${m.expect}]`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // Belt and braces: the committed artifact is never a working copy.
  if (sha256(readFileSync(artifact)) !== beforeHash) {
    console.log(`  SURVIVED  the committed ${label} was modified by this proof`);
    survived++;
  }

  if (survived) {
    console.log(`\n${label.toUpperCase()} GATE IS HOLLOW: ${survived} of ${checked} mutants were not rejected by the expected gate`);
    return 1;
  }
  console.log(`\n${label.toUpperCase()} GATE CAN FAIL: all ${checked} mutants were rejected by the gate that names them.`);
  return 0;
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const ok = (n, c, d) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d || ''})`}`); if (!c) fails++; };

  const tmp = mkdtempSync(join(tmpdir(), 'ccx-am-self-'));
  const art = join(tmp, 'thing.json');
  writeFileSync(art, JSON.stringify({ n: 1, keep: 'yes' }, null, 2) + '\n');
  const cfg = (over = {}) => ({
    artifact: art,
    label: 'thing',
    parse: (t) => JSON.parse(t),
    serialise: (v) => JSON.stringify(v, null, 2) + '\n',
    gate: (p) => { const v = JSON.parse(readFileSync(p, 'utf8')); return v.n === 1 ? [] : ['N_CHANGED']; },
    mutants: [{ label: 'n moved', expect: 'N_CHANGED', mutate: (v) => ({ ...v, n: 2 }) }],
    ...over,
  });

  const quiet = (fn) => { const real = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' ')); try { return { code: fn(), out: lines.join('\n') }; } finally { console.log = real; } };

  try {
    let r = quiet(() => proveArtifactGate(cfg()));
    ok('a real mutant rejected by its declared code passes', r.code === 0 && /GATE CAN FAIL/.test(r.out), r.out);

    r = quiet(() => proveArtifactGate(cfg({ gate: () => [] })));
    ok('MUST FAIL: a gate that rejects nothing', r.code === 1 && /SURVIVED/.test(r.out));

    r = quiet(() => proveArtifactGate(cfg({ gate: (p) => (JSON.parse(readFileSync(p, 'utf8')).n === 1 ? [] : ['SOMETHING_ELSE']) })));
    ok('MUST FAIL: rejected by the WRONG rule counts as survived', r.code === 1 && /WRONG GATE/.test(r.out),
      'this is the case an exit-code-only proof scores as killed');

    r = quiet(() => proveArtifactGate(cfg({ mutants: [{ label: 'no-op', expect: 'N_CHANGED', mutate: (v) => v }] })));
    ok('MUST FAIL: a mutant that changes no bytes', r.code === 1 && /changed nothing/.test(r.out));

    r = quiet(() => proveArtifactGate(cfg({ mutants: [] })));
    ok('MUST FAIL: no mutants declared at all', r.code === 1 && /HOLLOW/.test(r.out));

    r = quiet(() => proveArtifactGate(cfg({ gate: () => ['ALREADY_BROKEN'] })));
    ok('MUST REFUSE: a baseline that already fails, rather than passing vacuously',
      r.code === 1 && /CANNOT PROVE/.test(r.out) && !/SURVIVED/.test(r.out));

    r = quiet(() => proveArtifactGate(cfg({ artifact: join(tmp, 'absent.json') })));
    ok('a missing artifact is exit 2, distinct from a hollow gate', r.code === 2);

    const before = sha256(readFileSync(art));
    quiet(() => proveArtifactGate(cfg()));
    ok('the committed artifact is never written to', sha256(readFileSync(art)) === before);
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('artifact-mutation.mjs')) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : (console.log('usage: node tools/artifact-mutation.mjs --self-test'), 2));
}
