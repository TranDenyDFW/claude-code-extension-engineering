#!/usr/bin/env node
/**
 * COLLISION CHECK: a reference file whose NAME matches an official page about a
 * DIFFERENT subject must say so, and a new such collision must not be introducible
 * silently.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured on the 2026-08-13 LT benchmark. A searcher asked "how to monitor claude
 * code". This library's `monitors.md` was opened and read, and the answer described a
 * plugin-declared shell command whose stdout reaches the model. Every fact in it was
 * true. The asker meant OpenTelemetry, which lives in the official `monitoring-usage`
 * page and appears in ZERO files here. The answer scored 0 of 6 on every rubric
 * dimension.
 *
 * The thing worth naming: retrieval REPORTED NO PROBLEM, because mechanically nothing
 * had gone wrong. A gap would have scored better than the hit, since a model with
 * nothing loaded might have reached OpenTelemetry from training. That is the failure
 * mode this gate exists for, and it is invisible to every other gate in this
 * repository: quote-check proves the words are upstream, the suite proves the content
 * is present, and both are satisfied by a file that answers the wrong question well.
 *
 * DETECTION IS OVER-BROAD; CORROBORATION IS ONE-DIRECTIONAL, AND THAT IS MEASURED
 * -------------------------------------------------------------------------------
 * Flagging is cheap and lossy: normalised slug or title equality, or a prefix
 * relation. That over-flags on purpose, and a human then picks one of three verdicts.
 *
 * The design intent was to corroborate BOTH verdicts against shared STRUCTURED
 * IDENTIFIERS (env vars, dotted config paths, camelCase keys; bare backticked English
 * excluded, because `decision`, `timeout` and `description` co-occur in any two pages
 * about anything). That intent did not survive measurement, and the failure is recorded
 * here rather than tuned away. Shared identifiers as a fraction of the extension file's
 * own, on the real corpora:
 *
 *   sessions    <> sessions            1.00  14/14   same subject
 *   statusline  <> statusline          1.00  20/20   same subject
 *   sandboxing  <> sandboxing          1.00  14/14   same subject
 *   channels    <> channels-reference  0.91  10/11   same subject
 *   hooks       <> hooks               0.50   1/2    same subject
 *   permissions <> permission-modes    0.33   2/6    DIFFERENT subject
 *   permissions <> permissions         0.17   1/6    same subject
 *   sandboxing  <> sandbox-environments 0.07  1/14   DIFFERENT subject
 *   workflows   <> workflows           0.00   0/3    same subject
 *   monitors    <> monitoring-usage    0.00   0/14   DIFFERENT subject
 *   subagents   <> sub-agents           n/a   0/0    same subject
 *
 * Read the middle of that table. `permissions.md` shares MORE with the different-subject
 * `permission-modes` page (2) than with the same-subject `permissions` page (1), because
 * the modes page mentions `permissions.allow` in passing. The signal INVERTS on exactly
 * the pair it would need to separate, and several same-subject pairs share nothing at
 * all because this library writes its identifiers in tables rather than backticks.
 *
 * So the rule is asymmetric, and only in the direction the data supports:
 *
 *   A HIGH ratio REFUTES "different subject". Nothing refutes "same subject".
 *
 * No different-subject pair was observed above 0.33 and no pair at all was observed
 * between 0.50 and 0.91, so the threshold sits at 0.75 in an empty band, with a minimum
 * denominator so a 1-of-2 file cannot drive it. Everything else is REPORTED as evidence
 * beside the verdict for whoever reviews the diff, and asserts nothing on its own.
 * A gate that guessed in both directions here would have mis-declared the permissions
 * pair, which is one of the six collisions this whole change exists to fix.
 *
 * FALSE-POSITIVE POSTURE, STATED
 * ------------------------------
 * Tuned for recall. A false positive costs one ledger line with a verdict and its
 * evidence, reviewed once, visible in a diff. A false negative costs another GQ-55.
 *
 *   node tools/collision-check.mjs              full detection (needs the docs mirror)
 *   node tools/collision-check.mjs --offline    ledger consistency only, CI-safe
 *   node tools/collision-check.mjs --mirror <d>
 *   node tools/collision-check.mjs --self-test  includes must-fail cases
 *   node tools/collision-check.mjs --json
 *
 * exit: 0 clean, 1 a code was raised, 2 cannot check (no mirror; the message says so)
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referenceDirs, skillDirs, stripSkillPrefix } from './skill-roots.mjs';
import { tmpdir } from 'node:os';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
/* Every skill's references. A collision that spans two of the four skills is the one that
   matters most after the split, and a single-rooted scan cannot see it at all. */
