#!/usr/bin/env node
/**
 * Do the verbatim quotes in the reference files still appear upstream?
 *
 * WHY THIS EXISTS
 * ---------------
 * "Re-verify against the new build" was, until now, a manual sweep. 163 version
 * tags across 25 files, 40 of them pinned to one build, and the only way to check
 * them was to read. A manual sweep is not a gate: it happens once, nobody repeats
 * it, and the repo's own header warns that prose drifts from the artifact it
 * describes.
 *
 * The check that CAN be mechanical is the narrowest and most load-bearing one: a
 * claim that quotes upstream verbatim is falsified the moment that sentence stops
 * existing. This walks every evidence-tagged line, pulls the quoted fragments out,
 * and asserts each still appears somewhere in the local docs mirror.
 *
 * WHAT IT DOES NOT DO, stated because the gap matters more than the coverage.
 * A quote that still appears has not been shown to still MEAN the same thing: the
 * surrounding paragraph can invert it, and this would not notice. It also says
 * nothing about untagged prose, about [ENGINEERING] judgment, or about behaviour.
 * It answers exactly one question, "has the sentence I quoted disappeared", and
 * that question happens to be the one that goes stale silently.
 *
 * The mirror is not committed (copyright), so with no mirror this exits 2, CANNOT
 * CHECK, rather than passing. A check that reports success when it could not run
 * is the defect this project keeps finding in its own tooling.
 *
 * usage:
 *   node tools/quote-check.mjs                     check against the default mirror
 *   node tools/quote-check.mjs --mirror <dir>      check against a specific revision
 *   node tools/quote-check.mjs --self-test         includes must-fail cases
 *   node tools/quote-check.mjs --json
 *
 * exit: 0 every quote found, 1 one or more missing, 2 cannot check (no mirror)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REF_DIR = join(ROOT, 'skills', 'claude-code-extension-engineering', 'references');
export const DEFAULT_MIRROR = 'P:/ClaudeExt/CCX-Extension-Research/sources/docs/md';

/**
 * Smart quotes, entity forms, line wrapping and OUR OWN MARKDOWN all have to
 * collapse, or the gate cries wolf.
 *
 * The first version normalised only whitespace and quote glyphs and reported 16
 * missing quotes against a mirror where every one of them was present. The cause
 * was ours, not upstream: this project backticks identifiers INSIDE a quoted
 * sentence, so `add an ask rule for \`Bash(dangerouslyDisableSandbox:true)\``
 * never matches the unbackticked original. Sixteen false alarms on the first run
 * is a gate nobody would keep, which is worse than not having one.
 *
 * So emphasis markers are stripped from both sides before comparison. That
 * deliberately loses the ability to detect a formatting-only change upstream,
 * which is not a claim anyone makes.
 */
