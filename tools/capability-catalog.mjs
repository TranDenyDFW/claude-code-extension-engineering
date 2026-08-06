#!/usr/bin/env node
/**
 * capability-catalog.mjs - the versioned, evidence-carrying catalog of Claude Code
 * built-in tool names and hook-event names, generated from the official docs mirror.
 *
 * WHY THIS EXISTS
 * ---------------
 * extension-doctor.mjs shipped two hand-maintained Sets: HOOK_EVENTS (30 names) and
 * KNOWN_TOOLS (36 names). The docs list 43 tools and 31 hook events. The doctor was
 * missing 14 real tools (CronCreate, CronDelete, CronList, EndConversation,
 * EnterWorktree, ExitWorktree, LSP, PowerShell, PushNotification, RemoteTrigger,
 * ReportFindings, ScheduleWakeup, ShareOnboardingGuide, WaitForMcpServers) and one
 * real event (DirectoryAdded, hooks.md line 2462), while carrying 7 names the current
 * tools table does not list.
 *
 * The measured consequence: "tools: PowerShell" in a subagent was reported BROKEN by a
 * tool whose published headline is 12 of 12 with ZERO false positives. A hand-typed Set
 * has no provenance, no version, and no way to notice it went stale. This file replaces
 * it with a generated artifact where every name carries a citation, the whole body is
 * sealed with a sha256, and a drift gate can prove it still matches the docs.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a repair tool. --check reports drift and exits non-zero; it never rewrites
 * the committed catalog, because a gate that regenerates its own expected input cannot
 * fail twice. Regeneration is a separate, explicit flag (--from-mirror).
 *
 * PARSING TRAP (verified, see --self-test)
 * ----------------------------------------
 * A naive "every table row whose first cell is backticked" scan over tools-reference.md
 * returns 46 rows, not 43: it absorbs `WebSearch` again from the permission-rule table
 * under "## Configure tools with permission rules and hooks", and `url` plus `protocols`
 * from the WebSocket field table under "## Monitor tool". The parser here is
 * section-scoped: the canonical table is the one in the preamble (before the first "##")
 * whose header is "Tool | Description | Permission required". Same discipline for
 * hooks.md: only "###" headings inside "## Hook events", fence-aware, stopping at the
 * next "##".
 *
 * usage:
 *   node tools/capability-catalog.mjs                        same as --check-integrity
 *   node tools/capability-catalog.mjs --check-integrity      verify the committed catalog (no mirror needed, this is what CI runs)
 *   node tools/capability-catalog.mjs --check                drift vs the docs mirror (builds into a temp dir, never writes the catalog)
 *   node tools/capability-catalog.mjs --from-mirror <dir>    regenerate data/capabilities/catalog.json
 *   node tools/capability-catalog.mjs --self-test            includes must-fail cases
 *   node tools/capability-catalog.mjs --prove-fail           seven mutants, each must be rejected by a named gate
 *   flags: --out <path>  --json  --quiet
 *
 * exit: 0 pass, 1 fail, 2 cannot check (no mirror / no catalog on this machine)
 *
 * exported for tools/extension-doctor.mjs:
 *   loadCatalog(path?)              parse + verify, throws on a broken catalog
 *   currentNames(section, cat?)     Set of names whose status is "current"
 *   verifyCatalogIntegrity(cat)     -> { ok: boolean, errors: [{code, msg}] }   NOTE: an object, always truthy; test .ok
 *   cmpVersion(a, b)                numeric, so cmpVersion('2.1.9','2.1.220') < 0
 *   plus knownNames, statusOf, entryOf, citation, resetCatalogCache
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

export const REPO = resolve(HERE, '..');
export const CATALOG_PATH = join(REPO, 'data', 'capabilities', 'catalog.json');
export const VERSION_FILE = join(REPO, 'evidence', 'VERIFIED_VERSION');
export const BENCH_PATH = join(REPO, 'tests', 'lint-bench', 'results.json');
export const DEFAULT_MIRROR = process.env.CCX_DOCS_MIRROR
  || 'P:\\ClaudeExt\\CCX-Extension-Research\\sources\\docs\\md';

export const SCHEMA_VERSION = 1;
/** current: in the canonical tools table / hook-events section of the current docs.
 *  legacy:   the docs say it is a previous name or a legacy tool that is still accepted.
 *  historical: announced in the changelog, no coverage in any current reference page.
 *  sdk-only: documented only in the Agent SDK reference, with no legacy/alias statement.
 *  unlisted: zero occurrences anywhere in the mirror. Kept so a user is told, not alarmed. */
export const STATUSES = ['current', 'legacy', 'historical', 'sdk-only', 'unlisted'];
export const SECTIONS = ['tools', 'hookEvents'];
/** House rule: every doctor finding carries a citation string over 10 chars. */
export const MIN_CITATION = 10;

/** Pages this catalog reads. role drives nothing but reporting; provenance ids must be here. */
export const PRIMARY_PAGES = ['tools-reference.md', 'hooks.md'];
export const SUPPORTING_PAGES = [
  'permissions.md', 'errors.md', 'changelog.md',
  'agent-sdk__python.md', 'agent-sdk__typescript.md',
];
/** Synthetic source id for an assertion of ABSENCE. Its hash covers every mirrored page. */
export const MIRROR_INDEX_ID = 'mirror-index';
export const BENCH_ID = 'tests/lint-bench/results.json';

// ------------------------------------------------------------------ primitives --

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Deterministic JSON: object keys sorted recursively, arrays left in order, no whitespace. */
export function canonicalize(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
}

/** sha256 over the canonicalised body with the integrity field itself removed. */
export function computeIntegrity(cat) {
  const body = { ...cat };
  delete body.integrity;
  return sha256(Buffer.from(canonicalize(body), 'utf8'));
}

/** Same, minus the two fields that legitimately change on every rebuild. */
export function semanticFingerprint(cat) {
  const body = { ...cat };
  delete body.integrity;
  delete body.generated;
  delete body.generator;
  return sha256(Buffer.from(canonicalize(body), 'utf8'));
}

/**
 * Numeric version compare. String compare gets this backwards: '2.1.220' < '2.1.9'
 * lexicographically because '2' < '9' at the first differing char. The doctor uses this
 * to decide whether a name a user wrote exists yet on the build they are running, so
 * getting it backwards is a false positive generator, which is the bug we are here to kill.
 */
export function cmpVersion(a, b) {
  const parts = (s) => String(s === null || s === undefined ? '' : s)
    .split(/[^0-9]+/).filter((x) => x !== '').map(Number);
  const pa = parts(a);
  const pb = parts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] === undefined ? 0 : pa[i];
    const y = pb[i] === undefined ? 0 : pb[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** U+2010..U+2015 plus U+2212. Repo house rule bans them in anything we author, so a
 *  quote lifted out of a page that contains one is normalised, never copied verbatim. */
const DASH_FAMILY = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
export const QUOTE_POLICY = 'Quotes are markdown-link-flattened, whitespace-collapsed, '
  + 'truncated to 140 chars, and dash-family characters (U+2010..U+2015, U+2212) are replaced '
  + "with ' - ' per the repo house rule. For byte-verbatim text, read the cited line from the "
  + 'source whose sha256 is recorded in sources[].';

export function normalizeQuote(s, max = 140) {
  let t = String(s === null || s === undefined ? '' : s);
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');   // [text](url) -> text
  t = t.replace(DASH_FAMILY, ' - ').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 3).trimEnd() + '...';
  return t;
}

// ------------------------------------------------------------------ md parsing --

/**
 * Split markdown into sections at a heading level, ignoring headings inside code
 * fences. Section 0 is the preamble (everything before the first heading of that level).
 * Every retained line carries its 1-based file line number, which is what makes the
 * provenance in this catalog checkable by hand.
 */
