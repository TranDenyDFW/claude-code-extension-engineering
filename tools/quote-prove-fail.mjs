/**
 * End-to-end must-fail for the new COMMUNITY-quote rule.
 *
 * The self-test proves classifyLine and quotesIn behave; it does NOT prove that `npm run quotes`
 * returns non-zero. So: append one offending line to a real reference file, run the gate as its own
 * process, then restore the file to the exact bytes it held and verify that with git.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = `${ROOT}/skills/claude-code-extension-engineering/references/skills.md`;
const OFFENDER = '- Community practice holds that you should "always run the guard before the dispatcher fires"  [COMMUNITY]\n';

const original = readFileSync(TARGET);          // Buffer, so CRLF is preserved byte for byte
const gate = () => spawnSync('node', ['tools/quote-check.mjs'], { cwd: ROOT, encoding: 'utf8' });

const before = gate();
console.log(`  baseline gate exit: ${before.status}  (must be 0, or the experiment proves nothing)`);
if (before.status !== 0) { console.error('  ABORT: gate was already red'); process.exit(1); }

let restored = false;
try {
  writeFileSync(TARGET, Buffer.concat([original, Buffer.from(OFFENDER, 'utf8')]));
  const after = gate();
  const said = /VERBATIM QUOTE ON A COMMUNITY-ONLY LINE/.test(after.stdout);
  console.log(`  with one offending line, gate exit: ${after.status}  (must be 1)`);
  console.log(`  and it names the rule: ${said}`);
  writeFileSync(TARGET, original);
  restored = true;

  const diff = execFileSync('git', ['diff', '--stat', '--', TARGET], { cwd: ROOT, encoding: 'utf8' }).trim();
  console.log(`  file restored byte for byte, git diff: ${diff === '' ? 'EMPTY' : diff}`);

  const final = gate();
  console.log(`  gate exit after restore: ${final.status}  (must be 0)`);

  const ok = after.status === 1 && said && diff === '' && final.status === 0;
  console.log(`\n  ${ok ? 'GATE CAN FAIL' : 'FAIL'}  the COMMUNITY-quote rule is enforced end to end.`);
  process.exit(ok ? 0 : 1);
} finally {
  if (!restored) { writeFileSync(TARGET, original); console.error('  restored after an error'); }
}
