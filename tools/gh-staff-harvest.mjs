#!/usr/bin/env node
/**
 * Re-harvest project-authored statements from anthropics/claude-code issues.
 *
 * WHY THIS EXISTS AGAIN
 * ---------------------
 * The first harvest wrote 240 MB into a harness session scratchpad, which was
 * deleted with the session. The analysis survived in prose; the data did not.
 * This writes to a durable in-repo location instead.
 *
 * WHAT IT RECOVERS
 * ----------------
 *   design-statements.json  staff comments stating design intent or prescribing
 *                           a mechanism. The only externally-authored, key-shaped
 *                           material this corpus contains.
 *   version-facts.json      staff comments stating a version-gated behaviour
 *                           change. Directly fills `version_caveat`, the field our
 *                           keys fill with "none" almost everywhere.
 *
 * METHOD, and why it is cheaper than last time
 * --------------------------------------------
 * The `commenter:` search returns FULL issue objects (title, body, labels, state),
 * so the 81,002-issue population harvest is not needed at all. Search for each
 * known staff handle, keep the issues that mention a mechanism, then fetch only
 * those comment threads.
 *
 * TWO GOTCHAS ALREADY PAID FOR, both in cli-toolkit
 * -------------------------------------------------
 *  1. `page=` is hard-capped at page 99 on list endpoints. Search caps at 10
 *     pages of 100, so it is not hit here, but never fan out by page number.
 *  2. GitHub's SECONDARY rate limit is INVISIBLE to `gh api rate_limit`: a 403
 *     "rate limit exceeded" arrives while core still reports 4999/5000. It fires
 *     on CONCURRENCY. Six workers with immediate retry produced 1,381 failures of
 *     1,579. Hence WORKERS = 2, a per-request delay, and backoff that recognises
 *     the secondary limit rather than retrying straight back into it.
 */
import { execFile } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'data', 'gh');
const CDIR = join(OUT, 'comments');

const WORKERS = 2;              // fixed; does NOT scale with the work list
const REQ_DELAY_MS = 350;
const SEARCH_DELAY_MS = 2200;   // search allows 30/min

// Discovered by snowballing comment associations in the first harvest.
export const STAFF = [
  'ashwin-ant', 'rboyce-ant', 'hackyon-anthropic', 'catherinewu', 'dicksontsai',
  'sarahdeaton', 'igorkofman', 'dhollman', 'jarrah-anthropic', 'bcherny',
  'blois', 'morganl-ant', 'localden', 'wolffiex', 'ant-kurt',
];

export const BOT = /\[bot\]$|^github-actions/i;
export const PROJECT_ASSOC = new Set(['MEMBER', 'OWNER', 'COLLABORATOR']);
export const STAFF_NAME = /-ant$|anthropic/i;

/**
 * CONTRIBUTOR alone is NOT staff: it only means "had a pull request merged", and
 * community members carry it. But several staff carry it INSTEAD of MEMBER
 * because org membership is private. Neither including nor excluding the value
 * outright is correct, so it is only trusted alongside a known handle or a
 * staff-shaped name.
 */
export function isStaff(c, known) {
  const a = c.author || '';
  if (BOT.test(a)) return false;
  if (PROJECT_ASSOC.has(c.association)) return true;
  if (c.association === 'CONTRIBUTOR' && (STAFF_NAME.test(a) || known.has(a))) return true;
  return false;
}

export const MECH = /\b(hooks?|PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|SessionEnd|skills?|SKILL\.md|sub-?agents?|slash commands?|CLAUDE\.md|AGENTS\.md|MCP|plugins?|marketplace|settings\.json|permissions?|output styles?|status-?line|sandbox)\b/i;

/**
 * VERSION_FACT is unambiguous: a version number attached to a shipped change.
 * It is tested FIRST, because many version announcements also contain phrases
 * like "instead of", which a looser design test would swallow.
 */
export const VERSION_FACT = /\b(fixed|shipped|added|released|landed|available|supported|now honou?rs?|now preserves) in \*{0,2}v?\d+\.\d+\.\d+/i;

/**
 * DESIGN is deliberately NARROW.
 *
 * A first version accepted "instead of", "there is no", "we recommend" on their
 * own. Reading the output showed precision near 1 in 6: it swallowed triage
 * boilerplate ("we'll need more detail", "closed in favor of #69317"), a
 * debugging narrative, and version announcements. Counting those as design
 * statements would repeat the exact error the first harvest made when it
 * reported 201 "architectural" comments that were mostly release notes.
 *
 * A design statement asserts how the product IS SUPPOSED TO BEHAVE, or declines
 * to change it. That needs an explicit marker, not merely a comparative phrase.
 */
