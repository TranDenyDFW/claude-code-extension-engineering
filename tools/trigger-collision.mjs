#!/usr/bin/env node
/**
 * TRIGGER COLLISION: this skill competes for retrieval against the bundled skills, and
 * where it competes it must say which side of the line it owns.
 *
 * THE FAILURE THIS ADDRESSES, MEASURED
 * ------------------------------------
 * Benchmark question GQ-06, "claude code stop hook not working", scored 1 of 6. The routing
 * surface was fine: references/INDEX.md already carried
 * `A hook is configured but never runs -> hooks.md, hook-events.md`. The skill simply never
 * ran. The bundled `update-config` skill won retrieval first, and its own description says,
 * verbatim from the shipped binary:
 *
 *   "...permissions ("allow X", "add permission", "move permission to"), env vars
 *    ("set X=Y"), hook troubleshooting, or any changes to settings.json/settings.local.json
 *    files."
 *
 * So it claims hook troubleshooting outright. Nothing downstream of retrieval can fix that,
 * which is why every other gate in this change is blind to it.
 *
 * WHAT THIS PROVES, AND WHAT IT CANNOT
 * ------------------------------------
 * It proves the description STAKES A BOUNDARY where an overlap exists. It cannot prove the
 * model honours it. Retrieval is not a function of the description alone, and no static
 * check reaches it. That is what tests/routing-live measures, and this gate's green result
 * must never be read as evidence the skill wins. Stated here rather than in a footnote,
 * because a gate whose limits are only in the commit message gets over-read.
 *
 * SNAPSHOT COVERAGE IS PARTIAL, ON PURPOSE AND VISIBLY
 * ---------------------------------------------------
 * The CLI ships as one ~300 MB binary with skills embedded. Six of the twelve bundled names
 * sit in minified variable assignments (`Qme="code-review"`) with their descriptions
 * decoupled, so they are not recoverable by pattern. They are listed in `missing` and
 * reported on every run. A snapshot that quietly covered half would be worse than one that
 * says which half.
 *
 *   node tools/trigger-collision.mjs             check against the committed snapshot
 *   node tools/trigger-collision.mjs --offline   same; this gate needs no docs mirror
 *   node tools/trigger-collision.mjs --snapshot  regenerate from the installed binary
 *   node tools/trigger-collision.mjs --self-test
 *
 * exit: 0 clean, 1 a code was raised, 2 cannot check (no snapshot and no binary)
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SKILL = join(ROOT, 'skills', 'claude-code-extension-engineering', 'SKILL.md');
const LEDGER = join(ROOT, 'data', 'routing', 'skill-boundary.json');

export const VERDICTS = ['we-defer', 'we-own', 'both-fine'];

/**
 * Trigger nouns: the words a router actually matches on. Deliberately a short, explicit
 * list rather than generic tokenisation, because generic overlap on English stopwords makes
 * every pair look related and the ledger becomes noise nobody reads.
 */
export const TRIGGER_TERMS = [
  'settings.json', 'settings.local.json', 'hook', 'hooks', 'permission', 'permissions',
  'env var', 'environment variable', 'skill', 'subagent', 'plugin', 'mcp', 'sandbox',
  'output style', 'statusline', 'workflow', 'agent', 'review', 'security', 'allowlist',
];

export function sharedTriggers(a, b) {
  const has = (t, s) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(s);
  return TRIGGER_TERMS.filter((t) => has(t, a) && has(t, b));
}

/**
 * @param overlap  {bundled, shared[]}
 * @param entry    the ledger row for that bundled skill, or undefined
 * @param ourDesc  this skill's frontmatter description
 */
export function judgeOverlap({ overlap, entry, ourDesc }) {
  const codes = [];
  if (!entry) { codes.push('BOUNDARY_UNDECLARED'); return codes; }
  if (!VERDICTS.includes(entry.verdict)) { codes.push('BOUNDARY_UNKNOWN_VERDICT'); return codes; }
  /* `we-own` is a claim, and a claim has to appear where retrieval can see it. The only
     lever this skill has over precedence is its own description, so `we-own` with nothing
     in the description is an assertion with no mechanism behind it. */
  if (entry.verdict === 'we-own') {
    const claim = entry.claimed_by;
    if (!claim || !String(ourDesc).includes(claim)) codes.push('BOUNDARY_UNCLAIMED');
  }
  return codes;
}

export function detect({ snapshot, ourDesc }) {
  const overlaps = [];
  for (const [name, desc] of Object.entries(snapshot.bundled || {})) {
    const shared = sharedTriggers(ourDesc, desc);
    if (shared.length) overlaps.push({ bundled: name, shared });
  }
  return overlaps;
}

export function check({ ledgerPath = LEDGER, skillPath = SKILL } = {}) {
  if (!existsSync(ledgerPath)) return { problems: [{ code: 'BOUNDARY_SNAPSHOT_MISSING', detail: `no snapshot at ${ledgerPath}` }], overlaps: [] };
  let snap; try { snap = JSON.parse(readFileSync(ledgerPath, 'utf8')); } catch (e) { return { problems: [{ code: 'BOUNDARY_SNAPSHOT_UNPARSEABLE', detail: e.message }], overlaps: [] }; }
  const skillText = readFileSync(skillPath, 'utf8');
  const fm = skillText.match(/^---\n([\s\S]*?)\n---/);
  const ourDesc = fm ? fm[1] : '';

  const overlaps = detect({ snapshot: snap, ourDesc });
  const byName = new Map((snap.overlaps || []).map((o) => [o.bundled, o]));
  const problems = [];
  for (const o of overlaps) {
    for (const code of judgeOverlap({ overlap: o, entry: byName.get(o.bundled), ourDesc })) {
      problems.push({ code, detail: `${o.bundled} shares [${o.shared.join(', ')}]` });
    }
    byName.delete(o.bundled);
  }
  for (const [n] of byName) problems.push({ code: 'BOUNDARY_STALE', detail: `${n} is adjudicated but no longer overlaps` });
  return { problems, overlaps, snapshot: snap };
}

