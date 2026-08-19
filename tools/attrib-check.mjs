/**
 * attrib-check: catch a claim whose ATTRIBUTION changed while its SUBSTANCE did not.
 *
 * WHY THIS EXISTS. `tools/verify-evidence.mjs` line 162 is the entire source check:
 *   if (!sourceIds.has(c.source)) errors.push(...)
 * That is set membership. It asks whether the source id EXISTS, never whether it is the RIGHT one.
 * `note` is read by no gate at all, and `tags` is read by no gate at all. So a claim can silently
 * change which source it rests on, lose the reasoning behind it, or be promoted from observation to
 * documentation, and every other gate stays green.
 *
 * MEASURED 2026-08-18: during one adoption, id renumbering shifted claim ids and a positional donor
 * pairing swapped `source` and `note` across SEVEN records, including one where SRC_SUBAGENTS
 * silently displaced LOCAL_ENV. All eleven gates passed throughout. My own spot check found four of
 * the seven; the other three were found only by auditing every record against the baseline BY TEXT.
 *
 * WHY PAIRING ON RAW TEXT IS NOT ENOUGH. Tag markers live INSIDE the claim text, so `[ENGINEERING]`
 * becoming `[COMMUNITY]` changes the text, changes its hash, and makes the record look like brand
 * new text with no baseline to compare against. A retag would therefore drop every retagged claim
 * out of this check in exactly the commit that rewrites attribution. Pairing here is on the text
 * with tag markers STRIPPED, so a retag stays paired and stays visible.
 *
 * THE DECLARED-RETAG CONTRACT. A tag change is legitimate but must never be silent. Pass
 * `--expect-retag <file.json>` naming the claims whose tags are expected to change. The gate passes
 * only if the observed retag set EXACTLY equals the declared set, in BOTH directions: an undeclared
 * retag fails, and a declared retag that did not happen fails too. That turns a bulk edit into an
 * operation whose blast radius was stated in advance and then proven.
 *
 * An empty-string `note` and an ABSENT `note` are DIFFERENT. Not pedantry: a repair pass using
 * `.get('note','')` wrote empty strings over absent keys and an independent review caught exactly
 * one survivor.
 *
 *   node tools/attrib-check.mjs                        compare against main
 *   node tools/attrib-check.mjs --baseline <ref|path>  compare against another ref or file
 *   node tools/attrib-check.mjs --expect-retag <file>  declare the intended tag changes
 *   node tools/attrib-check.mjs --self-test            synthetic rows, proves each check can fail
 *   node tools/attrib-check.mjs --prove-fail           mutates the REAL ledger in memory and
 *                                                      proves the gate goes red on real data
 */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const HERE = fileURLToPath(import.meta.url);
const ROOT = join(dirname(HERE), '..');
const IS_ENTRY = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(HERE);

const LEDGER = 'evidence/claims.jsonl';

/**
 * Must stay identical to TAG_RE in tools/extract-claims.mjs, which does not export it. A copy that
 * silently drifts would strip a different set of markers and quietly change what "same substance"
 * means, so assertRegexInSync() below reads the extractor and fails if the two ever diverge.
 */
export const TAG_RE = /\[(OFFICIAL|ENGINEERING|COMMUNITY|ANTHROPIC|EXPERIMENTAL|LEGACY|DEPRECATED|ENGINEERING BEST PRACTICE|ANTHROPIC RECOMMENDATION|COMMUNITY PRACTICE)\]|\[v(\d+\.\d+\.\d+)\]/g;

export function assertRegexInSync(readFile = (p) => readFileSync(p, 'utf8')) {
  const src = readFile(join(ROOT, 'tools', 'extract-claims.mjs'));
  const m = src.match(/^const TAG_RE = (\/.*\/g);$/m);
  if (!m) return { ok: false, why: 'could not find TAG_RE in tools/extract-claims.mjs' };
  if (m[1] !== TAG_RE.toString()) {
    return { ok: false, why: `TAG_RE drifted.\n  extractor: ${m[1]}\n  here:      ${TAG_RE}` };
  }
  return { ok: true };
}

/** The claim's substance: its text with every tag marker removed and whitespace collapsed. */
export function stripTags(text) {
  return String(text).replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim();
}

export const substanceHash = (text) => createHash('sha256').update(stripTags(text), 'utf8').digest('hex');

/** Absent and empty-string are different values; undefined means the key was not present. */
function fieldOf(rec, key) {
  return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}
const show = (v) => (v === undefined ? '<absent>' : JSON.stringify(v));
/** Tag ORDER inside the array is an extraction artifact, so compare as a set. */
const tagKey = (rec) => {
  const t = fieldOf(rec, 'tags');
  return t === undefined ? undefined : JSON.stringify([...t].sort());
};

