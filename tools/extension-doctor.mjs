#!/usr/bin/env node
/**
 * extension-doctor: walks a Claude Code configuration surface across scopes
 * and reports the silent-failure conditions this repo's references document,
 * each finding citing the reference behind it.
 *
 *   node tools/extension-doctor.mjs [--home <dir>] [--project <dir>] [--json]
 *                                   [--delegate <agnix-bin>] [--no-delegate]
 *                                   [--assume-version <semver>] [--strict-unknown]
 *   node tools/extension-doctor.mjs --self-test
 *
 * Division of labor, measured rather than asserted (tests/results-lint-bench.md):
 * per-file linting has a capable incumbent in agnix, so when it is available
 * its file-anchored diagnostics are ingested rather than reimplemented. What
 * nothing else does, and what this file is for, is the CROSS-SCOPE and
 * SEMANTIC layer: the same name at two scopes, a key silently shadowed by
 * precedence, a hook that can never fire, a config that is valid but inert on
 * the installed version.
 *
 * Read-only by construction: the only fs writes in this file are inside
 * --self-test's temp fixtures. Exit 1 when any BROKEN finding exists.
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { homedir, tmpdir } from 'os';
import {
  loadCatalog, currentNames, knownNames, statusOf, entryOf, citation as catalogCitation,
  cmpVersion, verifyCatalogIntegrity, CATALOG_PATH,
} from './capability-catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ doc data --

/**
 * THE CAPABILITY CATALOG, not a hand-typed Set.
 *
 * Both name lists in this file used to be literals. The measured consequence:
 * a subagent declaring "tools: PowerShell" was reported BROKEN by a tool whose
 * headline is 12 of 12 with ZERO false positives, because PowerShell shipped in
 * 2.1.84 and nobody retyped the Set. A literal has no version, no provenance,
 * and no way to notice it went stale.
 *
 * data/capabilities/catalog.json is generated from the official docs mirror,
 * carries a citation per name, records the build it enumerates, and is sealed
 * with a sha256 its own gate re-derives. Everything below reads from it.
 *
 * Load is FAIL SOFT on purpose. loadCatalog throws on a corrupt catalog, and a
 * doctor that died there would be strictly worse than one that keeps its twelve
 * other checks and downgrades name checking to UNVERIFIED. The degradation is
 * announced in the header line, once, and never as a per-config finding: the
 * bench already taught this repo that run-level boilerplate must not enter the
 * findings list (the VER-001 fake catch, see tests/lint-bench/run-bench.mjs).
 */
export let CATALOG = null;
export let CATALOG_ERROR = null;
try {
  CATALOG = loadCatalog();
} catch (e) {
  CATALOG = null;
  CATALOG_ERROR = String(e && e.message ? e.message : e);
}

/**
 * Hook event names on the build the catalog enumerates. Exported for API
 * stability; it is now DERIVED, and the catalog's 31st event (DirectoryAdded,
 * hooks.md:2462, since 2.1.219) arrived here without anyone retyping anything.
 *
 * Do NOT read an empty Set as "nothing is valid": when the catalog is
 * unavailable these are empty and classifyHookEvent/classifyTool fail open to
 * UNKNOWN. The Sets are a convenience view; the classifiers are the API.
 */
export const HOOK_EVENTS = new Set(CATALOG ? currentNames('hookEvents', CATALOG) : []);

/** Built-in tool names a subagent tools list may reference. mcp__* passes by shape. */
export const KNOWN_TOOLS = new Set(CATALOG ? currentNames('tools', CATALOG) : []);

/** Re-exported so callers get ONE version comparator. '2.1.9' < '2.1.220' numerically. */
export { cmpVersion };

/** Skill description + when_to_use combined cap that Claude Code truncates at. */
export const DESC_CAP = 1536;
export const MEMORY_LINE_CAP = 200;
export const MEMORY_BYTE_CAP = 25 * 1024;

const CITE = {
  frontmatter: 'skills.md Frontmatter [LOCAL_ENV, measured 2026-07-30]: unparseable YAML loads with EMPTY metadata; this repo\'s own skill was dead for weeks this way (0%/16% trigger recall until fixed)',
  descCap: 'skills.md description cap [OFFICIAL]: description plus when_to_use truncates at ~1536 chars; the tail silently stops triggering',
  nameFormat: 'skills.md name format [OFFICIAL]: non-kebab-case names are silently ignored',
  dupSkill: 'skills.md scope shadowing [OFFICIAL]: same name at two scopes, one silently wins; /doctor only checks one directory',
  hookEvent: 'hook-events.md event table [OFFICIAL]: a hook under an unknown event never fires and nothing reports it',
  matcher: 'hooks.md matchers [OFFICIAL]: an array matcher is a schema error that rejects the WHOLE settings file; a bad regex never matches and fails open',
  handler: 'hooks.md failure policy [OFFICIAL]: command hooks fail OPEN, so a missing handler means the rule silently never enforces',
  disableAll: 'selection.md tamper boundary [OFFICIAL]: disableAllHooks switches every hook off and there is no per-hook disable',
  shadowing: 'settings precedence [OFFICIAL]: managed > CLI > local > project > user; the loser looks configured and does nothing',
  agentTools: 'subagents.md tools resolution [OFFICIAL] [v2.1.208]: an unresolvable tools list refuses to spawn',
  memoryCap: 'official memory docs [OFFICIAL] [v2.1.210]: MEMORY.md index over 200 lines errors instead of loading',
  mcpScope: 'mcp.md scopes [OFFICIAL]: same server name at two scopes, one config silently wins',
  versionPin: 'plugins.md versioning [OFFICIAL], IMPROVEMENTS.md item 6 (measured on this repo): a pinned version is the update cache key; updates stop until the string changes',
  capabilityStatus: 'data/capabilities/catalog.json [GENERATED from the official docs mirror]: the docs record this name as a previous, renamed, SDK-only or undocumented capability rather than a current one, so a config naming it can resolve today and stop resolving with no error; the provenance line follows',
  capabilityCoverage: 'data/capabilities/catalog.json [GENERATED] versionAwareness: the catalog enumerates one build, so a name it lacks is proof of nonexistence ONLY on a build it covers; on a newer or undetermined build the honest answer is UNVERIFIED, because a false BROKEN is the exact defect this catalog replaced',
  mcpShape: 'mcp.md tool naming [OFFICIAL]: an MCP tool reference is mcp__<server>__<tool> with a lowercase server segment and no globs; anything else never resolves to a server on any build',
  caseSensitive: 'data/capabilities/catalog.json [GENERATED]: built-in name resolution is case sensitive and the correct spelling is in the catalog, so a case variant is wrong on EVERY build, newer ones included',

  // Monitors. Every string below is quoted from references/monitors.md, and the
  // [TAG] is the tag that line actually carries there: an [ENGINEERING] line is
  // cited as [ENGINEERING], never promoted to [OFFICIAL] to sound better.
  monitorUserConfig: 'monitors.md Secrets and user_config [OFFICIAL] [v2.1.207]: since v2.1.207 Claude Code REJECTS the monitor with an error instead of substituting the value, the check runs on the command TEMPLATE so it fires even with nothing configured yet, and the rest of the plugin keeps loading and looks healthy',
  monitorSchema: 'monitors.md No block or deny contract [OFFICIAL] [v2.1.105]: the entire documented schema is name, command, description and when, with when either "always" (the default) or "on-skill-invoke:<skill-name>"; monitors.md What the documentation does not say records that whether an entry missing a required field is a hard error or is silently skipped is UNVERIFIED, so a schema violation is reported rather than assumed harmless',
  monitorSkillRef: 'monitors.md Configuration [OFFICIAL] [v2.1.105]: "on-skill-invoke:<skill-name>" starts the monitor the first time THAT SKILL IN THIS PLUGIN is dispatched, so a name no skill in the plugin answers to never arms, and monitors.md adds that no user-facing notice is documented for the silent cases',
  monitorDupName: 'monitors.md Configuration [OFFICIAL] [v2.1.105]: name is the identifier unique within the plugin and is the dedup key that prevents duplicate processes when the plugin reloads or the skill is invoked again; monitors.md Lifecycle and working directory [ENGINEERING] adds that it is the ONLY documented protection against duplicates',
  monitorCommandMissing: 'monitors.md No block or deny contract [ENGINEERING]: fail-open is the only posture available, so when a monitor dies the session simply stops hearing from it and carries on, and the absence of notifications is indistinguishable from nothing having happened',
  monitorCwd: 'monitors.md Lifecycle and working directory [OFFICIAL]: the cwd is the SESSION working directory, NOT the plugin directory, so a relative path resolves against wherever the user started Claude Code, which is the single most likely reason a monitor "never fires"; prefix with cd "${CLAUDE_PLUGIN_ROOT}" && when the script needs its own directory',
  monitorOptionVar: 'monitors.md Secrets and user_config [OFFICIAL] [v2.1.207]: monitor processes do NOT receive CLAUDE_PLUGIN_OPTION_<KEY> environment variables, which is where a monitor is strictly poorer than a hook, and the one documented answer is to have the monitor script read the value from a config file it owns',
  monitorLegacyKey: 'monitors.md Configuration [OFFICIAL] [v2.1.129]: the experimental.monitors key arrived at v2.1.129; a top-level monitors key still loads, but claude plugin validate warns and a future release will require the experimental.* form',

  // Channels.
  channelServerBinding: 'channels.md The four gates [OFFICIAL]: gate 2 is an .mcp.json or plugin mcpServers entry, and channels.md [ENGINEERING] adds that Claude Code spawns each configured server as a subprocess, so no entry means no process, the listener never binds, and an external POST is refused rather than accepted and dropped',
  channelAllowlistShape: 'channels.md Managed settings and availability [OFFICIAL] [v2.1.84]: allowedChannelPlugins REPLACES the Anthropic list when set and names each entry as a plugin plus its marketplace, so an entry missing either half names no plugin the allowlist can match',
  channelAllowlistInert: 'channels.md Managed settings and availability [OFFICIAL] [v2.1.84]: channelsEnabled is the master switch and must be true for any channel to deliver, and allowedChannelPlugins applies only while channelsEnabled is true, so on its own the list reads as policy and enforces nothing',
  channelAllowlistEmpty: 'channels.md Managed settings and availability [OFFICIAL]: an EMPTY allowedChannelPlugins array is not a kill switch, because --dangerously-load-development-channels still bypasses it; to block channels entirely including the development flag, leave channelsEnabled UNSET',
};

// ------------------------------------------------------------------- helpers --

const readText = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = p => { const t = readText(p); if (t === null) return { missing: true }; try { return { value: JSON.parse(t) }; } catch (e) { return { parseError: String(e.message) }; } };
const listDirs = p => { try { return readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };
const listFiles = (p, re) => { try { return readdirSync(p).filter(f => re.test(f)); } catch { return []; } };

/**
 * Frontmatter strictness, scoped to the defect classes that actually kill
 * skills. Deliberately NOT a full YAML parser: it accepts everything a normal
 * frontmatter uses and flags the shapes real parsers reject, of which the
 * unquoted colon is the one that shipped in this very repo.
 *
 * The first version was single-line and the live calibration run immediately
 * produced two false positives on this machine's real skills: a LEGAL
 * multi-line double-quoted scalar (agent-memory-systems) and a LEGAL
 * zero-indent block sequence under tags:/tools: (claude-monitor). Both shapes
 * are now modeled. A doctor that cries wolf on valid config is worse than no
 * doctor; the clean-tree-zero-findings rule exists for exactly this.
 *
 * BUT modeling a shape is not the same as READING it, and that gap shipped.
 * Independent review 2026-08-05: block-sequence items were skipped for
 * complaint purposes AND dropped on the floor, so `tools:` written as a list
 * left fields.tools empty, and every downstream name check was guarded behind
 * `if (toolsRaw)`. An invented tool name, a case variant, and a malformed mcp
 * name all reported ZERO findings on a covered build in three of the five legal
 * frontmatter forms. Suppressing a false positive by discarding the input turns
 * the detector into a check that cannot fail. Sequence values are now COLLECTED,
 * joined the same way the comma form already parses, so the classifier sees them.
 */
/** Append one YAML sequence item to a field, as the comma form the parser reads. */
function appendSeqItem(fields, key, raw) {
  const item = raw.trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
  if (!item) return;
  fields[key] = fields[key] ? `${fields[key]}, ${item}` : item;
}

export function frontmatterProblems(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [{ kind: 'no-frontmatter', detail: 'no frontmatter block found' }];
  const problems = [];
  const fields = {};
  const lines = m[1].split('\n');
  let inQuote = null;      // quote char while inside a multi-line quoted scalar
  let inBlockScalar = false; // after key: | or key: >
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inQuote) {
      if (currentKey) fields[currentKey] += ' ' + line.trim().replace(new RegExp(inQuote + '\\s*$'), '');
      if (new RegExp(`${inQuote}\\s*$`).test(line)) inQuote = null;
      continue;
    }
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\t/.test(line)) { problems.push({ kind: 'tab-indent', detail: `line ${i + 1}: tab indentation is invalid YAML` }); continue; }
    if (/^\s+\S/.test(line)) {
      // Indented: a sequence item, block-scalar content, a folded continuation,
      // or nested structure.
      const seq = line.match(/^\s+-\s*(.+)$/);
      if (currentKey && seq) { appendSeqItem(fields, currentKey, seq[1]); continue; }
      if (currentKey && !/^\s+-\s*$/.test(line)) fields[currentKey] = (fields[currentKey] || '') + ' ' + line.trim();
      continue;
    }
    inBlockScalar = false;
    // Zero-indent sequence item: legal YAML, and its VALUE must reach the field.
    const zseq = line.match(/^-\s*(.+)$/);
    if (zseq) { if (currentKey) appendSeqItem(fields, currentKey, zseq[1]); continue; }
    if (line === '-') continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!kv) { problems.push({ kind: 'not-a-mapping', detail: `line ${i + 1}: not a key-value line` }); continue; }
    currentKey = kv[1];
    let v = kv[2].trim();
    fields[currentKey] = v;
    if (!v) continue;
    if (v === '|' || v === '>' || /^[|>][+-]?$/.test(v)) { inBlockScalar = true; fields[currentKey] = ''; continue; }
    if (v.startsWith('"') || v.startsWith("'")) {
      const q = v[0];
      if (v.length > 1 && v.endsWith(q) && !v.endsWith(`\\${q}`)) {
        fields[currentKey] = v.slice(1, -1);
      } else {
        inQuote = q;
        fields[currentKey] = v.slice(1);
      }
    } else if (v.startsWith('[') || v.startsWith('{')) {
      // flow collection: accepted
    } else {
      const noComment = v.replace(/\s#.*$/, '');
      if (/:\s/.test(noComment)) {
        // THE defect: a plain scalar containing colon-space is "mapping values
        // are not allowed here" in every real parser. Item 19, byte for byte.
        problems.push({ kind: 'unquoted-colon', detail: `line ${i + 1}: ${currentKey} is an unquoted scalar containing ": "; real YAML parsers reject this and the skill loads with EMPTY metadata. Quote the value.` });
      }
    }
  }
  if (inQuote) problems.push({ kind: 'unclosed-quote', detail: `${currentKey} opens a quote that never closes before the frontmatter ends` });
  return problems.length ? problems : Object.assign([], { fields });
}
export function frontmatterFields(text) {
  const r = frontmatterProblems(text);
  return r.fields || null;
}