const REF_DIRS = referenceDirs(ROOT);
const REF_DIR = REF_DIRS[0] || join(ROOT, 'skills', 'claude-code-extension-engineering', 'references');
const LEDGER = join(ROOT, 'data', 'routing', 'collisions.json');
export const DEFAULT_MIRROR = 'P:/ClaudeExt/CCX-Extension-Research/sources/docs/md';

export const VERDICTS = ['same-subject', 'different-subject', 'unrelated-prefix'];

/**
 * Lowercase, drop non-alphanumerics, drop a trailing plural or gerund. `monitors` and
 * `monitoring-usage` must NOT normalise to the same string, or the prefix rule below
 * would have nothing left to catch. They meet at `monitor` vs `monitoringusage`, which
 * is a prefix relation, which is exactly the weaker signal that should flag and then be
 * adjudicated rather than decided here.
 */
export function normalizeSlug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies|es|s|ing)$/, '');
}

/**
 * A structured identifier is something a reader could TYPE into a config file. Bare
 * English in backticks is not one, and admitting it is what would make this gate
 * useless: `decision`, `timeout` and `description` are the three raw hits shared by
 * monitors.md and monitoring-usage.md, and counting them would have declared the one
 * confirmed different-subject pair "same subject".
 */
export function structuredIdentifiers(text) {
  const out = new Set();
  const spans = String(text).match(/`[^`\n]{2,80}`/g) || [];
  for (const raw of spans) {
    const s = raw.slice(1, -1).trim();
    if (!s) continue;
    // env var: SCREAMING_SNAKE with at least one underscore
    if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(s)) { out.add(s); continue; }
    // long flag
    if (/^--[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length > 4) { out.add(s); continue; }
    // dotted or slashed config path, at least one separator, no spaces
    if (/^[A-Za-z][A-Za-z0-9_]*([./][A-Za-z0-9_.-]+)+$/.test(s) && !/\s/.test(s)) { out.add(s); continue; }
    // camelCase key: lower start, at least one interior capital, no separators
    if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(s)) { out.add(s); continue; }
  }
  return out;
}

export function titleOf(text) {
  const m = String(text).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

/** Over-broad on purpose. Returns the RELATION so adjudication can use its strength. */
export function relate(extSlug, extTitle, docSlug, docTitle) {
  const es = normalizeSlug(extSlug); const ds = normalizeSlug(docSlug);
  const et = normalizeSlug(extTitle); const dt = normalizeSlug(docTitle);
  /* The mirror's own `parent__child.md` convention declares a subpage of one topic
     family. 25 of the 60 detected pairs are `agent-sdk.md` against `agent-sdk__*`, and
     demanding shared configuration between a parent reference and each of its 25
     subpages would flag the whole family as uncorroborated. The naming IS the
     corroboration there, exactly as an identical slug is. Checked before the slug rules
     because `agentsdk` is also a prefix of `agentsdkhooks`, and the weaker answer would
     otherwise win. */
  if (String(docSlug).includes('__') && normalizeSlug(String(docSlug).split('__')[0]) === es) return 'subpage-of';
  if (es && es === ds) return 'exact-slug';
  if (et && et === dt) return 'exact-title';
  const pfx = (a, b) => a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a));
  if (pfx(es, ds)) return 'prefix-slug';
  if (et && dt && pfx(et, dt)) return 'prefix-title';
  /* SUFFIX and interior containment, which a prefix rule misses. Measured: this adds 9
     pairs over the whole corpus, one of which is `workflows` against `common-workflows`,
     a confirmed collision that a prefix rule cannot see. Nine adjudications is a fair
     price for it. */
  if (es.length >= 6 && ds.includes(es)) return 'substring';
  if (ds.length >= 6 && es.includes(ds)) return 'substring';
  /* SHARED LEADING TOKEN, the weakest signal admitted, and the only one that reaches
     `context-modes` against `context-window`. Unfiltered it adds 13 pairs, of which 11
     are `claude-md-family` against every `claude-*` page, because the product name is
     not a topic. With the product name excluded it adds exactly 2. The stoplist is the
     whole reason this rule is affordable, so it is named rather than tuned. */
  const lead = (s) => { const t = String(s).split(/[-_]/)[0].toLowerCase(); return t.length >= 6 && !LEAD_STOPLIST.has(t) ? t : null; };
  const el = lead(extSlug);
  if (el && el === lead(docSlug)) return 'shared-lead';
  return null;
}

/** Words that name the product rather than a topic, so sharing one means nothing. */
export const LEAD_STOPLIST = new Set(['claude', 'anthropic']);

export const pairKey = (ext, doc) => `${ext}<>${doc}`;

/**
 * The pointer must live in a DECLARED disambiguation section, not anywhere in the file.
 *
 * The first version of this gate searched the whole file for the official slug, and
 * `context-modes.md` passed on the phrase "the parent context-window size" in an
 * unrelated bullet at line 20. An incidental prose mention is not a redirect: a reader
 * who lands on the wrong file is not helped by the right page's name appearing in a
 * parenthetical 20 lines down. A gate satisfied by an accident is a gate that will be
 * satisfied by an accident again.
 *
 * The convention is the one `safety-classifier.md:19` already uses, so this codifies
 * existing house style rather than inventing a format: an H2 beginning "Read this
 * first". The section runs to the next heading of any level.
 */
export const DISAMBIGUATION_HEADING = /^##\s+Read this first\b/i;

export function disambiguationSection(text) {
  const lines = String(text).split('\n');
  const start = lines.findIndex((l) => DISAMBIGUATION_HEADING.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l));
  return rest.slice(0, end < 0 ? rest.length : end).join('\n');
}

/** Does the extension file redirect to this official page, in a place that counts? */
export function pointsAt(extText, officialFile) {
  const section = disambiguationSection(extText);
  if (!section) return false;
  const slug = String(officialFile).replace(/\.md$/, '');
  return new RegExp(`\\b${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(section);
}

/**
 * The whole judgement, in one pure function so the self-test can drive it without a
 * corpus. `entry` is the ledger row or undefined; `overlap` is the shared structured
 * identifier count; `extText` is the extension file, for the disambiguation check.
 */
export const REFUTE_RATIO = 0.75;   // no different-subject pair observed above 0.33
export const REFUTE_MIN_IDS = 4;    // so a 1-of-2 file cannot drive the ratio

export function adjudicate({ doc, relation, entry, overlap, extIdCount = 0, extText }) {
  const codes = [];
  if (!entry) {
    codes.push('COLLISION_UNDECLARED');
    return codes;
  }
  if (!VERDICTS.includes(entry.verdict)) {
    codes.push('COLLISION_UNKNOWN_VERDICT');
    return codes;
  }
  const exactSlug = relation === 'exact-slug';
  const ratio = extIdCount ? overlap / extIdCount : 0;
  const stronglyShared = extIdCount >= REFUTE_MIN_IDS && ratio >= REFUTE_RATIO;

  if (entry.verdict === 'different-subject') {
    /* The ONE direction the measurement supports. A low ratio is silent: same-subject
       pairs sit at 0.00 too, so absence of shared configuration is not evidence of
       anything. See the table in the file header. */
    if (stronglyShared) codes.push('VERDICT_UNCORROBORATED');
    /* An identical slug pointing at a different subject is not adjudicable. No
       disambiguation header rescues a filename that IS the official page's name; the
       remedy is to rename the file, so it gets its own code rather than being folded
       into the generic one. */
    if (exactSlug) codes.push('COLLISION_EXACT_SLUG_DIFFERENT_SUBJECT');
    // The pointer is the entire point of declaring a collision.
    if (!pointsAt(extText || '', doc)) codes.push('COLLISION_NO_DISAMBIGUATION');
  } else if (entry.verdict === 'unrelated-prefix') {
    /* Same one-directional logic: heavy shared configuration refutes "unrelated", while
       sharing nothing is consistent with both "unrelated" and "same subject". */
    if (stronglyShared || exactSlug) codes.push('VERDICT_UNCORROBORATED');
  }
  /* Deliberately no rule for `same-subject`. Measured: workflows, subagents, mcp, skills
     and output-styles all share ZERO structured identifiers with their same-subject
     official page, because this library writes identifiers in tables rather than in
     backticked spans. A gate demanding overlap there would fire on five true rows and
     teach whoever reads it to stop believing the gate. */
  return codes;
}

// ------------------------------------------------------------------------ runner

/**
 * A MISSING ledger is a failure, not an empty one.
 *
 * This returned `{ pairs: [] }` for a missing path, so deleting
 * `data/routing/collisions.json` made the offline gate pass with zero problems while
 * corrupting the same file correctly raised LEDGER_UNPARSEABLE. An independent reviewer
 * measured it: `checkOffline('does-not-exist.json', refs)` returned 0 problems, exit 0.
 *
 * That matters more than it looks. The ledger is a new file, `--offline` is the CI-safe
 * variant that runs without the uncommitted mirror, and a bad merge or a .gitignore mistake
 * drops a file far more often than it corrupts one. The full run would still catch it via
 * COLLISION_UNDECLARED on all 72 pairs, but only where the mirror exists.
 */
function loadLedger(path = LEDGER) {
  if (!existsSync(path)) return { pairs: [], _missing: true };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { pairs: [], _parseError: e.message }; }
}