/**
 * Returns { drift, retag, collisions, matched, unpaired }.
 *   drift      source or note changed on substance-identical text. Always a failure.
 *   retag      tags changed on substance-identical text. A failure unless declared.
 *   collisions two baseline records share a substance hash, so pairing is ambiguous. Reported
 *              rather than silently resolved to the first, which is what the previous draft did.
 */
export function compare(baseline, current) {
  const byHash = new Map();
  const collisions = [];
  for (const b of baseline) {
    const h = substanceHash(b.text);
    if (byHash.has(h)) { collisions.push({ a: byHash.get(h).id, b: b.id, hash: h.slice(0, 12) }); continue; }
    byHash.set(h, b);
  }
  const drift = [];
  const retag = [];
  let matched = 0;
  const unpaired = [];
  for (const c of current) {
    const b = byHash.get(substanceHash(c.text));
    if (!b) { unpaired.push(c.id); continue; }   // genuinely new substance
    matched++;
    for (const key of ['source', 'note']) {
      const was = fieldOf(b, key), now = fieldOf(c, key);
      if (was !== now) drift.push({ id: c.id, was_id: b.id, key, was: show(was), now: show(now) });
    }
    const wt = tagKey(b), nt = tagKey(c);
    if (wt !== nt) retag.push({ id: c.id, was_id: b.id, was: wt ?? '<absent>', now: nt ?? '<absent>' });
  }
  return { drift, retag, collisions, matched, unpaired };
}

/** Compares the observed retag set against a declaration, in BOTH directions. */
export function reconcileRetag(observed, declared) {
  const obs = new Map(observed.map((r) => [r.id, r]));
  const dec = new Map((declared || []).map((r) => [r.id, r]));
  const undeclared = observed.filter((r) => !dec.has(r.id));
  const missing = [...dec.keys()].filter((id) => !obs.has(id)).map((id) => dec.get(id));
  const mismatched = [];
  for (const [id, d] of dec) {
    const o = obs.get(id);
    if (!o) continue;
    if (d.now && JSON.stringify([...d.now].sort()) !== o.now) {
      mismatched.push({ id, declared: JSON.stringify([...d.now].sort()), observed: o.now });
    }
  }
  return { undeclared, missing, mismatched };
}