export function splitSections(md, level = 2) {
  const marker = '#'.repeat(level) + ' ';
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let cur = { title: '', startLine: 1, lines: [] };
  let inFence = false;
  let fenceChar = '';
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const f = /^\s*(`{3,}|~{3,})/.exec(text);
    if (f) {
      if (!inFence) { inFence = true; fenceChar = f[1][0]; }
      else if (f[1][0] === fenceChar) { inFence = false; }
      cur.lines.push({ n: i + 1, text, fenced: true });
      continue;
    }
    if (!inFence && text.startsWith(marker)) {
      out.push(cur);
      cur = { title: text.slice(marker.length).trim(), startLine: i + 1, lines: [] };
      continue;
    }
    cur.lines.push({ n: i + 1, text, fenced: inFence });
  }
  out.push(cur);
  return out;
}

function splitRow(text) {
  return text.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim());
}

/**
 * The canonical tools table. Section-scoped on purpose: see the PARSING TRAP note at
 * the top of this file. Throws rather than guessing if the table shape changes, because
 * a parser that silently returns fewer names is exactly the failure we are replacing.
 */
export function parseToolsTable(md) {
  const pre = splitSections(md, 2)[0];
  if (!pre) throw new Error('tools-reference.md has no preamble section');
  const rows = [];
  let state = 'seek';
  for (const { n, text, fenced } of pre.lines) {
    if (fenced) continue;
    if (state === 'seek') {
      if (/^\|\s*Tool\s*\|/.test(text) && /Permission required/.test(text)) state = 'sep';
      continue;
    }
    if (state === 'sep') {
      if (/^\|[\s:|-]+\|\s*$/.test(text)) { state = 'rows'; continue; }
      state = 'seek';
      continue;
    }
    if (!text.startsWith('|')) break;
    const cells = splitRow(text);
    const m = /^`([A-Za-z][A-Za-z0-9_]*)`$/.exec(cells[0]);
    if (!m) throw new Error(`tools table row at line ${n} has an unexpected first cell: ${cells[0].slice(0, 60)}`);
    rows.push({ name: m[1], line: n, quote: normalizeQuote(cells[1] || text) });
  }
  if (!rows.length) throw new Error('no canonical tools table found in the tools-reference.md preamble');
  return rows;
}

/** Only "###" headings under "## Hook events", fence-aware, stopping at the next "##". */
export function parseHookEvents(md) {
  const sec = splitSections(md, 2).find((s) => /^hook events$/i.test(s.title));
  if (!sec) throw new Error('hooks.md has no "## Hook events" section');
  const out = [];
  for (let i = 0; i < sec.lines.length; i++) {
    const { n, text, fenced } = sec.lines[i];
    if (fenced || !/^###\s+\S/.test(text)) continue;
    const name = text.replace(/^###\s+/, '').replace(/`/g, '').trim();
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      throw new Error(`hook-events heading at line ${n} is not a plain event name: ${name.slice(0, 60)}`);
    }
    // Fall back to a self-describing sentence rather than the bare heading: a short
    // event name would otherwise produce a citation under the 10 char floor.
    let quote = `hooks.md documents ${name} as a hook event under "## Hook events"`;
    for (let j = i + 1; j < sec.lines.length; j++) {
      const p = sec.lines[j];
      if (p.fenced) continue;
      const t = p.text.trim();
      if (t.startsWith('#')) break;
      if (!t || t.startsWith('|') || t.startsWith('<')) continue;
      quote = normalizeQuote(t);
      break;
    }
    out.push({ name, line: n, quote });
  }
  if (!out.length) throw new Error('the "## Hook events" section produced no event headings');
  return out;
}

/**
 * Alias declarations, generated rather than hand-listed. The Agent SDK reference states
 * them in one fixed shape:
 *   **Tool name:** `TaskStop`. The previous names `KillShell` and `KillBash` are still accepted as aliases.
 * Everything after "still accepted" is cut off first, otherwise the backticks in the rest
 * of the sentence (`tools`, `SystemMessage`) get harvested as tool names.
 */
export function parseAliases(md) {
  const out = [];
  const lines = String(md).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\*\*Tool name:\*\*\s*`([A-Za-z][A-Za-z0-9_]*)`\.\s*The previous names?\s+([\s\S]*)$/.exec(lines[i]);
    if (!m) continue;
    const canonical = m[1];
    const cut = m[2].search(/\b(?:is|are)\s+still\s+accepted\b/);
    const head = cut >= 0 ? m[2].slice(0, cut) : m[2];
    for (const g of head.matchAll(/`([A-Z][A-Za-z0-9_]*)`/g)) {
      out.push({ alias: g[1], canonical, line: i + 1, quote: normalizeQuote(lines[i]) });
    }
  }
  return out;
}

/**
 * First announcement of a name in the changelog. Blocks are newest-first, so the LAST
 * write wins and that is the oldest version. The bullet must announce the name as the
 * direct object of "Added" ("Added `X`", "Added the X tool"), which keeps out bullets
 * that merely mention an existing tool while adding something else to it.
 * An absent `since` means "never announced in that shape", not "old" and not "new".
 */
export function changelogVersions(md, names) {
  const want = new Set(names);
  const found = new Map();
  const lines = String(md).split(/\r?\n/);
  let label = null;
  for (let i = 0; i < lines.length; i++) {
    const u = /<Update\s+label="([^"]+)"/.exec(lines[i]);
    if (u) { label = u[1]; continue; }
    if (/^\s*<\/Update>/.test(lines[i])) { label = null; continue; }
    if (!label) continue;
    const b = /^\s*\*\s+Added\s+(?:the\s+)?`?([A-Za-z][A-Za-z0-9_]*)`?/.exec(lines[i]);
    if (!b || !want.has(b[1])) continue;
    found.set(b[1], { version: label, line: i + 1, quote: normalizeQuote(lines[i]) });
  }
  return found;
}

/**
 * agnix 0.45.0 enumerates its own tool list inside the CC-AG-009 diagnostic captured by
 * the lint bench. CORROBORATING evidence only, never the arbiter: it is a competitor's
 * assertion, not documentation. It agreed with the docs on all 14 tools we were missing,
 * which is a fact worth carrying rather than hiding.
 */
export function agnixToolNames(benchText) {
  const m = /Known tools:\s*((?:[A-Za-z][A-Za-z0-9_]*,\s*)+[A-Za-z][A-Za-z0-9_]*)\./.exec(String(benchText));
  if (!m) return null;
  return m[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean).sort();
}

// ------------------------------------------------------------------ curation --

/**
 * The names extension-doctor carried that the current tools table does not list, minus
 * the ones the alias parser derives on its own (Task, BashOutput, KillShell). Each rule
 * declares the evidence that MUST still be findable; the build fails loudly if the docs
 * moved out from under it, rather than emitting an entry with a stale citation.
 */
export const NON_TABLE_RULES = [
  {
    name: 'MultiEdit',
    status: 'legacy',
    reason: 'the permissions reference calls it "the legacy MultiEdit tool"',
    evidence: [
      { source: 'permissions.md', re: /the legacy `MultiEdit` tool/ },
      { source: 'errors.md', re: /legacy `MultiEdit\(path\)` rules/ },
    ],
  },
  {
    name: 'SlashCommand',
    status: 'historical',
    reason: 'announced in the changelog, absent from the current tools table; the SDK type of the same name describes a slash-command descriptor, not this tool',
    evidence: [{ source: 'changelog.md', re: /Added SlashCommand tool/ }],
  },
  {
    name: 'LS',
    status: 'historical',
    reason: 'the changelog records the LSTool rename to LS; no current reference page lists it',
    evidence: [{ source: 'changelog.md', re: /Renamed tools for consistency:.*\bLS\b/ }],
  },
  {
    name: 'NotebookRead',
    status: 'unlisted',
    reason: 'zero occurrences anywhere in the mirror; kept so a user with it in a subagent is told rather than alarmed',
    absent: true,
  },
];

// ------------------------------------------------------------------ build --

function readPage(mirrorDir, id) {
  const p = join(mirrorDir, id);
  if (!existsSync(p)) throw new Error(`docs mirror is missing ${id} (looked in ${mirrorDir})`);
  return readFileSync(p, 'utf8');
}

/**
 * First line matching re, quoted around the match rather than from the start of the
 * line. permissions.md:263 is a 900 char paragraph whose "legacy MultiEdit tool" phrase
 * sits in the middle: a head-truncated quote would cite a line that does not visibly
 * contain the evidence it is offered for.
 */
export function findLine(text, re, max = 140) {
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const line = lines[i];
    let quote = line;
    if (line.length > max) {
      const start = Math.max(0, m.index - 30);
      quote = (start > 0 ? '...' : '') + line.slice(start, start + max);
    }
    return { line: i + 1, quote: normalizeQuote(quote, max + 6) };
  }
  return null;
}

function sortedObject(pairs) {
  const out = {};
  for (const k of Object.keys(pairs).sort()) out[k] = pairs[k];
  return out;
}

/**
 * Build the catalog object in memory. Writes nothing: every caller decides where the
 * bytes go, which is what keeps --check from ever touching the committed file.
 */