export function normalise(s) {
  return String(s)
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    // Inline markdown LINKS, keeping the link text. This was the second and
    // larger cause of false misses: upstream writes
    // "Explicit [deny rules](/docs/en/permissions) are always respected" while
    // we quote the prose, so a literal comparison diverged after one word. The
    // binary-search diagnostic printed a longest matching prefix of "Explicit ",
    // which is what pointed at it.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    /**
     * BACKTICKS ONLY. `*` and `_` were stripped here too and that was a silent
     * hole, found by independent review: stripping `*` collapses
     * `Edit(infra/**)` and `Edit(infra/*)` to the same string, so an upstream
     * widening of a glob would have gone undetected by a gate whose whole job is
     * detecting upstream change. Underscore went for the same reason: it is a
     * character inside identifiers like CLAUDE_PLUGIN_ROOT, not decoration.
     *
     * The cost is real and accepted: markdown emphasis inside a quoted sentence
     * will now cause a MISS rather than a silent match. A miss is visible and
     * gets adjudicated; a silent match is the failure mode this file exists to
     * avoid.
     */
    .replace(/`/g, '')
    /**
     * EMPHASIS PAIRS, not bare asterisks. This distinction is the whole fix.
     *
     * Stripping every `*` collapsed `Edit(infra/**)` and `Edit(infra/*)` into one
     * string, so an upstream widening of a glob was invisible to a gate whose job
     * is detecting upstream change. Independent review demonstrated it.
     *
     * But upstream also writes `**Sandboxing** provides OS-level enforcement`
     * while we quote the plain word, so leaving `*` entirely alone produced a
     * false miss on the very next run.
     *
     * A PAIR is markup; a lone asterisk is content. `**x**` and `*x*` need two
     * delimiters with text between them, which `Bash(rm *)` and `infra/**)` do
     * not have, so both survive intact and stay distinguishable.
     */
    /**
     * ...and the pair must not span a PATH. The first pair-based attempt read
     * `Edit(docs/**) and Read(docs/**)` as one bold span, because the two globs
     * supply two `**` delimiters with text between them, and quietly deleted
     * both globs. Its own new self-test row caught that immediately.
     *
     * Markdown bold in prose wraps a word or two: `**Sandboxing**`,
     * `**failIfUnavailable**`. A span containing a slash or a parenthesis is a
     * path or a rule, never emphasis, so those are left alone.
     */
    .replace(/\*\*([^*/()]+)\*\*/g, '$1')
    .replace(/__([^_/()]+)__/g, '$1')
    .replace(/\*([^*\s/()][^*/()]*?)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A quote written with an ellipsis is an ABRIDGEMENT, and matching it literally
 * can only ever fail. Split on the ellipsis and require every fragment to appear,
 * which is the strongest thing that abridgement supports.
 */
export function fragmentsOf(quote) {
  return String(quote).split(/\s*\.\.\.\s*|\s*\u2026\s*/)
    .map((f) => f.trim())
    .filter((f) => f.length >= 12);
}

/**
 * Fragments an abridged quote DROPS, so the loss is reported rather than silent.
 *
 * Independent review found that a live quote loses one: "Use `Bash(rm *)` ...
 * instead." splits into a long half and "instead.", and the short half is filtered
 * out, so only half the quote was ever verified. The filtering is still right, a
 * three-character fragment appears on every page and proves nothing, but doing it
 * silently means the run reports full coverage of a quote it half-checked.
 */
export function droppedFragments(quote) {
  return String(quote).split(/\s*\.\.\.\s*|\s*\u2026\s*/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && f.length < 12);
}

/**
 * Pull quoted fragments out of one line.
 *
 * MINIMUM LENGTH IS THE WHOLE DESIGN. A 25-char floor was chosen after trying
 * none: short quotes are words like "deny" and `Edit`, which appear in every page
 * and prove nothing, so a gate over them is green by construction. Backticked
 * code spans are excluded for the same reason, plus they are frequently OUR
 * formatting of an identifier rather than an upstream sentence.
 */
export const MIN_QUOTE = 25;

/**
 * A line often carries SEVERAL short quoted examples, and a naive pair-up spans
 * our own prose between them. Three of the six first-run "missing" quotes were
 * exactly that: the closing quote of `"Bash(git *)"` paired with the opening
 * quote of the next example, capturing the sentence in between and reporting it
 * as a citation that had vanished.
 *
 * A spurious span is recognisable: it begins where a sentence cannot. Real quoted
 * prose does not start with a full stop, a colon, a comma, a closing bracket, or
 * a shell variable.
 */
const CANNOT_START_A_QUOTE = /^[\s{[.,;:)\]$]/;

/**
 * Curly quotes were invisible here until 2026-08-19, so a fabricated citation written with them on
 * an [OFFICIAL] line passed every gate while its straight-quoted twin was checked. The pairs are
 * folded to straight quotes before extraction; `normalise` already folds them on the mirror side,
 * so both halves of the comparison now agree.
 */
export function foldQuoteMarks(s) {
  return String(s).replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

export function quotesIn(line) {
  line = foldQuoteMarks(line);
  const out = [];
  for (const m of String(line).matchAll(/"([^"]{25,})"/g)) {
    const q = normalise(m[1]);
    if (CANNOT_START_A_QUOTE.test(q)) continue;
    if (q.length >= MIN_QUOTE) out.push(q);
  }
  return out;
}

/**
 * SCARE QUOTES, which are ours and were never upstream.
 *
 * These cannot be told apart structurally from a citation: both are prose inside
 * double quotes on a tagged line. So they are listed, with a reason each, the way
 * coverage-report.mjs lists its ambiguity exemptions. The list is asserted SMALL
 * in the self-test, because an exemption list is how a gate quietly stops
 * checking, and a long one means the extractor needs fixing instead.
 */
export const NOT_A_CITATION = new Map([
  ['reload the plugin and try again', 'monitors.md: our phrasing of the WRONG instruction, quoted to name it as wrong. Never an upstream sentence.'],
]);

/**
 * Lines whose quotes must resolve against ANTHROPIC'S OWN PAGES. COMMUNITY is deliberately NOT
 * here. It was, and that was a semantic error waiting to fire: [COMMUNITY] means community
 * practice, which by definition is not in Anthropic's documentation, so demanding that its quotes
 * appear in the mirror would fail every honest community citation and pass only the ones that had
 * drifted into paraphrasing Anthropic. Nothing broke while the set was wrong because no COMMUNITY
 * line happened to carry a quoted span; the corpus adoption ahead would have supplied plenty.
 */
const TAGGED = /\[(OFFICIAL|ANTHROPIC|EXPERIMENTAL|LEGACY|DEPRECATED)\]|\[v\d+\.\d+\.\d+\]/;

/**
 * The other half of that decision. Dropping COMMUNITY from the mirror check must not leave its
 * quotes unchecked, so a verbatim span on a COMMUNITY-only line is refused outright: this project
 * holds no mirror of community sources, so such a quote is unverifiable by construction and the
 * honest move is to paraphrase and attribute rather than present quotation marks nothing can
 * confirm. A line carrying BOTH tags still resolves against the mirror, because the OFFICIAL half
 * is a promise about Anthropic's wording.
 */
const COMMUNITY_TAGGED = /\[COMMUNITY( PRACTICE)?\]/;

/**
 * The scan covers the references directory AND the skill's own SKILL.md. SKILL.md was outside it
 * until 2026-08-19, which an adversarial panel flagged as a latent hole: the library's front page
 * could carry a COMMUNITY-tagged quotation, or a documentation-tagged one that had gone stale
 * upstream, and no gate would look. It carries 9 quoted spans today and none on a tagged line, so
 * this changes no count; it removes the exemption before something lands in it.
 */
function scanTargets(refDir) {
  const out = readdirSync(refDir)
    .filter((x) => x.endsWith('.md'))
    .map((f) => ({ name: f, path: join(refDir, f) }));
  const skill = join(refDir, '..', 'SKILL.md');
  if (existsSync(skill)) out.push({ name: 'SKILL.md', path: skill });
  return out;
}

/**
 * Physical lines joined into the sentences a reader sees. A bullet or paragraph continued onto the
 * next line is ONE line here, which is what makes a citation broken by a wrap visible. Fenced and
 * indented code blocks are passed through unjoined, since a wrap means nothing inside them.
 *
 * The reported `line` is where the logical line STARTS, so a citation is cited at the line a reader
 * would look at.
 */
export function logicalLines(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let fenced = false;
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { flush(); fenced = !fenced; out.push({ line: i + 1, text: l }); continue; }
    if (fenced || /^ {4,}\S/.test(l)) { flush(); out.push({ line: i + 1, text: l }); continue; }
    if (!l.trim()) { flush(); continue; }
    /* A new block starts at a bullet, a heading, a table row, or a blockquote marker. Anything else
       that is not blank continues the block above it. */
    if (/^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|\||>)/.test(l) || !cur) { flush(); cur = { line: i + 1, text: l }; continue; }
    cur.text += ` ${l.trim()}`;
  }
  flush();
  return out;
}

function scanLines(refDir, predicate) {
  const out = [];
  for (const { name: f, path } of scanTargets(refDir)) {
    for (const { line, text } of logicalLines(readFileSync(path, 'utf8'))) {
      if (!predicate(text)) continue;
      for (const q of quotesIn(text)) {
        if (NOT_A_CITATION.has(q)) continue;
        out.push({ file: f, line, quote: q });
      }
    }
  }
  return out;
}

/**
 * Which regime a line's quotes fall under. Pure, so the must-fail rows can exercise it without
 * writing fixture files into the tree during a gate run.
 *   'mirror'    quotes must appear in Anthropic's pages
 *   'community' quotes are unverifiable here and are refused
 *   'none'      untagged prose and [ENGINEERING] judgment; this gate says nothing about them
 */
export function classifyLine(line) {
  if (TAGGED.test(line)) return 'mirror';
  if (COMMUNITY_TAGGED.test(line)) return 'community';
  return 'none';
}

export function collectQuotes(refDir = REF_DIR) {
  return scanLines(refDir, (line) => classifyLine(line) === 'mirror');
}

/** Quoted spans on COMMUNITY-only lines: unverifiable by construction, so always a finding. */
export function collectUnverifiableQuotes(refDir = REF_DIR) {
  return scanLines(refDir, (line) => classifyLine(line) === 'community');
}

/**
 * Quoted spans on lines in NEITHER regime. Most are illustrative: a user phrase, a scare quote, an
 * error string. A few are real quotations of Anthropic's prose, and those are the problem: nothing
 * checks them, nothing counts them, and the file header still says every quote was confirmed
 * upstream. Found 2026-08-19 at sandboxing.md:17, whose 27-character span resolves against the
 * mirrored sandboxing page while sitting on an [ENGINEERING] line.
 *
 * FENCED CODE BLOCKS ARE SKIPPED. A JSON example's string values are not citations, and two of the
 * three spans that resolved upstream were exactly that: "permissionDecisionReason" and a monitor
 * description inside ``` fences. Treating those as citations would demand a documentation tag on
 * every configuration example in the library.
 */
export function collectUncheckedResolvingQuotes(refDir = REF_DIR, pages) {
  if (!pages) return [];
  const out = [];
  for (const { name: f, path } of scanTargets(refDir)) {
    let fenced = false;
    /* Logical lines here too, or a citation that escapes the COUNT by wrapping also escapes the
       hunt meant to catch citations the count cannot see. Both fence spellings and indented blocks
       are skipped, since a configuration example is not a citation. */
    for (const { line, text } of logicalLines(readFileSync(path, 'utf8'))) {
      if (/^\s*(```|~~~)/.test(text)) { fenced = !fenced; continue; }
      if (fenced) continue;
      if (/^ {4,}\S/.test(text)) continue;
      if (classifyLine(text) !== 'none') continue;
      for (const q of quotesIn(text)) {
        if (NOT_A_CITATION.has(q)) continue;
        const page = findQuote(q, pages);
        if (page) out.push({ file: f, line, quote: q, page });
      }
    }
  }
  return out;
}

export function loadMirror(dir) {
  const pages = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const p = join(dir, f);
    if (!statSync(p).isFile()) continue;
    pages.set(f, normalise(readFileSync(p, 'utf8')));
  }
  return pages;
}

/**
 * Trailing sentence punctuation is OURS. We quote a bullet and add the full stop
 * that our own sentence needs, so "Explicit deny rules are always respected."
 * failed against an upstream bullet that ends without one. Trimming it on the
 * quote side only is safe: it can turn a false miss into a match, never a real
 * miss into one, because the words before it still have to be present.
 */
const trimTail = (s) => s.replace(/[.,;:]+$/, '');

export function findQuote(quote, pages) {
  const parts = fragmentsOf(quote).map(trimTail).filter(Boolean);
  if (!parts.length) return null;
  for (const [name, text] of pages) if (parts.every((p) => text.includes(p))) return name;
  return null;
}

/**
 * A reference file's header states how many verbatim quotes it carries, which tells a reader how
 * much of that file this gate actually covers. Nothing kept the two in agreement, so the sentence
 * went stale the moment a quote was added and stayed stale through two verification passes: an
 * independent review found testing.md still claiming NO quotes after one was added, and hooks.md
 * claiming TWO while the extractor found six. hooks.md's own header already names this defect
 * class in its own words, so the project had documented the failure and then repeated it.
 *
 * The header is a CLAIM ABOUT THIS GATE, so this gate is the right place to check it. Files whose
 * header makes no quote claim are skipped rather than required to make one.
 */
const QUOTE_COUNT_WORDS = {
  NO: 0, NONE: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6,
  SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12,
  THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16, SEVENTEEN: 17,
  EIGHTEEN: 18, NINETEEN: 19, TWENTY: 20,
  'TWENTY-ONE': 21, 'TWENTY-TWO': 22, 'TWENTY-THREE': 23, 'TWENTY-FOUR': 24,
  'TWENTY-FIVE': 25, 'TWENTY-SIX': 26, 'TWENTY-SEVEN': 27, 'TWENTY-EIGHT': 28,
  'TWENTY-NINE': 29, THIRTY: 30,
};

/**
 * Every dialect the reference headers actually use. Kept as a list rather than one clever regex so
 * a new dialect is added deliberately: a header phrased in a way none of these match is treated as
 * making NO claim, and a file with quotes that makes no claim is a failure below.
 */
const HEADER_CLAIM_PATTERNS = [
  /carries\s+([A-Za-z]+(?:-[A-Za-z]+)?|\d+)\s+verbatim\s+quotes?/i,
  /all\s+([A-Za-z]+(?:-[A-Za-z]+)?|\d+)\s+verbatim\s+quotes?\s+in\s+this\s+file/i,
];

/**
 * TWO SHAPES THIS DELIBERATELY DOES NOT READ, both of which fail CLOSED and were measured on
 * 2026-08-19. A CommonMark lazy continuation (a count phrase on an unmarked line following a
 * blockquote line) and a SECOND blockquote paragraph after a blank line both yield no claim. For a
 * file carrying quotes that is a FAILURE, since silence is only allowed at zero quotes, so the
 * gate errs toward complaining rather than toward believing. Widening the parser to accept them
 * would let body prose reach the header, which the boundary rule exists to prevent.
 *
 * THE HEADER IS THE LEADING BLOCKQUOTE, not a fixed number of lines. An adversarial panel found
 * safety-classifier.md wrapping "It carries NO / verbatim quotes" across the 8-line boundary, so
 * the claim was invisible and only the line break decided it. Reading the blockquote to its end
 * removes the wrap from the question entirely.
 */
export function headerBlock(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let started = false;
  /* No line cap. A cap of 8 hid safety-classifier.md's wrapped claim; a cap of 40 merely moves the
     boundary somewhere less likely to be hit, which is the same defect with better odds. The
     blockquote's own end is the only non-arbitrary stopping point. */
  for (const l of lines) {
    if (/^\s*>/.test(l)) { started = true; out.push(l.replace(/^\s*>\s?/, '')); continue; }
    if (started && !l.trim()) break;
    if (started) break;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

export function headerQuoteClaim(text) {
  const head = headerBlock(text);
  /* EVERY match, not the first. A header carrying two different counts would otherwise show the
     reader one number while the gate checked another, and first-match-wins made that silent. Two
     matches agreeing is fine, since a header may restate its count; two disagreeing is a claim the
     gate refuses to pick between. */
  const found = [];
  for (const re of HEADER_CLAIM_PATTERNS) {
    const all = head.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) || [];
    for (const hit of all) {
      const m = hit.match(re);
      if (m) found.push(m[1]);
    }
  }
  if (!found.length) return null;
  const parsed = found.map((raw) => ({
    word: raw,
    claimed: /^\d+$/.test(raw) ? Number(raw) : QUOTE_COUNT_WORDS[raw.toUpperCase()],
  })).map((p) => ({ word: p.word, claimed: p.claimed === undefined ? null : p.claimed }));
  const distinct = [...new Set(parsed.map((p) => String(p.claimed)))];
  if (distinct.length > 1) return { word: found.join(' and '), claimed: null, conflicting: true };
  return parsed[0];
}

export function headerQuoteMismatches(refDir = REF_DIR, quotes = collectQuotes(refDir)) {
  const byFile = new Map();
  for (const q of quotes) byFile.set(q.file, (byFile.get(q.file) || 0) + 1);
  const out = [];
  for (const { name: f, path } of scanTargets(refDir).sort((a, b) => a.name.localeCompare(b.name))) {
    const claim = headerQuoteClaim(readFileSync(path, 'utf8'));
    const actual = byFile.get(f) || 0;
    if (!claim) {
      /* Silence is honest for a file with nothing to describe, and a lie by omission for one whose
         quotes this gate is checking. permissions.md and sandboxing.md held 34 of 46 quotes and
         said nothing, so the gate's own PASS line overstated its reach. */
      if (actual > 0) out.push({ file: f, word: null, claimed: null, actual, reason: 'no claim' });
      continue;
    }
    /* ONE comparison, not two branches. An unparseable count is null, and null !== actual for
       every real count, so the unknown-number case rides on the same line the wrong-count case
       does. Two branches meant the rarer one could be deleted with every gate green, which a
       review demonstrated. */
    if (claim.claimed !== actual) {
      out.push({ file: f, word: claim.word, claimed: claim.claimed, actual, reason: claim.claimed === null ? 'not a number' : 'wrong count' });
    }
  }
  return out;
}

/**
 * A UNIVERSAL SOURCING CLAIM in a header is a promise about every claim in the file, and the ledger
 * is the only thing that can keep it. Rounds 1 to 3 of review found this construction false in
 * safety-classifier.md, then statusline.md, then sessions.md; each round it was corrected only
 * where it had been named, which is why it is a gate now rather than a habit.
 *
 * The rule is deliberately blunt: a header may say "every claim below was checked against X" only
 * when every ledger record for that file shares ONE source id. Any other file must state its split,
 * which is a sentence the ledger can be read against. Files with no ledger records are exempt,
 * because there is nothing to contradict.
 */
const UNIVERSAL_SOURCING = /\b(every|all|each)\s+claims?\s+below\b/i;

export function loadLedger(p = join(ROOT, 'evidence', 'claims.jsonl')) {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * The PURE decision, so the must-fail row can exercise it without a real header carrying the
 * construction. Fixing the corpus once made the corpus-level row unfalsifiable: it passed because
 * there was nothing left to find, which is a check that cannot fail wearing a green tick.
 */
export function sourcingMismatch(headerText, records) {
  if (!UNIVERSAL_SOURCING.test(String(headerText))) return null;
  if (!records || !records.length) return null;
  const sources = [...new Set(records.map((c) => c.source))];
  return sources.length > 1 ? { records: records.length, sources } : null;
}

/**
 * A header saying its sources were fetched on the file's own verification date is a claim about
 * sources.json, which records a `retrieved` date per source. Round 4 found four files asserting it
 * over sources retrieved on other days, including two rewritten in the same branch and one whose
 * exact date round 3 had already named.
 *
 * Only the "that day / that date" construction is checked, because a header naming an explicit
 * fetch date says what it means and can be read directly.
 */
const FETCH_ON_THAT_DATE = /\b(fetched?|fetches)\b[^.;]{0,60}\b(that (day|date))\b|\bon that date\b/i;

export function loadSources(p = join(ROOT, 'evidence', 'sources.json')) {
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** The pure decision, so its must-fail rows do not depend on the corpus being dirty. */
export function fetchDateMismatch(headerText, retrievedDates) {
  const head = String(headerText);
  if (!FETCH_ON_THAT_DATE.test(head)) return null;
  const dates = head.match(/20\d\d-\d\d-\d\d/g) || [];
  if (!dates.length) return null;
  /* Every retrieved date must APPEAR somewhere in the header, not merely equal the first one. A
     file citing pages fetched on two days is honest when it names both, and the earlier rule made
     that unsayable: it forced either a false sentence or a reworded evasion. */
  const claimed = dates[0];
  const named = new Set(dates);
  const wrong = [...new Set(retrievedDates)].filter((d) => d && !named.has(d));
  return wrong.length ? { claimed, wrong } : null;
}

export function headerFetchDateMismatches(refDir = REF_DIR, ledger = loadLedger(), sources = loadSources()) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out = [];
  for (const { name: f, path } of scanTargets(refDir)) {
    const cited = [...new Set(ledger.filter((c) => String(c.file).endsWith(`/${f}`)).map((c) => c.source))];
    const dates = cited
      .map((id) => byId.get(id))
      .filter((s) => s && s.type !== 'internal')
      .map((s) => s.retrieved);
    const bad = fetchDateMismatch(headerBlock(readFileSync(path, 'utf8')), dates);
    if (bad) out.push({ file: f, ...bad });
  }
  return out;
}

export function headerSourcingMismatches(refDir = REF_DIR, ledger = loadLedger()) {
  const out = [];
  for (const { name: f, path } of scanTargets(refDir)) {
    const recs = ledger.filter((c) => String(c.file).endsWith(`/${f}`));
    const bad = sourcingMismatch(headerBlock(readFileSync(path, 'utf8')), recs);
    if (bad) out.push({ file: f, ...bad });
  }
  return out;
}

/** How many reference files this gate actually read a claim from, for an honest PASS line. */
export function headerClaimCoverage(refDir = REF_DIR) {
  const files = scanTargets(refDir);
  const withClaim = files.filter((f) => headerQuoteClaim(readFileSync(f.path, 'utf8')));
  return { files: files.length, withClaim: withClaim.length };
}

function main(argv) {
  const mi = argv.indexOf('--mirror');
  const mirror = mi >= 0 ? argv[mi + 1] : DEFAULT_MIRROR;
  if (!existsSync(mirror)) {
    console.log(`quote-check: no docs mirror at ${mirror}`);
    console.log('CANNOT CHECK: the mirror is not committed (copyright), so this gate needs one locally.');
    return 2;
  }
  const pages = loadMirror(mirror);
  const quotes = collectQuotes();
  const unverifiable = collectUnverifiableQuotes();
  const missing = [];
  const byPage = new Map();
  for (const q of quotes) {
    const page = findQuote(q.quote, pages);
    if (!page) { missing.push(q); continue; }
    byPage.set(page, (byPage.get(page) || 0) + 1);
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ mirror, pages: pages.size, quotes: quotes.length, missing, unverifiable }, null, 2));
    return missing.length || unverifiable.length ? 1 : 0;
  }
  console.log(`quote-check: ${quotes.length} verbatim quote(s) from ${new Set(quotes.map((q) => q.file)).size} reference file(s)`);
  console.log(`             against ${pages.size} mirrored page(s) at ${mirror}`);
  console.log(`             plus ${unverifiable.length} quoted span(s) on COMMUNITY-only lines, which must be zero`);
  let bad = 0;
  if (missing.length) {
    console.log('\nNO LONGER FOUND UPSTREAM:');
    for (const m of missing) console.log(`  ${m.file}:${m.line}\n    "${m.quote.slice(0, 150)}"`);
    console.log(`\nFAIL ${missing.length} quote(s) missing. Each is a claim whose source sentence is gone:`);
    console.log('re-read the page, then either update the quote or record what replaced it.');
    bad += missing.length;
  }
  if (unverifiable.length) {
    console.log('\nVERBATIM QUOTE ON A COMMUNITY-ONLY LINE:');
    for (const u of unverifiable) console.log(`  ${u.file}:${u.line}\n    "${u.quote.slice(0, 150)}"`);
    console.log(`\nFAIL ${unverifiable.length} unverifiable quote(s). This project mirrors Anthropic's pages,`);
    console.log('not community sources, so nothing here can confirm these words were ever written.');
    console.log('Paraphrase and attribute instead, or promote the line to OFFICIAL with a real citation.');
    bad += unverifiable.length;
  }
  const stray = collectUncheckedResolvingQuotes(REF_DIR, pages);
  if (stray.length) {
    console.log('\nUPSTREAM PROSE QUOTED WHERE THIS GATE DOES NOT CHECK IT:');
    for (const s of stray) console.log(`  ${s.file}:${s.line}  resolves in ${s.page}\n    "${s.quote.slice(0, 150)}"`);
    console.log(`\nFAIL ${stray.length} span(s) quote Anthropic's words from a line carrying no documentation tag.`);
    console.log('The file header still reports every quote as confirmed, so the reader is told more');
    console.log('was checked than was. Tag the line if the claim is documented, or paraphrase.');
    bad += stray.length;
  }
  const fetchDates = headerFetchDateMismatches();
  if (fetchDates.length) {
    console.log('\nHEADER DATES A FETCH THAT THE SOURCE RECORDS CONTRADICT:');
    for (const d of fetchDates) {
      console.log(`  ${d.file}  header says ${d.claimed}, sources cited by this file were retrieved ${d.wrong.join(', ')}`);
    }
    console.log(`\nFAIL ${fetchDates.length} header(s) date a fetch sources.json disagrees with.`);
    console.log('Name the real dates. "Fetched live that day" is a claim about the provenance');
    console.log('record, and the record is right there.');
    bad += fetchDates.length;
  }
  const sourcing = headerSourcingMismatches();
  if (sourcing.length) {
    console.log('\nHEADER CLAIMS ONE SOURCE FOR EVERY CLAIM IN THE FILE, AND THE LEDGER DISAGREES:');
    for (const s of sourcing) {
      console.log(`  ${s.file}  ${s.records} record(s) across ${s.sources.length} sources: ${s.sources.join(', ')}`);
    }
    console.log(`\nFAIL ${sourcing.length} header(s) promise something the provenance record contradicts.`);
    console.log('State the split instead. A universal sourcing claim is only true when the file has');
    console.log('exactly one source, and this construction has now been found false three times.');
    bad += sourcing.length;
  }
  const headers = headerQuoteMismatches();
  if (headers.length) {
    console.log('\nHEADER MISDESCRIBES ITS OWN QUOTE COVERAGE:');
    for (const h of headers) {
      const said = h.reason === 'no claim'
        ? 'header states no quote count at all'
        : `header says ${h.word}${h.claimed === null ? ' (not a number)' : ` (${h.claimed})`}`;
      console.log(`  ${h.file}  ${said}, this gate finds ${h.actual}`);
    }
    console.log(`\nFAIL ${headers.length} header(s) tell the reader how much of the file this gate covers, and say it wrong.`);
    console.log('Fix the sentence, not the quote: the header is a claim about coverage, and a wrong one');
    console.log('understates or overstates what has actually been verified against the mirror.');
    bad += headers.length;
  }
  if (bad) return 1;
  const cov = headerClaimCoverage();
  console.log('\nPASS every verbatim quote still appears upstream, and no COMMUNITY-only line quotes.');
  console.log(`     ${cov.withClaim} of ${cov.files} scanned files state a quote count in their header, and each`);
  console.log('     matches what this gate found. The rest carry no quotes, which is the only case allowed');
  console.log('     to stay silent. The scanned set is the references directory plus the skill SKILL.md.');
  const partial = quotes.filter((q) => droppedFragments(q.quote).length);
  if (partial.length) {
    console.log(`\nPARTIAL COVERAGE on ${partial.length} abridged quote(s): a fragment shorter than`);
    console.log('12 characters was dropped, so only the longer half was verified. Reported here rather');
    console.log('than left silent, because a run claiming full coverage of a half-checked quote is the');
    console.log('failure mode this file exists to avoid.');
    for (const p of partial) console.log(`  ${p.file}:${p.line}  dropped ${JSON.stringify(droppedFragments(p.quote))}`);
  }
  console.log('\nNOTE this proves the sentence exists, NOT that its surrounding context still means the same thing.');
  return 0;
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const check = (n, ok, got) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `  (${got})`}`); if (!ok) fails++; };

  check('a long quote on a tagged line is extracted',
    quotesIn('- "Rules are evaluated in order: deny, then ask, then allow." [OFFICIAL]').length === 1);

  // The COMMUNITY split. Each row asserts the regime, not just that something was extracted.
  check('an OFFICIAL line resolves against the mirror',
    classifyLine('- a claim  [OFFICIAL]') === 'mirror', classifyLine('- a claim  [OFFICIAL]'));
  check('a COMMUNITY line does NOT resolve against the mirror',
    classifyLine('- a claim  [COMMUNITY]') === 'community', classifyLine('- a claim  [COMMUNITY]'));
  check('the [COMMUNITY PRACTICE] spelling is caught too, not just [COMMUNITY]',
    classifyLine('- a claim  [COMMUNITY PRACTICE]') === 'community', classifyLine('- a claim  [COMMUNITY PRACTICE]'));
  check('a line carrying BOTH tags still resolves against the mirror',
    classifyLine('- a claim  [OFFICIAL]  [COMMUNITY]') === 'mirror', classifyLine('- a claim  [OFFICIAL]  [COMMUNITY]'));
  check('an ENGINEERING line is in neither regime, which is why a retag changes coverage',
    classifyLine('- a claim  [ENGINEERING]') === 'none', classifyLine('- a claim  [ENGINEERING]'));
  check('a versioned line still resolves against the mirror',
    classifyLine('- a claim  [v2.1.203]') === 'mirror', classifyLine('- a claim  [v2.1.203]'));
  check('a quoted span on a COMMUNITY line IS extracted, so the refusal has something to refuse',
    quotesIn('- the practice is "run the guard before the dispatcher" here  [COMMUNITY]').length === 1);
  check('a SHORT quote is ignored, because short quotes are green by construction',
    quotesIn('- he said "deny" loudly [OFFICIAL]').length === 0);
  /**
   * This row USED to read "a backticked code span is not a quote" and passed BY
   * CONSTRUCTION: its input contained no double-quoted span at all, so quotesIn
   * returned [] whatever the code did. Independent review caught it.
   *
   * The replacement asserts what the code ACTUALLY does rather than inventing a
   * rule to make the old wording true. A quoted span of rule examples IS
   * extracted and IS checked, which is the conservative behaviour: if we present
   * it inside quotation marks then it should appear upstream, and if it does not,
   * that miss is a finding worth seeing. What matters is that the globs survive
   * normalisation intact, which is the property the emphasis guard above exists
   * to protect.
   */
  {
    const line = '- use "`Edit(docs/**)` and `Read(docs/**)`" here [OFFICIAL]';
    const got = quotesIn(line);
    check('a quoted span of rule examples IS extracted, and its globs survive intact',
      got.length === 1 && got[0] === 'Edit(docs/**) and Read(docs/**)', JSON.stringify(got));
  }
  check('a quoted JSON blob is ours, not upstream prose',
    quotesIn('- set "{ sandbox: enabled true, failIfUnavailable true }" [OFFICIAL]').length === 0,
    JSON.stringify(quotesIn('- set "{ sandbox: enabled true, failIfUnavailable true }" [OFFICIAL]')));
  check('...and a leading bracket is skipped for the same reason',
    quotesIn('- see "[a very long bracketed thing that is not prose]" [OFFICIAL]').length === 0);
  check('two quotes on one line are both extracted',
    quotesIn('- "the first long sentence here okay" and "the second long sentence here" [OFFICIAL]').length === 2);
  /**
   * THE GLOB HOLE, closed after independent review demonstrated it. Stripping
   * every asterisk made two different globs identical, so an upstream widening
   * was invisible. Emphasis PAIRS still collapse, because upstream bolds terms
   * inside sentences we quote plainly.
   */
  check('two DIFFERENT globs stay different, so an upstream widening is visible',
    normalise('Edit(infra/**)') !== normalise('Edit(infra/*)'));
  check('...and a widened Bash glob stays different too',
    normalise('Bash(rm *)') !== normalise('Bash(rm **)'));
  check('bold emphasis collapses, because upstream bolds terms we quote plainly',
    normalise('**Sandboxing** provides') === normalise('Sandboxing provides'));
  check('single-asterisk emphasis collapses', normalise('*x y z* here') === normalise('x y z here'));
  check('an identifier underscore SURVIVES, it is content not markup',
    normalise('CLAUDE_PLUGIN_ROOT') === 'CLAUDE_PLUGIN_ROOT');
  check('smart quotes normalise to straight ones',
    normalise('\u201cx\u2019y\u201d') === '"x\'y"');
  check('line wrapping collapses, or every wrapped quote is a false miss',
    normalise('a\n   b') === 'a b');

  const pages = new Map([['p.md', normalise('alpha beta "Rules are evaluated in order: deny, then ask, then allow." gamma')]]);
  check('a quote present in the mirror is found',
    findQuote('Rules are evaluated in order: deny, then ask, then allow.', pages) === 'p.md');

  /**
   * THE MUST-FAIL CASE. A gate that has only ever been seen passing is not
   * evidence. This one is fed a sentence that is not in the mirror and has to
   * report it missing.
   */
  check('MUST FAIL: a fabricated quote is reported missing, not found',
    findQuote('this sentence has never appeared in any Anthropic documentation page', pages) === null);
  check('...and a quote present in a DIFFERENT page is still found, so the search is not page-scoped by accident',
    findQuote('deny, then ask, then allow', new Map([['a.md', 'nothing'], ['b.md', normalise('deny, then ask, then allow')]])) === 'b.md');

  /**
   * A floor, not an equality. 39 was the observed count when this was written;
   * the floor sits below it so that legitimately dropping a quote does not redden
   * the gate, while the extractor silently returning nothing still does. An
   * equality here would break on every honest edit and get deleted within a week.
   */
  check('an abridged quote REPORTS the fragment it drops, rather than dropping it silently',
    droppedFragments('Use Bash(rm *) ... instead.').length === 1,
    JSON.stringify(droppedFragments('Use Bash(rm *) ... instead.')));
  check('...and a quote with no ellipsis drops nothing',
    droppedFragments('a plain sentence with no ellipsis in it at all').length === 0);
  const live = collectQuotes();
  check('the live reference set yields a non-trivial number of quotes (39 when written)',
    live.length >= 30, String(live.length));
  check('a span that starts with punctuation is rejected, because a sentence cannot',
    quotesIn('- see ". The handler runs only if the tool call matches, so it does" here [OFFICIAL]').length === 0);
  check('...and one starting with a shell variable is rejected too',
    quotesIn('- run "${CLAUDE_PLUGIN_ROOT}/scripts/poll-deploy.sh" now [OFFICIAL]').length === 0);
  /**
   * The exemption list is the way a gate quietly stops checking, so its SIZE is
   * itself asserted. If this ever needs to grow past a handful, the extractor is
   * wrong and the fix belongs there, not here.
   */
  check('every reference header that states a quote count states the RIGHT one',  // @header-row
    headerQuoteMismatches().length === 0, JSON.stringify(headerQuoteMismatches()));
  check('...and the header check can fail, given a count the gate contradicts',  // @header-row
    headerQuoteMismatches(REF_DIR, []).length > 0,
    `${headerQuoteMismatches(REF_DIR, []).length} file(s) claim a non-zero count`);
  /**
   * The first version of this check read ONE header dialect and exempted any file that claimed
   * nothing, so it covered 21 of 30 files and 9 of the 46 quotes while its PASS line said
   * "every header quote count matches". These rows pin the three properties that fixed it.
   */
  /**
   * REWRITTEN 2026-08-19. The previous version of this row planted a quote in themes.md, which
   * STATES a count, so it exercised the wrong-count branch under a label promising the no-claim
   * branch. An adversarial panel found that deleting the branch it named left every gate green.
   * sources.md states no count at all, which is the branch this row is for.
   */
  const planted = (f) => headerQuoteMismatches(REF_DIR, [{ file: f, line: 1, quote: 'x'.repeat(MIN_QUOTE) }]);
  check('a header claiming nothing is a FAILURE when the file carries quotes',  // @header-row
    planted('sources.md').some((h) => h.file === 'sources.md' && h.reason === 'no claim'),
    JSON.stringify(planted('sources.md').filter((h) => h.file === 'sources.md')));
  check('...and a file that states a count is caught on the count branch instead',  // @header-row
    planted('themes.md').some((h) => h.file === 'themes.md' && h.reason === 'wrong count'),
    JSON.stringify(planted('themes.md').filter((h) => h.file === 'themes.md')));
  /**
   * The fixture wraps the claim across the EIGHTH and NINTH lines, which is the shape that broke:
   * safety-classifier.md ends line 8 with "It carries NO" and starts line 9 with "verbatim quotes".
   * A shorter fixture passes under the old fixed window too, so it would not have caught it.
   */
  const WRAPPED_AT_8 = '# T\n\n> filler line 1 standing in for a long provenance header.\n> filler line 2 standing in for a long provenance header.\n> filler line 3 standing in for a long provenance header.\n> filler line 4 standing in for a long provenance header.\n> filler line 5 standing in for a long provenance header.\n> the sourcing note runs on and eventually says it carries NO\n> verbatim quotes, so the gate is silent.';
  check('a claim WRAPPED past the old fixed window is still read',  // @header-row
    headerQuoteClaim(WRAPPED_AT_8)?.claimed === 0,
    JSON.stringify(headerQuoteClaim(WRAPPED_AT_8)));
  /* No BLANK line between the blockquote and the body: a blank line is stopped by the separate
     blank-line rule, so a fixture containing one proves that rule instead of this one. */
  /* Body text, THEN a second blockquote. Without the boundary rule the two blockquotes join and
     the body's own quote count becomes the header's. A fixture whose forged claim sits in plain
     body text cannot detect the revert, because skipping that line is the same as stopping at it. */
  const FORGERY = '# T\n> a header with no count.\nBody text.\n> and it carries SIX verbatim quotes.';
  check('...and the blockquote stops at the first non-quoted line, so body prose cannot forge a claim',  // @header-row
    headerQuoteClaim(FORGERY) === null, JSON.stringify(headerQuoteClaim(FORGERY)));
  check('...and both header dialects parse, including the "all N verbatim quote" form',  // @header-row
    headerQuoteClaim('> all 1 verbatim quote in this file re-checked')?.claimed === 1
    && headerQuoteClaim('> this file carries SIX verbatim quotes')?.claimed === 6);
  check('...and a doubled space does not make a claim invisible, which it did in sessions.md',  // @header-row
    headerQuoteClaim('> It carries NO  verbatim quotes')?.claimed === 0);
  check('...and a number word the map does not know FAILS rather than being skipped',  // @header-row
    headerQuoteClaim('> this file carries FORTY-TWO verbatim quotes')?.claimed === null,
    JSON.stringify(headerQuoteClaim('> this file carries FORTY-TWO verbatim quotes')));
  check('no header dates a fetch the source records contradict',  // @header-row
    headerFetchDateMismatches().length === 0, JSON.stringify(headerFetchDateMismatches()));
  const FETCH_HEAD = 'Claude Code 2.1.229, verified 2026-08-13. Sources fetched live that day.';
  check('...and that decision fires when a cited source was retrieved on another day',  // @header-row
    fetchDateMismatch(FETCH_HEAD, ['2026-08-13', '2026-08-05']) !== null,
    JSON.stringify(fetchDateMismatch(FETCH_HEAD, ['2026-08-13', '2026-08-05'])));
  /* A header that NAMES a second date is honest about a second fetch, which is the whole point of
     comparing against every date in the header rather than only the first. */
  const TWO_DATES = 'verified 2026-08-13. Sources fetched that day, and the settings page 2026-08-05.';
  check('...and stays silent when every cited source date is named in the header',  // @header-row
    fetchDateMismatch(TWO_DATES, ['2026-08-13', '2026-08-05']) === null,
    JSON.stringify(fetchDateMismatch(TWO_DATES, ['2026-08-13', '2026-08-05'])));
  check('no header promises one source for every claim while the ledger says otherwise',  // @header-row
    headerSourcingMismatches().length === 0, JSON.stringify(headerSourcingMismatches()));
  /* Synthetic header AND synthetic ledger, so neither the corpus being clean nor the corpus being
     dirty can decide the outcome. */
  const UNIVERSAL_HEAD = 'Claude Code 2.1.229. What that means here: every claim below was checked against one page.';
  const TWO_SOURCES = [{ source: 'SRC_A' }, { source: 'SRC_B' }];
  check('...and that decision fires when such a header sits over records with two sources',  // @header-row
    sourcingMismatch(UNIVERSAL_HEAD, TWO_SOURCES) !== null,
    JSON.stringify(sourcingMismatch(UNIVERSAL_HEAD, TWO_SOURCES)));
  check('...and stays silent when every record shares one source',  // @header-row
    sourcingMismatch(UNIVERSAL_HEAD, [{ source: 'SRC_A' }, { source: 'SRC_A' }]) === null);
  check('...and stays silent for a header that makes no universal claim',  // @header-row
    sourcingMismatch('Claude Code 2.1.229. Sources fetched live that day.', TWO_SOURCES) === null);
  check('...and the phrasings it catches include all three quantifiers',  // @header-row
    ['every claim below', 'all claims below', 'each claim below']
      .every((p) => sourcingMismatch(`x ${p} was checked`, TWO_SOURCES) !== null));
  check('no upstream prose is quoted on a line this gate does not check',  // @header-row
    collectUncheckedResolvingQuotes(REF_DIR, loadMirror(DEFAULT_MIRROR)).length === 0,
    JSON.stringify(collectUncheckedResolvingQuotes(REF_DIR, loadMirror(DEFAULT_MIRROR)).map((s) => `${s.file}:${s.line}`)));
  check('...and that check ignores fenced code blocks, or every JSON example needs a tag',  // @header-row
    collectUncheckedResolvingQuotes(REF_DIR, new Map([['x.md', normalise('Destructive command blocked by hook')]])).length === 0);
  check('a header claim past the old 40-line cap is still read',  // @header-row
    headerQuoteClaim(`# T\n\n${Array.from({ length: 60 }, (_, i) => `> filler ${i}`).join('\n')}\n> and it carries NO verbatim quotes.`)?.claimed === 0);
  const CURLY = `- The docs say ${String.fromCharCode(0x201c)}a fabricated sentence nobody ever wrote${String.fromCharCode(0x201d)} here  [OFFICIAL]`;
  check('a span in TYPOGRAPHIC quotes is extracted, or a fabricated citation hides in plain sight',  // @header-row
    quotesIn(CURLY).length === 1, JSON.stringify(quotesIn(CURLY)));
  check('...and it yields the same span as its straight-quoted twin',  // @header-row
    quotesIn(CURLY)[0] === quotesIn('- The docs say "a fabricated sentence nobody ever wrote" here  [OFFICIAL]')[0]);
  check('a header carrying TWO DIFFERENT counts is refused rather than resolved to the first',  // @header-row
    headerQuoteClaim('> it carries SIX verbatim quotes, and elsewhere: carries TWO verbatim quotes')?.claimed === null,
    JSON.stringify(headerQuoteClaim('> it carries SIX verbatim quotes, and elsewhere: carries TWO verbatim quotes')));
  check('...and a header restating the SAME count twice is still read',  // @header-row
    headerQuoteClaim('> it carries SIX verbatim quotes, and again it carries SIX verbatim quotes')?.claimed === 6);
  check('the not-a-citation exemption list stays small', NOT_A_CITATION.size <= 5, String(NOT_A_CITATION.size));
  check('...and every exemption states a reason',
    [...NOT_A_CITATION.values()].every((r) => typeof r === 'string' && r.length > 30));
  check('...and every one is at least the minimum length',
    live.every((q) => q.quote.length >= MIN_QUOTE));

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

if (IS_MAIN) {
  const a = process.argv.slice(2);
  process.exit(a.includes('--self-test') ? selfTest() : main(a));
}