export function checkOffline(ledgerPath = LEDGER, refDir = REF_DIR) {
  const problems = [];
  const led = loadLedger(ledgerPath);
  if (led._missing) return [{ code: 'LEDGER_MISSING', detail: `no adjudication ledger at ${ledgerPath}; an absent ledger is a failure, not an empty one` }];
  if (led._parseError) return [{ code: 'LEDGER_UNPARSEABLE', detail: led._parseError }];
  const seen = new Set();
  for (const p of led.pairs || []) {
    const k = pairKey(p.extension, p.official);
    if (seen.has(k)) problems.push({ code: 'LEDGER_DUPLICATE_PAIR', detail: k });
    seen.add(k);
    if (!VERDICTS.includes(p.verdict)) problems.push({ code: 'COLLISION_UNKNOWN_VERDICT', detail: `${k} -> ${p.verdict}` });
    /* Search EVERY skill's references. p.extension names a file, and after the split that file
       lives in exactly one of four directories: joining it to one of them resolves a quarter of
       the time and reports nothing for the rest, which reads exactly like "no collision". */
    const f = [refDir, ...REF_DIRS].map((d) => join(d, p.extension)).find((x) => existsSync(x))
      || join(refDir, p.extension);
    if (!existsSync(f)) { problems.push({ code: 'LEDGER_EXT_FILE_MISSING', detail: p.extension }); continue; }
    if (p.verdict === 'different-subject' && !pointsAt(readFileSync(f, 'utf8'), p.official)) {
      problems.push({ code: 'COLLISION_NO_DISAMBIGUATION', key: k, detail: `${p.extension} has no "Read this first" section naming ${String(p.official).replace(/\.md$/, '')}` });
    }
  }
  return problems;
}