export function buildCatalog(opts = {}) {
  const mirrorDir = opts.mirrorDir || DEFAULT_MIRROR;
  const catalogVersion = opts.catalogVersion || readVerifiedVersion(opts.versionFile);
  const generated = opts.generated || new Date().toISOString();
  const generator = opts.generator || `tools/capability-catalog.mjs --from-mirror ${mirrorDir}`;
  const benchPath = opts.benchPath === undefined ? BENCH_PATH : opts.benchPath;

  const pages = {};
  const sources = [];
  for (const id of PRIMARY_PAGES.concat(SUPPORTING_PAGES)) {
    const text = readPage(mirrorDir, id);
    pages[id] = text;
    sources.push({
      id,
      role: PRIMARY_PAGES.includes(id) ? 'primary' : 'supporting',
      sha256: sha256(Buffer.from(text, 'utf8')),
      bytes: Buffer.byteLength(text, 'utf8'),
    });
  }

  // Absence is a claim too. Hash every mirrored page so "zero occurrences" is pinned to
  // an exact corpus rather than to whatever happened to be on disk that day.
  const allPages = readdirSync(mirrorDir).filter((f) => f.endsWith('.md')).sort();
  const indexLines = [];
  const corpus = [];
  for (const f of allPages) {
    const text = readFileSync(join(mirrorDir, f), 'utf8');
    corpus.push({ id: f, text });
    indexLines.push(`${f} ${sha256(Buffer.from(text, 'utf8'))}`);
  }
  const indexBody = indexLines.join('\n') + '\n';
  sources.push({
    id: MIRROR_INDEX_ID,
    role: 'absence-scan',
    sha256: sha256(Buffer.from(indexBody, 'utf8')),
    bytes: Buffer.byteLength(indexBody, 'utf8'),
    pages: allPages.length,
    note: 'sha256 over the sorted "<page> <sha256>" index of every mirrored page; cited by entries whose evidence is absence',
  });

  const tools = {};
  const hookEvents = {};
  // One citation per (source, line): a curated rule and the changelog scan can land on
  // the same line, and a duplicated citation reads like two independent witnesses.
  const addProv = (entry, source, line, quote) => {
    if (entry.provenance.some((p) => p.source === source && p.line === line)) return;
    entry.provenance.push({ source, line, quote: normalizeQuote(quote, 160) });
  };

  for (const r of parseToolsTable(pages['tools-reference.md'])) {
    tools[r.name] = { status: 'current', provenance: [] };
    addProv(tools[r.name], 'tools-reference.md', r.line, r.quote);
  }
  for (const r of parseHookEvents(pages['hooks.md'])) {
    hookEvents[r.name] = { status: 'current', provenance: [] };
    addProv(hookEvents[r.name], 'hooks.md', r.line, r.quote);
  }

  // Generated aliases. Documented as previous names that are still accepted, so they are
  // legacy (a runtime claim), and scope records that the claim lives only in SDK pages.
  for (const id of ['agent-sdk__python.md', 'agent-sdk__typescript.md']) {
    for (const a of parseAliases(pages[id])) {
      if (tools[a.alias] && tools[a.alias].status === 'current') continue;
      if (!tools[a.alias]) {
        tools[a.alias] = { status: 'legacy', aliasOf: a.canonical, scope: 'agent-sdk', provenance: [] };
      }
      addProv(tools[a.alias], id, a.line, a.quote);
    }
  }

  for (const rule of NON_TABLE_RULES) {
    if (tools[rule.name]) throw new Error(`curated rule for ${rule.name} collides with a generated entry`);
    const entry = { status: rule.status, reason: rule.reason, provenance: [] };
    if (rule.absent) {
      const hits = corpus.filter((p) => new RegExp(`\\b${rule.name}\\b`).test(p.text)).map((p) => p.id);
      if (hits.length) {
        throw new Error(`${rule.name} is marked unlisted but now occurs in: ${hits.join(', ')}`);
      }
      addProv(entry, MIRROR_INDEX_ID, 0,
        `absence scan: zero occurrences of ${rule.name} across all ${allPages.length} mirrored pages`);
    } else {
      for (const ev of rule.evidence) {
        const text = pages[ev.source];
        if (text === undefined) throw new Error(`rule for ${rule.name} cites undeclared page ${ev.source}`);
        const hit = findLine(text, ev.re);
        if (!hit) throw new Error(`evidence for ${rule.name} not found in ${ev.source}: ${ev.re}`);
        addProv(entry, ev.source, hit.line, hit.quote);
      }
    }
    tools[rule.name] = entry;
  }

  // since, from the changelog, for every name in either section.
  const since = changelogVersions(
    pages['changelog.md'],
    Object.keys(tools).concat(Object.keys(hookEvents)),
  );
  for (const [name, hit] of since) {
    const entry = tools[name] || hookEvents[name];
    if (!entry) continue;
    entry.since = hit.version;
    addProv(entry, 'changelog.md', hit.line, hit.quote);
  }

  const sortedTools = sortedObject(tools);
  const sortedEvents = sortedObject(hookEvents);

  // Cross-check. Corroborating, recorded, never authoritative.
  let crossCheck = null;
  if (benchPath && existsSync(benchPath)) {
    const benchText = readFileSync(benchPath, 'utf8');
    crossCheck = crossCheckOf(sortedTools, benchText);
    if (crossCheck) {
      sources.push({
        id: BENCH_ID,
        role: 'corroborating',
        sha256: sha256Text(benchText),
        bytes: Buffer.byteLength(benchText, 'utf8'),
        note: 'agnix 0.45.0 CC-AG-009 diagnostic captured by the lint bench',
      });
    }
  }

  const counts = countOf(sortedTools, sortedEvents, sources);
  const versionAwareness = versionAwarenessOf(sortedTools, sortedEvents, catalogVersion, pages['changelog.md']);

  const cat = {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion,
    generated,
    generator,
    quotePolicy: QUOTE_POLICY,
    statuses: STATUSES,
    sources: sources.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    counts,
    versionAwareness,
    crossCheck,
    tools: sortedTools,
    hookEvents: sortedEvents,
  };
  cat.integrity = computeIntegrity(cat);
  return cat;
}

/**
 * The recorded relationship between this catalog and agnix 0.45.0's own tool list.
 *
 * This is the only EXTERNAL anchor the mirror-free gate has. Internal consistency can
 * always be satisfied by a consistent forgery: delete PowerShell, correct the counts,
 * reseal, and nothing inside the file contradicts anything else inside the file. But
 * agnix's list lives in a committed file this catalog does not own, so a deletion moves
 * a name out of agreesWithDocsOn and into assertsUnsupportedByDocs, and the recorded
 * block stops matching. That turns a competitor's assertion into a tripwire without
 * ever letting it define what is true: it can only prove the RECORD is inaccurate.
 */
export function crossCheckOf(tools, benchText) {
  const names = agnixToolNames(benchText);
  if (!names) return null;
  const docsCurrent = new Set(Object.keys(tools).filter((n) => tools[n].status === 'current'));
  const known = new Set(Object.keys(tools));
  const idx = String(benchText).indexOf('Known tools:');
  return {
    id: 'agnix-0.45.0',
    source: BENCH_ID,
    line: String(benchText).slice(0, idx).split(/\r?\n/).length,
    role: 'corroborating',
    status: 'never the arbiter: a competitor assertion, recorded because it was more current than our own hardcoded list',
    toolCount: names.length,
    agreesWithDocsOn: names.filter((n) => docsCurrent.has(n)).length,
    docsCurrentItLacks: [...docsCurrent].filter((n) => !names.includes(n)).sort(),
    assertsDocumentedElsewhere: names.filter((n) => !docsCurrent.has(n) && known.has(n)).sort(),
    assertsUnsupportedByDocs: names.filter((n) => !known.has(n)).sort(),
  };
}

export function countOf(tools, hookEvents, sources) {
  const by = (m) => {
    const o = {};
    for (const s of STATUSES) o[s] = 0;
    for (const k of Object.keys(m)) o[m[k].status] = (o[m[k].status] || 0) + 1;
    return o;
  };
  const t = by(tools);
  const h = by(hookEvents);
  return {
    toolsTotal: Object.keys(tools).length,
    toolsCurrent: t.current,
    toolsByStatus: t,
    hookEventsTotal: Object.keys(hookEvents).length,
    hookEventsCurrent: h.current,
    hookEventsByStatus: h,
    sources: sources.length,
  };
}

export function versionAwarenessOf(tools, hookEvents, catalogVersion, changelogMd) {
  let newest = null;
  if (changelogMd) {
    for (const m of String(changelogMd).matchAll(/<Update\s+label="([^"]+)"/g)) {
      if (newest === null || cmpVersion(m[1], newest) > 0) newest = m[1];
    }
  }
  const newer = [];
  for (const section of SECTIONS) {
    const map = section === 'tools' ? tools : hookEvents;
    for (const name of Object.keys(map)) {
      const s = map[name].since;
      if (s && cmpVersion(s, catalogVersion) > 0) newer.push(`${section}:${name}@${s}`);
    }
  }
  return {
    catalogVersion,
    newestChangelogVersion: newest,
    catalogVersionIsNewestDocumented: newest === null ? null : cmpVersion(catalogVersion, newest) >= 0,
    namesNewerThanCatalogVersion: newer.sort(),
    note: 'names announced after catalogVersion are documented but may not exist on the verified build',
  };
}

export function readVerifiedVersion(file = VERSION_FILE) {
  if (!existsSync(file)) throw new Error(`no verified version file at ${file}`);
  const v = readFileSync(file, 'utf8').trim();
  if (!/^\d+(\.\d+)*$/.test(v)) throw new Error(`evidence/VERIFIED_VERSION is not a version: ${v.slice(0, 40)}`);
  return v;
}

