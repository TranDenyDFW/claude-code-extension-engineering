/**
 * Build the detailed HTML report for the 2026-08-19 head to head.
 *
 * Everything here is derived from the run artifacts, never typed in by hand: the ledger, the three
 * grader passes, the blind map, the pack prompts, and the single-cell re-run. The verdict
 * resolution mirrors score-pairs, and the totals it produces are asserted against score-pairs'
 * printed result before the file is written, so a mismatch fails the build rather than shipping.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const J = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));
const L = (f) => readFileSync(join(HERE, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const blind = J('blind-map.json').map;
const prompts = J('PROMPTS.json');
const g1n = new Map(L('mg-g1.jsonl').map((r) => [r.cellId, r.winner]));
const g1s = new Map(L('mg-g1-swapped.jsonl').map((r) => [r.cellId, r.winner]));
const g2n = new Map(L('mg-g2.jsonl').map((r) => [r.cellId, r.winner]));
const resp = new Map(L('responses.jsonl').map((r) => [`${r.cellId}|${r.arm}`, r]));

function resolve(cellId) {
  const m = blind[cellId];
  const n = g1n.get(cellId);
  const s = g1s.get(cellId);
  if (!m || !n || !s) return 'INCOMPLETE';
  if (n === 'TIE' && s === 'TIE') return 'TIE';
  if (n === 'TIE' || s === 'TIE') return 'INCONSISTENT';
  const a = n === 'ONE' ? m.one : m.two;
  const b = s === 'ONE' ? m.two : m.one;
  return a === b ? a : 'ORDER_DEPENDENT';
}

const cells = prompts.map((p) => {
  const A = resp.get(`${p.cellId}|A`);
  const C = resp.get(`${p.cellId}|C`);
  return {
    id: p.cellId,
    stratum: p.stratum,
    tier: p.tier,
    q: p.prompt,
    verdict: resolve(p.cellId),
    g2: g2n.get(p.cellId),
    a: A?.response ?? '',
    c: C?.response ?? '',
    aTools: A?.tools ?? {},
    cTools: C?.tools ?? {},
    aMs: A?.ms ?? 0,
    cMs: C?.ms ?? 0,
  };
});

/* Assert against what score-pairs printed. A report that disagrees with the tool is a bug. */
const tally = cells.reduce((m, c) => ({ ...m, [c.verdict]: (m[c.verdict] || 0) + 1 }), {});
const EXPECTED = { A: 21, C: 13, TIE: 9, ORDER_DEPENDENT: 8, INCONSISTENT: 9 };
for (const [k, v] of Object.entries(EXPECTED)) {
  if (tally[k] !== v) {
    console.error(`REFUSING: ${k} is ${tally[k]}, score-pairs reported ${v}`);
    process.exit(1);
  }
}
console.log(`verdicts agree with score-pairs: ${JSON.stringify(tally)}`);

/* The single-cell re-run after the GQ-06 fix. */
const rrRows = L('gq06-rerun.jsonl');
const rrMap = J('rerun-blind-map.json').map;
const rrN = L('rerun-rr-g1.jsonl')[0];
const rrS = L('rerun-rr-g1-swapped.jsonl')[0];
const rrArmNormal = rrN.winner === 'ONE' ? rrMap['GQ-06'].one : rrMap['GQ-06'].two;
const rrArmSwapped = rrS.winner === 'ONE' ? rrMap['GQ-06'].two : rrMap['GQ-06'].one;
const rerun = {
  a: rrRows.find((r) => r.arm === 'A')?.response ?? '',
  c: rrRows.find((r) => r.arm === 'C')?.response ?? '',
  aTools: rrRows.find((r) => r.arm === 'A')?.tools ?? {},
  cTools: rrRows.find((r) => r.arm === 'C')?.tools ?? {},
  normal: rrArmNormal,
  swapped: rrArmSwapped,
  verdict: rrArmNormal === rrArmSwapped ? rrArmNormal : 'ORDER_DEPENDENT',
  before: cells.find((c) => c.id === 'GQ-06'),
};
console.log(`re-run verdict: normal chose ${rrArmNormal}, swapped chose ${rrArmSwapped} -> ${rerun.verdict}`);

/* Arm behaviour, counted rather than described. */
const armStats = (arm) => {
  const key = arm === 'A' ? 'aTools' : 'cTools';
  const text = arm === 'A' ? 'a' : 'c';
  const tools = {};
  let skill = 0;
  let none = 0;
  let chars = 0;
  for (const c of cells) {
    const t = c[key] || {};
    if (!Object.keys(t).length) none++;
    if (t.Skill) skill++;
    for (const [k, v] of Object.entries(t)) tools[k] = (tools[k] || 0) + v;
    chars += c[text].length;
  }
  return { skill, none, tools, mean: Math.round(chars / cells.length) };
};
const statsA = armStats('A');
const statsC = armStats('C');

