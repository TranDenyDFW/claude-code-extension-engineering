/**
 * ONE DELIBERATELY BROKEN BUNDLE PER VALIDATION FAMILY.
 *
 * The gate injections corrupt the GENERATOR. These corrupt the SHIPPED HANDLER,
 * which is the other half: a bundle whose spec passes against a handler that does
 * not do what the spec says would be the worst possible outcome for this tool.
 * Each row names the case that MUST go red, so "something failed" is not accepted
 * as evidence.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as pack from '../tools/packs/validate-before-action.mjs';
import { proveBundle } from '../tools/extension-prove.mjs';

const HANDLER = '.claude/hooks/validate.mjs';
const ROOT = 'tmp/broken';
rmSync(ROOT, { recursive: true, force: true });

const BREAKS = [
  {
    family: 'dangerous-operation (widened)', probe: 'V1', expectRed: 'no-rm-rf-near-miss-1',
    // The flag check stops firing, so the rule matches MORE than it should and a
    // safe `rm build` is blocked. Caught by the near-miss arm, which is the arm
    // that exists for exactly this and is the one people leave out.
    break: (s) => s.replace('if (cm.anyFlag && !cm.anyFlag.some((f) => flagPresent(f, args))) return false;', 'if (false) return false;'),
  },
  {
    family: 'dangerous-operation (narrowed)', probe: 'V1', expectRed: 'no-rm-rf-blocks-1',
    // The opposite defect: the rule stops matching anything, so the guard is
    // installed and inert. Caught by the enforce arm.
    break: (s) => s.replace('if (exec !== cm.exec) return false;', 'if (true) return false;'),
  },
  {
    family: 'command-validation', probe: 'V3', expectRed: 'approved-npm-near-miss-1',
    // The default decision is ignored, so an unapproved command walks through an
    // allowlist. On a deny-by-default policy that is what the near-miss arm sees.
    break: (s) => s.replace(/return \{ decision: policy\.defaultDecision[\s\S]*?\};/, "return { decision: 'allow', ruleId: null, reason: 'x' };"),
  },
  {
    family: 'required-check', probe: 'V4', expectRed: 'tests-must-pass-blocks-when-unmet',
    // Every check reports success without being run: the exact shape of a gate
    // that cannot fail.
    break: (s) => s.replace('const argv = (p.command || []).slice(1).concat(extraArgs || []);', "return { id: p.id, ok: true, why: 'ok' };\n  const argv = (p.command || []).slice(1).concat(extraArgs || []);"),
  },
  {
    family: 'schema-validation', probe: 'V5', expectRed: 'manifest-must-be-valid-blocks-invalid-document',
    // The document is read and then not validated.
    break: (s) => s.replace('if (doc === null || typeof doc !== \'object\' || Array.isArray(doc)) return [\'the document is not a JSON object\'];', 'return [];'),
  },
  {
    family: 'deployment-gate', probe: 'V6', expectRed: 'prod-gates-blocks-when-unmet',
    // Only the first gate is consulted, so a red second gate is invisible.
    break: (s) => s.replace('const failed = programs.map((p) => runProgram(p, cwd)).filter((r) => !r.ok);', 'const failed = [programs[0]].map((p) => runProgram(p, cwd)).filter((r) => !r.ok);'),
  },
];

let bad = 0;
for (const b of BREAKS) {
  const probe = pack.GATE_PROBES.find((p) => p.id === b.probe);
  const a = pack.analyse({ policy: probe.policy });
  const { files } = pack.buildBundle(`broken-${b.family}`, { policy: probe.policy }, a);
  const dir = join(ROOT, b.family.replace(/[^a-z0-9]+/gi, "-"));
  const broken = b.break(files[HANDLER]);
  if (broken === files[HANDLER]) { console.log(`FAIL ${b.family}: the break did not change the handler, so it proves nothing`); bad++; continue; }
  for (const [rel, content] of Object.entries({ ...files, [HANDLER]: broken })) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  const res = proveBundle(dir);
  const red = res.cases.filter((c) => !c.ok).map((c) => c.id);
  const ok = red.includes(b.expectRed);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${b.family.padEnd(20)} ${b.expectRed} ${ok ? 'went RED as required' : `stayed green; red instead: ${red.join(', ') || 'nothing'}`}`);
}
console.log(bad ? `\n${bad} family bundle(s) did not detect their own defect` : '\nevery family: the broken handler was caught by the named case');
process.exit(bad ? 1 : 0);