// ------------------------------------------------------------------ verification --

/**
 * Mirror-free self-consistency. This is the CI gate.
 * Returns { ok, errors:[{code,msg}] }. It is an OBJECT and therefore always truthy:
 * callers must test `.ok`, never the return value itself.
 */
/**
 * Hash TEXT, not bytes, for integrity records over checked-in text files.
 *
 * On a Windows clone with core.autocrlf, git rewrites every LF to CRLF on
 * checkout, so a sha256 taken over the raw bytes differs from the one recorded
 * on the machine that wrote it while the CONTENT is identical. That is not a
 * theoretical concern: it happened here. The crosscheck source failed
 * verification, catalog load FAILS SOFT by design, and every capability name
 * check silently degraded to UNVERIFIED with one header line to say so. An
 * integrity gate that reports line endings as tampering is a gate that gets
 * ignored, which is worse than not having it.
 *
 * Normalising is safe in the direction that matters: it cannot make DIFFERENT
 * content hash the same unless the only difference is line endings, which for a
 * generated JSON file is exactly what we want to tolerate.
 */
function sha256Text(text) {
  return sha256(Buffer.from(String(text).split('\r\n').join('\n'), 'utf8'));
}

export function verifyCatalogIntegrity(cat, opts = {}) {
  const errors = [];
  const add = (code, msg) => errors.push({ code, msg });
  const versionFile = opts.versionFile === undefined ? VERSION_FILE : opts.versionFile;

  if (!cat || typeof cat !== 'object' || Array.isArray(cat)) {
    add('SCHEMA_NOT_OBJECT', 'catalog is not an object');
    return { ok: false, errors };
  }
  for (const k of ['schemaVersion', 'catalogVersion', 'generated', 'generator', 'sources', 'tools', 'hookEvents', 'counts', 'integrity']) {
    if (cat[k] === undefined) add('SCHEMA_MISSING_FIELD', `missing required field: ${k}`);
  }
  if (errors.length) return { ok: false, errors };

  if (cat.schemaVersion !== SCHEMA_VERSION) {
    add('SCHEMA_VERSION', `schemaVersion ${cat.schemaVersion}, this build understands ${SCHEMA_VERSION}`);
  }

  const actual = computeIntegrity(cat);
  if (actual !== cat.integrity) {
    add('INTEGRITY_MISMATCH', `integrity is ${String(cat.integrity).slice(0, 16)}..., body hashes to ${actual.slice(0, 16)}...`);
  }

  if (!Array.isArray(cat.sources) || cat.sources.length === 0) {
    add('SOURCES_EMPTY', 'sources[] is empty, so no provenance can be checked');
  }
  const ids = new Set();
  for (const s of (Array.isArray(cat.sources) ? cat.sources : [])) {
    if (!s || typeof s.id !== 'string' || !s.id) { add('SOURCE_BAD_ID', 'a source has no id'); continue; }
    if (ids.has(s.id)) add('SOURCE_DUPLICATE_ID', `duplicate source id: ${s.id}`);
    ids.add(s.id);
    if (!/^[0-9a-f]{64}$/.test(String(s.sha256))) add('SOURCE_BAD_HASH', `source ${s.id} has no sha256`);
  }

  for (const section of SECTIONS) {
    const map = cat[section];
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      add('SECTION_BAD', `${section} is not an object`);
      continue;
    }
    const names = Object.keys(map);
    if (names.length === 0) add('SECTION_EMPTY', `${section} has no entries, which is a vacuous pass`);
    for (const name of names) {
      const e = map[name];
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) add('NAME_BAD', `${section}.${name} is not a plain identifier`);
      if (!e || typeof e !== 'object') { add('ENTRY_BAD', `${section}.${name} is not an object`); continue; }
      if (!STATUSES.includes(e.status)) add('STATUS_UNKNOWN', `${section}.${name} has status ${JSON.stringify(e.status)}`);
      if (!Array.isArray(e.provenance) || e.provenance.length === 0) {
        add('PROVENANCE_EMPTY', `${section}.${name} carries no provenance`);
        continue;
      }
      for (const p of e.provenance) {
        if (!p || typeof p !== 'object') { add('PROVENANCE_BAD', `${section}.${name} has a malformed provenance entry`); continue; }
        if (!ids.has(p.source)) add('PROVENANCE_UNDECLARED_SOURCE', `${section}.${name} cites undeclared source ${JSON.stringify(p.source)}`);
        if (typeof p.line !== 'number' || !Number.isInteger(p.line) || p.line < 0) {
          add('PROVENANCE_BAD_LINE', `${section}.${name} has line ${JSON.stringify(p.line)}`);
        }
        const q = typeof p.quote === 'string' ? p.quote.trim() : '';
        if (!q) add('PROVENANCE_EMPTY', `${section}.${name} has a blank citation quote`);
        else if (q.length <= MIN_CITATION) add('CITATION_TOO_SHORT', `${section}.${name} citation is ${q.length} chars, the floor is over ${MIN_CITATION}`);
      }
      if (e.since !== undefined && !/^\d+(\.\d+)*$/.test(String(e.since))) {
        add('SINCE_BAD', `${section}.${name} has since ${JSON.stringify(e.since)}`);
      }
    }
  }

  const expectCounts = countOf(cat.tools || {}, cat.hookEvents || {}, Array.isArray(cat.sources) ? cat.sources : []);
  if (canonicalize(expectCounts) !== canonicalize(cat.counts)) {
    for (const k of Object.keys(expectCounts)) {
      if (canonicalize(expectCounts[k]) !== canonicalize((cat.counts || {})[k])) {
        add('COUNTS_MISMATCH', `counts.${k} says ${canonicalize((cat.counts || {})[k])}, the catalog body gives ${canonicalize(expectCounts[k])}`);
      }
    }
    if (!errors.some((e) => e.code === 'COUNTS_MISMATCH')) {
      add('COUNTS_MISMATCH', 'counts block does not match the catalog body');
    }
  }

  if (cat.versionAwareness) {
    const expected = versionAwarenessOf(cat.tools || {}, cat.hookEvents || {}, cat.catalogVersion, null);
    if (canonicalize(expected.namesNewerThanCatalogVersion) !== canonicalize(cat.versionAwareness.namesNewerThanCatalogVersion)) {
      add('VERSION_AWARENESS_MISMATCH', 'versionAwareness.namesNewerThanCatalogVersion does not match the since fields');
    }
    if (cat.versionAwareness.catalogVersion !== cat.catalogVersion) {
      add('VERSION_AWARENESS_MISMATCH', 'versionAwareness.catalogVersion disagrees with catalogVersion');
    }
  }

  if (versionFile && existsSync(versionFile)) {
    const verified = readFileSync(versionFile, 'utf8').trim();
    if (cmpVersion(cat.catalogVersion, verified) !== 0) {
      add('CATALOG_VERSION_MISMATCH', `catalogVersion ${cat.catalogVersion} but evidence/VERIFIED_VERSION is ${verified}`);
    }
  }

  // The external anchor. Skipped when the bench file is absent or has itself moved,
  // and it is never allowed to redefine the catalog: it can only say the RECORD is stale.
  const benchPath = opts.benchPath === undefined ? BENCH_PATH : opts.benchPath;
  if (cat.crossCheck && benchPath && existsSync(benchPath)) {
    const benchText = readFileSync(benchPath, 'utf8');
    const declared = (Array.isArray(cat.sources) ? cat.sources : []).find((s) => s.id === cat.crossCheck.source);
    if (declared && declared.sha256 !== sha256Text(benchText)) {
      add('CROSSCHECK_SOURCE_CHANGED', `${cat.crossCheck.source} changed on disk since the catalog recorded it`);
    } else {
      const fresh = crossCheckOf(cat.tools || {}, benchText);
      if (!fresh) add('CROSSCHECK_UNREADABLE', `no tool list could be re-derived from ${benchPath}`);
      else if (canonicalize(fresh) !== canonicalize(cat.crossCheck)) {
        add('CROSSCHECK_MISMATCH', `the recorded ${cat.crossCheck.id} comparison no longer matches a re-derivation: `
          + `agreesWithDocsOn ${cat.crossCheck.agreesWithDocsOn} vs ${fresh.agreesWithDocsOn}, `
          + `assertsUnsupportedByDocs ${canonicalize(cat.crossCheck.assertsUnsupportedByDocs)} vs ${canonicalize(fresh.assertsUnsupportedByDocs)}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Drift against the docs mirror. Builds a fresh catalog INTO A TEMP DIR and compares.
 * It never writes the committed catalog: a drift gate that repairs the drift it detects
 * can only fail once.
 */
export function checkDrift(cat, mirrorDir = DEFAULT_MIRROR, opts = {}) {
  const errors = [];
  const add = (code, msg) => errors.push({ code, msg });
  if (!existsSync(mirrorDir)) return { ok: false, cannotCheck: true, errors: [{ code: 'NO_MIRROR', msg: `no docs mirror at ${mirrorDir}` }] };

  const tmp = mkdtempSync(join(tmpdir(), 'ccx-capcat-'));
  let fresh;
  try {
    fresh = buildCatalog({
      mirrorDir,
      catalogVersion: opts.catalogVersion || readVerifiedVersion(opts.versionFile),
      benchPath: opts.benchPath === undefined ? BENCH_PATH : opts.benchPath,
      generated: cat.generated,
      generator: cat.generator,
    });
    writeFileSync(join(tmp, 'catalog.json'), JSON.stringify(fresh, null, 2) + '\n');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (semanticFingerprint(fresh) === semanticFingerprint(cat)) return { ok: true, errors: [], fresh };

  if (cmpVersion(fresh.catalogVersion, cat.catalogVersion) !== 0) {
    add('DRIFT_CATALOG_VERSION', `catalog says ${cat.catalogVersion}, evidence says ${fresh.catalogVersion}`);
  }
  const sourceHash = (c, id) => (c.sources.find((s) => s.id === id) || {}).sha256;
  for (const s of fresh.sources) {
    const old = sourceHash(cat, s.id);
    if (old === undefined) add('DRIFT_SOURCE_ADDED', `source ${s.id} is not declared in the catalog`);
    else if (old !== s.sha256) add('DRIFT_SOURCE_HASH', `source ${s.id} changed on disk since the catalog was generated`);
  }
  for (const section of SECTIONS) {
    const code = section === 'tools' ? 'TOOL' : 'EVENT';
    const a = cat[section] || {};
    const b = fresh[section] || {};
    for (const n of Object.keys(b)) {
      if (!a[n]) { add(`DRIFT_${code}_MISSING`, `${section}.${n} is in the docs but not in the catalog`); continue; }
      if (a[n].status !== b[n].status) add(`DRIFT_${code}_STATUS`, `${section}.${n} is ${a[n].status} in the catalog, ${b[n].status} in the docs`);
      const al = (a[n].provenance || []).map((p) => `${p.source}:${p.line}`).join(',');
      const bl = (b[n].provenance || []).map((p) => `${p.source}:${p.line}`).join(',');
      if (al !== bl) add('DRIFT_PROVENANCE', `${section}.${n} citations moved: ${al} -> ${bl}`);
    }
    for (const n of Object.keys(a)) {
      if (!b[n]) add(`DRIFT_${code}_EXTRA`, `${section}.${n} is in the catalog but no longer derivable from the docs`);
    }
  }
  if (canonicalize(cat.counts) !== canonicalize(fresh.counts)) add('DRIFT_COUNTS', 'counts differ from a fresh build');
  if (!errors.length) add('DRIFT_UNCLASSIFIED', 'the semantic fingerprint changed but no field-level difference was classified');
  return { ok: false, errors, fresh };
}

// ------------------------------------------------------------------ consumer API --

let _cache = null;
export function resetCatalogCache() { _cache = null; }

/** Parse and verify. Throws on a broken catalog: a doctor running off a corrupt
 *  capability list would produce exactly the false positives this replaces. */
export function loadCatalog(path = CATALOG_PATH, opts = {}) {
  const verify = opts.verify === undefined ? true : opts.verify;
  if (!existsSync(path)) throw new Error(`no capability catalog at ${path} (regenerate with --from-mirror)`);
  let cat;
  try {
    cat = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`capability catalog at ${path} is not valid JSON: ${e.message}`);
  }
  if (verify) {
    const v = verifyCatalogIntegrity(cat, opts);
    if (!v.ok) throw new Error(`capability catalog failed verification: ${v.errors.map((e) => e.code).join(', ')}`);
  }
  return cat;
}

function sectionMap(section, cat) {
  if (!SECTIONS.includes(section)) throw new Error(`unknown catalog section: ${section} (expected ${SECTIONS.join(' or ')})`);
  const c = cat || _cache || (_cache = loadCatalog());
  return c[section] || {};
}

/** Names a current build accepts. This is the set a linter should validate against. */
export function currentNames(section, cat) {
  const m = sectionMap(section, cat);
  return new Set(Object.keys(m).filter((n) => m[n].status === 'current'));
}

/** Every name the catalog knows, current or not. Use with statusOf to say WHY a
 *  non-current name is not current, instead of reporting it as unknown. */
export function knownNames(section, cat) {
  return new Set(Object.keys(sectionMap(section, cat)));
}

export function entryOf(section, name, cat) {
  return sectionMap(section, cat)[name] || null;
}

export function statusOf(section, name, cat) {
  const e = entryOf(section, name, cat);
  return e ? e.status : null;
}

/** A ready-made citation string, always longer than the doctor's 10 char floor. */
export function citation(section, name, cat) {
  const e = entryOf(section, name, cat);
  if (!e || !e.provenance || !e.provenance.length) return null;
  const p = e.provenance[0];
  return `${p.source}:${p.line} "${p.quote}"`;
}

// ------------------------------------------------------------------ reporting --

function report(label, res, quiet) {
  if (quiet) return;
  if (res.ok) { console.log(`PASS ${label}`); return; }
  console.log(`FAIL ${label}`);
  for (const e of res.errors) console.log(`  [${e.code}] ${e.msg}`);
}

function summarize(cat) {
  const c = cat.counts;
  const line = (label, by) => STATUSES.filter((s) => by[s]).map((s) => `${s} ${by[s]}`).join(', ');
  console.log(`catalog ${cat.catalogVersion}  schema ${cat.schemaVersion}  generated ${cat.generated}`);
  console.log(`  tools       ${c.toolsTotal} total (${line('tools', c.toolsByStatus)})`);
  console.log(`  hookEvents  ${c.hookEventsTotal} total (${line('events', c.hookEventsByStatus)})`);
  console.log(`  sources     ${c.sources}  integrity ${cat.integrity.slice(0, 16)}...`);
}

// ------------------------------------------------------------------ self-test --

const FIXTURE_TOOLS = [
  '# Tools reference',
  '',
  'Intro prose.',
  '',
  '| Tool      | Description                  | Permission required |',
  '| :-------- | :--------------------------- | :------------------ |',
  '| `Agent`   | Spawns a subagent to do work | Yes                 |',
  '| `Bash`    | Executes shell commands here | Yes                 |',
  '| `PowerShell` | Executes PowerShell on Windows hosts | Yes         |',
  '',
  '## Configure tools with permission rules',
  '',
  '| Rule        | Applies to | Docs             |',
  '| :---------- | :--------- | :--------------- |',
  '| `WebSearch` | WebSearch  | No specifier row |',
  '',
  '## Monitor tool',
  '',
  '| Field       | Required | Description            |',
  '| :---------- | :------- | :--------------------- |',
  '| `url`       | Yes      | The endpoint to use    |',
  '| `protocols` | No       | Subprotocol names sent |',
  '',
].join('\n');

const FIXTURE_HOOKS = [
  '# Hooks reference',
  '',
  '## Configuration',
  '',
  '### NotAnEvent',
  '',
  '## Hook events',
  '',
  '### SessionStart',
  '',
  'Runs when a session starts up and nothing else has happened yet.',
  '',
  '```bash',
  '### NotAnEventEither',
  '```',
  '',
  '### DirectoryAdded',
  '',
  'Runs after a working directory is added mid-session with /add-dir.',
  '',
  '## Prompt-based hooks',
  '',
  '### AlsoNotAnEvent',
  '',
].join('\n');

/** The trap, implemented as the obvious wrong parser so the self-test can watch it fail. */
export function naiveToolScan(md) {
  const out = [];
  for (const line of String(md).split(/\r?\n/)) {
    const m = /^\|\s*`([A-Za-z][A-Za-z0-9_]*)`\s*\|/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

function synthCatalog() {
  const src = [{ id: 'p.md', role: 'primary', sha256: 'a'.repeat(64), bytes: 10 }];
  const tools = { Read: { status: 'current', provenance: [{ source: 'p.md', line: 3, quote: 'Reads the contents of a file from disk' }] } };
  const hookEvents = { Stop: { status: 'current', provenance: [{ source: 'p.md', line: 9, quote: 'Runs when the main agent finishes responding' }] } };
  const cat = {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: '2.1.220',
    generated: '2026-01-01T00:00:00.000Z',
    generator: 'self-test',
    sources: src,
    counts: countOf(tools, hookEvents, src),
    versionAwareness: versionAwarenessOf(tools, hookEvents, '2.1.220', null),
    tools,
    hookEvents,
  };
  cat.integrity = computeIntegrity(cat);
  return cat;
}

export function selfTest() {
  let pass = 0;
  let fail = 0;
  const check = (label, cond, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra ? ` (${extra})` : ''}`); }
  };
  const codes = (r) => r.errors.map((e) => e.code);

  console.log('cmpVersion');
  check('2.1.9 sorts BEFORE 2.1.220 numerically', cmpVersion('2.1.9', '2.1.220') < 0);
  check('MUST FAIL: string compare gets it backwards, which is why cmpVersion exists', ('2.1.9' < '2.1.220') === false);
  check('2.1.220 sorts after 2.1.9', cmpVersion('2.1.220', '2.1.9') > 0);
  check('equal versions compare 0', cmpVersion('2.1.220', '2.1.220') === 0);
  check('missing segments are zero', cmpVersion('2.1', '2.1.0') === 0);
  check('2.2.0 beats 2.1.999', cmpVersion('2.2.0', '2.1.999') > 0);
  check('v prefixes and junk are tolerated', cmpVersion('v2.1.220', '2.1.220') === 0);
  check('empty is lowest', cmpVersion('', '0.0.1') < 0);

  console.log('tools table parsing');
  const naive = naiveToolScan(FIXTURE_TOOLS);
  check('MUST FAIL: the naive scan absorbs url and protocols', naive.includes('url') && naive.includes('protocols'));
  check('MUST FAIL: the naive scan re-absorbs WebSearch from the permission table', naive.includes('WebSearch'));
  check('the naive scan over-counts the fixture', naive.length === 6, `got ${naive.length}`);
  const parsed = parseToolsTable(FIXTURE_TOOLS).map((r) => r.name);
  check('the section-scoped parser returns only the canonical table', canonicalize(parsed) === canonicalize(['Agent', 'Bash', 'PowerShell']), parsed.join(','));
  check('url is NOT absorbed', !parsed.includes('url'));
  check('protocols is NOT absorbed', !parsed.includes('protocols'));
  check('the trailing WebSearch row is NOT absorbed', !parsed.includes('WebSearch'));
  check('rows carry their file line number', parseToolsTable(FIXTURE_TOOLS)[0].line === 7);
  let threw = false;
  try { parseToolsTable('# nothing here\n\nno table at all\n'); } catch { threw = true; }
  check('a page with no canonical table throws instead of returning empty', threw);

  console.log('hook events parsing');
  const events = parseHookEvents(FIXTURE_HOOKS).map((e) => e.name);
  check('only the Hook events section is read', canonicalize(events) === canonicalize(['SessionStart', 'DirectoryAdded']), events.join(','));
  check('a heading before the section is NOT absorbed', !events.includes('NotAnEvent'));
  check('a heading after the section is NOT absorbed', !events.includes('AlsoNotAnEvent'));
  check('a heading inside a code fence is NOT absorbed', !events.includes('NotAnEventEither'));
  check('each event carries a prose citation over the floor', parseHookEvents(FIXTURE_HOOKS).every((e) => e.quote.length > MIN_CITATION));
  threw = false;
  try { parseHookEvents('# hooks\n\n## Something else\n\n### X\n'); } catch { threw = true; }
  check('a page with no Hook events section throws', threw);

  console.log('alias parsing');
  const aliasMd = [
    '**Tool name:** `Agent`. The previous name `Task` is still accepted as an alias, and the `tools` list in the init [`SystemMessage`](#systemmessage) reports this tool as `Task`.',
    '**Tool name:** `TaskStop`. The previous names `KillShell` and `KillBash` are still accepted as aliases.',
    '**Tool name:** `Bash`',
  ].join('\n');
  const aliases = parseAliases(aliasMd);
  check('both alias declarations parse', aliases.length === 3, `got ${aliases.length}`);
  check('Task maps to Agent', aliases.some((a) => a.alias === 'Task' && a.canonical === 'Agent'));
  check('KillShell and KillBash both map to TaskStop', aliases.filter((a) => a.canonical === 'TaskStop').length === 2);
  check('MUST NOT absorb SystemMessage from the tail of the sentence', !aliases.some((a) => a.alias === 'SystemMessage'));
  check('a plain tool-name line yields no alias', !aliases.some((a) => a.canonical === 'Bash'));

  console.log('changelog since');
  const clog = [
    '<Update label="2.1.219">',
    '  * Added `DirectoryAdded` hook that fires after /add-dir',
    '  * Fixed `PowerShell` quoting on Windows',
    '</Update>',
    '<Update label="2.0.1">',
    '  * Added `DirectoryAdded` hook (earlier mention wins)',
    '  * Added SlashCommand tool, which enables Claude to invoke your slash commands.',
    '</Update>',
  ].join('\n');
  const since = changelogVersions(clog, ['DirectoryAdded', 'SlashCommand', 'PowerShell']);
  check('the OLDEST announcement wins', since.get('DirectoryAdded').version === '2.0.1', since.get('DirectoryAdded').version);
  check('an unbackticked "Added X tool" bullet is caught', since.get('SlashCommand').version === '2.0.1');
  check('MUST NOT treat a "Fixed" bullet as an announcement', !since.has('PowerShell'));

  console.log('integrity');
  const good = synthCatalog();
  check('a synthetic catalog verifies', verifyCatalogIntegrity(good, { versionFile: null }).ok);
  check('key order does not change the hash',
    computeIntegrity(good) === computeIntegrity(JSON.parse(JSON.stringify({ tools: good.tools, ...good }))));
  const flipped = JSON.parse(JSON.stringify(good));
  flipped.integrity = (flipped.integrity[0] === 'a' ? 'b' : 'a') + flipped.integrity.slice(1);
  check('MUST FAIL: a one-byte integrity flip is caught', codes(verifyCatalogIntegrity(flipped, { versionFile: null })).includes('INTEGRITY_MISMATCH'));
  const silent = JSON.parse(JSON.stringify(good));
  silent.tools.Read.status = 'legacy';
  check('MUST FAIL: a silent status edit is caught', codes(verifyCatalogIntegrity(silent, { versionFile: null })).includes('INTEGRITY_MISMATCH'));

  console.log('verification rules');
  const mut = (f) => { const c = JSON.parse(JSON.stringify(good)); f(c); c.integrity = computeIntegrity(c); return verifyCatalogIntegrity(c, { versionFile: null }); };
  check('MUST FAIL: empty tools is not a vacuous pass', codes(mut((c) => { c.tools = {}; c.counts = countOf(c.tools, c.hookEvents, c.sources); c.versionAwareness = versionAwarenessOf(c.tools, c.hookEvents, c.catalogVersion, null); })).includes('SECTION_EMPTY'));
  check('MUST FAIL: a blank quote is caught', codes(mut((c) => { c.tools.Read.provenance[0].quote = ''; })).includes('PROVENANCE_EMPTY'));
  check('MUST FAIL: a short quote is caught', codes(mut((c) => { c.tools.Read.provenance[0].quote = 'too short'; })).includes('CITATION_TOO_SHORT'));
  check('MUST FAIL: an empty provenance array is caught', codes(mut((c) => { c.tools.Read.provenance = []; })).includes('PROVENANCE_EMPTY'));
  check('MUST FAIL: an undeclared source id is caught', codes(mut((c) => { c.tools.Read.provenance[0].source = 'ghost.md'; })).includes('PROVENANCE_UNDECLARED_SOURCE'));
  check('MUST FAIL: an unknown status is caught', codes(mut((c) => { c.tools.Read.status = 'probably-fine'; })).includes('STATUS_UNKNOWN'));
  check('MUST FAIL: a wrong count is caught', codes(mut((c) => { c.counts.toolsCurrent = 99; })).includes('COUNTS_MISMATCH'));
  check('MUST FAIL: a duplicate source id is caught', codes(mut((c) => { c.sources.push({ ...c.sources[0] }); c.counts = countOf(c.tools, c.hookEvents, c.sources); })).includes('SOURCE_DUPLICATE_ID'));
  check('MUST FAIL: a missing field is caught', codes(mut((c) => { delete c.hookEvents; })).includes('SCHEMA_MISSING_FIELD'));
  const wrongVersion = mutObj(good, (c) => { c.catalogVersion = '9.9.9'; c.versionAwareness = versionAwarenessOf(c.tools, c.hookEvents, '9.9.9', null); });
  wrongVersion.integrity = computeIntegrity(wrongVersion);
  check('MUST FAIL: a catalogVersion that disagrees with evidence/VERIFIED_VERSION is caught',
    codes(verifyCatalogIntegrity(wrongVersion, { versionFile: VERSION_FILE })).includes('CATALOG_VERSION_MISMATCH'));
  check('the matching catalogVersion does NOT trip that rule',
    !codes(verifyCatalogIntegrity(mutObj(good, (c) => { c.catalogVersion = readVerifiedVersion(); c.integrity = computeIntegrity(c); }), { versionFile: VERSION_FILE })).includes('CATALOG_VERSION_MISMATCH'));

  console.log('consumer API');
  check('currentNames returns only current names', canonicalize([...currentNames('tools', good)]) === canonicalize(['Read']));
  check('knownNames includes non-current names', knownNames('tools', mutObj(good, (c) => { c.tools.MultiEdit = { status: 'legacy', provenance: c.tools.Read.provenance }; })).has('MultiEdit'));
  check('statusOf reports the status', statusOf('hookEvents', 'Stop', good) === 'current');
  check('statusOf on an unknown name is null', statusOf('tools', 'Frobnicate', good) === null);
  check('citation is longer than the doctor floor', String(citation('tools', 'Read', good)).length > MIN_CITATION);
  threw = false;
  try { currentNames('toolz', good); } catch { threw = true; }
  check('an unknown section throws', threw);

  console.log('drift');
  const tmp = mkdtempSync(join(tmpdir(), 'ccx-capcat-st-'));
  try {
    const mirror = join(tmp, 'md');
    mkdirSync(mirror);
    for (const id of PRIMARY_PAGES.concat(SUPPORTING_PAGES)) {
      let body = `# ${id}\n\nplaceholder page\n`;
      if (id === 'tools-reference.md') body = FIXTURE_TOOLS;
      if (id === 'hooks.md') body = FIXTURE_HOOKS;
      if (id === 'permissions.md') body = 'the legacy `MultiEdit` tool is still accepted here\n';
      if (id === 'errors.md') body = 'replace legacy `MultiEdit(path)` rules with Edit(path)\n';
      if (id === 'changelog.md') body = [
        '<Update label="2.1.220">',
        '  * Added SlashCommand tool, which enables Claude to invoke your slash commands.',
        '  * Renamed tools for consistency: LSTool to LS, View to Read, etc.',
        '</Update>',
      ].join('\n');
      writeFileSync(join(mirror, id), body);
    }
    const built = buildCatalog({ mirrorDir: mirror, catalogVersion: '2.1.220', benchPath: null, generated: 'X', generator: 'self-test' });
    check('a synthetic mirror builds', built.counts.toolsCurrent === 3, `got ${built.counts.toolsCurrent}`);
    check('curated non-table names land in the catalog', ['MultiEdit', 'SlashCommand', 'LS', 'NotebookRead'].every((n) => built.tools[n]));
    check('NotebookRead is unlisted with an absence citation', built.tools.NotebookRead.status === 'unlisted' && built.tools.NotebookRead.provenance[0].source === MIRROR_INDEX_ID);
    check('the built catalog verifies', verifyCatalogIntegrity(built, { versionFile: null }).ok, canonicalize(codes(verifyCatalogIntegrity(built, { versionFile: null }))));
    check('drift against its own mirror is clean', checkDrift(built, mirror, { catalogVersion: '2.1.220', benchPath: null }).ok);

    writeFileSync(join(mirror, 'tools-reference.md'), FIXTURE_TOOLS.replace('| `PowerShell` | Executes PowerShell on Windows hosts | Yes         |\n', ''));
    const drifted = checkDrift(built, mirror, { catalogVersion: '2.1.220', benchPath: null });
    check('MUST FAIL: a tool vanishing from the docs is drift', !drifted.ok);
    check('MUST FAIL: the drift is classified as an EXTRA catalog name', codes(drifted).includes('DRIFT_TOOL_EXTRA'));
    check('MUST FAIL: the changed source page is named', codes(drifted).includes('DRIFT_SOURCE_HASH'));
    writeFileSync(join(mirror, 'tools-reference.md'), FIXTURE_TOOLS);
    check('restoring the page restores the clean check', checkDrift(built, mirror, { catalogVersion: '2.1.220', benchPath: null }).ok);

    writeFileSync(join(mirror, 'tools-reference.md'), FIXTURE_TOOLS.replace(
      '| `PowerShell` | Executes PowerShell on Windows hosts | Yes         |',
      '| `PowerShell` | Executes PowerShell on Windows hosts | Yes         |\n| `Frobnicate` | A brand new tool nobody has yet   | Yes         |'));
    const added = checkDrift(built, mirror, { catalogVersion: '2.1.220', benchPath: null });
    check('MUST FAIL: a NEW documented tool is drift too', codes(added).includes('DRIFT_TOOL_MISSING'));
    writeFileSync(join(mirror, 'tools-reference.md'), FIXTURE_TOOLS);

    // A drift gate that repairs is a gate that can only fail once.
    if (existsSync(CATALOG_PATH)) {
      const before = sha256(readFileSync(CATALOG_PATH));
      checkDrift(built, mirror, { catalogVersion: '2.1.220', benchPath: null });
      check('checkDrift does NOT touch the committed catalog', sha256(readFileSync(CATALOG_PATH)) === before);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('live mirror');
  if (existsSync(DEFAULT_MIRROR)) {
    const toolsMd = readFileSync(join(DEFAULT_MIRROR, 'tools-reference.md'), 'utf8');
    const hooksMd = readFileSync(join(DEFAULT_MIRROR, 'hooks.md'), 'utf8');
    const realNaive = naiveToolScan(toolsMd);
    const realParsed = parseToolsTable(toolsMd).map((r) => r.name);
    const realEvents = parseHookEvents(hooksMd).map((e) => e.name);
    check(`MUST FAIL: the naive scan over the real page returns ${realNaive.length}, not 43`, realNaive.length === 46, `got ${realNaive.length}`);
    check('the real tools table has 43 rows', realParsed.length === 43, `got ${realParsed.length}`);
    check('the real hook-events section has 31 headings', realEvents.length === 31, `got ${realEvents.length}`);
    check('PowerShell is a real documented tool', realParsed.includes('PowerShell'));
    check('DirectoryAdded is a real documented event', realEvents.includes('DirectoryAdded'));
    check('url and protocols are not tools', !realParsed.includes('url') && !realParsed.includes('protocols'));
    const realAliases = parseAliases(readFileSync(join(DEFAULT_MIRROR, 'agent-sdk__python.md'), 'utf8')).map((a) => a.alias);
    check('the four documented aliases are still declared', ['Task', 'BashOutput', 'KillShell', 'KillBash'].every((n) => realAliases.includes(n)), realAliases.join(','));
  } else {
    console.log(`  skip: no docs mirror at ${DEFAULT_MIRROR}`);
  }

  console.log('committed catalog');
  if (existsSync(CATALOG_PATH)) {
    const v = verifyCatalogIntegrity(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')));
    check('the committed catalog verifies', v.ok, codes(v).join(','));
  } else {
    console.log(`  skip: no catalog at ${CATALOG_PATH} yet`);
  }

  /**
   * --check MUST NOT WRITE, WITH EITHER MIRROR FLAG.
   *
   * Independent review 2026-08-05 demonstrated `--check --from-mirror <dir>`
   * falling into the regeneration branch, overwriting the committed catalog and
   * exiting 0: a drift gate repairing the drift it detects. This row is safe to
   * run against the real catalog because it asserts only that the bytes do not
   * change, and it still detects the regression: the write path stamps a fresh
   * `generated` value, so a rewrite changes the hash even with no drift present.
   */
  console.log('--check is read-only');
  if (existsSync(CATALOG_PATH) && existsSync(DEFAULT_MIRROR)) {
    const digest = () => createHash('sha256').update(readFileSync(CATALOG_PATH)).digest('hex');
    for (const flag of ['--mirror', '--from-mirror']) {
      const before = digest();
      const code = run(['--check', flag, DEFAULT_MIRROR, '--quiet']);
      check(`--check ${flag} does not rewrite the committed catalog`,
        digest() === before, `exit ${code}, hash changed`);
    }
  } else {
    console.log('  skip: needs both the committed catalog and a docs mirror');
  }

  console.log(`\n${fail === 0 ? 'SELF-TEST PASS' : 'SELF-TEST FAIL'} ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

function mutObj(cat, f) {
  const c = JSON.parse(JSON.stringify(cat));
  f(c);
  return c;
}

// ------------------------------------------------------------------ prove-fail --

/**
 * Seven mutants of the COMMITTED catalog, each written into a temp dir and fed back
 * through the gates. Every mutant except the integrity-flip is RESEALED (its integrity
 * hash recomputed) first, because otherwise all seven would trip the same single hash
 * check and six of the rules would be decoration. Each mutant declares the code that
 * must reject it, so a mutant caught by the wrong rule counts as a failure.
 */
export function proveFail(opts = {}) {
  const catalogPath = opts.catalogPath || CATALOG_PATH;
  const mirrorDir = opts.mirrorDir || DEFAULT_MIRROR;
  if (!existsSync(catalogPath)) {
    console.log(`CANNOT PROVE: no catalog at ${catalogPath}`);
    return 2;
  }
  const base = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const haveMirror = existsSync(mirrorDir);
  const tmp = mkdtempSync(join(tmpdir(), 'ccx-capcat-pf-'));
  const beforeHash = sha256(readFileSync(catalogPath));
  let survived = 0;
  let checked = 0;
  let skipped = 0;

  const reseal = (c) => { c.integrity = computeIntegrity(c); return c; };
  const gate = (c) => {
    const v = verifyCatalogIntegrity(c);
    if (!v.ok) return v.errors.map((e) => e.code);
    if (!haveMirror) return [];
    const d = checkDrift(c, mirrorDir);
    return d.ok ? [] : d.errors.map((e) => e.code);
  };

  const mutants = [
    {
      label: 'drop the PowerShell tool',
      needsMirror: false,
      expect: 'COUNTS_MISMATCH',
      mutate: (c) => { delete c.tools.PowerShell; return reseal(c); },
    },
    {
      label: 'drop PowerShell AND correct the counts (a well-formed forgery, no mirror needed to catch it)',
      needsMirror: false,
      expect: 'CROSSCHECK_MISMATCH',
      note: 'internally consistent, but the committed competitor list still asserts PowerShell',
      mutate: (c) => {
        delete c.tools.PowerShell;
        c.counts = countOf(c.tools, c.hookEvents, c.sources);
        c.versionAwareness = versionAwarenessOf(c.tools, c.hookEvents, c.catalogVersion, null);
        return reseal(c);
      },
    },
    {
      label: 'drop PowerShell, correct the counts AND rewrite the cross-check (a total forgery)',
      needsMirror: true,
      expect: 'DRIFT_TOOL_MISSING',
      note: 'nothing internal contradicts it any more, so only the docs mirror can refute it',
      mutate: (c) => {
        delete c.tools.PowerShell;
        c.counts = countOf(c.tools, c.hookEvents, c.sources);
        c.versionAwareness = versionAwarenessOf(c.tools, c.hookEvents, c.catalogVersion, null);
        if (c.crossCheck && existsSync(BENCH_PATH)) c.crossCheck = crossCheckOf(c.tools, readFileSync(BENCH_PATH, 'utf8'));
        return reseal(c);
      },
    },
    {
      label: 'drop the DirectoryAdded hook event',
      needsMirror: false,
      expect: 'COUNTS_MISMATCH',
      mutate: (c) => { delete c.hookEvents.DirectoryAdded; return reseal(c); },
    },
    {
      label: 'drop DirectoryAdded AND correct the counts (a well-formed forgery)',
      needsMirror: true,
      expect: 'DRIFT_EVENT_MISSING',
      mutate: (c) => {
        delete c.hookEvents.DirectoryAdded;
        c.counts = countOf(c.tools, c.hookEvents, c.sources);
        c.versionAwareness = versionAwarenessOf(c.tools, c.hookEvents, c.catalogVersion, null);
        return reseal(c);
      },
    },
    {
      label: 'flip one byte of the integrity hash',
      needsMirror: false,
      expect: 'INTEGRITY_MISMATCH',
      mutate: (c) => { c.integrity = (c.integrity[0] === '0' ? '1' : '0') + c.integrity.slice(1); return c; },
    },
    {
      label: 'blank a provenance citation',
      needsMirror: false,
      expect: 'PROVENANCE_EMPTY',
      mutate: (c) => { c.tools[Object.keys(c.tools)[0]].provenance[0].quote = '   '; return reseal(c); },
    },
    {
      label: 'point a provenance at an undeclared source id',
      needsMirror: false,
      expect: 'PROVENANCE_UNDECLARED_SOURCE',
      mutate: (c) => { c.tools[Object.keys(c.tools)[0]].provenance[0].source = 'no-such-page.md'; return reseal(c); },
    },
    {
      label: 'set counts.toolsCurrent wrong',
      needsMirror: false,
      expect: 'COUNTS_MISMATCH',
      mutate: (c) => { c.counts.toolsCurrent = c.counts.toolsCurrent + 1; return reseal(c); },
    },
    {
      label: 'set catalogVersion to 9.9.9',
      needsMirror: false,
      expect: 'CATALOG_VERSION_MISMATCH',
      mutate: (c) => {
        c.catalogVersion = '9.9.9';
        c.versionAwareness = versionAwarenessOf(c.tools, c.hookEvents, '9.9.9', null);
        return reseal(c);
      },
    },
  ];

  try {
    for (let i = 0; i < mutants.length; i++) {
      const m = mutants[i];
      if (m.needsMirror && !haveMirror) {
        skipped++;
        console.log(`  SKIP  ${m.label} (needs the docs mirror at ${mirrorDir})`);
        continue;
      }
      const c = m.mutate(JSON.parse(JSON.stringify(base)));
      const p = join(tmp, `mutant-${i}.json`);
      writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
      const got = gate(JSON.parse(readFileSync(p, 'utf8')));
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

  if (sha256(readFileSync(catalogPath)) !== beforeHash) {
    console.log('  SURVIVED  the committed catalog was modified by --prove-fail');
    survived++;
  }

  if (survived) {
    console.log(`\nCATALOG GATE IS HOLLOW: ${survived} of ${checked} mutants were not rejected by the expected gate`);
    return 1;
  }
  if (skipped) {
    console.log(`\nPARTIAL PROOF: ${checked} mutants rejected, ${skipped} skipped for want of the docs mirror`);
    return 2;
  }
  console.log(`\nPROVE-FAIL PASS: all ${checked} mutants rejected by their named gate`);
  return 0;
}

// ------------------------------------------------------------------ cli --

function argValue(argv, flag, fallback) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

export function run(argv = process.argv.slice(2)) {
  const quiet = argv.includes('--quiet');
  const asJson = argv.includes('--json');

  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--prove-fail')) return proveFail({ mirrorDir: argValue(argv, '--from-mirror', DEFAULT_MIRROR) });

  /**
   * --check IS TESTED FIRST, AND THAT ORDER IS LOAD-BEARING.
   *
   * Independent review 2026-08-05: `--check --from-mirror <dir>` used to fall into
   * the regeneration branch below, overwrite the committed catalog, and exit 0. It
   * repaired the drift it was asked to detect, which violates the house rule and
   * this file's own header. It was not an exotic invocation either: --check's mirror
   * flag was --mirror while regeneration's was --from-mirror, so "check against this
   * mirror" composed straight into the write path.
   *
   * --check now accepts EITHER flag as a read-only mirror path and can never write.
   * Ordering it first is what makes that structural rather than a promise.
   */
  if (argv.includes('--check')) {
    const mirrorDir = argValue(argv, '--mirror', argValue(argv, '--from-mirror', DEFAULT_MIRROR));
    if (!existsSync(CATALOG_PATH)) { console.error(`no catalog at ${CATALOG_PATH}`); return 2; }
    const cat = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
    const res = checkDrift(cat, mirrorDir);
    if (res.cannotCheck) { console.error(res.errors[0].msg); return 2; }
    if (asJson) console.log(JSON.stringify({ ok: res.ok, errors: res.errors }, null, 2));
    else report(`catalog matches the docs mirror at ${mirrorDir}`, res, quiet);
    if (!res.ok && !quiet) console.log('regenerate with: node tools/capability-catalog.mjs --from-mirror <dir>');
    return res.ok ? 0 : 1;
  }

  if (argv.includes('--from-mirror')) {
    const mirrorDir = argValue(argv, '--from-mirror', DEFAULT_MIRROR);
    if (!existsSync(mirrorDir)) {
      console.error(`cannot generate: no docs mirror at ${mirrorDir}`);
      return 2;
    }
    const out = argValue(argv, '--out', CATALOG_PATH);
    const cat = buildCatalog({ mirrorDir, generator: `tools/capability-catalog.mjs --from-mirror ${mirrorDir}` });
    const v = verifyCatalogIntegrity(cat);
    if (!v.ok) {
      console.error('refusing to write: the freshly built catalog does not verify');
      for (const e of v.errors) console.error(`  [${e.code}] ${e.msg}`);
      return 1;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(cat, null, 2) + '\n');
    if (!quiet) {
      summarize(cat);
      console.log(`wrote ${out}`);
    }
    return 0;
  }

  // default: --check-integrity
  if (!existsSync(CATALOG_PATH)) {
    console.error(`no catalog at ${CATALOG_PATH} (generate it with --from-mirror <dir>)`);
    return 2;
  }
  let cat;
  try {
    cat = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  } catch (e) {
    console.error(`catalog is not valid JSON: ${e.message}`);
    return 1;
  }
  const res = verifyCatalogIntegrity(cat);
  if (asJson) { console.log(JSON.stringify({ ok: res.ok, errors: res.errors, counts: cat.counts }, null, 2)); return res.ok ? 0 : 1; }
  if (!quiet && res.ok) summarize(cat);
  report('catalog integrity', res, quiet);
  return res.ok ? 0 : 1;
}

if (IS_MAIN) {
  process.exit(run());
}
