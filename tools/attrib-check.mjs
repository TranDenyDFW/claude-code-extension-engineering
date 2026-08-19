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
 * THE DECLARATION CONTRACT. An attribution change is often legitimate but must never be silent.
 * Pass `--expect <file.json>`, an array of {id, key, to} covering every intended change to source,
 * note or tags. The gate passes only if the observed change set EXACTLY equals the declared set, in
 * BOTH directions: an undeclared change fails, a declared change that did not happen fails, and a
 * change landing on the wrong value fails. That turns a bulk edit into an operation whose blast
 * radius was stated in advance and then proven. Keyed on id AND field, so a claim that legitimately
 * changes its note cannot smuggle an undeclared source swap alongside it.
 *
 * An empty-string `note` and an ABSENT `note` are DIFFERENT. Not pedantry: a repair pass using
 * `.get('note','')` wrote empty strings over absent keys and an independent review caught exactly
 * one survivor.
 *
 *   node tools/attrib-check.mjs                        compare against main
 *   node tools/attrib-check.mjs --baseline <ref|path>  compare against another ref or file
 *   node tools/attrib-check.mjs --expect <file.json>   declare the intended attribution changes
 *   node tools/attrib-check.mjs --self-test            synthetic rows, proves each check can fail
 *   node tools/attrib-check.mjs --prove-fail           mutates a copy of the REAL ledger and
 *                                                      proves the gate goes red on real data
 */
import { readFileSync, existsSync } from 'fs';
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
 * Returns { changes, collisions, matched, unpaired }.
 *   changes    source, note or tags differ on substance-identical text. Every one is a failure
 *              unless it appears in a declaration; there is no field that may drift quietly.
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
  const changes = [];
  let matched = 0;
  const unpaired = [];
  for (const c of current) {
    const b = byHash.get(substanceHash(c.text));
    if (!b) { unpaired.push(c.id); continue; }   // genuinely new substance
    matched++;
    for (const key of ['source', 'note']) {
      const was = fieldOf(b, key), now = fieldOf(c, key);
      if (was !== now) changes.push({ id: c.id, was_id: b.id, key, was: show(was), now: show(now) });
    }
    const wt = tagKey(b), nt = tagKey(c);
    if (wt !== nt) changes.push({ id: c.id, was_id: b.id, key: 'tags', was: wt ?? '<absent>', now: nt ?? '<absent>' });
  }
  return { changes, collisions, matched, unpaired };
}

/** A declaration entry's expected new value, normalised the same way compare() reports it. */
const declaredNow = (d) => (d.key === 'tags' ? JSON.stringify([...d.to].sort()) : show(d.to));

/**
 * Compares the observed attribution changes against a declaration, in BOTH directions, so that an
 * undeclared change, a declared change that did not happen, and a change to the wrong value all
 * fail. Keyed on id AND field, because one claim may legitimately change two fields at once.
 */