// ------------------------------------------------------- version awareness --

/**
 * Read-only detection of the Claude Code build a configuration runs against.
 *
 * Rooted at the home ARGUMENT, never os.homedir(). The lint bench redirects HOME
 * to a fixture copy, and a detector that quietly consulted the real machine
 * would report this box's build while linting somebody else's tree, which is a
 * false-positive generator wearing a version number.
 *
 * It NEVER spawns claude. Read-only is this tool's whole selling point, and the
 * benched competitor (claude plugin validate) was measured WRITING inside the
 * fixture home during a scoring run. Asking the binary its own version would put
 * us in that same category for a fact that is already on disk. existsSync plus a
 * JSON read is the ceiling.
 *
 * CONFIDENCE IS LOAD BEARING, not decoration. Rung 3 reads
 * .claude.json lastOnboardingVersion, which records the build that last ran
 * ONBOARDING and is therefore <= the installed build. Understating the build
 * makes the catalog look MORE complete than it is, and that is precisely the
 * direction that manufactures a false BROKEN. So the hard rule, enforced in
 * classifyName and covered by its own self-test: a WEAK or ABSENT signal may
 * only widen UNKNOWN, it can never license a BROKEN. Fail open on the version,
 * fail closed on the citation.
 *
 * @returns {{version: string|null, confidence: 'strong'|'weak'|'none', rung: string|null, source: string|null}}
 */
export function detectInstalledVersion({ home } = {}) {
  const none = { version: null, confidence: 'none', rung: null, source: null };
  if (!home || typeof home !== 'string') return none;

  // Rung 1: the installer's own versions store. Several may coexist after an
  // update, so take the HIGHEST, NUMERICALLY: a lexical sort puts 2.1.9 above
  // 2.1.220 and would understate the build, which is the direction that
  // manufactures a false BROKEN.
  //
  // Entries count whether they are DIRECTORIES OR FILES. The first draft took
  // directories only, per the obvious reading of "versions/<version>/". On the
  // one machine we can actually observe, the installer had written a single
  // 265 MB FILE named 2.1.219 (the binary itself), so this rung was dead here:
  // detection silently dropped to the weak onboarding rung and the header
  // announced NOT PROVEN for a build that was sitting right there, strongly
  // determinable. A rung that cannot fire on the only observable machine is not
  // a rung, so both layouts are accepted.
  const versionsDir = join(home, '.local', 'share', 'claude', 'versions');
  let stored = [];
  try {
    stored = readdirSync(versionsDir, { withFileTypes: true })
      .filter(e => (e.isDirectory() || e.isFile()) && /^\d+\.\d+\.\d+$/.test(e.name))
      .map(e => e.name)
      .sort(cmpVersion);
  } catch { stored = []; }
  if (stored.length) {
    const best = stored[stored.length - 1];
    return { version: best, confidence: 'strong', rung: 'versions-store', source: join(versionsDir, best) };
  }

  // Rung 2: a global npm install. POSIX npm puts packages under <prefix>/lib/
  // node_modules; Windows npm puts them under <prefix>/node_modules with no lib
  // segment, so both are probed rather than assuming the layout of whichever OS
  // wrote the docs.
  const prefixes = [];
  if (process.env.npm_config_prefix) prefixes.push(process.env.npm_config_prefix);
  if (process.platform === 'win32' && process.env.APPDATA) prefixes.push(join(process.env.APPDATA, 'npm'));
  prefixes.push('/usr/local');
  for (const prefix of prefixes) {
    for (const nm of [join(prefix, 'lib', 'node_modules'), join(prefix, 'node_modules')]) {
      const pj = join(nm, '@anthropic-ai', 'claude-code', 'package.json');
      if (!existsSync(pj)) continue;
      const r = readJson(pj);
      const v = r.value && typeof r.value.version === 'string' ? r.value.version.trim() : '';
      if (/^\d+(\.\d+)+/.test(v)) return { version: v, confidence: 'strong', rung: 'npm-global', source: pj };
    }
  }

  // Rung 3: WEAK. The build that last ran onboarding, which lags the installed
  // build after an update. Widens unknown, never narrows it.
  const claudeJson = join(home, '.claude.json');
  if (existsSync(claudeJson)) {
    const r = readJson(claudeJson);
    const v = r.value && typeof r.value.lastOnboardingVersion === 'string' ? r.value.lastOnboardingVersion.trim() : '';
    if (/^\d+(\.\d+)+$/.test(v)) return { version: v, confidence: 'weak', rung: 'onboarding', source: claudeJson };
  }

  return none;
}

/** Accepts a bare semver (treated as strong, which is what --assume-version means)
 *  or a detector result. Anything else collapses to "no signal". */
export function versionSignal(v) {
  const none = { version: null, confidence: 'none', rung: null, source: null };
  if (v === null || v === undefined) return none;
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? { version: t, confidence: 'strong', rung: 'assumed', source: null } : none;
  }
  if (typeof v !== 'object') return none;
  const version = typeof v.version === 'string' && v.version.trim() ? v.version.trim() : null;
  if (!version) return none;
  return {
    version,
    confidence: v.confidence === 'weak' ? 'weak' : v.confidence === 'none' ? 'none' : 'strong',
    rung: v.rung || null,
    source: v.source || null,
  };
}

/**
 * The asymmetry, in one boolean. Absence from the catalog is evidence of
 * nonexistence only when a STRONG signal puts the running build at or below the
 * build the catalog enumerates. Everything else (newer build, weak signal, no
 * signal, no catalog) means the catalog cannot speak for that build.
 */
export function absenceIsProof(catalog, running) {
  const sig = versionSignal(running);
  const cv = catalog && typeof catalog.catalogVersion === 'string' ? catalog.catalogVersion : null;
  if (!cv || !sig.version || sig.confidence !== 'strong') return false;
  return cmpVersion(sig.version, cv) <= 0;
}

/** One line, printed once, stating what the catalog covers and which way the
 *  asymmetry runs on this machine. Silence about coverage is how a stale name
 *  list passes for an authority. */
export function versionHeader(catalog, running) {
  const sig = versionSignal(running);
  const proof = absenceIsProof(catalog, sig);
  if (!catalog) {
    return `capability catalog UNAVAILABLE at ${CATALOG_PATH} (${CATALOG_ERROR || 'not loaded'}); regenerate it with node tools/capability-catalog.mjs --from-mirror <dir>: until then every tool and hook event name is reported UNVERIFIED, not BROKEN.`;
  }
  const c = catalog.counts || {};
  const head = `capability catalog ${catalog.catalogVersion} (${c.toolsCurrent ?? Object.keys(catalog.tools || {}).length} current tools, ${c.hookEventsCurrent ?? Object.keys(catalog.hookEvents || {}).length} current hook events)`;
  if (proof) {
    return `${head}; installed build ${sig.version} (${sig.rung}, ${sig.confidence}) is covered by the catalog: an absent name is reported BROKEN.`;
  }
  if (!sig.version) {
    return `${head}; the installed build could not be detected: names absent from the catalog are reported UNVERIFIED, not BROKEN.`;
  }
  if (sig.confidence !== 'strong') {
    return `${head}; installed build ${sig.version} (${sig.rung}, ${sig.confidence} signal, a lower bound only) is NOT PROVEN covered by the catalog: names absent from the catalog are reported UNVERIFIED, not BROKEN.`;
  }
  return `${head}; installed build ${sig.version} (${sig.rung}, ${sig.confidence}) is NEWER than the catalog: names absent from the catalog are reported UNVERIFIED, not BROKEN.`;
}

// ------------------------------------------------------- name classification --

/**
 * Per-section wiring for the shared classifier. A new catalog section (the
 * monitor and channel checks land next) needs one row here plus a call site;
 * the rules, the version asymmetry and the citation floor come for free.
 *
 * The INVALID ids are the ones that already exist, deliberately: the bench
 * fixtures score on them and a rename would have quietly rewritten history.
 * UNSUPPORTED and UNVERIFIED are new ids because they are new claims.
 */
export const NAME_CHECKS = {
  tools: {
    label: 'tool',
    where: name => `tools lists "${name}"`,
    invalid: 'agent-unresolvable-tool',
    unsupported: 'agent-unsupported-tool',
    unknown: 'agent-unverified-tool',
    invalidCite: CITE.agentTools,
    consequence: 'since v2.1.208 an unresolvable tools list refuses to spawn the subagent',
    softConsequence: 'the subagent spawns today and can stop spawning with no error the moment the alias is dropped',
    fix: 'Remove or correct the entry.',
  },
  hookEvents: {
    label: 'hook event',
    where: name => `hook event "${name}"`,
    invalid: 'hook-unknown-event',
    unsupported: 'hook-unsupported-event',
    unknown: 'hook-unverified-event',
    invalidCite: CITE.hookEvent,
    consequence: 'every hook under it never fires and nothing reports it',
    softConsequence: 'hooks under it may fire today and stop with no error, and nothing reports it',
    fix: 'Use a current event name from the catalog.',
  },
};

const MCP_NAME = /^mcp__[a-z0-9_-]+(__[A-Za-z0-9_-]+)?$/;
const MCP_LOOKALIKE = /^mcp__/i;
const PLAIN_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Per-catalog derived views. Keyed on the catalog OBJECT so an injected test
 *  catalog never collides with the committed one. */