export function checkFull({ mirror, ledgerPath = LEDGER, refDir = REF_DIR }) {
  const led = loadLedger(ledgerPath);
  if (led._missing) return { problems: [{ code: 'LEDGER_MISSING', detail: `no adjudication ledger at ${ledgerPath}` }], detected: [] };
  if (led._parseError) return { problems: [{ code: 'LEDGER_UNPARSEABLE', detail: led._parseError }], detected: [] };
  const byKey = new Map((led.pairs || []).map((p) => [pairKey(p.extension, p.official), p]));

  const extFiles = readdirSync(refDir).filter((f) => f.endsWith('.md'));
  const docFiles = readdirSync(mirror).filter((f) => f.endsWith('.md'));
  const extText = new Map(extFiles.map((f) => [f, readFileSync(join(refDir, f), 'utf8')]));
  const docText = new Map(docFiles.map((f) => [f, readFileSync(join(mirror, f), 'utf8')]));
  const extIds = new Map([...extText].map(([f, t]) => [f, structuredIdentifiers(t)]));
  const docIds = new Map([...docText].map(([f, t]) => [f, structuredIdentifiers(t)]));

  const problems = [];
  const detected = [];
  for (const ef of extFiles) {
    if (ef === 'INDEX.md') continue;
    const eStem = basename(ef, '.md');
    const eTitle = titleOf(extText.get(ef));
    for (const df of docFiles) {
      const dStem = basename(df, '.md');
      const relation = relate(eStem, eTitle, dStem, titleOf(docText.get(df)));
      if (!relation) continue;
      const a = extIds.get(ef); const b = docIds.get(df);
      let overlap = 0; for (const id of a) if (b.has(id)) overlap++;
      const key = pairKey(ef, df);
      const entry = byKey.get(key);
      const ratio = a.size ? overlap / a.size : null;
      detected.push({ ext: ef, doc: df, relation, overlap, extIds: a.size, ratio, verdict: entry?.verdict || null });
      for (const code of adjudicate({ doc: df, relation, entry, overlap, extIdCount: a.size, extText: extText.get(ef) })) {
        problems.push({ code, key, detail: `${key} (relation ${relation}, ${overlap}/${a.size} shared structured identifiers)` });
      }
      byKey.delete(key);
    }
  }
  /* A ledger row nobody detects any more is not harmless: it is a dead adjudication
     that would mask the pair being re-introduced under the same name later. */
  for (const [k] of byKey) problems.push({ code: 'COLLISION_STALE', detail: `${k} is adjudicated but no longer detected` });
  return { problems, detected };
}

