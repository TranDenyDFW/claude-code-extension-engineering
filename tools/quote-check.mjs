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
import { skillDirs, referenceDirs } from './skill-roots.mjs';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REF_DIRS = referenceDirs(ROOT);
const REF_DIR = REF_DIRS[0];
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

export function quotesIn(line) {
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

const TAGGED = /\[(OFFICIAL|ANTHROPIC|COMMUNITY|EXPERIMENTAL|LEGACY|DEPRECATED)\]|\[v\d+\.\d+\.\d+\]/;

/* EVERY skill's references. A quote gate that scans a quarter of the corpus and reports every
   quote verified is the same shape as a coverage number that never looked at its population. */
export function collectQuotes(refDir = null) {
  const dirs = refDir ? [refDir] : REF_DIRS;
  const out = [];
  const entries = dirs.flatMap((d) => readdirSync(d).filter((x) => x.endsWith('.md')).map((f) => ({ f, d })));
  for (const { f, d } of entries) {
    const lines = readFileSync(join(d, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!TAGGED.test(line)) return;
      for (const q of quotesIn(line)) {
        if (NOT_A_CITATION.has(q)) continue;
        out.push({ file: f, line: i + 1, quote: q });
      }
    });
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
  const missing = [];
  const byPage = new Map();
  for (const q of quotes) {
    const page = findQuote(q.quote, pages);
    if (!page) { missing.push(q); continue; }
    byPage.set(page, (byPage.get(page) || 0) + 1);
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ mirror, pages: pages.size, quotes: quotes.length, missing }, null, 2));
    return missing.length ? 1 : 0;
  }
  console.log(`quote-check: ${quotes.length} verbatim quote(s) from ${new Set(quotes.map((q) => q.file)).size} reference file(s)`);
  console.log(`             against ${pages.size} mirrored page(s) at ${mirror}`);
  if (missing.length) {
    console.log('\nNO LONGER FOUND UPSTREAM:');
    for (const m of missing) console.log(`  ${m.file}:${m.line}\n    "${m.quote.slice(0, 150)}"`);
    console.log(`\nFAIL ${missing.length} quote(s) missing. Each is a claim whose source sentence is gone:`);
    console.log('re-read the page, then either update the quote or record what replaced it.');
    return 1;
  }
  console.log('\nPASS every verbatim quote still appears upstream.');
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
