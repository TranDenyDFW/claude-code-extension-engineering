#!/usr/bin/env node
/**
 * Which Bash command shapes does a `permissions.deny` file rule actually reach?
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `extension-prove` used to answer "does the deny rule stop this?" for the four
 * built-in file tools and silently answer `allow` for everything else. `Bash` is
 * not in `EDIT_COVERS`, so `ruleApplies` returned false, `permissionDecision`
 * returned null, and the verdict defaulted to allow. That is a WRONG answer, not
 * a missing one: the product does deny several Bash shapes, so the simulator was
 * reporting a bypass that does not exist, and would have reported one for shapes
 * it had simply never been taught.
 *
 * The docs cannot settle it. `permissions.md` says rules cover "file commands
 * Claude Code recognizes in Bash" and gives EXAMPLES, never an enumeration, so
 * there is no way to read your way to the edge of the recognised set. It also
 * never mentions PowerShell in that sentence, though PowerShell gets full parity
 * a few sections earlier, so on Windows the question is open in the docs both
 * ways.
 *
 * So the set is MEASURED, and this module is the frozen result. The measurement
 * is `tests/tier4/bash-recognition-n10.json`, produced by
 * `tools/bash-recognition-run.mjs`. `--check` asserts the two agree, so the table
 * cannot outrun the evidence and a hand-edit here is a build failure.
 *
 * THE ATTRIBUTION RULE, which is the whole reason this is paired
 * -------------------------------------------------------------
 * "The file did not change" has two causes that look identical on disk: the rule
 * denied the command, or the model simply declined to run it. The first run of
 * this class hit exactly that, with three shapes coming back "not violated" and
 * an EMPTY trace, meaning nothing was ever attempted. So every pass runs two
 * arms, identical but for the deny rule:
 *
 *   rule arm unchanged AND control arm changed -> DENIED, attributable
 *   both arms changed                          -> ALLOWED, the rule did not reach it
 *   both arms unchanged                        -> the command never ran, DISCARD
 *
 * A discarded pass is not a denial. Counting it as one is how you measure your
 * own model's caution and publish it as a security property.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
export const MEASUREMENT = join(REPO, 'tests', 'tier4', 'bash-recognition-n10.json');

/**
 * Shape classification. Deliberately narrow and deliberately WITHOUT a fallback:
 * a command this does not recognise returns `{ shape: null }`, and the caller
 * turns that into `undetermined`, never into `allow`.
 *
 * `targets` is what the shape would write to. A shape whose target cannot be
 * resolved statically (a variable, a glob, a subshell) sets `resolvable: false`,
 * which is also undetermined: the product's own parser refuses those too, with
 * messages like "Contains simple_expansion", and guessing which way it refuses
 * is exactly the kind of encoded guess this project exists to avoid.
 */
