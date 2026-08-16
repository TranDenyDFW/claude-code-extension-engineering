#!/usr/bin/env node
/**
 * RE-KEY the claims ledger after reference lines move.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT "REGENERATE"
 * ----------------------------------------------
 * A claim id encodes the line it sits on: `CLM-<stem>-<line>`. That is a deliberate
 * design, because it makes an edited or moved claim a DETECTED DRIFT rather than a
 * silent change. It also means inserting four lines near the top of a reference file
 * renumbers every claim below it, and `verify-evidence` reports the whole tail as broken.
 * Adding six disambiguation sections produced 266 such errors at once.
 *
 * The wrong repair is `extract-claims.mjs > claims.jsonl`. Extraction knows the tagged
 * lines; it does NOT know which SOURCE each was attributed to, or the hand-written note
 * explaining why that source and not a near neighbour. Regenerating would silently
 * discard 502 attributions and leave a file that passes the id check while asserting
 * nothing, which is the precise failure `verify-evidence`'s own header warns about.
 *
 * So this pairs by TEXT, never by id. A claim whose text is still present somewhere in
 * the same file keeps its source, status and note, and only its line and id move. Text
 * that has vanished is REPORTED, never dropped, because a vanished claim is either a
 * deliberate deletion or an accidental one and the tool cannot tell which.
 *
 *   node tools/rekey-claims.mjs             report what would change, write nothing
 *   node tools/rekey-claims.mjs --write     apply
 *   node tools/rekey-claims.mjs --self-test
 *
 * exit: 0 clean, 1 something needs a human (vanished claims, or new tagged lines with
 * no attribution), 2 cannot run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const claimId = (file, line) => `CLM-${basename(file, '.md')}-${String(line).padStart(3, '0')}`;

/**
 * Pair old records against current tagged lines by exact text, within the same file.
 *
 * Duplicate text inside one file is possible, so pairing consumes matches in order:
 * the first unclaimed occurrence wins. Ordering both sides by line keeps that stable
 * and stops two identical bullets swapping attributions on every run.
 */
export function rekey(oldClaims, taggedLines) {
  const byFile = new Map();
  for (const t of taggedLines) {
    if (!byFile.has(t.file)) byFile.set(t.file, []);
    byFile.get(t.file).push({ ...t, taken: false });
  }
  for (const arr of byFile.values()) arr.sort((a, b) => a.line - b.line);

  const moved = []; const unchanged = []; const vanished = [];
  for (const c of [...oldClaims].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))) {
    const pool = byFile.get(c.file) || [];
    const hit = pool.find((t) => !t.taken && t.text === c.text);
    if (!hit) { vanished.push(c); continue; }
    hit.taken = true;
    const next = { ...c, line: hit.line, id: claimId(c.file, hit.line) };
    (next.id === c.id && next.line === c.line ? unchanged : moved).push(next);
  }
  const orphans = [];
  for (const arr of byFile.values()) for (const t of arr) if (!t.taken) orphans.push(t);
  return { moved, unchanged, vanished, orphans };
}

if (process.argv.includes('--self-test')) {
  let fails = 0; let ran = 0;
  const ok = (n, c, d) => { ran++; if (!c) fails++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d || ''})`}`); };
  const F = 'refs/a.md';
  const C = (line, text, source = 'S1') => ({ id: claimId(F, line), file: F, line, text, source, status: 'attributed', note: 'n' });
  const T = (line, text) => ({ file: F, line, text });

  let r = rekey([C(12, 'alpha'), C(20, 'beta')], [T(16, 'alpha'), T(24, 'beta')]);
  ok('a claim whose text moved keeps its source and note', r.moved.length === 2 && r.moved[0].source === 'S1' && r.moved[0].note === 'n');
  ok('and its id follows the new line', r.moved[0].id === claimId(F, 16));
  ok('nothing is reported vanished when every text is still present', r.vanished.length === 0 && r.orphans.length === 0);

  r = rekey([C(12, 'alpha')], [T(12, 'alpha')]);
  ok('an unmoved claim is reported unchanged, not rewritten', r.unchanged.length === 1 && r.moved.length === 0);

  r = rekey([C(12, 'alpha'), C(20, 'gone')], [T(16, 'alpha')]);
  ok('MUST REPORT a claim whose text no longer exists rather than dropping it', r.vanished.length === 1 && r.vanished[0].text === 'gone');

  r = rekey([C(12, 'alpha')], [T(12, 'alpha'), T(30, 'brand new tagged line')]);
  ok('MUST REPORT a new tagged line that has no attribution', r.orphans.length === 1 && r.orphans[0].line === 30);

  r = rekey([C(12, 'dup'), C(40, 'dup')], [T(16, 'dup'), T(44, 'dup')]);
  ok('duplicate text inside one file pairs in line order rather than colliding',
    r.moved.length === 2 && r.moved[0].line === 16 && r.moved[1].line === 44);

  r = rekey([{ ...C(12, 'alpha'), file: 'refs/b.md' }], [T(12, 'alpha')]);
  ok('MUST NOT pair identical text across DIFFERENT files', r.vanished.length === 1 && r.orphans.length === 1);
  console.log(`\n${fails ? `SELF-TEST FAIL: ${fails}` : 'SELF-TEST PASS'} (${ran} checks)`);
  process.exit(fails ? 1 : 0);
}