const _views = new WeakMap();
function catalogView(section, catalog) {
  if (!catalog) return { current: new Set(), known: new Set(), byLower: new Map() };
  let per = _views.get(catalog);
  if (!per) { per = {}; _views.set(catalog, per); }
  if (!per[section]) {
    const current = currentNames(section, catalog);
    const byLower = new Map();
    for (const n of current) byLower.set(n.toLowerCase(), n);
    per[section] = { current, known: knownNames(section, catalog), byLower };
  }
  return per[section];
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Up to three catalog names a typo plausibly meant. Current names outrank
 *  non-current ones, because suggesting a legacy alias as the fix would be
 *  trading one silent failure for another.
 *
 *  The name itself is excluded. The first live run advised replacing MultiEdit
 *  with "MultiEdit": the name is in the catalog (as legacy), so it matched
 *  itself at distance zero and outranked every real suggestion. A fix line that
 *  restates the problem is worse than no fix line. A CASE variant is still
 *  offered, since powershell to PowerShell is exactly the advice wanted. */
export function nearestNames(name, section, catalog, limit = 3) {
  const { current, known } = catalogView(section, catalog);
  const lower = String(name).toLowerCase();
  const budget = Math.max(2, Math.floor(lower.length / 3));
  return [...known]
    .filter(n => n !== name)
    .map(n => ({ n, d: editDistance(lower, n.toLowerCase()), cur: current.has(n) ? 0 : 1 }))
    .filter(x => x.d <= budget)
    .sort((a, b) => a.cur - b.cur || a.d - b.d || a.n.localeCompare(b.n))
    .slice(0, limit)
    .map(x => x.n);
}

/**
 * The one classifier. Rules IN ORDER, and the order is the point:
 *
 *   a. "*" and a well-formed mcp__<server>[__<tool>] reference are valid, and
 *      are valid with NO catalog at all: MCP names resolve against a running
 *      server, never against a docs table.
 *   b. INVALID regardless of version: a malformed shape, an mcp lookalike whose
 *      server segment is wrong-case or globbed, and a name that matches a
 *      CURRENT catalog entry case insensitively but not exactly. A case error
 *      cannot be fixed by a newer build, because the correct casing is sitting
 *      in the catalog next to it.
 *   c. status current            -> valid
 *   d. status legacy / historical / sdk-only / unlisted -> UNSUPPORTED, which is
 *      a real answer ("here is the line that says it was renamed"), not a shrug.
 *   e. absent from the catalog   -> INVALID only when absenceIsProof, else UNKNOWN.
 *
 * @returns {{class:'valid'|'invalid'|'unsupported'|'unknown', severity:string|null,
 *            confidence:'strong'|'weak'|'none', why:string, nearest:string[]}}
 */
export function classifyName(section, name, catalog, running, opts = {}) {
  const spec = NAME_CHECKS[section];
  if (!spec) throw new Error(`classifyName: unknown section "${section}" (expected ${Object.keys(NAME_CHECKS).join(' or ')})`);
  const label = spec.label;
  const sig = versionSignal(running);
  const cv = catalog && typeof catalog.catalogVersion === 'string' ? catalog.catalogVersion : null;
  const view = catalogView(section, catalog);
  const near = () => nearestNames(name, section, catalog);

  const valid = why => ({ class: 'valid', severity: null, confidence: 'strong', why, nearest: [] });
  const invalid = (why, nearest) => ({ class: 'invalid', severity: 'BROKEN', confidence: 'strong', why, nearest: nearest || [] });

  if (typeof name !== 'string' || name === '') {
    return invalid(`an empty ${label} name is not a ${label} on any build; ${spec.consequence}`, []);
  }

  // (a)
  if (name === '*') return valid('"*" is the documented match everything wildcard, not a name to resolve');
  if (MCP_NAME.test(name)) {
    return valid(`"${name}" is a well formed mcp__<server>[__<tool>] reference; MCP names resolve against a running server, so no catalog can adjudicate them`);
  }

  // (b) shape errors, wrong on every build
  if (MCP_LOOKALIKE.test(name)) {
    return invalid(`"${name}" looks like an MCP reference but is not mcp__<server>[__<tool>] with a lowercase server segment and no globs, so it resolves to no server on any build; ${spec.consequence}`, ['mcp__<server>__<tool>']);
  }
  if (!PLAIN_NAME.test(name)) {
    return invalid(`"${name}" is not a plain identifier (letter first, then letters, digits or underscores), so it is not a ${label} on any build; ${spec.consequence}`, near());
  }
  const canonical = view.byLower.get(name.toLowerCase());
  if (canonical && canonical !== name) {
    return invalid(`"${name}" differs only in case from the current ${label} "${canonical}"; name resolution is case sensitive and the correct spelling is in the catalog, so this is wrong on every build including newer ones; ${spec.consequence}`, [canonical]);
  }

  // (c) and (d)
  const status = catalog ? statusOf(section, name, catalog) : null;
  if (status === 'current') {
    return valid(`"${name}" is a current ${label} in capability catalog ${cv}`);
  }
  if (status) {
    const entry = entryOf(section, name, catalog) || {};
    const alias = entry.aliasOf ? `, renamed to "${entry.aliasOf}"` : '';
    const reason = entry.reason ? ` (${entry.reason})` : '';
    return {
      class: 'unsupported',
      severity: 'SILENT',
      confidence: 'strong',
      why: `"${name}" is recorded in capability catalog ${cv} with status ${status}${alias}${reason}, not as a current ${label}; ${spec.softConsequence}`,
      nearest: entry.aliasOf ? [entry.aliasOf] : near(),
    };
  }

  // (e) absent
  if (absenceIsProof(catalog, sig)) {
    return invalid(`"${name}" is not a ${label} in capability catalog ${cv}, which completely enumerates that build, and the installed build ${sig.version} is at or below it, so absence is proof the name does not exist here; ${spec.consequence}`, near());
  }
  const because = !catalog ? 'the capability catalog is unavailable'
    : !sig.version ? 'the installed build could not be detected'
      : sig.confidence !== 'strong' ? `the only version signal is weak (${sig.rung}, a lower bound on the real build)`
        : `the installed build ${sig.version} is newer than catalog ${cv}`;
  return {
    class: 'unknown',
    severity: opts.strictUnknown ? 'BROKEN' : 'SILENT',
    confidence: 'weak',
    why: `"${name}" is not in the capability catalog${cv ? ` ${cv}` : ''} and ${because}, so it is UNVERIFIED rather than broken; if the name is not real then ${spec.consequence}`,
    nearest: near(),
  };
}

export function classifyTool(name, catalog, running, opts = {}) {
  return classifyName('tools', name, catalog, running, opts);
}
export function classifyHookEvent(name, catalog, running, opts = {}) {
  return classifyName('hookEvents', name, catalog, running, opts);
}

// -------------------------------------------------------------------- checks --

function F(severity, check, where, what, fix, citation) {
  return { severity, check, where, what, fix, citation, source: 'doctor' };
}

/**
 * Turn a classification into a finding, or null when the name is fine.
 * The citation floor is absolute: an uncited complaint is an opinion, so every
 * branch here composes a string well past the 10 char floor, and the
 * catalog's own provenance line is appended whenever the catalog knows the name.
 */
export function nameFinding(section, name, cls, where, ctx = {}) {
  if (!cls || cls.class === 'valid') return null;
  const spec = NAME_CHECKS[section];
  const check = spec[cls.class];
  const catalog = ctx.catalog === undefined ? CATALOG : ctx.catalog;
  const sig = versionSignal(ctx.signal);

  let cite;
  if (cls.class === 'invalid') {
    cite = /^mcp__/i.test(name) ? CITE.mcpShape
      : cls.nearest.length === 1 && cls.nearest[0].toLowerCase() === String(name).toLowerCase() ? CITE.caseSensitive
        : spec.invalidCite;
  } else if (cls.class === 'unsupported') {
    cite = CITE.capabilityStatus;
  } else {
    cite = `${CITE.capabilityCoverage} (catalog ${catalog ? catalog.catalogVersion : 'unavailable'}, detected build ${sig.version || 'unknown'}${sig.version ? `, ${sig.confidence} signal` : ''})`;
  }
  const prov = catalog ? catalogCitation(section, name, catalog) : null;
  if (prov) cite = `${cite} | ${prov}`;

  const nearest = cls.nearest.length ? ` Nearest catalog name(s): ${cls.nearest.join(', ')}.` : '';
  // The replacement is only named when the CATALOG named it (aliasOf), never
  // when it came out of the edit-distance guesser: "did you mean" is a hint,
  // and printing a hint as an instruction is how a linter earns distrust.
  const entry = catalog ? entryOf(section, name, catalog) : null;
  const fix = cls.class === 'unsupported'
    ? (entry && entry.aliasOf ? `Replace it with "${entry.aliasOf}".` : `Replace it with a current ${spec.label} name, or remove it.`)
    : cls.class === 'unknown'
      ? 'Confirm the name against the build you actually run, then regenerate data/capabilities/catalog.json so the answer stops being a guess.'
      : spec.fix;

  const f = F(cls.severity, check, where, `${spec.where(name)}: ${cls.why}.${nearest}`, fix, cite);
  f.class = cls.class;
  f.confidence = cls.confidence;
  return f;
}

// --------------------------------------------------- monitors and channels --

/**
 * DELIBERATELY NOT CHECKED, and the reason for each, so a later reader does not
 * "fix" the omission by adding a check that cannot be right. Every one of these
 * is a REAL failure mode documented in references/monitors.md or
 * references/channels.md; none of them is statically decidable from a source
 * tree, and a check that fires on correct config is worse than no check at all.
 *
 *   MONITOR CHATTINESS (monitors.md Context cost). Not statically decidable. A
 *   `tail -F` and a filtered watch are the same string until you run them, and
 *   the cost depends on the source's line rate, which is not in the repo.
 *
 *   HOST AVAILABILITY (monitors.md Where monitors silently do not run: Bedrock,
 *   Vertex, Foundry, non-interactive sessions, DISABLE_TELEMETRY). An
 *   ENVIRONMENT condition, not a config defect. The same manifest is correct on
 *   one host and skipped on another, so the finding would describe the machine
 *   the doctor ran on, not the plugin it read.
 *
 *   PROJECT-SCOPE @skills-dir MONITORS NOT LOADING (monitors.md, the hole that
 *   bites hardest). The doctor cannot know from a SOURCE TREE how a plugin will
 *   be installed: the same directory is a personal-scope plugin under
 *   ~/.claude/skills/ and a project-scope one under <cwd>/.claude/skills/. A
 *   check here would fire on every correctly authored plugin that ships a
 *   monitor, which is the definition of a false positive.
 *
 *   META-KEY HYPHENS, the claude/channel CAPABILITY KEY, and the SENDER
 *   ALLOWLIST (channels.md Notification contract, The four gates gate 1,
 *   Security). All three live in the channel server's TypeScript source. This
 *   file reads configuration, does not read code, and must not start: a linter
 *   that half-parses a language is a false-positive engine.
 *
 *   channelsEnabled ABSENT WHILE A CHANNEL PLUGIN EXISTS. Genuinely undecidable.
 *   channels.md: claude.ai Team and Enterprise default to BLOCKED, Console
 *   API-key organizations are PERMITTED by default, and Pro and Max users with
 *   no organization skip both checks entirely. The default flips on auth mode,
 *   so a finding would be wrong for a large share of users.
 */

const asPathList = v => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

/**
 * Every skill name an `on-skill-invoke:<name>` monitor in THIS plugin could
 * legitimately be waiting on. The set is deliberately GENEROUS (directory name
 * and frontmatter name, default folders and manifest paths, flat command files
 * and single-skill layout) because it is used only to prove a name IS
 * resolvable: every name this misses becomes a BROKEN finding, so under-collecting
 * here manufactures exactly the false positive the whole file exists to avoid.
 */
export function pluginSkillNames(pluginRoot, manifest) {
  const names = new Set();
  const add = v => { if (typeof v === 'string' && v.trim()) names.add(v.trim()); };
  const addSkillTree = dir => {
    for (const d of listDirs(dir)) {
      const p = join(dir, d, 'SKILL.md');
      if (!existsSync(p)) continue;
      add(d);
      const f = frontmatterFields(readText(p) || '');
      if (f) add(f.name);
    }
  };
  const addDirectSkill = (dir, fallback) => {
    const p = join(dir, 'SKILL.md');
    if (!existsSync(p)) return;
    const f = frontmatterFields(readText(p) || '');
    if (f && typeof f.name === 'string' && f.name.trim()) add(f.name);
    add(fallback);
  };
  const addCommandDir = dir => { for (const f of listFiles(dir, /\.md$/i)) add(f.replace(/\.md$/i, '')); };

  addSkillTree(join(pluginRoot, 'skills'));
  addCommandDir(join(pluginRoot, 'commands'));
  // A plugin with a SKILL.md at its root is loaded as a single-skill plugin
  // (plugins-reference.md), named by its frontmatter or the directory basename.
  addDirectSkill(pluginRoot, basename(pluginRoot));
  if (existsSync(join(pluginRoot, 'SKILL.md')) && manifest) add(manifest.name);

  for (const p of asPathList(manifest && manifest.skills)) {
    const abs = join(pluginRoot, p);
    addSkillTree(abs);
    addDirectSkill(abs, basename(abs));
  }
  for (const p of asPathList(manifest && manifest.commands)) {
    if (/\.md$/i.test(p)) add(basename(p).replace(/\.md$/i, ''));
    else addCommandDir(join(pluginRoot, p));
  }
  return names;
}

/**
 * Every MCP server name a channel in this plugin could bind to: the manifest's
 * inline `mcpServers` object, each path it names, and the plugin root's own
 * `.mcp.json`. Union rather than precedence, for the same reason as above.
 */
export function pluginMcpServerNames(pluginRoot, manifest) {
  const names = new Set();
  const addMap = obj => { if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const k of Object.keys(obj)) names.add(k); };
  const addDoc = doc => {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
    if (doc.mcpServers && typeof doc.mcpServers === 'object') addMap(doc.mcpServers);
    else addMap(doc);
  };
  const m = manifest ? manifest.mcpServers : undefined;
  if (m && typeof m === 'object' && !Array.isArray(m)) addDoc(m);
  for (const p of [...asPathList(m), './.mcp.json']) addDoc(readJson(join(pluginRoot, p)).value);
  return names;
}

/**
 * Monitor entries for a plugin, from all three documented homes
 * (monitors.md Configuration): the default `monitors/monitors.json`, an inline
 * array under `experimental.monitors`, or a relative path string (or array of
 * them) that REPLACES the default folder. The legacy top-level `monitors` key
 * is read too, and reported separately.
 */
export function loadPluginMonitors(pluginRoot, manifest, manifestPath) {
  const out = { entries: [], legacyKey: false, sources: [] };
  const exp = manifest && manifest.experimental && typeof manifest.experimental === 'object'
    ? manifest.experimental.monitors : undefined;
  let decl = exp;
  let key = 'experimental.monitors';
  if (decl === undefined && manifest && manifest.monitors !== undefined) {
    decl = manifest.monitors;
    key = 'monitors';
    out.legacyKey = true;
  }

  const pushArray = (arr, where) => {
    out.sources.push(where);
    arr.forEach((entry, i) => out.entries.push({ entry, where: `${where}[${i}]` }));
  };
  const fromFile = rel => {
    const file = join(pluginRoot, rel);
    const r = readJson(file);
    if (r.value === undefined || !Array.isArray(r.value)) return;
    pushArray(r.value, file);
  };

  const isEntryArray = Array.isArray(decl) && decl.some(x => x && typeof x === 'object');
  if (isEntryArray) pushArray(decl, `${manifestPath} ${key}`);
  else if (decl === undefined) fromFile(join('monitors', 'monitors.json'));
  else for (const p of asPathList(decl)) fromFile(p);
  return out;
}