function selfTest() {
  const T = (s) => s;
  const base = [{ id: 'X1', text: T('a claim  [ENGINEERING]'), source: 'SRC_A', note: 'because', tags: ['ENGINEERING'] }];
  const cases = [
    { label: 'identical attribution passes',
      cur: [{ id: 'X1', text: T('a claim  [ENGINEERING]'), source: 'SRC_A', note: 'because', tags: ['ENGINEERING'] }] },
    { label: 'a CHANGED source on unchanged text is CAUGHT',
      cur: [{ id: 'X1', text: T('a claim  [ENGINEERING]'), source: 'SRC_B', note: 'because', tags: ['ENGINEERING'] }], drift: 1 },
    { label: 'a CHANGED note is CAUGHT',
      cur: [{ id: 'X1', text: T('a claim  [ENGINEERING]'), source: 'SRC_A', note: 'other', tags: ['ENGINEERING'] }], drift: 1 },
    { label: 'an EMPTY-STRING note over an absent key is CAUGHT',
      base: [{ id: 'X1', text: T('a claim  [ENGINEERING]'), source: 'SRC_A', tags: ['ENGINEERING'] }],
      cur: [{ id: 'X1', text: T('a claim  [ENGINEERING]'), source: 'SRC_A', note: '', tags: ['ENGINEERING'] }], drift: 1 },
    { label: 'THE RETAG CASE: ENGINEERING to COMMUNITY still PAIRS and is reported',
      cur: [{ id: 'X1', text: T('a claim  [COMMUNITY]'), source: 'SRC_A', note: 'because', tags: ['COMMUNITY'] }], retag: 1, matched: 1 },
    { label: 'a retag that ALSO moves the source reports BOTH, not just the retag',
      cur: [{ id: 'X1', text: T('a claim  [COMMUNITY]'), source: 'SRC_B', note: 'because', tags: ['COMMUNITY'] }], retag: 1, drift: 1 },
    { label: 'tag ARRAY ORDER alone is not a retag',
      base: [{ id: 'X1', text: T('a claim  [OFFICIAL]  [v2.1.0]'), source: 'SRC_A', tags: ['OFFICIAL', 'v2.1.0'] }],
      cur: [{ id: 'X1', text: T('a claim  [OFFICIAL]  [v2.1.0]'), source: 'SRC_A', tags: ['v2.1.0', 'OFFICIAL'] }] },
    { label: 'a RENUMBERED id with identical substance and attribution passes',
      cur: [{ id: 'X99', text: T('a claim  [ENGINEERING]'), source: 'SRC_A', note: 'because', tags: ['ENGINEERING'] }] },
    { label: 'genuinely NEW substance is unpaired, not drift',
      cur: [{ id: 'X2', text: T('a different claim  [ENGINEERING]'), source: 'SRC_Z', note: 'new', tags: ['ENGINEERING'] }], unpaired: 1, matched: 0 },
    { label: 'an edit BEYOND the 400-char prefix changes substance and unpairs, it does not pass',
      base: [{ id: 'X1', text: T('A'.repeat(500) + ' tail one  [ENGINEERING]'), source: 'SRC_A', tags: ['ENGINEERING'] }],
      cur: [{ id: 'X1', text: T('A'.repeat(500) + ' tail two  [ENGINEERING]'), source: 'SRC_A', tags: ['ENGINEERING'] }], unpaired: 1, matched: 0 },
    { label: 'an AMBIGUOUS baseline (two records, same substance) is REPORTED, not silently resolved',
      base: [{ id: 'X1', text: T('dup  [ENGINEERING]'), source: 'SRC_A', tags: ['ENGINEERING'] },
             { id: 'X2', text: T('dup  [COMMUNITY]'), source: 'SRC_B', tags: ['COMMUNITY'] }],
      cur: [{ id: 'X1', text: T('dup  [ENGINEERING]'), source: 'SRC_A', tags: ['ENGINEERING'] }], collisions: 1 },
  ];
  let pass = 0;
  for (const c of cases) {
    const r = compare(c.base || base, c.cur);
    const ok = r.drift.length === (c.drift || 0) && r.retag.length === (c.retag || 0)
      && r.collisions.length === (c.collisions || 0) && r.unpaired.length === (c.unpaired || 0)
      && (c.matched === undefined || r.matched === c.matched);
    if (ok) pass++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}  (drift ${r.drift.length}/${c.drift || 0}, retag ${r.retag.length}/${c.retag || 0}, collision ${r.collisions.length}/${c.collisions || 0}, unpaired ${r.unpaired.length}/${c.unpaired || 0})`);
  }

  // The declaration reconciler needs its own must-fail rows.
  const recCases = [
    { label: 'declared retag that happened reconciles clean',
      obs: [{ id: 'A', now: JSON.stringify(['COMMUNITY']) }], dec: [{ id: 'A', now: ['COMMUNITY'] }], u: 0, m: 0, x: 0 },
    { label: 'an UNDECLARED retag is CAUGHT',
      obs: [{ id: 'A', now: JSON.stringify(['COMMUNITY']) }], dec: [], u: 1, m: 0, x: 0 },
    { label: 'a declared retag that did NOT happen is CAUGHT',
      obs: [], dec: [{ id: 'A', now: ['COMMUNITY'] }], u: 0, m: 1, x: 0 },
    { label: 'a retag to the WRONG tag is CAUGHT',
      obs: [{ id: 'A', now: JSON.stringify(['OFFICIAL']) }], dec: [{ id: 'A', now: ['COMMUNITY'] }], u: 0, m: 0, x: 1 },
  ];
  for (const c of recCases) {
    const r = reconcileRetag(c.obs, c.dec);
    const ok = r.undeclared.length === c.u && r.missing.length === c.m && r.mismatched.length === c.x;
    if (ok) pass++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}  (undeclared ${r.undeclared.length}/${c.u}, missing ${r.missing.length}/${c.m}, mismatched ${r.mismatched.length}/${c.x})`);
  }

  const sync = assertRegexInSync();
  const total = cases.length + recCases.length + 1;
  if (sync.ok) { pass++; console.log('  ok   TAG_RE is identical to the extractor\'s'); }
  else console.log(`  FAIL TAG_RE sync: ${sync.why}`);

  console.log(`\n${pass === total ? 'PASS' : 'FAIL'}  ${pass}/${total} self-test rows.`);
  return pass === total ? 0 : 1;
}

export function parse(text) {
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function loadBaseline(ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${LEDGER}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
  } catch {
    return readFileSync(ref, 'utf8');
  }
}

/**
 * Synthetic rows can pass while the tool is blind on the real artifact: fact-sweep's self-test
 * passed 6 of 6 while it could not see an injected value in the real questions.jsonl. So this mode
 * mutates the REAL ledger in memory and requires the gate to go red on each mutation.
 */