export const DESIGN = /\b(intended behavio\w*|by design|working as intended|expected behavio\w*|not planned|won'?t fix|we (generally )?want|you should use|we recommend(?! reading)|the recommended (way|approach)|your options (are|for)|there(?: i|')s no (?:such |way |option|setting|支持)?\w*(?: setting| option| field| flag| way)|deprecated in favou?r of|is not supported|use the .{0,40} instead)\b/i;

/** Triage and support boilerplate that carries no product statement at all. */
export const TRIAGE = /\b(need(?:s)? more (?:detail|information)|can you (?:share|provide|confirm)|please (?:provide|share|comment|open|file)|closing (?:this )?(?:for now|in favou?r of|as)|closed in favou?r of|duplicate of|triaging|thank you for (?:your report|reporting|taking the time)|we'?ll (?:take a look|investigate|look into)|marking as|reopening)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isSecondary = (e) => /rate limit exceeded|secondary rate limit|abuse detection|\b403\b/i.test(e || '');

function gh(args) {
  return new Promise((res) => {
    execFile('gh', args, { maxBuffer: 96 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? res({ error: (stderr || err.message || '').split('\n').slice(0, 2).join(' ') }) : res({ stdout }));
  });
}

async function ghRetry(args, label) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await gh(args);
    if (!r.error) return r;
    if (!isSecondary(r.error)) return r;
    const wait = 20000 * 2 ** attempt;
    process.stderr.write(`  secondary limit on ${label}, backing off ${wait / 1000}s\n`);
    await sleep(wait);
  }
  return { error: 'exhausted backoff' };
}

async function issuesCommentedBy(handle) {
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    const q = `repo:anthropics/claude-code is:issue commenter:${handle}`;
    const r = await ghRetry(['api', `search/issues?q=${encodeURIComponent(q)}&per_page=100&page=${page}`], `search ${handle}`);
    if (r.error) { console.error(`  search ${handle} p${page}: ${r.error}`); break; }
    let j; try { j = JSON.parse(r.stdout); } catch { break; }
    if (!j.items || !j.items.length) break;
    for (const it of j.items) {
      if (it.pull_request) continue;
      rows.push({
        number: it.number, title: it.title || '', body: it.body || '', url: it.html_url,
        state: it.state, state_reason: it.state_reason,
        labels: (it.labels || []).map((l) => l.name || l),
      });
    }
    if (j.items.length < 100) break;
    await sleep(SEARCH_DELAY_MS);
  }
  return rows;
}

async function fetchThread(meta) {
  const f = join(CDIR, `${meta.number}.json`);
  if (existsSync(f)) return 'skip';
  const r = await ghRetry(['api', '--paginate', `repos/anthropics/claude-code/issues/${meta.number}/comments`], `#${meta.number}`);
  if (r.error) return `fail:${r.error.slice(0, 100)}`;
  let rows;
  try { rows = JSON.parse(r.stdout.replace(/\]\s*\[/g, ',')); } catch { return 'fail:bad json'; }
  writeFileSync(f, JSON.stringify({
    ...meta,
    comments: rows.map((c) => ({
      author: c.user && c.user.login, association: c.author_association,
      created_at: c.created_at, reactions: c.reactions ? c.reactions.total_count : 0,
      body: c.body || '',
    })),
  }, null, 1));
  return 'ok';
}

async function pool(items, fn) {
  let i = 0; let ok = 0; const failures = [];
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (i < items.length) {
      const it = items[i++];
      const r = await fetchThread(it);
      if (r === 'ok') { ok++; if (ok % 100 === 0) process.stderr.write(`  ${ok}/${items.length}\n`); }
      else if (String(r).startsWith('fail')) failures.push({ n: it.number, r });
      await sleep(REQ_DELAY_MS);
    }
  }));
  return { ok, failures };
}