export function reconcile(observed, declared) {
  const k = (x) => `${x.id}|${x.key}`;
  const obs = new Map(observed.map((r) => [k(r), r]));
  const dec = new Map((declared || []).map((d) => [k(d), d]));
  const undeclared = observed.filter((r) => !dec.has(k(r)));
  const missing = [...dec.values()].filter((d) => !obs.has(k(d)));
  const mismatched = [];
  /**
   * An entry with no `to` is INCOMPLETE, not permissive. An earlier draft skipped the comparison
   * when `to` was absent, so such an entry excused ANY value at that id and field while the run
   * still printed "applied exactly as declared". An independent review demonstrated it: the same
   * entry with a `to` rejected 6 of 7 arbitrary values, and without one accepted all 7. Omission
   * is also the edit that looks like carelessness rather than intent, which is the worst possible
   * shape for a silent opt-out, so it is now a failure in its own right.
   */
  const incomplete = [...dec.values()].filter((d) => d.to === undefined);
  for (const [key, d] of dec) {
    const o = obs.get(key);
    if (!o || d.to === undefined) continue;
    if (declaredNow(d) !== o.now) mismatched.push({ id: d.id, key: d.key, declared: declaredNow(d), observed: o.now });
  }
  return { undeclared, missing, mismatched, incomplete };
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
    const want = (c.drift || 0) + (c.retag || 0);
    const ok = r.changes.length === want
      && r.collisions.length === (c.collisions || 0) && r.unpaired.length === (c.unpaired || 0)
      && (c.matched === undefined || r.matched === c.matched)
      && (c.retag === undefined || r.changes.filter((x) => x.key === 'tags').length === c.retag);
    if (ok) pass++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}  (changes ${r.changes.length}/${want}, of which tags ${r.changes.filter((x) => x.key === 'tags').length}/${c.retag || 0}, collision ${r.collisions.length}/${c.collisions || 0}, unpaired ${r.unpaired.length}/${c.unpaired || 0})`);
  }

  // The declaration reconciler needs its own must-fail rows, across every field.
  const OBS = (id, key, now) => ({ id, key, now });
  const recCases = [
    { label: 'declared retag that happened reconciles clean',
      obs: [OBS('A', 'tags', JSON.stringify(['COMMUNITY']))], dec: [{ id: 'A', key: 'tags', to: ['COMMUNITY'] }], u: 0, m: 0, x: 0 },
    { label: 'an UNDECLARED retag is CAUGHT',
      obs: [OBS('A', 'tags', JSON.stringify(['COMMUNITY']))], dec: [], u: 1, m: 0, x: 0 },
    { label: 'a declared retag that did NOT happen is CAUGHT',
      obs: [], dec: [{ id: 'A', key: 'tags', to: ['COMMUNITY'] }], u: 0, m: 1, x: 0 },
    { label: 'a retag to the WRONG tag is CAUGHT',
      obs: [OBS('A', 'tags', JSON.stringify(['OFFICIAL']))], dec: [{ id: 'A', key: 'tags', to: ['COMMUNITY'] }], u: 0, m: 0, x: 1 },
    { label: 'a declared NOTE edit reconciles clean',
      obs: [OBS('A', 'note', JSON.stringify('new reasoning'))], dec: [{ id: 'A', key: 'note', to: 'new reasoning' }], u: 0, m: 0, x: 0 },
    { label: 'an UNDECLARED note edit is CAUGHT',
      obs: [OBS('A', 'note', JSON.stringify('new reasoning'))], dec: [], u: 1, m: 0, x: 0 },
    { label: 'an UNDECLARED source swap is CAUGHT even when a note edit on the SAME claim is declared',
      obs: [OBS('A', 'note', JSON.stringify('ok')), OBS('A', 'source', JSON.stringify('SRC_B'))],
      dec: [{ id: 'A', key: 'note', to: 'ok' }], u: 1, m: 0, x: 0 },
    { label: 'a declaration entry with NO "to" is INCOMPLETE, never a wildcard',
      obs: [OBS('A', 'note', JSON.stringify('whatever'))], dec: [{ id: 'A', key: 'note' }], u: 0, m: 0, x: 0, i: 1 },
    { label: '...and it is incomplete even when the change did not happen, so it cannot hide either way',
      obs: [], dec: [{ id: 'A', key: 'note' }], u: 0, m: 1, x: 0, i: 1 },
    { label: 'to: null IS a stated value and is compared, not treated as absent',
      obs: [OBS('A', 'note', JSON.stringify('something'))], dec: [{ id: 'A', key: 'note', to: null }], u: 0, m: 0, x: 1, i: 0 },
  ];
  for (const c of recCases) {
    const r = reconcile(c.obs, c.dec);
    const ok = r.undeclared.length === c.u && r.missing.length === c.m && r.mismatched.length === c.x
      && r.incomplete.length === (c.i || 0);
    if (ok) pass++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}  (undeclared ${r.undeclared.length}/${c.u}, missing ${r.missing.length}/${c.m}, mismatched ${r.mismatched.length}/${c.x}, incomplete ${r.incomplete.length}/${c.i || 0})`);
  }

  // Staleness: a declaration written against an old baseline must NEVER excuse a change.
  const staleCases = [
    { label: 'a declaration matching the baseline is ACTIVE',
      decl: { baseline: 'abc', changes: [{ id: 'A', key: 'tags' }] }, sha: 'abc', n: 1, stale: false },
    { label: 'a declaration against a DIFFERENT baseline is ignored, not honoured',
      decl: { baseline: 'abc', changes: [{ id: 'A', key: 'tags' }] }, sha: 'def', n: 0, stale: true },
    { label: 'a bare array declaration stays active (explicit --expect)',
      decl: [{ id: 'A', key: 'tags' }], sha: 'def', n: 1, stale: false },
    { label: 'no declaration means no excuses',
      decl: null, sha: 'abc', n: 0, stale: false },
  ];
  for (const c of staleCases) {
    const r = activeDeclarations(c.decl, c.sha);
    const ok = r.changes.length === c.n && Boolean(r.stale) === c.stale;
    if (ok) pass++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}  (active ${r.changes.length}/${c.n}, stale ${Boolean(r.stale)}/${c.stale})`);
  }

  const sync = assertRegexInSync();
  const total = cases.length + recCases.length + staleCases.length + 1;
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
  // Mutates a COPY of the baseline against the baseline itself, so this proves the gate can fail
  // regardless of what the working tree currently holds. An earlier draft compared the live ledger
  // against the baseline and therefore refused to run on any branch with an intentional edit, which
  // is precisely when someone most wants evidence that the gate still bites.
  const baseline = parse(loadBaseline(ref));
  const target = baseline.find((r) => r.source && (r.tags || []).length && r.note !== undefined);
  if (!target) { console.error('FAIL  no real record was usable as a mutation target'); return 1; }

  const control = compare(baseline, baseline);
  console.log(`  baseline ${ref}: ${baseline.length} records; target ${target.id}`);
  console.log(`  NEGATIVE CONTROL, baseline against itself: changes ${control.changes.length}, collisions ${control.collisions.length}, unpaired ${control.unpaired.length}`);
  if (control.changes.length) {
    console.error('  FAIL  the baseline disagrees with itself, so no red result below would mean anything');
    return 1;
  }

  const mutants = [
    { label: 'source swapped', key: 'source',
      mutate: (r) => ({ ...r, source: r.source === 'SRC_HOOKS' ? 'SRC_SKILLS' : 'SRC_HOOKS' }) },
    { label: 'note blanked to empty string', key: 'note', mutate: (r) => ({ ...r, note: '' }) },
    { label: 'note key deleted entirely', key: 'note',
      mutate: (r) => { const c = { ...r }; delete c.note; return c; } },
    { label: 'retagged to COMMUNITY, text marker moved with it', key: 'tags',
      mutate: (r) => ({ ...r, tags: ['COMMUNITY'], text: r.text.replace(/\[(OFFICIAL|ENGINEERING)\]/, '[COMMUNITY]') }) },
  ];
  let pass = 0;
  for (const m of mutants) {
    const mutated = baseline.map((r) => (r.id === target.id ? m.mutate(r) : r));
    const res = compare(baseline, mutated);
    const hit = res.changes.filter((c) => c.key === m.key);
    const caught = hit.length > 0 && res.unpaired.length === 0;
    if (caught) pass++;
    console.log(`  ${caught ? 'ok  ' : 'FAIL'} ${m.label} -> ${m.key} changes ${hit.length}, unpaired ${res.unpaired.length}`);
  }
  /**
   * The declaration path had NO real-artifact coverage: an independent review found that
   * --prove-fail called reconcile() zero times, so the one mechanism standing between a bulk
   * attribution edit and a green run was proven only by synthetic rows. These mutants exercise it
   * against the real ledger.
   */
  const retagAll = baseline.map((r) => (r.id === target.id
    ? { ...r, tags: ['COMMUNITY'], text: r.text.replace(/\[(OFFICIAL|ENGINEERING)\]/, '[COMMUNITY]') } : r));
  const observed = compare(baseline, retagAll).changes;
  const good = observed.map((c) => ({ id: c.id, key: c.key, to: c.key === 'tags' ? JSON.parse(c.now) : JSON.parse(c.now) }));
  const decCases = [
    { label: 'a correct declaration over a real retag reconciles clean',
      dec: good, want: (r) => !r.undeclared.length && !r.missing.length && !r.mismatched.length && !r.incomplete.length },
    { label: 'an EMPTY declaration over the same real retag is caught',
      dec: [], want: (r) => r.undeclared.length > 0 },
    { label: 'a declaration naming a claim that did NOT change is caught',
      dec: good.concat([{ id: 'CLM-DOES-NOT-EXIST', key: 'tags', to: ['COMMUNITY'] }]), want: (r) => r.missing.length > 0 },
    { label: 'a declaration with the WRONG value is caught',
      dec: good.map((d) => ({ ...d, to: d.key === 'tags' ? ['LEGACY'] : 'wrong' })), want: (r) => r.mismatched.length > 0 },
    { label: 'a declaration entry with NO "to" is caught rather than excusing the change',
      dec: good.map(({ id, key }) => ({ id, key })), want: (r) => r.incomplete.length > 0 },
  ];
  for (const c of decCases) {
    const r = reconcile(observed, c.dec);
    const ok = c.want(r);
    if (ok) pass++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label}  (undeclared ${r.undeclared.length}, missing ${r.missing.length}, mismatched ${r.mismatched.length}, incomplete ${r.incomplete.length})`);
  }
  if (!observed.length) { console.log('  FAIL the real retag produced no observed change, so the declaration rows above prove nothing'); }

  const sync = assertRegexInSync();
  if (sync.ok) pass++; else console.log(`  FAIL TAG_RE sync: ${sync.why}`);
  const total = mutants.length + decCases.length + 1;
  console.log(`\n${pass === total && observed.length ? 'GATE CAN FAIL' : 'FAIL'}  ${pass}/${total} real-artifact mutants rejected.`);
  return pass === total && observed.length ? 0 : 1;
}