// --------------------------------------------------------------------- self-test

function selfTest() {
  let fails = 0;
  const ok = (n, c, d) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d || ''})`}`); if (!c) fails++; };

  ok('normalizeSlug folds case, punctuation and a trailing plural',
    normalizeSlug('Agent-Teams') === 'agentteam' && normalizeSlug('agent_teams') === 'agentteam');
  ok('MUST NOT fold monitors onto monitoring-usage, or the prefix rule has nothing to catch',
    normalizeSlug('monitors') !== normalizeSlug('monitoring-usage'));

  const ids = structuredIdentifiers('see `CLAUDE_CODE_ENABLE_TELEMETRY` and `sandbox.failIfUnavailable` and `allowUnsandboxedCommands` and `--dangerously-skip-permissions`');
  ok('extracts env vars, dotted paths, camelCase keys and long flags', ids.size === 4);
  const noise = structuredIdentifiers('the `decision` field, a `timeout`, its `description`');
  ok('MUST NOT count bare backticked English as a structured identifier, which is what makes the monitors pair measurable',
    noise.size === 0, [...noise].join(','));

  ok('an identical stem is an exact-slug relation', relate('hooks', 'Hooks', 'hooks', 'Hooks') === 'exact-slug');
  /* The real pair relates by TITLE equality, not slug: "Monitors" and "Monitoring" both
     normalise to `monitor`, while the slugs `monitor` and `monitoringusage` do not. That
     matters for the remedy. An exact SLUG match is unfixable by a header and demands a
     rename; an exact title match is exactly what a disambiguation header is for. */
  ok('the real monitors pair relates by title, and NOT by slug, so a header is the right remedy',
    relate('monitors', 'Monitors', 'monitoring-usage', 'Monitoring') === 'exact-title'
    && normalizeSlug('monitors') !== normalizeSlug('monitoring-usage'));
  ok('a genuine prefix-only relation is still caught', relate('sandboxing', 'Sandboxing', 'sandbox-environments', 'Sandbox environments') === 'prefix-slug');
  ok('the mirror subpage convention is recognised as one family', relate('agent-sdk', 'Agent SDK', 'agent-sdk__observability', 'Observability') === 'subpage-of');
  ok('MUST NOT let the weaker prefix answer win over the subpage relation',
    relate('agent-sdk', 'Agent SDK', 'agent-sdk__hooks', 'Hooks') === 'subpage-of');
  ok('unrelated names do not relate', relate('themes', 'Custom Themes', 'costs', 'Costs') === null);

  const base = { doc: 'monitoring-usage.md', relation: 'exact-title' };
  ok('MUST FLAG a detected pair absent from the ledger, which is the cannot-be-introduced-silently property',
    adjudicate({ ...base, entry: undefined, overlap: 0, extIdCount: 14, extText: '' }).includes('COLLISION_UNDECLARED'));
  ok('MUST REFUTE different-subject when the pages configure nearly all the same things',
    adjudicate({ ...base, entry: { verdict: 'different-subject' }, overlap: 14, extIdCount: 14, extText: 'monitoring-usage' }).includes('VERDICT_UNCORROBORATED'));
  /* The measured inversion, frozen as a test. permissions.md shares 2 of its 6 with the
     DIFFERENT-subject permission-modes page and 1 of 6 with the SAME-subject one, so a
     gate refuting on a low ratio would mis-declare a real collision. */
  ok('MUST NOT refute different-subject at the observed permissions ratio (2 of 6), the pair where the signal inverts',
    !adjudicate({ doc: 'permission-modes.md', relation: 'prefix-slug', entry: { verdict: 'different-subject' }, overlap: 2, extIdCount: 6, extText: 'permission-modes' }).includes('VERDICT_UNCORROBORATED'));
  ok('MUST NOT let a 1-of-2 file reach the refute threshold on ratio alone',
    !adjudicate({ ...base, entry: { verdict: 'different-subject' }, overlap: 1, extIdCount: 2, extText: 'monitoring-usage' }).includes('VERDICT_UNCORROBORATED'));
  ok('MUST FLAG different-subject with no pointer in the extension file',
    adjudicate({ ...base, entry: { verdict: 'different-subject' }, overlap: 0, extIdCount: 14, extText: 'nothing here' }).includes('COLLISION_NO_DISAMBIGUATION'));
  ok('a correctly declared and pointed different-subject pair is clean',
    adjudicate({ ...base, entry: { verdict: 'different-subject' }, overlap: 0, extIdCount: 14, extText: '## Read this first: not monitoring\n\nsee monitoring-usage for telemetry\n' }).length === 0);
  /* The false pass this gate actually shipped with for one iteration. context-modes.md
     line 20 says "the parent context-window size" in an unrelated bullet, and a
     whole-file search accepted that as a redirect. Frozen so it cannot come back. */
  ok('MUST NOT accept an incidental prose mention outside a declared section as a pointer',
    adjudicate({ doc: 'context-window.md', relation: 'shared-lead', entry: { verdict: 'different-subject' }, overlap: 0, extIdCount: 3, extText: '# Context modes\n\n- Starting context: ... but NOT the parent context-window size ...\n' })
      .includes('COLLISION_NO_DISAMBIGUATION'));
  ok('the pointer is found when it sits inside the declared section',
    pointsAt('# X\n\n## Read this first: this is not the token budget\n\n- see context-window for compaction\n', 'context-window.md'));
  ok('MUST NOT find a pointer that sits AFTER the section ends',
    !pointsAt('# X\n\n## Read this first: something\n\n- nothing here\n\n## Later\n\nsee context-window\n', 'context-window.md'));
  ok('MUST demand a RENAME, not a header, when the slug is identical and the subject is not',
    adjudicate({ doc: 'hooks.md', relation: 'exact-slug', entry: { verdict: 'different-subject' }, overlap: 0, extIdCount: 2, extText: 'hooks' })
      .includes('COLLISION_EXACT_SLUG_DIFFERENT_SUBJECT'));
  ok('MUST REJECT a verdict outside the vocabulary rather than ignoring the row',
    adjudicate({ ...base, entry: { verdict: 'probably-fine' }, overlap: 0, extIdCount: 14, extText: '' }).includes('COLLISION_UNKNOWN_VERDICT'));
  /* The five true same-subject rows that share nothing. A gate demanding overlap here
     would fire on all five and teach whoever reads it to stop believing the gate. */
  for (const f of ['workflows.md', 'subagents.md', 'mcp.md', 'skills.md', 'output-styles.md']) {
    ok(`same-subject asserts nothing about overlap, so ${f} sharing zero stays clean`,
      adjudicate({ doc: f, relation: 'exact-slug', entry: { verdict: 'same-subject' }, overlap: 0, extIdCount: 0, extText: '' }).length === 0);
  }

  // offline gate, over a temp tree, including its must-fail cases
  const tmp = mkdtempSync(join(tmpdir(), 'ccx-collision-self-'));
  try {
    const refs = join(tmp, 'references');
    mkdirSync(refs, { recursive: true });
    writeFileSync(join(refs, 'monitors.md'), '# Monitors\n\n## Read this first: this is not monitoring\n\nnot telemetry, see monitoring-usage for that\n');
    const lp = join(tmp, 'ledger.json');
    writeFileSync(lp, JSON.stringify({ pairs: [{ extension: 'monitors.md', official: 'monitoring-usage.md', verdict: 'different-subject' }] }));
    ok('offline gate passes a well-formed ledger with its pointer present', checkOffline(lp, refs).length === 0);

    writeFileSync(join(refs, 'monitors.md'), '# Monitors\n\nno pointer at all\n');
    ok('MUST FAIL offline: the pointer was deleted from the extension file',
      checkOffline(lp, refs).some((p) => p.code === 'COLLISION_NO_DISAMBIGUATION'));

    writeFileSync(lp, JSON.stringify({ pairs: [{ extension: 'ghost.md', official: 'x.md', verdict: 'same-subject' }] }));
    ok('MUST FAIL offline: a ledger row naming a file that does not exist',
      checkOffline(lp, refs).some((p) => p.code === 'LEDGER_EXT_FILE_MISSING'));

    writeFileSync(lp, '{ not json');
    ok('MUST FAIL offline: an unparseable ledger is a failure, never a silent empty list',
      checkOffline(lp, refs).some((p) => p.code === 'LEDGER_UNPARSEABLE'));

    /* Found by an independent reviewer, 2026-08-13: corruption was guarded and ABSENCE was
       not, so deleting the ledger made the CI-safe variant pass with zero problems. A
       missing file is the likelier accident of the two. */
    ok('MUST FAIL offline: a DELETED ledger is a failure, not an empty one',
      checkOffline(join(tmp, 'no-such-ledger.json'), refs).some((p) => p.code === 'LEDGER_MISSING'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${fails ? `SELF-TEST FAIL: ${fails}` : 'SELF-TEST PASS'}`);
  return fails ? 1 : 0;
}

// ------------------------------------------------------------------------- main

if (IS_MAIN) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());

  const asJson = argv.includes('--json');
  if (argv.includes('--offline')) {
    const problems = checkOffline();
    if (asJson) console.log(JSON.stringify({ mode: 'offline', problems }, null, 2));
    else if (problems.length) for (const p of problems) console.log(`${p.code}  ${p.detail}`);
    else console.log('COLLISIONS OK (offline): the ledger is well formed and every different-subject row carries its pointer.');
    process.exit(problems.length ? 1 : 0);
  }

  const mi = argv.indexOf('--mirror');
  const mirror = mi >= 0 ? argv[mi + 1] : DEFAULT_MIRROR;
  if (!existsSync(mirror)) {
    console.log('CANNOT CHECK: the docs mirror is not committed (copyright), so this gate needs one locally.');
    console.log(`  looked in ${mirror}`);
    console.log('  run with --offline for the ledger-consistency half, which needs no mirror.');
    process.exit(2);
  }
  const { problems, detected } = checkFull({ mirror });
  /* The offline half re-checks the same rows, so dedupe on (code, pair) rather than on
     the detail string: the two halves word the same finding differently, and a
     detail-string dedupe let every pointer problem print twice. */
  const offline = checkOffline();
  const seen = new Set(problems.map((p) => `${p.code}|${p.key || p.detail}`));
  const all = [...problems];
  for (const o of offline) { const k = `${o.code}|${o.key || o.detail}`; if (!seen.has(k)) { seen.add(k); all.push(o); } }
  if (asJson) { console.log(JSON.stringify({ mirror, detected, problems: all }, null, 2)); process.exit(all.length ? 1 : 0); }

  const adjudicated = detected.filter((d) => d.verdict).length;
  /* Report the split. "72 adjudicated" reads as 72 human judgments, and it is not: the
     subpage family is corroborated by the mirror's own naming convention, so those rows
     took no judgment at all. A number without its denominator overstates the work behind
     it, which an independent reviewer flagged on exactly this line. */
  const byName = detected.filter((d) => d.relation === 'subpage-of' || d.relation === 'exact-slug').length;
  const judged = detected.length - byName;
  const split = `${judged} needed a judgment call, ${byName} corroborated by naming convention (identical slug or the mirror's parent__child form)`;
  if (all.length) {
    for (const p of all) console.log(`${p.code}  ${p.detail}`);
    console.log(`\nCOLLISIONS FAIL: ${detected.length} pairs detected, ${adjudicated} adjudicated, ${all.length} problem(s).`);
    console.log(`  of the ${detected.length}: ${split}`);
    process.exit(1);
  }
  console.log(`COLLISIONS OK: ${detected.length} pairs detected, ${adjudicated} adjudicated, 0 uncorroborated.`);
  console.log(`  of the ${detected.length}: ${split}`);
  process.exit(0);
}