const SHAPES = [
  { id: 'append-redirect', re: />>\s*("[^"]+"|'[^']+'|[^\s;&|>]+)/, pick: 1 },
  { id: 'overwrite-redirect', re: /(?:^|[^>\d])>\s*("[^"]+"|'[^']+'|[^\s;&|>]+)/, pick: 1 },
  { id: 'tee', re: /\|\s*tee\s+(?:-a\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/, pick: 1 },
  { id: 'sed-i', re: /\bsed\s+(?:[^\s]*\s+)*?-i[^\s]*\s+(?:'[^']*'|"[^"]*"|[^\s]+)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/, pick: 1 },
  { id: 'cp', re: /\bcp\s+(?:-\S+\s+)*(?:"[^"]+"|'[^']+'|[^\s;&|]+)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/, pick: 1 },
  { id: 'mv', re: /\bmv\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;&|]+)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/, pick: [1, 2] },
  { id: 'rm', re: /\brm\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;&|]+)/, pick: 1 },
  { id: 'touch', re: /\btouch\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;&|]+)/, pick: 1 },
  { id: 'powershell-set-content', re: /\b(?:powershell|pwsh)\b[\s\S]*\b(?:Set-Content|Add-Content|Out-File)\b[\s\S]*?(?:-(?:Path|LiteralPath|FilePath)\s+)?("[^"]+"|'[^']+'|[^\s;&|]+\.[\w]+)/i, pick: 1 },
  { id: 'node-e-write', re: /\bnode\s+-e\b[\s\S]*(?:writeFileSync|appendFileSync|createWriteStream)\s*\(\s*("[^"]+"|'[^']+')/, pick: 1 },
  { id: 'python-c-write', re: /\bpython3?\s+-c\b[\s\S]*\bopen\s*\(\s*("[^"]+"|'[^']+')\s*,\s*['"][aw]/, pick: 1 },
];

// Constructs that make the target unresolvable without executing the command.
// The product's own command parser bails on these too; we refuse rather than guess.
const UNRESOLVABLE = [
  [/\$\{?\w+/, 'variable expansion'],
  [/\$\(|`/, 'command substitution'],
  [/[*?\[]/, 'glob in the target'],
];

export function classifyBashWrite(command) {
  const cmd = String(command || '');
  // A leading `cd` changes what every relative path in the rest means, and the
  // rest is what the rule would be matched against. Recorded as its own shape
  // BEFORE classification, because "cd infra && touch main.tf" and
  // "touch infra/main.tf" write the same file and look nothing alike to a glob.
  const cd = cmd.match(/^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)\s*([\s\S]+)$/);
  if (cd) {
    const inner = classifyBashWrite(cd[2]);
    const base = unquote(cd[1]).replace(/\/$/, '');
    return {
      shape: 'cd-then-write',
      inner: inner.shape,
      resolvable: inner.resolvable && !!base,
      why: inner.resolvable ? null : inner.why,
      targets: (inner.targets || []).map((t) => (isAbsolute(t) ? t : `${base}/${t}`)),
    };
  }
  if (/\b(?:bash|sh|zsh)\s+-c\b/.test(cmd)) {
    return { shape: 'nested-shell', resolvable: false, targets: [], why: 'a nested shell hides the write from any static read of the outer command' };
  }
  /**
   * An interpreter running a SCRIPT. This is the V3 residual vector, and it is
   * the one shape whose target list is empty BY DEFINITION: no static read of
   * `node build.mjs` can know what it writes. `resolvable: true` is deliberate,
   * because the SHAPE is fully determined even though its targets are not, and
   * the measurement is about the shape.
   *
   * The inline forms (`node -e`, `python -c`) are a DIFFERENT shape above, and
   * kept separate because they reach the approval layer differently: no
   * project-scope permissions.allow spelling was enough for them, only
   * --allowedTools. Whether the deny rule reaches either is measured
   * independently, so one cannot borrow the other's verdict.
   */
  if (/^\s*(?:(?:node|python3?|ruby|perl|deno|bun)\s+[\w./\\-]+\.\w+|npm\s+run\s+[\w:-]+|\.\/[\w./-]+|(?:bash|sh)\s+[\w./\\-]+\.sh)\s*$/.test(cmd)) {
    return { shape: 'opaque-subprocess', resolvable: true, targets: [], why: null };
  }
  for (const s of SHAPES) {
    const m = cmd.match(s.re);
    if (!m) continue;
    const picks = Array.isArray(s.pick) ? s.pick : [s.pick];
    const targets = picks.map((i) => unquote(m[i])).filter(Boolean);
    for (const [re, why] of UNRESOLVABLE) {
      if (targets.some((t) => re.test(t))) return { shape: s.id, resolvable: false, targets: [], why };
    }
    return { shape: s.id, resolvable: true, targets, why: null };
  }
  return { shape: null, resolvable: false, targets: [], why: 'no recognised write shape' };
}

function unquote(s) { return String(s || '').replace(/^["']|["']$/g, ''); }
function isAbsolute(p) { return /^([A-Za-z]:[\\/]|\/)/.test(String(p)); }

/**
 * The frozen table. `denied: true` means the paired measurement observed the
 * deny rule stopping this shape with the control arm succeeding. `denied: false`
 * means the control-arm comparison showed the rule did NOT reach it: that is a
 * measured residual, not an assumption.
 *
 * A shape absent from this table is `undetermined`, never allowed. That is the
 * conservative direction: it turns a case red and demands a measurement, rather
 * than reporting a bypass nobody observed.
 */
export const RECOGNIZED_WRITE_SHAPES = loadTable();

function loadTable() {
  if (!existsSync(MEASUREMENT)) return new Map();
  const m = JSON.parse(readFileSync(MEASUREMENT, 'utf8'));
  const out = new Map();
  for (const r of (m.shapes || [])) {
    if (r.verdict !== 'DENIED' && r.verdict !== 'ALLOWED') continue;   // INCONCLUSIVE stays absent
    out.set(r.shape, {
      denied: r.verdict === 'DENIED',
      n: r.attributable, passes: r.passes, discarded: r.discarded,
      cli: m.cli_version, platform: m.platform, measured: m.generated,
    });
  }
  return out;
}

export function shapeVerdict(command) {
  const c = classifyBashWrite(command);
  if (!c.shape) return { state: 'undetermined', why: c.why, classification: c };
  if (!c.resolvable) return { state: 'undetermined', why: c.why, classification: c };
  const key = c.shape === 'cd-then-write' ? `cd-then-write:${c.inner}` : c.shape;
  const row = RECOGNIZED_WRITE_SHAPES.get(key) || RECOGNIZED_WRITE_SHAPES.get(c.shape);
  if (!row) return { state: 'undetermined', why: `shape "${key}" is not in the calibrated set`, classification: c };
  return { state: row.denied ? 'reaches' : 'residual', row, classification: c };
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const check = (name, ok, got) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (${got})`}`); if (!ok) fails++; };

  const t = (cmd) => classifyBashWrite(cmd);
  check('append redirect is recognised and its target extracted',
    t("printf 'x\\n' >> infra/main.tf").shape === 'append-redirect' && t("printf 'x\\n' >> infra/main.tf").targets[0] === 'infra/main.tf');
  check('overwrite redirect is a DIFFERENT shape from append',
    t('echo x > infra/main.tf').shape === 'overwrite-redirect');
  check('a 2>&1 fd redirect is not read as a write target',
    t('ls infra 2>&1').shape === null, JSON.stringify(t('ls infra 2>&1')));
  check('cp takes the DESTINATION, not the source', t('cp seed.tf infra/main.tf').targets[0] === 'infra/main.tf');
  check('mv reports BOTH ends, because a rename out of a tree is also a change',
    t('mv infra/main.tf infra/renamed.tf').targets.length === 2);
  check('sed -i skips the script argument and takes the file',
    t("sed -i 's/a/b/' infra/main.tf").targets[0] === 'infra/main.tf', JSON.stringify(t("sed -i 's/a/b/' infra/main.tf")));
  check('tee -a is a write', t("printf 'x' | tee -a infra/main.tf").shape === 'tee');
  check('node -e writeFileSync is recognised as its own shape',
    t(`node -e "require('fs').appendFileSync('infra/main.tf','x')"`).shape === 'node-e-write');
  check('PowerShell Set-Content is recognised, because permissions.md never says it is',
    t('powershell -c "Set-Content -Path infra/main.tf -Value x"').shape === 'powershell-set-content');

  /**
   * The refusals matter more than the recognitions. Each of these returns
   * undetermined, and the caller must NOT convert that into allow.
   */
  check('a variable target is unresolvable, not allowed',
    t("T=infra/main.tf; printf 'x' >> $T").resolvable === false);
  check('command substitution is unresolvable', t("printf 'x' >> $(echo infra/main.tf)").resolvable === false);
  check('a glob target is unresolvable', t("printf 'x' >> infra/*.tf").resolvable === false);
  check('a nested shell is unresolvable', t(`bash -c "printf 'x' >> infra/main.tf"`).shape === 'nested-shell');
  check('...and the nested shell is NOT resolvable', t(`bash -c "printf 'x' >> infra/main.tf"`).resolvable === false);
  check('an unrecognised command has NO shape', t('git status').shape === null);
  check('an interpreter running a SCRIPT is the opaque-subprocess residual vector',
    t('node build.mjs').shape === 'opaque-subprocess' && t('bash writer.sh').shape === 'opaque-subprocess');
  check('...with an EMPTY target list, because no static read can know what it writes',
    t('node build.mjs').targets.length === 0 && t('node build.mjs').resolvable === true);
  check('npm run is the same shape', t('npm run build').shape === 'opaque-subprocess');
  check('...but an INLINE interpreter is not: node -e stays its own shape',
    t(`node -e "require('fs').writeFileSync('a','b')"`).shape === 'node-e-write');

  const cdc = t("cd infra && printf 'x' >> main.tf");
  check('cd-then-write is its own shape', cdc.shape === 'cd-then-write');
  check('...and the cd base is folded into the target, or the glob would never match',
    cdc.targets[0] === 'infra/main.tf', JSON.stringify(cdc.targets));

  /**
   * The gate on the gate: an EMPTY table must make everything undetermined. If
   * this ever passes with `allow`, the widening has become a check that cannot
   * fail, which is the exact defect the undetermined verdict exists to prevent.
   */
  const saved = new Map(RECOGNIZED_WRITE_SHAPES);
  RECOGNIZED_WRITE_SHAPES.clear();
  check('with an empty table EVERY recognised shape is undetermined, never allowed',
    shapeVerdict("printf 'x' >> infra/main.tf").state === 'undetermined');
  for (const [k, v] of saved) RECOGNIZED_WRITE_SHAPES.set(k, v);
  check('...and the table is restored afterwards', RECOGNIZED_WRITE_SHAPES.size === saved.size);

  if (RECOGNIZED_WRITE_SHAPES.size) {
    check('the loaded table only ever holds measured verdicts',
      [...RECOGNIZED_WRITE_SHAPES.values()].every((r) => typeof r.denied === 'boolean' && r.n > 0));
  } else {
    console.log('  ..   table is EMPTY: no calibration file yet, so every Bash shape is undetermined');
  }

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

/**
 * Drift gate. The table is DERIVED from the measurement, so this asserts the
 * derivation still holds and that no shape was hand-added. A table that can be
 * edited without a measurement is a table that will be.
 */
function check() {
  if (!existsSync(MEASUREMENT)) {
    console.log(`bash-recognition: no measurement at ${MEASUREMENT}`);
    console.log('CANNOT CHECK: the table is empty and every Bash shape is undetermined, which is the safe state.');
    return 2;
  }
  const m = JSON.parse(readFileSync(MEASUREMENT, 'utf8'));
  const fresh = loadTable();
  let bad = 0;
  for (const [k, v] of fresh) {
    const live = RECOGNIZED_WRITE_SHAPES.get(k);
    if (!live || live.denied !== v.denied) { console.log(`  DRIFT ${k}: table says ${live ? live.denied : '(absent)'}, measurement says ${v.denied}`); bad++; }
  }
  for (const k of RECOGNIZED_WRITE_SHAPES.keys()) {
    if (!fresh.has(k)) { console.log(`  DRIFT ${k}: in the table with no measured verdict behind it`); bad++; }
  }
  const inconclusive = (m.shapes || []).filter((r) => r.verdict === 'INCONCLUSIVE');
  console.log(`bash-recognition: ${fresh.size} calibrated shape(s), ${inconclusive.length} inconclusive, cli ${m.cli_version}, ${m.platform}`);
  for (const [k, v] of fresh) console.log(`  ${v.denied ? 'DENIED  ' : 'RESIDUAL'} ${k.padEnd(26)} n=${v.n}/${v.passes} discarded=${v.discarded}`);
  for (const r of inconclusive) console.log(`  ABSENT   ${r.shape.padEnd(26)} ${r.why}`);
  console.log(bad ? `FAIL ${bad} drift(s)` : 'PASS table matches the measurement');
  return bad ? 1 : 0;
}

if (IS_MAIN) {
  const a = process.argv.slice(2);
  process.exit(a.includes('--self-test') ? selfTest() : check());
}