const DEFAULT_DECL = join(ROOT, 'evidence', 'attrib-expected.json');

/**
 * A declaration is scoped to the baseline it was written against, as {baseline, changes}. Once the
 * branch merges, the baseline sha advances, the file's entries no longer describe anything, and a
 * naive reader would report every one as "declared but did not happen". So a declaration whose
 * baseline does not match the resolved one is STALE and is ignored, leaving the strict check in
 * force. That is the safe direction: a stale file can never excuse a change, only fail to excuse
 * one.
 */
export function activeDeclarations(decl, baselineSha) {
  if (!decl) return { changes: [], stale: false };
  if (Array.isArray(decl)) return { changes: decl, stale: false };   // bare array: always active
  if (decl.baseline && baselineSha && decl.baseline !== baselineSha) {
    return { changes: [], stale: true, was: decl.baseline };
  }
  return { changes: decl.changes || [], stale: false };
}

function run(argv) {
  const bi = argv.indexOf('--baseline');
  const ref = bi > -1 ? argv[bi + 1] : 'main';
  const ei = argv.indexOf('--expect');
  const declPath = ei > -1 ? argv[ei + 1] : (existsSync(DEFAULT_DECL) ? DEFAULT_DECL : null);
  const rawDecl = declPath ? JSON.parse(readFileSync(declPath, 'utf8')) : null;

  /**
   * `git rev-parse <an existing file>` exits 0 and echoes the PATH rather than resolving a
   * revision, so a path baseline used to yield a non-sha "baselineSha" that never matched a
   * declaration and silently forced the STALE branch. Accept only a real 40-hex object id.
   */
  let baselineSha = null;
  try {
    const out = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8', cwd: ROOT }).trim();
    if (/^[0-9a-f]{40}$/.test(out)) baselineSha = out;
  } catch { /* baseline given as a path */ }
  if (!baselineSha && rawDecl && !Array.isArray(rawDecl) && rawDecl.baseline) {
    console.error(`FAIL  ${ref} does not resolve to a commit, so the declaration's baseline cannot be`);
    console.error('      checked. Pass a revision, or use --expect with a bare array declaration.');
    return 1;
  }
  const { changes: declared, stale, was } = activeDeclarations(rawDecl, baselineSha);
  if (stale) {
    console.log(`note: ${declPath} declares against baseline ${was.slice(0, 12)} but ${ref} is ${baselineSha.slice(0, 12)};`);
    console.log('      the declaration is STALE and is being ignored, so the strict check applies.');
  }

  const sync = assertRegexInSync();
  if (!sync.ok) { console.error(`FAIL  ${sync.why}`); return 1; }

  const { changes, collisions, matched, unpaired } =
    compare(parse(loadBaseline(ref)), parse(readFileSync(join(ROOT, LEDGER), 'utf8')));

  let bad = 0;
  for (const c of collisions) {
    console.error(`FAIL  baseline records ${c.a} and ${c.b} share substance hash ${c.hash}; pairing is ambiguous`);
    bad++;
  }

  const { undeclared, missing, mismatched, incomplete } = reconcile(changes, declared || []);
  for (const r of undeclared) {
    console.error(`FAIL  ${r.id}  ${r.key} changed while the substance did not, and no declaration covers it`);
    console.error(`        was ${r.was}`);
    console.error(`        now ${r.now}`);
    if (r.was_id !== r.id) console.error(`        (baseline id was ${r.was_id}; renumbering alone is fine)`);
    bad++;
  }
  for (const d of missing) { console.error(`FAIL  ${d.id} declares a ${d.key} change that did not happen`); bad++; }
  for (const m of mismatched) { console.error(`FAIL  ${m.id} ${m.key} declared ${m.declared} but observed ${m.observed}`); bad++; }
  for (const d of incomplete) {
    console.error(`FAIL  ${d.id} ${d.key} is declared with no "to" value, so it would excuse ANY value`);
    console.error('        state the expected value; omission is not a wildcard');
    bad++;
  }

  if (!bad) {
    // Say only what was actually tested. The earlier wording claimed "applied exactly as declared"
    // even when the declaration was stale and ignored, or carried no value to compare against.
    const dec = changes.length
      ? `, ${changes.length} declared change(s) each matching its stated value`
      : ', no attribution changed';
    console.log(`PASS  ${matched} claim(s) paired by substance against ${ref}${dec}; ${unpaired.length} genuinely new.`);
  } else {
    console.error(`\n${bad} attribution finding(s). No other gate can see these.`);
  }
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