function proveFail(ref) {
  const baseline = parse(loadBaseline(ref));
  const clean = compare(baseline, parse(readFileSync(join(ROOT, LEDGER), 'utf8')));
  const live = parse(readFileSync(join(ROOT, LEDGER), 'utf8'));
  const target = live.find((r) => byHashHas(baseline, r) && r.source && (r.tags || []).length);
  if (!target) { console.error('FAIL  no real record was usable as a mutation target'); return 1; }

  const mutants = [
    { label: 'real record, source swapped', mutate: (r) => ({ ...r, source: r.source === 'SRC_HOOKS' ? 'SRC_SKILLS' : 'SRC_HOOKS' }), field: 'drift' },
    { label: 'real record, note blanked to empty string', mutate: (r) => ({ ...r, note: '' }), field: 'drift' },
    { label: 'real record, retagged ENGINEERING to COMMUNITY', mutate: (r) => ({ ...r, tags: ['COMMUNITY'], text: r.text.replace(/\[(OFFICIAL|ENGINEERING)\]/, '[COMMUNITY]') }), field: 'retag' },
  ];
  let pass = 0;
  console.log(`  baseline ${ref}: ${baseline.length} records; live ledger: ${live.length}; target ${target.id}`);
  console.log(`  clean run: drift ${clean.drift.length}, retag ${clean.retag.length}, collisions ${clean.collisions.length}`);
  if (clean.drift.length || clean.retag.length) {
    console.error('  FAIL  the ledger is NOT clean against the baseline, so a red result proves nothing');
    return 1;
  }
  for (const m of mutants) {
    const mutated = live.map((r) => (r.id === target.id ? m.mutate(r) : r));
    const res = compare(baseline, mutated);
    const caught = res[m.field].length > 0;
    if (caught) pass++;
    console.log(`  ${caught ? 'ok  ' : 'FAIL'} ${m.label} -> ${m.field} ${res[m.field].length}`);
  }
  const sync = assertRegexInSync();
  if (sync.ok) pass++; else console.log(`  FAIL TAG_RE sync: ${sync.why}`);
  console.log(`\n${pass === mutants.length + 1 ? 'GATE CAN FAIL' : 'FAIL'}  ${pass}/${mutants.length + 1} real-artifact mutants rejected.`);
  return pass === mutants.length + 1 ? 0 : 1;
}
function byHashHas(baseline, rec) {
  const h = substanceHash(rec.text);
  return baseline.some((b) => substanceHash(b.text) === h);
}

function run(argv) {
  const bi = argv.indexOf('--baseline');
  const ref = bi > -1 ? argv[bi + 1] : 'main';
  const ei = argv.indexOf('--expect-retag');
  const declared = ei > -1 ? JSON.parse(readFileSync(argv[ei + 1], 'utf8')) : null;

  const sync = assertRegexInSync();
  if (!sync.ok) { console.error(`FAIL  ${sync.why}`); return 1; }

  const { drift, retag, collisions, matched, unpaired } =
    compare(parse(loadBaseline(ref)), parse(readFileSync(join(ROOT, LEDGER), 'utf8')));

  let bad = 0;
  for (const c of collisions) {
    console.error(`FAIL  baseline records ${c.a} and ${c.b} share substance hash ${c.hash}; pairing is ambiguous`);
    bad++;
  }
  for (const d of drift) {
    console.error(`FAIL  ${d.id}  ${d.key} changed while the substance did not`);
    console.error(`        was ${d.was}`);
    console.error(`        now ${d.now}`);
    if (d.was_id !== d.id) console.error(`        (baseline id was ${d.was_id}; renumbering alone is fine)`);
    bad++;
  }

  if (declared) {
    const { undeclared, missing, mismatched } = reconcileRetag(retag, declared);
    for (const r of undeclared) { console.error(`FAIL  ${r.id} was retagged ${r.was} to ${r.now} but the declaration does not list it`); bad++; }
    for (const r of missing) { console.error(`FAIL  ${r.id} is declared for retag but its tags did not change`); bad++; }
    for (const r of mismatched) { console.error(`FAIL  ${r.id} declared ${r.declared} but observed ${r.observed}`); bad++; }
    if (!bad) console.log(`PASS  ${retag.length} declared retag(s) applied exactly as declared; ${matched} claim(s) paired by substance, ${unpaired.length} genuinely new.`);
  } else {
    for (const r of retag) { console.error(`FAIL  ${r.id} tags changed ${r.was} to ${r.now} with no --expect-retag declaration`); bad++; }
    if (!bad) console.log(`PASS  ${matched} claim(s) unchanged in substance also unchanged in source, note and tags (baseline ${ref}); ${unpaired.length} genuinely new.`);
  }
  if (bad) console.error(`\n${bad} attribution finding(s). No other gate can see these.`);
  return bad ? 1 : 0;
}

if (IS_ENTRY) {
  const a = process.argv;
  const bi = a.indexOf('--baseline');
  process.exit(
    a.includes('--self-test') ? selfTest()
    : a.includes('--prove-fail') ? proveFail(bi > -1 ? a[bi + 1] : 'main')
    : run(a)
  );
}