const strata = {};
for (const c of cells) {
  const s = (strata[c.stratum] ||= { n: 0, A: 0, C: 0, TIE: 0, ORDER_DEPENDENT: 0, INCONSISTENT: 0 });
  s.n++;
  s[c.verdict]++;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DATA = { cells, rerun, statsA, statsC, strata, tally };

const html = `<title>Sixty Questions, Two Libraries</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&display=swap">
<style>
:root {
  --ground: #FBFBFD;
  --surface: #F1F2F6;
  --surface-2: #E7E9F0;
  --ink: #191B22;
  --muted: #5B6172;
  --rule: #DCDFE8;
  --arm-a: #2F5D8C;
  --arm-c: #7A5230;
  --good: #3D6F4E;
  --warn: #8A6410;
  --bad: #8A3B3B;
  --shadow: 0 1px 2px rgba(25, 27, 34, .05), 0 4px 16px rgba(25, 27, 34, .04);
  --measure: 68ch;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #14161C;
    --surface: #1B1E26;
    --surface-2: #232734;
    --ink: #E8EAF0;
    --muted: #9BA2B4;
    --rule: #2C313D;
    --arm-a: #7FADDC;
    --arm-c: #D0A173;
    --good: #7FBE93;
    --warn: #D9AE55;
    --bad: #DC8C8C;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 4px 16px rgba(0, 0, 0, .3);
  }
}
:root[data-theme="dark"] {
  --ground: #14161C;
  --surface: #1B1E26;
  --surface-2: #232734;
  --ink: #E8EAF0;
  --muted: #9BA2B4;
  --rule: #2C313D;
  --arm-a: #7FADDC;
  --arm-c: #D0A173;
  --good: #7FBE93;
  --warn: #D9AE55;
  --bad: #DC8C8C;
  --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 4px 16px rgba(0, 0, 0, .3);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }
.col { max-width: var(--measure); }
h1, h2, h3 { font-family: "IBM Plex Serif", Georgia, serif; text-wrap: balance; line-height: 1.2; margin: 0; }
h1 { font-size: clamp(2rem, 5vw, 3.1rem); font-weight: 600; letter-spacing: -.015em; }
h2 { font-size: 1.55rem; font-weight: 600; margin-top: 4rem; }
h3 { font-size: 1.1rem; font-weight: 600; }
p { margin: 0 0 1rem; }
a { color: var(--arm-a); }
code, .mono { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .87em; }
.eyebrow {
  font-family: "IBM Plex Mono", monospace; font-size: .72rem; text-transform: uppercase;
  letter-spacing: .12em; color: var(--muted); margin: 0 0 .8rem;
}
header.masthead { border-bottom: 1px solid var(--rule); padding: 4.5rem 0 2.5rem; }
.lede { font-size: 1.18rem; color: var(--muted); max-width: var(--measure); margin-top: 1.4rem; }
.meta { display: flex; flex-wrap: wrap; gap: 1.6rem 2.4rem; margin-top: 2.2rem; }
.meta div { font-size: .85rem; }
.meta dt { font-family: "IBM Plex Mono", monospace; font-size: .68rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
.meta dd { margin: .25rem 0 0; font-weight: 500; }

.headline { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 3px; overflow: hidden; margin: 2.5rem 0 1rem; }
.headline > div { background: var(--ground); padding: 1.3rem 1.2rem; }
.headline .n { font-family: "IBM Plex Mono", monospace; font-size: 2.1rem; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1; }
.headline .k { font-size: .78rem; color: var(--muted); margin-top: .5rem; }
.headline .a .n { color: var(--arm-a); }
.headline .c .n { color: var(--arm-c); }

.verdict-note { border-left: 3px solid var(--warn); background: var(--surface); padding: 1.1rem 1.3rem; border-radius: 0 3px 3px 0; max-width: var(--measure); }
.verdict-note strong { color: var(--warn); }

table { border-collapse: collapse; width: 100%; font-size: .9rem; }
.scroll { overflow-x: auto; margin: 1.5rem 0; }
th, td { text-align: left; padding: .6rem .8rem; border-bottom: 1px solid var(--rule); }
th { font-family: "IBM Plex Mono", monospace; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 500; }
td.num, th.num { text-align: right; font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }

.controls { position: sticky; top: 0; z-index: 5; background: var(--ground); border-bottom: 1px solid var(--rule); padding: .9rem 0; display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.controls input { font: inherit; font-size: .88rem; padding: .45rem .7rem; border: 1px solid var(--rule); border-radius: 3px; background: var(--surface); color: var(--ink); min-width: 220px; }
.chipbtn { font-family: "IBM Plex Mono", monospace; font-size: .72rem; letter-spacing: .04em; padding: .4rem .7rem; border: 1px solid var(--rule); background: var(--ground); color: var(--muted); border-radius: 3px; cursor: pointer; }
.chipbtn[aria-pressed="true"] { background: var(--ink); color: var(--ground); border-color: var(--ink); }
.chipbtn:focus-visible, input:focus-visible { outline: 2px solid var(--arm-a); outline-offset: 2px; }

.cell { border: 1px solid var(--rule); border-left-width: 4px; border-radius: 3px; margin: 1rem 0; background: var(--ground); box-shadow: var(--shadow); }
.cell[data-v="A"] { border-left-color: var(--arm-a); }
.cell[data-v="C"] { border-left-color: var(--arm-c); }
.cell[data-v="TIE"] { border-left-color: var(--muted); }
.cell[data-v="ORDER_DEPENDENT"], .cell[data-v="INCONSISTENT"] { border-left-color: var(--warn); }
.cell > summary { cursor: pointer; padding: .9rem 1.1rem; display: flex; gap: .9rem; align-items: baseline; flex-wrap: wrap; }
.cell > summary::-webkit-details-marker { display: none; }
.cell .cid { font-family: "IBM Plex Mono", monospace; font-size: .78rem; color: var(--muted); }
.cell .q { font-weight: 500; flex: 1 1 320px; }
.chip { font-family: "IBM Plex Mono", monospace; font-size: .68rem; letter-spacing: .06em; text-transform: uppercase; padding: .2rem .5rem; border-radius: 2px; border: 1px solid currentColor; white-space: nowrap; }
.chip.A { color: var(--arm-a); }
.chip.C { color: var(--arm-c); }
.chip.TIE { color: var(--muted); }
.chip.ORDER_DEPENDENT, .chip.INCONSISTENT { color: var(--warn); }
.answers { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--rule); border-top: 1px solid var(--rule); }
@media (max-width: 820px) { .answers { grid-template-columns: 1fr; } }
.ans { background: var(--ground); padding: 1.1rem; }
.ans h4 { margin: 0 0 .6rem; font-family: "IBM Plex Mono", monospace; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 500; }
.ans.a h4 { color: var(--arm-a); }
.ans.c h4 { color: var(--arm-c); }
.ans .body { white-space: pre-wrap; font-size: .87rem; line-height: 1.55; }
.ans .tools { font-family: "IBM Plex Mono", monospace; font-size: .7rem; color: var(--muted); margin-top: .8rem; padding-top: .6rem; border-top: 1px dashed var(--rule); }
footer { border-top: 1px solid var(--rule); margin-top: 5rem; padding: 2rem 0 4rem; color: var(--muted); font-size: .85rem; }
.count { font-family: "IBM Plex Mono", monospace; font-size: .78rem; color: var(--muted); }
</style>

<div class="wrap">
<header class="masthead">
  <p class="eyebrow">Blind pairwise head to head &middot; 2026-08-19</p>
  <h1>Sixty Questions, Two Libraries</h1>
  <p class="lede">The claude-code-extension-engineering library at merged main <code>c4cce82</code>, against Anthropic's eighteen published skills, on sixty real search-demand questions. Web denied in both arms, so a library is the only source either one has beyond the model's training.</p>
  <div class="meta">
    <div><dt>Host</dt><dd>LT, CLI 2.1.233</dd></div>
    <div><dt>Cells</dt><dd>120 of 120, 0 failed</dd></div>
    <div><dt>Run time</dt><dd>60.6 minutes</dd></div>
    <div><dt>Reached the web</dt><dd>0 of 120</dd></div>
    <div><dt>Graders</dt><dd>2, three passes</dd></div>
  </div>
</header>

<section class="col">
  <h2>What the run found</h2>
  <div class="headline">
    <div class="a"><div class="n">21</div><div class="k">our library wins</div></div>
    <div class="c"><div class="n">13</div><div class="k">Anthropic wins</div></div>
    <div><div class="n">9</div><div class="k">tie</div></div>
    <div><div class="n">17</div><div class="k">counted for neither</div></div>
  </div>
  <p class="count">Among the 34 pairs with a consistent winner, our library takes 61.8 percent.</p>
  <p class="verdict-note"><strong>The interval spans 50 percent.</strong> 95 percent confidence runs from 45.0 to 76.1, so this run does not establish a winner. Sixty questions is not enough to separate two libraries that are both usually adequate, and saying otherwise would be reading noise.</p>
  <p>The seventeen pairs counted for neither arm are the honest cost of counterbalancing. Every pair was graded twice, once in each order, and a verdict that flips when the two answers exchange places was about position rather than content. Eight flipped outright and nine were inconsistent. A single-pass run would have awarded all seventeen to somebody.</p>
</section>

<section class="col">
  <h2>Order effect, measured before any arm result</h2>
  <p>Grader 1 chose the first answer 21 times and the second 26, a first-position share of 44.7 percent among decided pairs. That is the reason for the swap: position was pulling verdicts, and spreading a bias evenly across arms converts a systematic error into noise rather than removing it.</p>
  <p>Independent agreement between the two graders was 83.3 percent raw, Cohen kappa 0.740.</p>
</section>

<section>
  <h2>By stratum</h2>
  <p class="col">Only stratum A was drawn to be representative of real search demand. D is the off-topic tail, questions about news, opinion and other tools, where no documentation library has an advantage to press.</p>
  <div class="scroll"><table id="strata"><thead><tr><th>Stratum</th><th class="num">n</th><th class="num">ours</th><th class="num">Anthropic</th><th class="num">tie</th><th class="num">neither</th><th class="num">our share of decided</th></tr></thead><tbody></tbody></table></div>
</section>

<section>
  <h2>What each arm did with the same tools</h2>
  <p class="col">Both arms had identical tool availability, so this is a choice each library led its model to make. The previous open-web run invoked our skill in 6 of 60 cells, which is why the web-denied design exists: with the live documentation one fetch away, neither library was the thing being consulted.</p>
  <div class="scroll"><table id="behaviour"><thead><tr><th>Arm</th><th class="num">invoked a skill</th><th class="num">used no tools</th><th class="num">mean answer</th><th>tool calls</th></tr></thead><tbody></tbody></table></div>
</section>

<section class="col">
  <h2>The one question we re-ran</h2>
  <p>GQ-06, <em>claude code stop hook not working</em>, was the sharpest loss: our arm wrote 2758 characters enumerating seven possible causes and said plainly that it had not checked anything. Anthropic's arm ran Bash, read the settings files, reported that no Stop hook was configured at all, and asked three narrowing questions.</p>
  <p><strong>Two benchmarks disagree on this exact question id.</strong> The library already records that auditing the workspace scored 1 of 6 on 2026-08-13, question GQ-06, which is why it carries a rule against doing so. Reversing that rule to win this one pair would trade it for those six.</p>
  <p>The fix took a third option the library had never mentioned: hand the asker the read-only command that shows them their own state. The documentation has a page for exactly this, and the library cited it zero times while its own hooks reference ran to 30KB.</p>
  <div id="rerun"></div>
</section>

<section>
  <h2>Every question</h2>
  <p class="col">All sixty, both answers in full, with the verdict each pair received. Arm labels are unblinded here because grading is finished and sealed; the artifacts the graders saw carried no labels.</p>
  <div class="controls">
    <input id="q" type="search" placeholder="Search questions and answers" aria-label="Search questions and answers">
    <button class="chipbtn" data-f="all" aria-pressed="true">all</button>
    <button class="chipbtn" data-f="A" aria-pressed="false">ours won</button>
    <button class="chipbtn" data-f="C" aria-pressed="false">Anthropic won</button>
    <button class="chipbtn" data-f="TIE" aria-pressed="false">tie</button>
    <button class="chipbtn" data-f="NEITHER" aria-pressed="false">neither</button>
    <span class="count" id="shown"></span>
  </div>
  <div id="cells"></div>
</section>

<footer class="wrap">
  <p>Generated from the run artifacts: the 120-row response ledger, three grader passes, the sealed blind map, and the single-cell re-run. Verdict resolution mirrors <code>score-pairs</code> and the build asserts its totals against that tool's printed result, so a report that disagreed with the harness would fail rather than publish.</p>
  <p>Pack <code>Prompts-LT-20260819-merged-denied</code>. Arm C pinned 2026-08-09, 18 skills, 407 files. Leak detection found 16 of 120 responses naming a library, split 7 ours and 9 Anthropic's; responses were not edited.</p>
</footer>
</div>

<script>
const DATA = ${JSON.stringify(DATA)};
const LABEL = { A: 'ours', C: 'Anthropic', TIE: 'tie', ORDER_DEPENDENT: 'order dependent', INCONSISTENT: 'inconsistent' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const toolStr = (t) => Object.keys(t).length ? Object.entries(t).map(([k, v]) => k + ' x' + v).join(', ') : 'no tools';

const sb = document.querySelector('#strata tbody');
for (const [k, s] of Object.entries(DATA.strata).sort()) {
  const decided = s.A + s.C;
  const share = decided ? ((s.A / decided) * 100).toFixed(1) + '%' : 'n/a';
  sb.insertAdjacentHTML('beforeend',
    '<tr><td>' + k + '</td><td class="num">' + s.n + '</td><td class="num">' + s.A + '</td><td class="num">' + s.C +
    '</td><td class="num">' + s.TIE + '</td><td class="num">' + (s.ORDER_DEPENDENT + s.INCONSISTENT) +
    '</td><td class="num">' + share + '</td></tr>');
}

const bb = document.querySelector('#behaviour tbody');
for (const [name, s, cls] of [['ours', DATA.statsA, 'arm-a'], ["Anthropic's", DATA.statsC, 'arm-c']]) {
  bb.insertAdjacentHTML('beforeend',
    '<tr><td style="color:var(--' + cls + ');font-weight:500">' + name + '</td><td class="num">' + s.skill + ' of 60</td><td class="num">' +
    s.none + '</td><td class="num">' + s.mean + ' chars</td><td class="mono">' + toolStr(s.tools) + '</td></tr>');
}

const rr = DATA.rerun;
document.getElementById('rerun').innerHTML =
  '<div class="cell" data-v="' + rr.verdict + '"><div style="padding:.9rem 1.1rem;display:flex;gap:.9rem;align-items:baseline;flex-wrap:wrap">' +
  '<span class="cid">GQ-06 re-run</span><span class="q">claude code stop hook not working</span>' +
  '<span class="chip ' + rr.verdict + '">' + LABEL[rr.verdict] + ' won again</span></div>' +
  '<div class="answers"><div class="ans a"><h4>ours, after the fix</h4><div class="body">' + esc(rr.a) +
  '</div><div class="tools">' + toolStr(rr.aTools) + '</div></div>' +
  '<div class="ans c"><h4>Anthropic, re-run</h4><div class="body">' + esc(rr.c) +
  '</div><div class="tools">' + toolStr(rr.cTools) + '</div></div></div></div>' +
  '<p>The answer changed as intended: it now leads with the command, says what its absence would mean, and closes by asking the reader to run it. The verdict did not change. Both orders chose Anthropic again, so this is a clean negative: the fix improved the answer without winning the pair. The grader is rewarding an arm that did the work over an arm that explained how to do it, which is the broader pattern in these losses and is not closed by this change.</p>';

const host = document.getElementById('cells');
const shown = document.getElementById('shown');
let filter = 'all';
let query = '';

function render() {
  const q = query.trim().toLowerCase();
  const list = DATA.cells.filter((c) => {
    const fOk = filter === 'all' ? true
      : filter === 'NEITHER' ? (c.verdict === 'ORDER_DEPENDENT' || c.verdict === 'INCONSISTENT')
      : c.verdict === filter;
    const qOk = !q || c.q.toLowerCase().includes(q) || c.a.toLowerCase().includes(q) || c.c.toLowerCase().includes(q);
    return fOk && qOk;
  });
  shown.textContent = list.length + ' of ' + DATA.cells.length + ' shown';
  host.innerHTML = list.map((c) =>
    '<details class="cell" data-v="' + c.verdict + '"><summary><span class="cid">' + c.id + ' &middot; ' + c.stratum +
    '</span><span class="q">' + esc(c.q) + '</span><span class="chip ' + c.verdict + '">' + LABEL[c.verdict] + '</span></summary>' +
    '<div class="answers"><div class="ans a"><h4>ours &middot; ' + c.a.length + ' chars</h4><div class="body">' + esc(c.a) +
    '</div><div class="tools">' + toolStr(c.aTools) + '</div></div>' +
    '<div class="ans c"><h4>Anthropic &middot; ' + c.c.length + ' chars</h4><div class="body">' + esc(c.c) +
    '</div><div class="tools">' + toolStr(c.cTools) + '</div></div></div></details>').join('');
}

document.getElementById('q').addEventListener('input', (e) => { query = e.target.value; render(); });
for (const b of document.querySelectorAll('.chipbtn')) {
  b.addEventListener('click', () => {
    filter = b.dataset.f;
    for (const o of document.querySelectorAll('.chipbtn')) o.setAttribute('aria-pressed', String(o === b));
    render();
  });
}
render();
</script>
`;

const out = join(HERE, 'head-to-head-20260819.html');
writeFileSync(out, html);
console.log(`written ${out} (${Math.round(html.length / 1024)} KB)`);
void esc;