export function extract(dir, known) {
  const design = []; const versions = [];
  let files = 0; let comments = 0; let bots = 0; let staffComments = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    files++;
    for (const c of t.comments || []) {
      comments++;
      if (BOT.test(c.author || '')) { bots++; continue; }
      if (!isStaff(c, known)) continue;
      staffComments++;
      const body = (c.body || '').trim();
      if (!MECH.test(body)) continue;
      const rec = {
        number: t.number, url: t.url, title: t.title, state: t.state, state_reason: t.state_reason,
        author: c.author, association: c.association, created_at: c.created_at, body,
      };
      // Version first: it is the unambiguous class, and many version notes also
      // contain phrasing a design test would otherwise claim.
      if (VERSION_FACT.test(body)) { versions.push(rec); continue; }
      // A design marker inside pure triage boilerplate is not a design statement.
      if (DESIGN.test(body) && !(TRIAGE.test(body) && body.length < 400)) design.push(rec);
    }
  }
  return { design, versions, stats: { files, comments, bots, staffComments } };
}

async function main() {
  if (process.argv.includes('--extract-only')) {
    const known = new Set(STAFF);
    const { design, versions, stats } = extract(CDIR, known);
    writeFileSync(join(OUT, 'design-statements.json'), JSON.stringify(design, null, 1));
    writeFileSync(join(OUT, 'version-facts.json'), JSON.stringify(versions, null, 1));
    console.log(`threads read      : ${stats.files}`);
    console.log(`comments          : ${stats.comments}  (bots ${stats.bots})`);
    console.log(`project-authored  : ${stats.staffComments}`);
    console.log(`design statements : ${design.length}  -> data/gh/design-statements.json`);
    console.log(`version facts     : ${versions.length}  -> data/gh/version-facts.json`);
    console.log('STATUS: PASS');
    return;
  }

  mkdirSync(CDIR, { recursive: true });
  if (!existsSync(join(OUT, '.gitignore'))) writeFileSync(join(OUT, '.gitignore'), 'comments/\n');

  console.log(`searching ${STAFF.length} staff handles (search allows 30/min, spacing ${SEARCH_DELAY_MS}ms)`);
  const byNumber = new Map();
  for (const h of STAFF) {
    const rows = await issuesCommentedBy(h);
    for (const r of rows) if (!byNumber.has(r.number)) byNumber.set(r.number, r);
    console.log(`  ${h.padEnd(20)} ${String(rows.length).padStart(4)}   (union ${byNumber.size})`);
    await sleep(SEARCH_DELAY_MS);
  }

  const all = [...byNumber.values()];
  const mech = all.filter((r) => MECH.test(`${r.title}\n${r.body}`));
  const todo = mech.filter((r) => !existsSync(join(CDIR, `${r.number}.json`)));
  console.log(`\nstaff-touched issues     : ${all.length}`);
  console.log(`  ...mention a mechanism : ${mech.length}`);
  console.log(`  ...not already on disk : ${todo.length}`);
  console.log(`estimated wall time      : ~${Math.ceil(todo.length * (REQ_DELAY_MS + 550) / WORKERS / 60000)} min at ${WORKERS} workers\n`);

  const { ok, failures } = await pool(todo, fetchThread);
  console.log(`\nfetched : ${ok}`);
  console.log(`failed  : ${failures.length}`);
  for (const f of failures.slice(0, 10)) console.log(`  #${f.n}: ${f.r}`);

  const known = new Set(STAFF);
  const { design, versions, stats } = extract(CDIR, known);
  writeFileSync(join(OUT, 'design-statements.json'), JSON.stringify(design, null, 1));
  writeFileSync(join(OUT, 'version-facts.json'), JSON.stringify(versions, null, 1));
  writeFileSync(join(OUT, 'harvest-stats.json'), JSON.stringify({
    staff_handles: STAFF.length, staff_touched_issues: all.length, mechanism_mentioning: mech.length,
    threads_on_disk: stats.files, comments: stats.comments, bot_comments: stats.bots,
    project_authored: stats.staffComments, design_statements: design.length, version_facts: versions.length,
    fetch_failures: failures.length,
  }, null, 1));

  console.log(`\nthreads read      : ${stats.files}`);
  console.log(`comments          : ${stats.comments}  (bots ${stats.bots})`);
  console.log(`project-authored  : ${stats.staffComments}`);
  console.log(`design statements : ${design.length}`);
  console.log(`version facts     : ${versions.length}`);
  console.log(failures.length === 0 ? 'STATUS: PASS' : `STATUS: PARTIAL (${failures.length} gaps)`);
}

if (IS_MAIN) main();