/** Tokens of a shell command, with the quoting the docs' own examples use stripped. */
const commandTokens = command => command.replace(/["']/g, '').split(/\s+/).filter(Boolean);

/** The 8 monitor checks for ONE plugin. */
export function monitorFindings({ pluginRoot, manifest, manifestPath, project }) {
  const out = [];
  const loaded = loadPluginMonitors(pluginRoot, manifest, manifestPath);

  if (loaded.legacyKey) {
    out.push(F('INFO', 'monitor-manifest-key-legacy', manifestPath,
      'monitors are declared under the top-level "monitors" key instead of "experimental.monitors"; the top-level key still loads today, so nothing is broken yet, but claude plugin validate warns about it and a future release will require the experimental.* form',
      'Move the value under "experimental": { "monitors": ... }.',
      CITE.monitorLegacyKey));
  }
  if (!loaded.entries.length) return out;

  const skills = pluginSkillNames(pluginRoot, manifest);
  const expand = s => s
    .replace(/\$\{?CLAUDE_PLUGIN_ROOT\}?/g, pluginRoot)
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, project);
  const byName = new Map();

  for (const { entry, where } of loaded.entries) {
    const obj = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null;

    // -- monitor-entry-invalid --------------------------------------------
    const problems = [];
    if (!obj) problems.push('the entry is not a JSON object');
    else {
      for (const k of ['name', 'command', 'description']) {
        if (typeof obj[k] !== 'string' || !obj[k].trim()) problems.push(`${k} is missing or is not a non-empty string`);
      }
      if (obj.when !== undefined && !(obj.when === 'always' || (typeof obj.when === 'string' && /^on-skill-invoke:.+$/.test(obj.when)))) {
        problems.push(`when ${JSON.stringify(obj.when)} is neither "always" nor "on-skill-invoke:<skill-name>"`);
      }
    }
    if (problems.length) {
      out.push(F('BROKEN', 'monitor-entry-invalid', where,
        `monitor entry does not match the documented schema: ${problems.join('; ')}`,
        'Give the entry a name, a command and a description, and set when to "always" or "on-skill-invoke:<skill-name>".',
        CITE.monitorSchema));
    }

    if (obj && typeof obj.name === 'string' && obj.name.trim()) {
      const n = obj.name.trim();
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(where);
    }

    // -- monitor-skill-unresolvable ---------------------------------------
    const whenSkill = obj && typeof obj.when === 'string' ? (obj.when.match(/^on-skill-invoke:(.+)$/) || [])[1] : null;
    if (whenSkill && !skills.has(whenSkill)) {
      out.push(F('BROKEN', 'monitor-skill-unresolvable', where,
        `when is "on-skill-invoke:${whenSkill}" but no skill named "${whenSkill}" exists in this plugin (found: ${[...skills].sort().join(', ') || 'no skills at all'}); the monitor never arms and nothing reports it`,
        'Name a skill this plugin actually ships, or use "always".',
        CITE.monitorSkillRef));
    }

    const command = obj && typeof obj.command === 'string' ? obj.command : null;
    if (!command) continue;

    // -- monitor-user-config-ref ------------------------------------------
    if (/\$\{user_config\./.test(command)) {
      out.push(F('BROKEN', 'monitor-user-config-ref', where,
        'command references ${user_config.*}; since v2.1.207 Claude Code rejects the monitor with an error instead of substituting the value, so this monitor never starts while the rest of the plugin keeps loading and looks healthy',
        'Have the monitor script read the value from a config file it owns; the exec-form and CLAUDE_PLUGIN_OPTION_ escape routes a hook has do not exist for a monitor.',
        CITE.monitorUserConfig));
    }

    // -- monitor-plugin-option-var ----------------------------------------
    if (/CLAUDE_PLUGIN_OPTION_/.test(command)) {
      out.push(F('SILENT', 'monitor-plugin-option-var', where,
        'command references a CLAUDE_PLUGIN_OPTION_ variable, which monitor processes do not receive; it expands to empty and the command runs subtly wrong rather than failing',
        'Read the value inside the script from a config file the plugin owns.',
        CITE.monitorOptionVar));
    }

    const tokens = commandTokens(command);

    // -- monitor-command-missing ------------------------------------------
    // Sibling of hook-handler-missing, and the same shape of evidence: only a
    // token that names a SCRIPT, and only once every substitution in it has
    // actually been resolved. A token still carrying a "$" is a variable this
    // tool cannot expand, and guessing at it would be a false positive.
    const scriptTok = tokens.find(t => /\.(mjs|cjs|js|py|sh|ps1)$/i.test(t));
    if (scriptTok) {
      const expanded = expand(scriptTok);
      if (!expanded.includes('$')) {
        const candidates = /^([A-Za-z]:|[\\/])/.test(expanded)
          ? [expanded]
          : [join(pluginRoot, expanded), join(project, expanded)];
        if (!candidates.some(c => existsSync(c))) {
          out.push(F('SILENT', 'monitor-command-missing', where,
            `command script "${scriptTok}" not found (checked ${candidates.join(' and ')}); a monitor that cannot start is indistinguishable from a monitor with nothing to report, because fail-open is the only posture available here`,
            'Create the file or fix the path; anchor it with "${CLAUDE_PLUGIN_ROOT}".',
            CITE.monitorCommandMissing));
        }
      }
    }

    // -- monitor-cwd-assumption -------------------------------------------
    // THE EXISTENCE CONDITION IS THE WHOLE DESIGN. The docs' own example,
    // `tail -F ./logs/error.log`, is a legitimate monitor watching a log in the
    // SESSION working directory, and a check that flagged every relative path
    // would fire on it. A relative path that resolves to a file sitting inside
    // the PLUGIN is different: the author is addressing their own bundled file
    // through a cwd that will not be theirs.
    //
    // A token qualifies as a relative PATH when it carries a separator
    // (`./logs/error.log`) or a file extension (`poll.sh`). The bare-filename
    // half is not decoration: the live calibration run had `sh poll.sh --token
    // ...` with poll.sh sitting in the plugin root, which is the defect exactly,
    // and a separator-only rule walked straight past it. The extension is what
    // keeps `make build` out when the plugin happens to ship a file named
    // `build`, since a make TARGET is not a path.
    const cdPrefixed = /\bcd\s+["']?\$\{?CLAUDE_PLUGIN_ROOT\}?["']?\s*&&/.test(command);
    if (!cdPrefixed) {
      for (const t of tokens) {
        if (!t || t.startsWith('-') || t.includes('$')) continue;
        if (/^([A-Za-z]:|[\\/~])/.test(t)) continue;
        if (!/[\\/]/.test(t) && !/\.[A-Za-z0-9]{1,8}$/.test(t)) continue;
        let isFile = false;
        try { isFile = statSync(join(pluginRoot, t)).isFile(); } catch { isFile = false; }
        if (!isFile) continue;
        out.push(F('SILENT', 'monitor-cwd-assumption', where,
          `command uses the relative path "${t}", which exists under the plugin root but is resolved against the SESSION working directory, so it only works when the user happens to start Claude Code inside the plugin`,
          'Prefix the command with cd "${CLAUDE_PLUGIN_ROOT}" && , or anchor the path with "${CLAUDE_PLUGIN_ROOT}".',
          CITE.monitorCwd));
        break;
      }
    }
  }

  // -- monitor-duplicate-name ---------------------------------------------
  for (const [name, sites] of byName) {
    if (sites.length < 2) continue;
    out.push(F('SILENT', 'monitor-duplicate-name', sites.join(' AND '),
      `${sites.length} monitor entries share the name "${name}"; name is the dedup key, so a plugin reload or a repeat skill dispatch spawns duplicate processes instead of reusing one`,
      'Give each monitor its own stable name.',
      CITE.monitorDupName));
  }
  return out;
}

/** channel-server-unbound for ONE plugin. */
export function channelFindings({ pluginRoot, manifest, manifestPath }) {
  const out = [];
  const channels = manifest && Array.isArray(manifest.channels) ? manifest.channels : null;
  if (!channels || !channels.length) return out;
  const servers = pluginMcpServerNames(pluginRoot, manifest);
  const known = [...servers].sort().join(', ') || 'none';
  channels.forEach((ch, i) => {
    const where = `${manifestPath} channels[${i}]`;
    const server = ch && typeof ch === 'object' && !Array.isArray(ch) ? ch.server : undefined;
    // A missing server value is the same defect as a wrong one, reported under
    // the same id: server is required precisely because it is the binding.
    if (typeof server !== 'string' || !server.trim()) {
      out.push(F('BROKEN', 'channel-server-unbound', where,
        `channel declaration names no server (server is required and must match a key in the plugin's mcpServers; this plugin declares: ${known}), so the declaration binds to nothing and no process ever binds the listener`,
        'Set server to one of the plugin\'s mcpServers keys.',
        CITE.channelServerBinding));
      return;
    }
    if (!servers.has(server.trim())) {
      out.push(F('BROKEN', 'channel-server-unbound', where,
        `channel binds to server "${server}", which is not a key in this plugin's mcpServers (found: ${known}); with no entry there is no subprocess, so the listener never binds and the declaration binds to nothing`,
        'Add the server to the plugin\'s mcpServers or .mcp.json, or correct the name.',
        CITE.channelServerBinding));
    }
  });
  return out;
}

/**
 * The three allowedChannelPlugins checks, over every discovered settings file.
 *
 * Scanned at EVERY scope, not only managed. channels.md is explicit that these
 * keys are managed tier only, but a malformed or inert allowlist is the same
 * defect wherever it is typed, and a check that could only ever read
 * C:\Program Files could never be fed a known-bad input on a developer machine.
 * A check that cannot fail is a defect.
 */
export function channelPolicyFindings(parsedSettings) {
  const out = [];
  const enabledAnywhere = parsedSettings.some(s => s.value && s.value.channelsEnabled === true);
  for (const s of parsedSettings) {
    const list = s.value ? s.value.allowedChannelPlugins : undefined;
    if (list === undefined) continue;

    if (!enabledAnywhere) {
      out.push(F('SILENT', 'channel-allowlist-inert', s.file,
        'allowedChannelPlugins is set while channelsEnabled is absent or false; the allowlist applies only while channelsEnabled is true, so this reads as policy and enforces nothing',
        'Set channelsEnabled to true in managed settings if the allowlist is meant to apply, or drop the allowlist.',
        CITE.channelAllowlistInert));
    }
    if (!Array.isArray(list)) continue;

    if (list.length === 0) {
      out.push(F('SILENT', 'channel-allowlist-empty', s.file,
        'allowedChannelPlugins is an empty array; that blocks the Anthropic list but --dangerously-load-development-channels still bypasses it, so the evident intent (no channels) is not achieved',
        'To block channels entirely, including the development flag, leave channelsEnabled UNSET instead.',
        CITE.channelAllowlistEmpty));
    }
    list.forEach((e, i) => {
      const ok = e && typeof e === 'object' && !Array.isArray(e)
        && typeof e.marketplace === 'string' && e.marketplace.trim()
        && typeof e.plugin === 'string' && e.plugin.trim();
      if (ok) return;
      const missing = !e || typeof e !== 'object' || Array.isArray(e)
        ? 'the entry is not an object'
        : [!e.marketplace && 'marketplace', !e.plugin && 'plugin'].filter(Boolean).join(' and ') + ' is missing';
      out.push(F('BROKEN', 'channel-allowlist-invalid', `${s.file} allowedChannelPlugins[${i}]`,
        `allowlist entry is not a plugin plus its marketplace (${missing}); it matches no plugin, and because the list REPLACES the Anthropic allowlist the entries it does not match are blocked`,
        'Write each entry as { "marketplace": "<marketplace>", "plugin": "<plugin>" }.',
        CITE.channelAllowlistShape));
    });
  }
  return out;
}

/**
 * @param {object}  o
 * @param {string}  o.home            home root; every home-derived path, INCLUDING version detection, hangs off this
 * @param {string}  o.project         project root
 * @param {string}  [o.assumeVersion] pin the build instead of detecting it (tests, and --assume-version)
 * @param {boolean} [o.strictUnknown] promote UNKNOWN names from SILENT back to BROKEN
 * @param {object}  [o.catalog]       inject a catalog; defaults to the committed one, null disables name checks
 */
export function runChecks({ home, project, assumeVersion = null, strictUnknown = false, catalog = undefined }) {
  const findings = [];
  const scopes = [];
  const cat = catalog === undefined ? CATALOG : catalog;
  const signal = assumeVersion ? versionSignal(assumeVersion) : detectInstalledVersion({ home });
  const nameCtx = { catalog: cat, signal, strictUnknown };

  // ---- discovery -----------------------------------------------------------
  const managedPath = process.platform === 'win32'
    ? 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
    : process.platform === 'darwin'
      ? '/Library/Application Support/ClaudeCode/managed-settings.json'
      : '/etc/claude-code/managed-settings.json';
  const settingsFiles = [
    { scope: 'managed', file: managedPath, base: dirname(managedPath) },
    { scope: 'user', file: join(home, '.claude', 'settings.json'), base: home },
    { scope: 'project', file: join(project, '.claude', 'settings.json'), base: project },
    { scope: 'local', file: join(project, '.claude', 'settings.local.json'), base: project },
  ].filter(s => existsSync(s.file));
  for (const s of settingsFiles) scopes.push({ scope: s.scope, file: s.file });

  const skillRoots = [
    { scope: 'user', dir: join(home, '.claude', 'skills') },
    { scope: 'project', dir: join(project, '.claude', 'skills') },
  ];
  const agentRoots = [
    { scope: 'user', dir: join(home, '.claude', 'agents') },
    { scope: 'project', dir: join(project, '.claude', 'agents') },
  ];

  // ---- skills: frontmatter, caps, name format, cross-scope duplicates ------
  const skillsByName = new Map();
  for (const root of skillRoots) {
    for (const d of listDirs(root.dir)) {
      const p = join(root.dir, d, 'SKILL.md');
      const text = readText(p);
      if (text === null) continue;
      const problems = frontmatterProblems(text);
      if (problems.length) {
        for (const pr of problems) {
          findings.push(F('BROKEN', 'skill-frontmatter', p,
            `frontmatter does not parse (${pr.kind}): ${pr.detail}`,
            'Fix the YAML; quote any value containing a colon. Then confirm the description shows in /skills.',
            CITE.frontmatter));
        }
        continue;
      }
      const f = frontmatterFields(text) || {};
      const name = f.name || d;
      const combined = (f.description || '').length + (f.when_to_use || '').length;
      if (combined > DESC_CAP) {
        findings.push(F('SILENT', 'skill-description-cap', p,
          `description plus when_to_use is ${combined} chars, past the ~${DESC_CAP} cap; the tail is silently truncated out of triggering`,
          'Cut the combined length under the cap; move detail into the body.',
          CITE.descCap));
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
        findings.push(F('BROKEN', 'skill-name-format', p,
          `skill name "${name}" is not kebab-case; Claude Code silently ignores it`,
          'Rename to lowercase-kebab-case and keep the directory in sync.',
          CITE.nameFormat));
      }
      if (!skillsByName.has(name)) skillsByName.set(name, []);
      skillsByName.get(name).push({ scope: root.scope, path: p });
    }
  }
  for (const [name, sites] of skillsByName) {
    if (sites.length > 1) {
      findings.push(F('SILENT', 'skill-duplicate-across-scopes', sites.map(s => s.path).join(' AND '),
        `skill "${name}" exists at ${sites.map(s => s.scope).join(' and ')} scope; one silently shadows the other`,
        'Rename one, or delete the one that should lose.',
        CITE.dupSkill));
    }
  }

  // ---- settings: parse, hooks, disableAllHooks, cross-scope shadowing ------
  const parsedSettings = [];
  for (const s of settingsFiles) {
    const r = readJson(s.file);
    if (r.parseError) {
      findings.push(F('BROKEN', 'settings-parse', s.file,
        `settings file does not parse: ${r.parseError}`,
        'Fix the JSON; the whole file is rejected as-is.',
        CITE.matcher));
      continue;
    }
    parsedSettings.push({ ...s, value: r.value });

    const hooks = r.value.hooks;
    const hookEventCount = hooks && typeof hooks === 'object' ? Object.keys(hooks).length : 0;

    if (r.value.disableAllHooks === true && hookEventCount > 0) {
      findings.push(F('SILENT', 'disable-all-hooks', s.file,
        `disableAllHooks is true while ${hookEventCount} hook event(s) are configured: every hook in every file is off`,
        'Remove disableAllHooks, or remove the dead hook config so the state is honest.',
        CITE.disableAll));
    }

    if (hooks && typeof hooks === 'object') {
      for (const [event, entries] of Object.entries(hooks)) {
        const evFinding = nameFinding('hookEvents', event,
          classifyHookEvent(event, cat, signal, { strictUnknown }),
          `${s.file} hooks.${event}`, nameCtx);
        if (evFinding) findings.push(evFinding);
        if (!Array.isArray(entries)) continue;
        entries.forEach((entry, i) => {
          const where = `${s.file} hooks.${event}[${i}]`;
          if (Array.isArray(entry.matcher)) {
            findings.push(F('BROKEN', 'hook-matcher-array', where,
              'matcher is a JSON array; this is a schema error and the WHOLE settings file is rejected, so no hook in it appears in /hooks',
              'Join alternatives into one regex string: "Bash|Edit".',
              CITE.matcher));
          } else if (typeof entry.matcher === 'string' && entry.matcher && entry.matcher !== '*') {
            // "*" is the documented match-everything wildcard, not a regex;
            // the first live run flagged it BROKEN while the hook wired with
            // it was demonstrably firing. Empty string also matches all.
            try { new RegExp(entry.matcher); } catch (e) {
              findings.push(F('BROKEN', 'hook-matcher-regex', where,
                `matcher "${entry.matcher}" does not compile as a regex (${e.message}); the hook can never match and fails open`,
                'Fix the pattern, or use "*" to match every tool.',
                CITE.matcher));
            }
          }
          for (const h of entry.hooks || []) {
            if (h.type !== 'command' || typeof h.command !== 'string') continue;
            const scriptTok = h.command.replace(/"/g, '').split(/\s+/).find(t => /\.(mjs|cjs|js|py|sh|ps1)$/i.test(t));
            if (!scriptTok) continue;
            const expanded = scriptTok
              .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, project)
              .replace(/^~[\\/]/, home + '/');
            const candidates = resolve(expanded) === expanded.replace(/[\\/]+/g, resolve(expanded).includes('\\') ? '\\' : '/') && /^([A-Za-z]:|\/)/.test(expanded)
              ? [expanded]
              : [join(project, expanded), join(s.base, expanded)];
            if (!candidates.some(c => existsSync(c))) {
              findings.push(F('SILENT', 'hook-handler-missing', where,
                `handler "${scriptTok}" not found (checked ${candidates.join(' and ')}); command hooks fail OPEN, so this rule silently never enforces`,
                'Create the file or fix the path; prefer $CLAUDE_PROJECT_DIR-anchored paths.',
                CITE.handler));
            }
          }
        });
      }
    }
  }

  // cross-scope shadowing on scalar top-level keys
  const PRECEDENCE = ['managed', 'local', 'project', 'user'];
  const keySites = new Map();
  for (const s of parsedSettings) {
    for (const [k, v] of Object.entries(s.value)) {
      if (typeof v === 'object' && v !== null) continue;
      if (!keySites.has(k)) keySites.set(k, []);
      keySites.get(k).push({ scope: s.scope, file: s.file, value: v });
    }
  }
  for (const [k, sites] of keySites) {
    const distinct = new Set(sites.map(s => JSON.stringify(s.value)));
    if (sites.length > 1 && distinct.size > 1) {
      const winner = sites.slice().sort((a, b) => PRECEDENCE.indexOf(a.scope) - PRECEDENCE.indexOf(b.scope))[0];
      findings.push(F('INFO', 'settings-shadowing', sites.map(s => `${s.scope}:${s.file}`).join(' AND '),
        `"${k}" is set at ${sites.map(s => `${s.scope}=${JSON.stringify(s.value)}`).join(', ')}; precedence resolves to ${winner.scope} (${JSON.stringify(winner.value)}) and the others silently do nothing`,
        'Keep the key at one scope, or make the shadowing intentional and documented.',
        CITE.shadowing));
    }
  }

  // ---- agents: frontmatter + tools resolution ------------------------------
  for (const root of agentRoots) {
    for (const f of listFiles(root.dir, /\.md$/)) {
      const p = join(root.dir, f);
      const text = readText(p);
      if (text === null) continue;
      const problems = frontmatterProblems(text);
      if (problems.length) {
        for (const pr of problems) {
          findings.push(F('BROKEN', 'agent-frontmatter', p,
            `frontmatter does not parse (${pr.kind}): ${pr.detail}`,
            'Fix the YAML.',
            CITE.frontmatter));
        }
        continue;
      }
      const fm = frontmatterFields(text) || {};
      const toolsRaw = fm.tools;
      if (toolsRaw) {
        let tools = [];
        try { tools = JSON.parse(toolsRaw.replace(/'/g, '"')); } catch { tools = toolsRaw.split(',').map(t => t.trim()).filter(Boolean); }
        for (const t of tools) {
          const tf = nameFinding('tools', t, classifyTool(t, cat, signal, { strictUnknown }), p, nameCtx);
          if (tf) findings.push(tf);
        }
      }
    }
  }

  // ---- memory cap ----------------------------------------------------------
  const memFiles = [];
  const projRoot = join(home, '.claude', 'projects');
  for (const d of listDirs(projRoot)) {
    const p = join(projRoot, d, 'memory', 'MEMORY.md');
    if (existsSync(p)) memFiles.push(p);
  }
  const direct = join(home, '.claude', 'memory', 'MEMORY.md');
  if (existsSync(direct)) memFiles.push(direct);
  for (const p of memFiles) {
    const text = readText(p) || '';
    const lines = text.split(/\r?\n/).length;
    const bytes = Buffer.byteLength(text);
    if (lines > MEMORY_LINE_CAP || bytes > MEMORY_BYTE_CAP) {
      findings.push(F('SILENT', 'memory-over-cap', p,
        `MEMORY.md index is ${lines} lines / ${bytes} bytes, past the ${MEMORY_LINE_CAP}-line / ${MEMORY_BYTE_CAP}-byte cap; over-limit content errors instead of loading (v2.1.210+)`,
        'Move detail into per-topic files and keep MEMORY.md a one-line-per-memory index.',
        CITE.memoryCap));
    }
  }

  // ---- MCP scope collisions ------------------------------------------------
  const userMcp = readJson(join(home, '.claude.json')).value?.mcpServers || {};
  const projMcp = readJson(join(project, '.mcp.json')).value?.mcpServers || {};
  for (const name of Object.keys(userMcp)) {
    if (name in projMcp && JSON.stringify(userMcp[name]) !== JSON.stringify(projMcp[name])) {
      findings.push(F('SILENT', 'mcp-scope-collision', `${join(home, '.claude.json')} AND ${join(project, '.mcp.json')}`,
        `MCP server "${name}" is configured at user scope and project scope with DIFFERENT configs; one silently wins and the loser looks configured`,
        'Keep the server at one scope, or align the configs deliberately.',
        CITE.mcpScope));
    }
  }

  // ---- plugins: version pinning, monitors, channels ------------------------
  // plugin.json is no longer the only file read per plugin. The monitor and
  // channel checks need <pluginRoot>/monitors/monitors.json and
  // <pluginRoot>/.mcp.json as well, plus mcpServers and channels out of the
  // manifest, so discovery yields the ROOT and every reader hangs off it.
  const pluginDirs = [];
  const scan = (base, depth) => {
    if (depth < 0 || !existsSync(base)) return;
    for (const d of listDirs(base)) {
      if (d === 'node_modules' || d.startsWith('.git')) continue;
      const pj = join(base, d, '.claude-plugin', 'plugin.json');
      if (existsSync(pj)) pluginDirs.push(pj);
      else scan(join(base, d), depth - 1);
    }
  };
  scan(project, 2);
  for (const pj of pluginDirs) {
    const r = readJson(pj);
    const manifest = r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? r.value : null;
    if (manifest && typeof manifest.version === 'string') {
      findings.push(F('INFO', 'plugin-version-pinned', pj,
        `plugin.json pins version "${manifest.version}"; the marketplace treats the version as the update cache key, so updates stop arriving until the string changes`,
        'Omit version to use commit-SHA flow, or bump it on every release without exception.',
        CITE.versionPin));
    }
    const pluginRoot = dirname(dirname(pj));
    findings.push(...monitorFindings({ pluginRoot, manifest, manifestPath: pj, project }));
    findings.push(...channelFindings({ pluginRoot, manifest, manifestPath: pj }));
  }

  // ---- channel policy in settings -----------------------------------------
  findings.push(...channelPolicyFindings(parsedSettings));

  return {
    scopes,
    findings,
    version: signal,
    catalogVersion: cat ? cat.catalogVersion : null,
    absenceIsProof: absenceIsProof(cat, signal),
    header: versionHeader(cat, signal),
  };
}

// --------------------------------------------------------------- delegation --

export function delegateToAgnix(agnixBin, { home, project, allLevels = false }) {
  const r = spawnSync(agnixBin, [home, project, '--format', 'json'], {
    encoding: 'utf8', timeout: 120_000, windowsHide: true, shell: agnixBin.endsWith('.cmd'),
    env: { ...process.env, NO_COLOR: '1', DO_NOT_TRACK: '1' },
  });
  const out = `${r.stdout || ''}`;
  try {
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    return (parsed.diagnostics || [])
      .filter(d => /\.(md|json|mjs|js|cjs|ts|toml|ya?ml|sh|ps1)$/i.test(d.file || ''))
      // Errors only by default. agnix warnings include style opinions (a valid
      // hook with no timeout field draws CC-HK-010), and on the bench's clean
      // tree that made the WRAPPER throw a false positive our own checks never
      // would. Delegation exists to import agnix's hard failures, not its
      // taste; --delegate-all restores everything.
      .filter(d => allLevels || d.level === 'error')
      .map(d => ({
        severity: d.level === 'error' ? 'BROKEN' : d.level === 'warning' ? 'SILENT' : 'INFO',
        check: `agnix:${d.rule}`,
        where: `${d.file}:${d.line ?? 1}`,
        what: d.message,
        fix: d.suggestion || '',
        citation: `agnix ${d.rule} (agent-sh/agnix)`,
        source: 'agnix',
      }));
  } catch {
    return [{ severity: 'INFO', check: 'agnix:unparseable', where: agnixBin, what: `agnix output was not parseable JSON (exit ${r.status})`, fix: '', citation: '', source: 'agnix' }];
  }
}

// ---------------------------------------------------------------- self-test --

function selfTest() {
  let bad = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) bad++; };

  // The committed bench fixtures are the ground truth: every failure-mode
  // fixture must produce its check's finding, and the clean tree must produce
  // none. Gutting any check turns exactly its row red here.
  const FIX = join(HERE, '..', 'tests', 'lint-bench', 'fixtures');
  const EXPECT = {
    'dead-skill-frontmatter': 'skill-frontmatter',
    'over-cap-description': 'skill-description-cap',
    'dup-skill-across-scopes': 'skill-duplicate-across-scopes',
    'bad-hook-event': 'hook-unknown-event',
    'bad-matcher-regex': 'hook-matcher-regex',
    'missing-hook-handler': 'hook-handler-missing',
    'disable-all-hooks': 'disable-all-hooks',
    'settings-shadowing': 'settings-shadowing',
    'unresolvable-subagent-tools': 'agent-unresolvable-tool',
    'memory-over-cap': 'memory-over-cap',
    'mcp-scope-collision': 'mcp-scope-collision',
    'plugin-version-pinned': 'plugin-version-pinned',
    'control-array-matcher': 'hook-matcher-array',
    'control-bad-skill-name': 'skill-name-format',
  };
  // The fixture homes carry no version signal by design, so the build is PINNED
  // to the one the catalog enumerates. Without the pin these rows would assert
  // whatever the machine running CI happens to have installed, and the
  // unresolvable-tool row in particular would flip from BROKEN to UNVERIFIED on
  // any box a release ahead of the catalog. A fixture must test the check, not
  // the host.
  const COVERED = CATALOG ? CATALOG.catalogVersion : '2.1.220';
  for (const [fixture, checkId] of Object.entries(EXPECT)) {
    const dir = join(FIX, fixture);
    if (!existsSync(dir)) { check(`fixture ${fixture} exists`, false); continue; }
    const { findings } = runChecks({ home: join(dir, 'home'), project: join(dir, 'project'), assumeVersion: COVERED });
    const hit = findings.some(f => f.check === checkId);
    check(`${fixture} -> ${checkId}`, hit, hit ? '' : `got: ${[...new Set(findings.map(f => f.check))].join(', ') || 'nothing'}`);
  }
  {
    const dir = join(FIX, 'clean');
    for (const v of [COVERED, '2.1.999', null]) {
      const { findings } = runChecks({ home: join(dir, 'home'), project: join(dir, 'project'), assumeVersion: v });
      check(`clean tree yields ZERO findings (build ${v || 'undetected'})`, findings.length === 0,
        findings.length ? findings.map(f => f.check).join(', ') : '');
    }
  }

  // Unit coverage for the frontmatter classifier: the defect shapes it must
  // catch, and the legal shapes the live calibration run proved it must NOT.
  check('unquoted colon-space is rejected', frontmatterProblems('---\nname: x\ndescription: a thing: with colon\n---\nbody').some(p => p.kind === 'unquoted-colon'));
  check('unclosed quote at frontmatter end is rejected', frontmatterProblems('---\ndescription: "half open\nstill open\n---\nbody').some(p => p.kind === 'unclosed-quote'));
  check('quoted colon passes', frontmatterProblems('---\ndescription: "a thing: quoted"\n---\nbody').length === 0);

  /**
   * FORM MATRIX. Independent review 2026-08-05 found that suppressing the
   * block-sequence false positive had been done by DISCARDING the sequence items,
   * so `tools:` written as a list never reached the classifier and an invented
   * name reported nothing on three of the five legal forms. Every existing test
   * on this shape asserted the no-complaint direction only, which made the
   * detection side a check that could not fail.
   *
   * These rows assert BOTH directions on all five forms: a bad name is always
   * caught, and a good list never complains. Discarding sequence items again
   * turns the first three red.
   */
  {
    const FORMS = {
      'inline JSON array': (t) => `tools: [${t.map((x) => `"${x}"`).join(', ')}]`,
      'comma string': (t) => `tools: ${t.join(', ')}`,
      'zero-indent block': (t) => `tools:\n${t.map((x) => `- ${x}`).join('\n')}`,
      'two-space block': (t) => `tools:\n${t.map((x) => `  - ${x}`).join('\n')}`,
      'four-space block': (t) => `tools:\n${t.map((x) => `    - ${x}`).join('\n')}`,
    };
    const fmOf = (body) => frontmatterFields(`---\nname: r\ndescription: "d"\n${body}\n---\n\nbody\n`);
    for (const [label, build] of Object.entries(FORMS)) {
      const bad = fmOf(build(['Read', 'FrobnicateTool']));
      const names = String(bad.tools || '').replace(/[[\]"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      check(`FORM MATRIX (${label}): the bad name REACHES the classifier`,
        names.includes('FrobnicateTool'), `parsed tools = ${JSON.stringify(bad.tools)}`);
      check(`FORM MATRIX (${label}): a valid list raises no frontmatter complaint`,
        frontmatterProblems(`---\nname: r\ndescription: "d"\n${build(['Read', 'Grep'])}\n---\n\nbody\n`).length === 0);
    }
  }
  check('tab indentation is rejected', frontmatterProblems('---\n\tname: x\n---\nbody').some(p => p.kind === 'tab-indent'));
  check('fields are extracted from clean frontmatter', frontmatterFields('---\nname: ok-skill\ndescription: "fine"\n---\nbody')?.name === 'ok-skill');
  // The two live false positives, now modeled:
  check('a LEGAL multi-line quoted scalar passes (live FP #1)',
    frontmatterProblems('---\nname: x\ndescription: "Memory is the cornerstone. Without it, every\n  interaction starts from zero. It covers\n  memory: short-term and long-term."\n---\nbody').length === 0);
  check('a LEGAL zero-indent block sequence passes (live FP #2)',
    frontmatterProblems('---\nname: x\ntags:\n- monitoring\n- performance\ntools:\n- claude-code\n---\nbody').length === 0);
  check('colon-space INSIDE a multi-line quote is not flagged',
    !frontmatterProblems('---\ndescription: "first line\n  second: with colon"\n---\nbody').some(p => p.kind === 'unquoted-colon'));
  check('block scalar content is accepted and accumulated', (() => {
    const f = frontmatterFields('---\nname: x\ndescription: >-\n  folded line one\n  folded line two\n---\nbody');
    return f && /folded line one/.test(f.description) && /folded line two/.test(f.description);
  })());
  check('multi-line quoted description accumulates for cap measurement', (() => {
    const f = frontmatterFields('---\ndescription: "abc\n  def"\n---\nbody');
    return f && f.description.includes('abc') && f.description.includes('def');
  })());

  // The live false positive: matcher "*" is the documented wildcard and must
  // never be flagged, while a genuinely broken pattern still is.
  {
    const tmp = join(tmpdir(), `doctor-st-${Date.now()}`);
    mkdirSync(join(tmp, 'home', '.claude'), { recursive: true });
    mkdirSync(join(tmp, 'project'), { recursive: true });
    writeFileSync(join(tmp, 'home', '.claude', 'settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo ok' }] }] },
    }));
    const { findings } = runChecks({ home: join(tmp, 'home'), project: join(tmp, 'project') });
    check('matcher "*" wildcard is NOT flagged (live FP #3)', !findings.some(f => f.check === 'hook-matcher-regex'),
      findings.map(f => f.check).join(', '));
    rmSync(tmp, { recursive: true, force: true });
  }

  // ------------------------------------------------------- version awareness --
  // Pure functions first. Every rule gets its own row so a regression turns
  // exactly one line red, instead of collapsing one end-to-end row that nobody
  // can then read backwards to a cause.

  const CAT = CATALOG;
  const BUILDS = ['2.1.208', '2.1.220', '2.1.222', null];
  check('the capability catalog loads', !!CAT, CATALOG_ERROR || '');

  // THE REGRESSION. PowerShell shipped in 2.1.84 and the hand-typed Set never
  // heard about it, so a valid subagent was called BROKEN by a tool advertising
  // zero false positives. It must now be safe on every build, in both
  // directions of the asymmetry, and with no version signal at all.
  {
    const worst = BUILDS.filter(v => classifyTool('PowerShell', CAT, v).severity === 'BROKEN');
    check('REGRESSION: PowerShell is never BROKEN on any build', worst.length === 0, `broken on: ${worst.join(', ')}`);
    check('REGRESSION: PowerShell classifies valid on the covered build', classifyTool('PowerShell', CAT, '2.1.220').class === 'valid');
  }
  // THE OTHER REGRESSION: the 31st hook event, absent from the old literal.
  check('REGRESSION: DirectoryAdded classifies valid', classifyHookEvent('DirectoryAdded', CAT, '2.1.220').class === 'valid',
    classifyHookEvent('DirectoryAdded', CAT, '2.1.220').why);

  const PREVIOUSLY_MISSING = [
    'CronCreate', 'CronDelete', 'CronList', 'EndConversation', 'EnterWorktree', 'ExitWorktree',
    'LSP', 'PowerShell', 'PushNotification', 'RemoteTrigger', 'ReportFindings', 'ScheduleWakeup',
    'ShareOnboardingGuide', 'WaitForMcpServers',
  ];
  {
    const bad = PREVIOUSLY_MISSING.filter(n => classifyTool(n, CAT, '2.1.220').class !== 'valid');
    check('all 14 previously missing tools classify valid on 2.1.220', bad.length === 0, bad.join(', '));
  }

  // NEGATIVE CONTROLS. A classifier that answers "fine" to everything would pass
  // every row above, so the invented name must still be caught where the
  // evidence supports catching it, and must still be REPORTED where it does not.
  check('NEGATIVE CONTROL: FrobnicateTool on a COVERED build is BROKEN', (() => {
    const c = classifyTool('FrobnicateTool', CAT, '2.1.220');
    return c.class === 'invalid' && c.severity === 'BROKEN';
  })());
  check('NEGATIVE CONTROL: FrobnicateTool on a NEWER build is unknown and SILENT', (() => {
    const c = classifyTool('FrobnicateTool', CAT, '2.1.222');
    return c.class === 'unknown' && c.severity === 'SILENT';
  })());
  check('NEGATIVE CONTROL: an UNKNOWN name is still REPORTED, not swallowed', (() => {
    const c = classifyTool('FrobnicateTool', CAT, '2.1.222');
    const f = nameFinding('tools', 'FrobnicateTool', c, 'x/agents/a.md', { catalog: CAT, signal: '2.1.222' });
    return !!f && f.check === 'agent-unverified-tool' && f.severity === 'SILENT' && f.citation.length > 10;
  })());
  check('a valid name produces NO finding', nameFinding('tools', 'Read', classifyTool('Read', CAT, '2.1.220'), 'x', { catalog: CAT }) === null);

  // Case and shape errors are version independent: the correct spelling is in
  // the catalog, so no future build can make them right.
  {
    const bad = BUILDS.filter(v => classifyTool('powershell', CAT, v).severity !== 'BROKEN');
    check('a case variant (powershell) is BROKEN on EVERY build including null', bad.length === 0, `not broken on: ${bad.join(', ')}`);
    check('the case variant names the correct spelling', classifyTool('powershell', CAT, null).nearest[0] === 'PowerShell');
  }
  {
    const bad = BUILDS.filter(v => classifyTool('MCP__github__x', CAT, v).severity !== 'BROKEN');
    check('a malformed mcp name (MCP__github__x) is BROKEN on every build', bad.length === 0, `not broken on: ${bad.join(', ')}`);
  }
  check('a globbed mcp server segment is BROKEN', classifyTool('mcp__*__x', CAT, '2.1.999').severity === 'BROKEN');
  check('a well formed mcp__ name passes with catalog null', classifyTool('mcp__github__create_issue', null, null).class === 'valid');
  check('a well formed bare mcp__server name passes', classifyTool('mcp__github', CAT, '2.1.220').class === 'valid');
  check('the "*" wildcard passes with catalog null', classifyTool('*', null, null).class === 'valid');
  check('an mcp shape complaint cites the mcp naming rule', (() => {
    const f = nameFinding('tools', 'MCP__github__x', classifyTool('MCP__github__x', CAT, '2.1.220'), 'x', { catalog: CAT, signal: '2.1.220' });
    return f.citation.startsWith('mcp.md tool naming');
  })());
  check('an empty name is invalid rather than crashing', classifyTool('', CAT, '2.1.220').severity === 'BROKEN');
  check('an unknown section is refused loudly', (() => {
    try { classifyName('monitors', 'X', CAT, '2.1.220'); return false; } catch (e) { return /unknown section/.test(e.message); }
  })());

  // The degraded mode. A missing or corrupt catalog must NOT turn every name
  // into a BROKEN; it fails open to UNVERIFIED and says so in the header, once.
  check('with NO catalog every name is UNVERIFIED, never BROKEN', (() => {
    return ['PowerShell', 'FrobnicateTool', 'MultiEdit'].every(n => {
      const c = classifyTool(n, null, '2.1.208');
      return c.class === 'unknown' && c.severity === 'SILENT';
    });
  })());
  check('with NO catalog a case or shape error is still BROKEN', classifyTool('MCP__github__x', null, null).severity === 'BROKEN');
  // Found by mutation, and the only mutant that survived the first matrix:
  // substituting a version for the missing catalog changed no verdict, so every
  // behavioural row stayed green while the finding text claimed authority from a
  // catalog that was never loaded. Being honest about what was actually
  // consulted is the entire reason this file stopped hand-typing name lists.
  check('a degraded finding never claims a catalog version it did not load',
    !/capability catalog \d/.test(classifyTool('FrobnicateTool', null, '2.1.208').why),
    classifyTool('FrobnicateTool', null, '2.1.208').why);
  check('the degraded header announces the catalog is unavailable',
    /^capability catalog UNAVAILABLE .*UNVERIFIED, not BROKEN\.$/.test(versionHeader(null, '2.1.208')),
    versionHeader(null, '2.1.208'));

  check('MultiEdit is unsupported, not broken', (() => {
    const c = classifyTool('MultiEdit', CAT, '2.1.220');
    return c.class === 'unsupported' && c.severity === 'SILENT';
  })(), classifyTool('MultiEdit', CAT, '2.1.220').class);
  check('BashOutput is unsupported and names its replacement', (() => {
    const c = classifyTool('BashOutput', CAT, '2.1.220');
    return c.class === 'unsupported' && c.nearest[0] === 'TaskOutput';
  })());
  check('an unsupported name stays unsupported on a NEWER build', classifyTool('MultiEdit', CAT, '2.1.999').class === 'unsupported');
  // The first live run advised "Replace it with MultiEdit" for MultiEdit: the
  // name is in the catalog as legacy, so it matched itself at distance zero.
  check('a suggestion never suggests the offending name back', (() => {
    const c = classifyTool('MultiEdit', CAT, '2.1.220');
    const f = nameFinding('tools', 'MultiEdit', c, 'x', { catalog: CAT, signal: '2.1.220' });
    return !c.nearest.includes('MultiEdit') && !/Replace it with "MultiEdit"/.test(f.fix) && !/Nearest catalog name\(s\): MultiEdit/.test(f.what);
  })(), nameFinding('tools', 'MultiEdit', classifyTool('MultiEdit', CAT, '2.1.220'), 'x', { catalog: CAT }).fix);
  check('a replacement is only named when the CATALOG names it', (() => {
    const withAlias = nameFinding('tools', 'BashOutput', classifyTool('BashOutput', CAT, '2.1.220'), 'x', { catalog: CAT, signal: '2.1.220' });
    const without = nameFinding('tools', 'MultiEdit', classifyTool('MultiEdit', CAT, '2.1.220'), 'x', { catalog: CAT, signal: '2.1.220' });
    return withAlias.fix === 'Replace it with "TaskOutput".' && /current tool name, or remove it/.test(without.fix);
  })());
  // The row above passes for the wrong reason on the committed catalog: no
  // legacy name there has a near neighbour, so aliasOf and nearest[0] agree by
  // accident and a mutation swapping them survived. This separates them. A
  // legacy name with a plausible GUESS but no recorded alias must still get the
  // generic fix, because an edit-distance hint printed as an instruction is how
  // a linter talks a user into the wrong edit.
  check('a guessed neighbour is never promoted into the fix line', (() => {
    const synth = {
      catalogVersion: '2.1.220',
      tools: {
        Read: { status: 'current', provenance: [{ source: 'tools-reference.md', line: 42, quote: 'Reads the contents of files. See Read tool behavior' }] },
        Reads: { status: 'legacy', provenance: [{ source: 'changelog.md', line: 7, quote: 'Removed the Reads tool; no replacement alias is recorded anywhere in the docs' }] },
      },
      hookEvents: {},
    };
    const c = classifyTool('Reads', synth, '2.1.220');
    const f = nameFinding('tools', 'Reads', c, 'x', { catalog: synth, signal: '2.1.220' });
    return c.class === 'unsupported' && c.nearest.includes('Read') && /current tool name, or remove it/.test(f.fix);
  })());

  check('--strict-unknown promotes unknown to BROKEN', (() => {
    const c = classifyTool('FrobnicateTool', CAT, '2.1.222', { strictUnknown: true });
    return c.class === 'unknown' && c.severity === 'BROKEN';
  })());
  check('--strict-unknown does NOT promote unsupported', classifyTool('MultiEdit', CAT, '2.1.222', { strictUnknown: true }).severity === 'SILENT');

  check("cmpVersion('2.1.9','2.1.220') < 0", cmpVersion('2.1.9', '2.1.220') < 0, String(cmpVersion('2.1.9', '2.1.220')));
  check('cmpVersion is symmetric and reflexive', cmpVersion('2.1.220', '2.1.9') > 0 && cmpVersion('2.1.220', '2.1.220') === 0);
  check('absenceIsProof runs the right way round', (() => {
    const a = absenceIsProof({ catalogVersion: '2.1.220' }, '2.1.220');
    const b = absenceIsProof({ catalogVersion: '2.1.220' }, '2.1.222');
    const c = absenceIsProof({ catalogVersion: '2.1.220' }, null);
    const d = absenceIsProof(null, '2.1.208');
    return a === true && b === false && c === false && d === false;
  })());

  // ------------------------------------------------------- version detector --
  {
    const tmp = join(tmpdir(), `doctor-ver-${Date.now()}`);
    const seeded = join(tmp, 'seeded');
    const empty = join(tmp, 'empty');
    const weak = join(tmp, 'weak');
    const fileOnly = join(tmp, 'file-layout');
    const dirOnly = join(tmp, 'dir-layout');
    try {
      // Both on-disk layouts, in one store. Directories are the obvious reading
      // of versions/<version>/; a FILE named for the version is what the
      // installer actually wrote on the one machine we could observe, and
      // taking directories only made this rung dead there.
      for (const v of ['2.1.9', '2.1.100']) {
        mkdirSync(join(seeded, '.local', 'share', 'claude', 'versions', v), { recursive: true });
      }
      writeFileSync(join(seeded, '.local', 'share', 'claude', 'versions', '2.1.222'), 'binary stand in');
      mkdirSync(join(fileOnly, '.local', 'share', 'claude', 'versions'), { recursive: true });
      writeFileSync(join(fileOnly, '.local', 'share', 'claude', 'versions', '2.1.219'), 'binary stand in');
      mkdirSync(join(dirOnly, '.local', 'share', 'claude', 'versions', '2.1.219'), { recursive: true });
      mkdirSync(empty, { recursive: true });
      mkdirSync(weak, { recursive: true });
      writeFileSync(join(weak, '.claude.json'), JSON.stringify({ lastOnboardingVersion: '2.1.100' }));

      const got = detectInstalledVersion({ home: seeded });
      // The real machine has its own build installed. If the detector consulted
      // os.homedir() this would report that one, the bench would lint fixture
      // trees against the wrong build, and the asymmetry would point the wrong
      // way without ever saying so.
      check('detector reads from the home ARGUMENT, not os.homedir()',
        got.version === '2.1.222' && String(got.source).startsWith(seeded),
        `${got.version} from ${got.source}`);
      check('detector picks the HIGHEST of several stored versions (numeric, not lexical)', got.version === '2.1.222', got.version);
      check('detector marks the versions store strong', got.confidence === 'strong' && got.rung === 'versions-store');
      // The layout defect this caught for real: the installer wrote a FILE, the
      // directories-only draft went blind, and detection fell to the weak rung
      // while the build sat on disk in plain sight.
      check('a versions store holding a FILE is detected (observed layout)',
        detectInstalledVersion({ home: fileOnly }).version === '2.1.219'
        && detectInstalledVersion({ home: fileOnly }).confidence === 'strong',
        JSON.stringify(detectInstalledVersion({ home: fileOnly })));
      check('a versions store holding a DIRECTORY is detected (documented layout)',
        detectInstalledVersion({ home: dirOnly }).version === '2.1.219'
        && detectInstalledVersion({ home: dirOnly }).confidence === 'strong',
        JSON.stringify(detectInstalledVersion({ home: dirOnly })));

      // Rung 2, BOTH npm layouts. Neither can fire on a machine with no global
      // install, and an untestable rung is an untested one: a mutation run
      // proved that deleting the Windows layout (<prefix>/node_modules, no lib
      // segment) changed no result anywhere in this file. npm_config_prefix is
      // consulted first, so pointing it at a seeded tree makes the rung
      // deterministic on any host. The env is restored in the block that set it.
      {
        const posix = join(tmp, 'npm-posix');
        const win = join(tmp, 'npm-win');
        const seedPkg = (root, rel, version) => {
          const dir = join(root, ...rel, '@anthropic-ai', 'claude-code');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', version }));
        };
        seedPkg(posix, ['lib', 'node_modules'], '2.1.230');
        seedPkg(win, ['node_modules'], '2.1.231');
        const savedPrefix = process.env.npm_config_prefix;
        try {
          process.env.npm_config_prefix = posix;
          const a = detectInstalledVersion({ home: empty });
          check('npm global POSIX layout (prefix/lib/node_modules) is detected strong',
            a.version === '2.1.230' && a.confidence === 'strong' && a.rung === 'npm-global', JSON.stringify(a));
          process.env.npm_config_prefix = win;
          const b = detectInstalledVersion({ home: empty });
          check('npm global WINDOWS layout (prefix/node_modules, no lib) is detected strong',
            b.version === '2.1.231' && b.confidence === 'strong' && b.rung === 'npm-global', JSON.stringify(b));
          const c = detectInstalledVersion({ home: seeded });
          check('the versions store outranks the npm rung', c.rung === 'versions-store' && c.version === '2.1.222', JSON.stringify(c));
        } finally {
          if (savedPrefix === undefined) delete process.env.npm_config_prefix;
          else process.env.npm_config_prefix = savedPrefix;
        }
      }

      const w = detectInstalledVersion({ home: weak });
      check('lastOnboardingVersion is detected as WEAK', w.version === '2.1.100' && w.confidence === 'weak' && w.rung === 'onboarding',
        JSON.stringify(w));
      // THE HARD RULE. 2.1.100 is well under catalog 2.1.220, so a naive
      // comparison would call the absent name BROKEN. lastOnboardingVersion is a
      // LOWER BOUND (it lags the installed build after an update), and
      // understating the build makes the catalog look more complete than it is,
      // which is the direction that manufactures a false BROKEN.
      check('a WEAK signal can never make an absent name BROKEN',
        classifyTool('FrobnicateTool', CAT, w).severity !== 'BROKEN' && classifyTool('FrobnicateTool', CAT, w).class === 'unknown');
      check('a WEAK signal still classifies a CURRENT name valid', classifyTool('PowerShell', CAT, w).class === 'valid');

      check('no home yields null, and null never yields BROKEN', (() => {
        const n = detectInstalledVersion({});
        return n.version === null && n.confidence === 'none'
          && classifyTool('FrobnicateTool', CAT, n).severity !== 'BROKEN'
          && classifyTool('FrobnicateTool', CAT, null).severity !== 'BROKEN';
      })());
      check('detection is READ ONLY: it creates nothing under a home that does not exist', (() => {
        const ghost = join(tmp, 'ghost');
        detectInstalledVersion({ home: ghost });
        return !existsSync(ghost);
      })());
      check('the detector never shells out to claude', (() => {
        // Read-only is the whole selling point, and the benched competitor
        // (claude plugin validate) was measured WRITING during a run. Asserted
        // against this file's own source so the property cannot rot silently.
        const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
        return src.split(/\r?\n/).filter(l => /spawnSync\s*\(/.test(l)).every(l => !/claude/i.test(l));
      })());
      // The empty home proves the same rooting from the other side: rungs 1 and
      // 3 hang off the argument, so neither can fire here.
      check('a home with no signal fires no home rooted rung', !['versions-store', 'onboarding'].includes(detectInstalledVersion({ home: empty }).rung),
        String(detectInstalledVersion({ home: empty }).rung));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ------------------------------------------------------- catalog integrity --
  if (CAT) {
    const v = verifyCatalogIntegrity(CAT);
    check('catalog integrity verifies', v.ok, v.errors.map(e => e.code).join(', '));

    const sourceIds = new Set((CAT.sources || []).map(s => s.id));
    const shortCite = [];
    const danglingSource = [];
    let entries = 0;
    for (const section of ['tools', 'hookEvents']) {
      for (const [name, e] of Object.entries(CAT[section] || {})) {
        entries++;
        const prov = Array.isArray(e.provenance) ? e.provenance : [];
        if (!prov.length) shortCite.push(`${section}.${name} (none)`);
        for (const p of prov) {
          if (!p || typeof p.quote !== 'string' || p.quote.trim().length <= 10) shortCite.push(`${section}.${name}`);
          if (!p || !sourceIds.has(p.source)) danglingSource.push(`${section}.${name} -> ${p && p.source}`);
        }
      }
    }
    check('every catalog entry carries provenance over 10 chars', shortCite.length === 0, shortCite.slice(0, 5).join(', '));
    check('every provenance source id resolves to a declared source', danglingSource.length === 0, danglingSource.slice(0, 5).join(', '));
    check('counts match the catalog body', (() => {
      const c = CAT.counts || {};
      const tools = Object.keys(CAT.tools || {});
      const events = Object.keys(CAT.hookEvents || {});
      return c.toolsTotal === tools.length
        && c.hookEventsTotal === events.length
        && c.toolsCurrent === tools.filter(n => CAT.tools[n].status === 'current').length
        && c.hookEventsCurrent === events.filter(n => CAT.hookEvents[n].status === 'current').length
        && entries === tools.length + events.length;
    })(), JSON.stringify(CAT.counts));
    check('the derived Sets are the catalog current names, not a literal',
      HOOK_EVENTS.size === CAT.counts.hookEventsCurrent && KNOWN_TOOLS.size === CAT.counts.toolsCurrent
      && HOOK_EVENTS.has('DirectoryAdded') && KNOWN_TOOLS.has('PowerShell'),
      `${KNOWN_TOOLS.size} tools / ${HOOK_EVENTS.size} events`);
  }

  // ------------------------------------------------------------ header line --
  check('the header states coverage when the build is at or below the catalog',
    /is covered by the catalog: an absent name is reported BROKEN\.$/.test(versionHeader(CAT, '2.1.220')),
    versionHeader(CAT, '2.1.220'));
  check('the header states the newer asymmetry when the build is ahead',
    /installed build 2\.1\.222 .*is NEWER than the catalog: names absent from the catalog are reported UNVERIFIED, not BROKEN\.$/.test(versionHeader(CAT, '2.1.222')),
    versionHeader(CAT, '2.1.222'));
  check('the header says so when the build is undetectable',
    /could not be detected: names absent from the catalog are reported UNVERIFIED, not BROKEN\.$/.test(versionHeader(CAT, null)),
    versionHeader(CAT, null));
  check('the header carries the catalog version and both counts',
    CAT ? versionHeader(CAT, null).includes(CAT.catalogVersion) && /\d+ current tools, \d+ current hook events/.test(versionHeader(CAT, null)) : true);

  // ------------------------------------------------- end to end finding kinds --
  // Every new check id fed a known bad input and OBSERVED red. hook-unsupported
  // -event cannot be produced by the committed catalog (all 31 hook events are
  // current), so it is fed a SYNTHETIC catalog: a check that cannot fail is a
  // defect, and "unreachable with today's data" is not evidence the wiring works.
  {
    const synth = {
      catalogVersion: '2.1.220',
      counts: { toolsCurrent: 1, hookEventsCurrent: 1 },
      sources: [{ id: 'hooks.md' }, { id: 'changelog.md' }, { id: 'tools-reference.md' }],
      tools: { Read: { status: 'current', provenance: [{ source: 'tools-reference.md', line: 42, quote: 'Reads the contents of files. See Read tool behavior' }] } },
      hookEvents: {
        PreToolUse: { status: 'current', provenance: [{ source: 'hooks.md', line: 100, quote: 'Runs before a tool call is executed and can block it' }] },
        OldEvent: { status: 'historical', reason: 'renamed in the changelog', aliasOf: 'PreToolUse', provenance: [{ source: 'changelog.md', line: 9, quote: 'Renamed OldEvent to PreToolUse for consistency across the hook table' }] },
      },
    };
    const tmp = join(tmpdir(), `doctor-kinds-${Date.now()}`);
    const home = join(tmp, 'home');
    const project = join(tmp, 'project');
    try {
      mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
      mkdirSync(project, { recursive: true });
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo ok' }] }],
          OldEvent: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo ok' }] }],
          PreToolUsed: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo ok' }] }],
        },
      }));
      writeFileSync(join(home, '.claude', 'agents', 'a.md'),
        '---\nname: a\ndescription: "an agent"\ntools: ["Read", "MultiEdit", "FrobnicateTool"]\n---\nbody\n');

      const runs = [
        runChecks({ home, project, assumeVersion: '2.1.220' }),
        runChecks({ home, project, assumeVersion: '2.1.999' }),
        runChecks({ home, project, assumeVersion: '2.1.220', catalog: synth }),
        runChecks({ home, project, assumeVersion: '2.1.999', catalog: synth }),
      ];
      const all = runs.flatMap(r => r.findings);
      const ids = new Set(all.map(f => f.check));
      for (const id of ['agent-unresolvable-tool', 'agent-unsupported-tool', 'agent-unverified-tool',
        'hook-unknown-event', 'hook-unsupported-event', 'hook-unverified-event']) {
        check(`check id ${id} fires on a known bad input`, ids.has(id), [...ids].join(', '));
      }
      check('every finding carries a citation, the four new kinds included',
        all.every(f => f.citation && f.citation.length > 10),
        all.filter(f => !f.citation || f.citation.length <= 10).map(f => f.check).join(', '));
      check('an unsupported finding quotes the catalog line that says so',
        all.filter(f => f.check === 'agent-unsupported-tool').every(f => /permissions\.md:|errors\.md:|agent-sdk__/.test(f.citation)),
        (all.find(f => f.check === 'agent-unsupported-tool') || {}).citation);
      check('the unresolvable-tool id and severity are UNCHANGED for a covered build',
        runs[0].findings.some(f => f.check === 'agent-unresolvable-tool' && f.severity === 'BROKEN'));
      check('--strict-unknown promotes the end to end unknown finding to BROKEN', (() => {
        const r = runChecks({ home, project, assumeVersion: '2.1.999', strictUnknown: true });
        return r.findings.some(f => f.check === 'agent-unverified-tool' && f.severity === 'BROKEN');
      })());
      check('runChecks reports the version signal it used', runs[0].version.version === '2.1.220' && runs[0].absenceIsProof === true);
      check('runChecks reports the asymmetry flipping on a newer build', runs[1].absenceIsProof === false);
      check('runChecks with catalog null degrades to UNVERIFIED and never BROKEN', (() => {
        const r = runChecks({ home, project, assumeVersion: '2.1.220', catalog: null });
        return r.findings.some(f => f.check === 'agent-unverified-tool')
          && !r.findings.some(f => f.severity === 'BROKEN')
          && /UNAVAILABLE/.test(r.header);
      })());

      // CLI wiring. The classifiers can be perfect and the flags still not
      // reach them, which is a defect no pure-function row can see.
      {
        const cli = spawnSync(process.execPath,
          [fileURLToPath(import.meta.url), '--home', home, '--project', project, '--json', '--no-delegate',
            '--assume-version', '2.1.999', '--strict-unknown'],
          { encoding: 'utf8', timeout: 60_000, windowsHide: true });
        let parsed = null;
        try { parsed = JSON.parse((cli.stdout || '').slice((cli.stdout || '').indexOf('{'))); } catch { }
        check('--assume-version and --strict-unknown reach the classifier through the CLI',
          !!parsed && parsed.capability.installed.version === '2.1.999' && parsed.capability.strictUnknown === true
          && parsed.findings.some(f => f.check === 'agent-unverified-tool' && f.severity === 'BROKEN'),
          parsed ? parsed.capability.header : `exit ${cli.status}`);
        check('--json emits ONE parseable object with the header inside it, not before it',
          !!parsed && (cli.stdout || '').trim().startsWith('{') && typeof parsed.capability.header === 'string');
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ------------------------------------------------- monitors and channels --
  // 12 new checks are 12 new false-positive opportunities, and this file's
  // history is three shipped false positives (matcher "*", the multi-line YAML
  // scalar, the zero-indent block sequence) plus the 14-tool class fixed one
  // agent ago. So every check below is fed a known-bad input AND a correctly
  // authored input, in a real tree on disk, and both verdicts are asserted. A
  // check only ever seen firing is half-tested.
  {
    const tmp = join(tmpdir(), `doctor-mc-${Date.now()}`);
    const w = (rel, body) => {
      const p = join(tmp, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
      return p;
    };
    const run = (homeRel, projRel) => {
      mkdirSync(join(tmp, homeRel), { recursive: true });
      mkdirSync(join(tmp, projRel), { recursive: true });
      return runChecks({ home: join(tmp, homeRel), project: join(tmp, projRel), assumeVersion: COVERED });
    };
    const MC = f => /^(monitor|channel)-/.test(f.check);
    try {
      // ---- a CORRECTLY AUTHORED monitor and channel plugin -----------------
      // Both monitor entries are the official example from monitors.md
      // Configuration, byte for byte, including `tail -F ./logs/error.log`.
      w('good/good-plugin/.claude-plugin/plugin.json', {
        name: 'good-plugin',
        description: 'A correctly authored monitor and channel plugin.',
        mcpServers: { telegram: { command: 'node', args: ['./server.mjs'] } },
        channels: [{ server: 'telegram', userConfig: { bot_token: { type: 'string', title: 'Bot token', sensitive: true } } }],
      });
      w('good/good-plugin/monitors/monitors.json', [
        { name: 'deploy-status', command: '"${CLAUDE_PLUGIN_ROOT}"/scripts/poll-deploy.sh', description: 'Deployment status changes' },
        { name: 'error-log', command: 'tail -F ./logs/error.log', description: 'Application error log', when: 'on-skill-invoke:debug' },
        { name: 'queue-depth', command: 'cd "${CLAUDE_PLUGIN_ROOT}" && ./scripts/queue.sh', description: 'Queue depth', when: 'always' },
      ]);
      w('good/good-plugin/scripts/poll-deploy.sh', '#!/bin/sh\necho deploy\n');
      w('good/good-plugin/scripts/queue.sh', '#!/bin/sh\necho queue\n');
      w('good/good-plugin/skills/debug/SKILL.md', '---\nname: debug\ndescription: "Debug helper"\n---\nbody\n');
      const good = run('home-empty', 'good');
      check('a CORRECTLY AUTHORED monitor and channel plugin yields ZERO findings',
        good.findings.length === 0, good.findings.map(f => `${f.check} @ ${f.where}`).join(' | '));

      // The same plugin from the OTHER two documented homes: a custom
      // experimental.monitors path, a plugin-root .mcp.json, and skills reached
      // through a manifest path. Each is a reader that could silently do
      // nothing and still leave the row above green.
      w('good-alt/alt-plugin/.claude-plugin/plugin.json', {
        name: 'alt-plugin',
        description: 'Monitors from a custom path, servers from .mcp.json.',
        experimental: { monitors: './config/monitors.json' },
        skills: ['./custom-skills/'],
        channels: [{ server: 'webhook' }],
      });
      w('good-alt/alt-plugin/.mcp.json', { mcpServers: { webhook: { command: 'node', args: ['server.mjs'] } } });
      w('good-alt/alt-plugin/config/monitors.json', [
        { name: 'watch', command: '"${CLAUDE_PLUGIN_ROOT}"/bin/watch.sh', description: 'Watch the queue', when: 'on-skill-invoke:triage' },
      ]);
      w('good-alt/alt-plugin/bin/watch.sh', '#!/bin/sh\n');
      w('good-alt/alt-plugin/custom-skills/triage/SKILL.md', '---\nname: triage\ndescription: "Triage"\n---\nbody\n');
      const goodAlt = run('home-empty', 'good-alt');
      check('a custom experimental.monitors path, .mcp.json servers and manifest skills all resolve',
        goodAlt.findings.length === 0, goodAlt.findings.map(f => `${f.check} @ ${f.where}`).join(' | '));

      // ---- every monitor and channel defect, in one plugin ------------------
      w('bad/bad-plugin/.claude-plugin/plugin.json', {
        name: 'bad-plugin',
        description: 'Every documented monitor and channel defect at once.',
        // Top-level key on purpose: legacy home AND inline array in one shot.
        monitors: [
          { name: 'secrets', command: 'echo ${user_config.token}', description: 'Deploy status' },
          { command: 'echo x' },
          { name: 'whenwrong', command: 'echo x', description: 'd', when: 'sometimes' },
          { name: 'skillref', command: 'echo x', description: 'd', when: 'on-skill-invoke:ghost-skill' },
          { name: 'secrets', command: 'echo y', description: 'd' },
          { name: 'gone', command: '"${CLAUDE_PLUGIN_ROOT}"/scripts/gone.sh', description: 'd' },
          { name: 'cwd', command: 'tail -F ./logs/error.log', description: 'd' },
          { name: 'optvar', command: 'echo $CLAUDE_PLUGIN_OPTION_TOKEN', description: 'd' },
        ],
        mcpServers: { telegram: { command: 'node', args: ['./server.mjs'] } },
        channels: [{ server: 'ghost' }, {}],
      });
      // The ONLY difference from the good tree's identical command string.
      w('bad/bad-plugin/logs/error.log', 'boom\n');
      const bad = run('home-empty', 'bad');
      const badIds = new Set(bad.findings.map(f => f.check));
      for (const id of ['monitor-user-config-ref', 'monitor-entry-invalid', 'monitor-skill-unresolvable',
        'monitor-duplicate-name', 'monitor-command-missing', 'monitor-cwd-assumption',
        'monitor-plugin-option-var', 'monitor-manifest-key-legacy', 'channel-server-unbound']) {
        check(`check id ${id} fires on a known bad input`, badIds.has(id), [...badIds].join(', '));
      }
      check('the severities are the documented ones', (() => {
        const sev = id => (bad.findings.find(f => f.check === id) || {}).severity;
        return sev('monitor-user-config-ref') === 'BROKEN' && sev('monitor-entry-invalid') === 'BROKEN'
          && sev('monitor-skill-unresolvable') === 'BROKEN' && sev('channel-server-unbound') === 'BROKEN'
          && sev('monitor-duplicate-name') === 'SILENT' && sev('monitor-command-missing') === 'SILENT'
          && sev('monitor-cwd-assumption') === 'SILENT' && sev('monitor-plugin-option-var') === 'SILENT'
          && sev('monitor-manifest-key-legacy') === 'INFO';
      })(), bad.findings.filter(MC).map(f => `${f.severity}:${f.check}`).join(', '));
      check('a bad monitor or channel plugin exits non-zero (BROKEN present)',
        bad.findings.some(f => f.severity === 'BROKEN' && MC(f)));
      check('every monitor and channel finding carries a citation over 10 chars',
        bad.findings.filter(MC).every(f => f.citation && f.citation.length > 10),
        bad.findings.filter(MC).filter(f => !f.citation || f.citation.length <= 10).map(f => f.check).join(', '));
      check('the citations point into monitors.md and channels.md, the files that say it',
        bad.findings.filter(f => /^monitor-/.test(f.check)).every(f => f.citation.startsWith('monitors.md'))
        && bad.findings.filter(f => /^channel-/.test(f.check)).every(f => f.citation.startsWith('channels.md')),
        bad.findings.filter(MC).map(f => f.citation.slice(0, 14)).join(' | '));
      check('the entry missing name and description is reported once, naming both fields', (() => {
        const f = bad.findings.find(x => x.check === 'monitor-entry-invalid' && /name is missing/.test(x.what));
        return !!f && /description is missing/.test(f.what);
      })(), (bad.findings.find(x => x.check === 'monitor-entry-invalid') || {}).what);
      check('an invalid when value is reported as a schema violation, not as an unresolvable skill', (() => {
        const inv = bad.findings.filter(f => f.check === 'monitor-entry-invalid');
        const unres = bad.findings.filter(f => f.check === 'monitor-skill-unresolvable');
        return inv.some(f => /"sometimes"/.test(f.what)) && unres.length === 1 && /ghost-skill/.test(unres[0].what);
      })());
      check('the duplicate name finding names BOTH sites', (() => {
        const f = bad.findings.find(x => x.check === 'monitor-duplicate-name');
        return !!f && f.where.includes(' AND ') && /"secrets"/.test(f.what);
      })());
      check('BOTH channel defects fire: a wrong server name and a missing one',
        bad.findings.filter(f => f.check === 'channel-server-unbound').length === 2
        && bad.findings.some(f => /"ghost"/.test(f.what)) && bad.findings.some(f => /names no server/.test(f.what)),
        bad.findings.filter(f => f.check === 'channel-server-unbound').map(f => f.where).join(' | '));

      // THE DESIGN CONDITION, isolated. `tail -F ./logs/error.log` is the docs'
      // own legitimate example. It is the SAME STRING in both trees; the only
      // difference is whether that relative path resolves to a file inside the
      // plugin. Drop the existence condition and this pair stops disagreeing,
      // which is exactly how the check would start firing on correct config.
      check('monitor-cwd-assumption turns on FILE EXISTENCE, not on relativeness',
        !good.findings.some(f => f.check === 'monitor-cwd-assumption')
        && bad.findings.some(f => f.check === 'monitor-cwd-assumption' && /\.\/logs\/error\.log/.test(f.what)));
      check('a cd "${CLAUDE_PLUGIN_ROOT}" && prefix suppresses the cwd finding', (() => {
        w('cdfix/p/.claude-plugin/plugin.json', { name: 'p', description: 'd', experimental: { monitors: [{ name: 'm', command: 'cd "${CLAUDE_PLUGIN_ROOT}" && tail -F ./logs/error.log', description: 'd' }] } });
        w('cdfix/p/logs/error.log', 'x\n');
        const r = run('home-empty', 'cdfix');
        return !r.findings.some(f => f.check === 'monitor-cwd-assumption');
      })());
      check('without the prefix the SAME plugin goes red', (() => {
        w('cdbad/p/.claude-plugin/plugin.json', { name: 'p', description: 'd', experimental: { monitors: [{ name: 'm', command: 'tail -F ./logs/error.log', description: 'd' }] } });
        w('cdbad/p/logs/error.log', 'x\n');
        const r = run('home-empty', 'cdbad');
        return r.findings.some(f => f.check === 'monitor-cwd-assumption');
      })());
      // Found by running the tool rather than by a test: `sh poll.sh` with
      // poll.sh in the plugin root is the cwd defect exactly, and the first
      // draft required a separator in the token and walked past it.
      check('a BARE relative filename that exists in the plugin is caught too', (() => {
        w('bareexec/p/.claude-plugin/plugin.json', { name: 'p', description: 'd', experimental: { monitors: [{ name: 'm', command: 'sh poll.sh --once', description: 'd' }] } });
        w('bareexec/p/poll.sh', '#!/bin/sh\n');
        const r = run('home-empty', 'bareexec');
        return r.findings.some(f => f.check === 'monitor-cwd-assumption' && /"poll\.sh"/.test(f.what))
          && !r.findings.some(f => f.check === 'monitor-command-missing');
      })());
      // ...and the guard that widening it needed: a bare WORD that happens to
      // name a file in the plugin is an argument, not a path. A make target is
      // the everyday case, and flagging it would be a false positive.
      check('a bare word with no extension is NOT read as a path', (() => {
        w('maketarget/p/.claude-plugin/plugin.json', { name: 'p', description: 'd', experimental: { monitors: [{ name: 'm', command: 'make build', description: 'd' }] } });
        w('maketarget/p/build', 'not a path argument\n');
        return !run('home-empty', 'maketarget').findings.some(MC);
      })());
      // A command whose path is a variable this tool cannot expand must be left
      // alone: guessing at ${MY_LOG_DIR} is how a linter invents a finding.
      check('an unexpandable variable in the path is left alone, not guessed at', (() => {
        w('varpath/p/.claude-plugin/plugin.json', { name: 'p', description: 'd', experimental: { monitors: [{ name: 'm', command: 'sh "${MY_TOOLS}"/watch.sh', description: 'd' }] } });
        const r = run('home-empty', 'varpath');
        return !r.findings.some(MC);
      })(), 'a $-carrying token must not be resolved');
      // experimental.monitors is the CURRENT home, so it must NOT draw the
      // legacy INFO: a check that fires on the recommended form is a defect.
      check('experimental.monitors does NOT draw the legacy-key finding',
        !run('home-empty', 'cdfix').findings.some(f => f.check === 'monitor-manifest-key-legacy'));
      check('a plugin with no monitors and no channels draws nothing', (() => {
        w('plain/p/.claude-plugin/plugin.json', { name: 'p', description: 'A plugin with neither component.' });
        return !run('home-empty', 'plain').findings.some(MC);
      })());
      check('a monitor plugin with no channels draws no channel finding and vice versa',
        !good.findings.some(f => /^channel-/.test(f.check))
        && !bad.findings.filter(f => /^monitor-/.test(f.check)).some(f => /channels\[/.test(f.where)));

      // ---- allowedChannelPlugins policy ------------------------------------
      w('home-inert/.claude/settings.json', { allowedChannelPlugins: [] });
      const inert = run('home-inert', 'plain-proj');
      check('an EMPTY allowlist is reported as not a kill switch',
        inert.findings.some(f => f.check === 'channel-allowlist-empty' && f.severity === 'SILENT'),
        inert.findings.map(f => f.check).join(', '));
      check('an allowlist with channelsEnabled absent is reported inert',
        inert.findings.some(f => f.check === 'channel-allowlist-inert' && f.severity === 'SILENT'));
      w('home-shape/.claude/settings.json', {
        channelsEnabled: true,
        allowedChannelPlugins: [{ marketplace: 'm' }, { plugin: 'p' }, 'claude-plugins-official/telegram'],
      });
      const shape = run('home-shape', 'plain-proj');
      check('every malformed allowlist entry is reported',
        shape.findings.filter(f => f.check === 'channel-allowlist-invalid' && f.severity === 'BROKEN').length === 3,
        shape.findings.map(f => f.check).join(', '));
      check('a malformed allowlist entry names WHICH half is missing',
        shape.findings.some(f => f.check === 'channel-allowlist-invalid' && /plugin is missing/.test(f.what))
        && shape.findings.some(f => f.check === 'channel-allowlist-invalid' && /marketplace is missing/.test(f.what)),
        shape.findings.filter(f => f.check === 'channel-allowlist-invalid').map(f => f.what).join(' | '));
      check('channelsEnabled true silences the inert finding',
        !shape.findings.some(f => f.check === 'channel-allowlist-inert'));
      // The correctly authored policy, which is where a false positive would hurt most.
      w('home-policy-ok/.claude/settings.json', {
        channelsEnabled: true,
        allowedChannelPlugins: [{ marketplace: 'claude-plugins-official', plugin: 'telegram' }],
      });
      check('a CORRECTLY AUTHORED channel policy yields ZERO channel findings', (() => {
        const r = run('home-policy-ok', 'plain-proj');
        return !r.findings.some(MC);
      })());
      check('channelsEnabled alone, with no allowlist, draws nothing', (() => {
        w('home-enabled-only/.claude/settings.json', { channelsEnabled: true });
        return !run('home-enabled-only', 'plain-proj').findings.some(MC);
      })());
      check('settings with no channel keys at all draw nothing', (() => {
        w('home-nokeys/.claude/settings.json', { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo ok' }] }] } });
        return !run('home-nokeys', 'plain-proj').findings.some(MC);
      })());

      // ---- the readers, unit level -----------------------------------------
      const goodRoot = join(tmp, 'good', 'good-plugin');
      const goodManifest = readJson(join(goodRoot, '.claude-plugin', 'plugin.json')).value;
      check('pluginSkillNames finds the default skills/ tree by directory AND frontmatter name',
        pluginSkillNames(goodRoot, goodManifest).has('debug'));
      check('pluginSkillNames reads a manifest skills path', (() => {
        const root = join(tmp, 'good-alt', 'alt-plugin');
        return pluginSkillNames(root, readJson(join(root, '.claude-plugin', 'plugin.json')).value).has('triage');
      })());
      check('pluginMcpServerNames reads the inline manifest map',
        pluginMcpServerNames(goodRoot, goodManifest).has('telegram'));
      check('pluginMcpServerNames reads the plugin-root .mcp.json', (() => {
        const root = join(tmp, 'good-alt', 'alt-plugin');
        return pluginMcpServerNames(root, readJson(join(root, '.claude-plugin', 'plugin.json')).value).has('webhook');
      })());
      check('loadPluginMonitors reads the default monitors/monitors.json', (() => {
        const l = loadPluginMonitors(goodRoot, goodManifest, 'x');
        return l.entries.length === 3 && l.legacyKey === false;
      })());
      check('loadPluginMonitors reads an inline array and flags the legacy key', (() => {
        const root = join(tmp, 'bad', 'bad-plugin');
        const l = loadPluginMonitors(root, readJson(join(root, '.claude-plugin', 'plugin.json')).value, 'x');
        return l.entries.length === 8 && l.legacyKey === true;
      })());
      check('loadPluginMonitors distinguishes a path array from an entry array', (() => {
        const root = join(tmp, 'good-alt', 'alt-plugin');
        const l = loadPluginMonitors(root, readJson(join(root, '.claude-plugin', 'plugin.json')).value, 'x');
        return l.entries.length === 1 && l.legacyKey === false && l.sources.length === 1;
      })());
      check('a plugin.json that does not parse does not crash the monitor readers', (() => {
        w('brokenjson/p/.claude-plugin/plugin.json', '{ not json');
        const r = run('home-empty', 'brokenjson');
        return Array.isArray(r.findings);
      })());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // Every finding must carry a citation: an uncited complaint is an opinion.
  {
    const dir = join(FIX, 'bad-hook-event');
    const { findings } = runChecks({ home: join(dir, 'home'), project: join(dir, 'project'), assumeVersion: COVERED });
    check('every finding carries a citation', findings.every(f => f.citation && f.citation.length > 10));
  }

  console.log(bad ? `SELF-TEST FAIL: ${bad} check(s) failed` : 'SELF-TEST PASS: every documented failure mode detected, clean tree silent.');
  process.exit(bad ? 1 : 0);
}

// --------------------------------------------------------------------- main --

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) main();

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

  const home = resolve(arg('--home') || homedir());
  const project = resolve(arg('--project') || process.cwd());
  const asJson = argv.includes('--json');
  const assumeVersion = arg('--assume-version');
  const strictUnknown = argv.includes('--strict-unknown');

  const { scopes, findings, version, catalogVersion, absenceIsProof: proof, header } =
    runChecks({ home, project, assumeVersion, strictUnknown });

  let delegated = [];
  const explicit = arg('--delegate');
  const allLevels = argv.includes('--delegate-all');
  if (explicit) delegated = delegateToAgnix(explicit, { home, project, allLevels });
  else if (!argv.includes('--no-delegate')) {
    const probe = spawnSync('agnix', ['--version'], { encoding: 'utf8', timeout: 15_000, shell: true, windowsHide: true });
    if (probe.status === 0) delegated = delegateToAgnix('agnix', { home, project, allLevels });
  }
  const all = [...findings, ...delegated];

  if (asJson) {
    // The header rides INSIDE the payload here. Printing a bare line before the
    // JSON would be a second way to say the same thing and a first way to break
    // every consumer that parses stdout.
    console.log(JSON.stringify({
      home, project, scopes,
      capability: { catalogVersion, installed: version, absenceIsProof: proof, strictUnknown, header },
      findings: all,
    }, null, 2));
  } else {
    console.log(`extension-doctor  home=${home}  project=${project}`);
    console.log(`scopes found: ${scopes.map(s => s.scope).join(', ') || 'none'}${delegated.length || explicit ? '  (agnix delegated)' : '  (agnix not found; per-file lint coverage reduced)'}`);
    console.log(header + (strictUnknown ? '  [--strict-unknown: UNVERIFIED names are promoted to BROKEN]' : ''));
    console.log('');
    if (!all.length) console.log('No findings. All documented silent-failure conditions absent.');
    for (const f of all.sort((a, b) => ['BROKEN', 'SILENT', 'INFO'].indexOf(a.severity) - ['BROKEN', 'SILENT', 'INFO'].indexOf(b.severity))) {
      console.log(`${f.severity.padEnd(7)} [${f.check}] ${f.where}`);
      console.log(`        ${f.what}`);
      if (f.fix) console.log(`        fix: ${f.fix}`);
      if (f.citation) console.log(`        why: ${f.citation}`);
      console.log('');
    }
    const broken = all.filter(f => f.severity === 'BROKEN').length;
    console.log(`${all.length} finding(s): ${broken} BROKEN, ${all.filter(f => f.severity === 'SILENT').length} SILENT, ${all.filter(f => f.severity === 'INFO').length} INFO.`);
  }
  process.exit(all.some(f => f.severity === 'BROKEN') ? 1 : 0);
}