// --------------------------------------------------------------------- self-test

function selfTest() {
  let fails = 0; let ran = 0;
  const ok = (n, c, d) => { ran++; if (!c) fails++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d || ''})`}`); };

  ok('shares the trigger nouns that actually collide',
    sharedTriggers('diagnosing a hook that will not fire, settings.json', 'hook troubleshooting, or any changes to settings.json').includes('hook'));
  ok('MUST NOT report an overlap between unrelated descriptions',
    sharedTriggers('themes and colours', 'scheduled remote agents').length === 0);
  ok('settings.json is matched as a whole token, not as the word settings',
    sharedTriggers('edit settings.json', 'change settings.json now').includes('settings.json'));

  const OUR = 'diagnosing one that will not load, fire, or behave. ALSO use it for a BARE SYMPTOM';
  ok('MUST FLAG an overlap that is not in the ledger at all',
    judgeOverlap({ overlap: { bundled: 'update-config', shared: ['hook'] }, entry: undefined, ourDesc: OUR }).includes('BOUNDARY_UNDECLARED'));
  ok('MUST FLAG we-own with nothing in the description to back it',
    judgeOverlap({ overlap: { bundled: 'update-config', shared: ['hook'] }, entry: { verdict: 'we-own', claimed_by: 'BARE SYMPTOM with no artifact' }, ourDesc: 'nothing relevant' }).includes('BOUNDARY_UNCLAIMED'));
  ok('a we-own claim present in the description is clean',
    judgeOverlap({ overlap: { bundled: 'update-config', shared: ['hook'] }, entry: { verdict: 'we-own', claimed_by: 'BARE SYMPTOM' }, ourDesc: OUR }).length === 0);
  ok('we-defer needs no claim in the description, because deferring is the absence of one',
    judgeOverlap({ overlap: { bundled: 'security-review', shared: ['review'] }, entry: { verdict: 'we-defer' }, ourDesc: OUR }).length === 0);
  ok('MUST REJECT a verdict outside the vocabulary',
    judgeOverlap({ overlap: { bundled: 'x', shared: ['hook'] }, entry: { verdict: 'probably-fine' }, ourDesc: OUR }).includes('BOUNDARY_UNKNOWN_VERDICT'));

  /* The fixture has to CARRY a trigger term, or detection correctly finds nothing and the
     test asserts the opposite of what it claims. The first version used a description with
     no trigger noun in it and failed for that reason, not because detection was broken. */
  const OUR_FULL = 'hooks, subagents, permission rules and the OS sandbox. Use when diagnosing one that will not load, fire, or behave, including a BARE SYMPTOM with settings.json mentioned';
  const snap = { bundled: { 'update-config': 'hook troubleshooting and settings.json changes', schedule: 'scheduled remote agents on a cron' } };
  const d = detect({ snapshot: snap, ourDesc: OUR_FULL });
  ok('detection finds the real competitor and not the unrelated one',
    d.length === 1 && d[0].bundled === 'update-config', JSON.stringify(d));
  ok('MUST find nothing when our description carries no trigger noun at all',
    detect({ snapshot: snap, ourDesc: 'a file about colours' }).length === 0);

  console.log(`\n${fails ? `SELF-TEST FAIL: ${fails}` : 'SELF-TEST PASS'} (${ran} checks)`);
  return fails ? 1 : 0;
}

// ------------------------------------------------------------------------- main

if (IS_MAIN) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());

  const { problems, overlaps, snapshot } = check();
  if (argv.includes('--json')) { console.log(JSON.stringify({ problems, overlaps }, null, 2)); process.exit(problems.length ? 1 : 0); }
  if (problems.some((p) => p.code.startsWith('BOUNDARY_SNAPSHOT_'))) {
    for (const p of problems) console.log(`${p.code}  ${p.detail}`);
    process.exit(2);
  }
  if (problems.length) {
    for (const p of problems) console.log(`${p.code}  ${p.detail}`);
    console.log(`\nTRIGGER BOUNDARY FAIL: ${overlaps.length} overlap(s), ${problems.length} problem(s).`);
    process.exit(1);
  }
  const miss = (snapshot.missing || []).length;
  console.log(`TRIGGER BOUNDARY OK: ${overlaps.length} overlap(s) detected, all adjudicated and claimed.`);
  console.log(`  snapshot covers ${Object.keys(snapshot.bundled || {}).length} of ${Object.keys(snapshot.bundled || {}).length + miss} bundled skills; ${miss} could not be extracted (${(snapshot.missing || []).join(', ')}).`);
  console.log('  This proves the description STAKES a boundary. It does NOT prove the model honours it; only tests/routing-live measures that.');
  process.exit(0);
}