if (IS_MAIN) {
  const claimsPath = resolve(ROOT, 'evidence/claims.jsonl');
  if (!existsSync(claimsPath)) { console.error(`CANNOT RUN: no ledger at ${claimsPath}`); process.exit(2); }
  const oldClaims = readFileSync(claimsPath, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

  const { extractClaims } = await import('./extract-claims.mjs').catch(() => ({}));
  let tagged;
  if (typeof extractClaims === 'function') tagged = extractClaims();
  else {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(process.execPath, [resolve(HERE, 'extract-claims.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26 });
    tagged = out.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  }

  const r = rekey(oldClaims, tagged);
  console.log(`ledger ${oldClaims.length} claims, references now carry ${tagged.length} tagged lines`);
  console.log(`  unchanged ${r.unchanged.length}`);
  console.log(`  moved     ${r.moved.length}   (line and id updated, source and note preserved)`);
  console.log(`  vanished  ${r.vanished.length}   (text no longer in the file; NOT written, decide by hand)`);
  console.log(`  new       ${r.orphans.length}   (tagged line with no attribution; add by hand)`);
  for (const v of r.vanished) console.log(`    VANISHED ${v.id}  ${v.text.slice(0, 90)}`);
  for (const o of r.orphans) console.log(`    NEW      ${claimId(o.file, o.line)}  ${o.text.slice(0, 90)}`);

  if (process.argv.includes('--write')) {
    /* Vanished claims are deliberately NOT carried forward and NOT deleted silently:
       they are absent from the written file and printed above, so the diff shows the
       loss and a human decides. Orphans are absent because attribution is not a thing
       a script may invent. */
    const next = [...r.unchanged, ...r.moved].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
    /* REFUSE rather than write a ledger that is missing claims.
     *
     * The line below writes `unchanged + moved`, so anything vanished is silently absent from the
     * file. The exit code that reports it comes AFTER the write, which means the destruction
     * happened before the warning: by the time a human reads "vanished 563" the attributions are
     * already gone from disk.
     *
     * Pairing is by exact `c.file` string. Move the references into four directories and EVERY
     * claim reports vanished, every tagged line reports new, and this writes an empty file over 563
     * hand-made attributions. That is not a hypothetical: it is the highest-severity risk named in
     * the plan for the split this guard was added during, and the tool's own comment already says a
     * vanished claim is "either a deletion or a rename" and that "a script may not decide which".
     * A tool that may not decide must also not act. */
    if (r.vanished.length) {
      console.error(`\nREFUSING TO WRITE: ${r.vanished.length} claim(s) would be dropped from the ledger.`);
      console.error('Pairing is by exact file path, so a MOVED file looks identical to a DELETED one.');
      console.error('If these files moved, re-path the ledger first (see tools/split-claims.mjs);');
      console.error('if they were really deleted, remove those claims by hand and re-run.');
      for (const c of r.vanished.slice(0, 8)) console.error(`  ${c.id}  ${c.file}`);
      if (r.vanished.length > 8) console.error(`  ... and ${r.vanished.length - 8} more`);
      process.exit(1);
    }
    writeFileSync(claimsPath, next.map((c) => JSON.stringify(c)).join('\n') + '\n');
    console.log(`\nwrote ${claimsPath}: ${next.length} claims`);
  } else {
    console.log('\ndry run. Re-run with --write to apply.');
  }
  process.exit(r.vanished.length || r.orphans.length ? 1 : 0);
}
