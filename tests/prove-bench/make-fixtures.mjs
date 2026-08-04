#!/usr/bin/env node
/**
 * Deterministic fixture generation for prove-bench.
 *
 * EXPERIMENTAL DESIGN
 * -------------------
 * Every fixture answers the SAME requirement and carries a BYTE-IDENTICAL
 * conformance.json. Only the implementation differs. The spec is held constant
 * and the implementation is the single variable, which is what makes the
 * comparison interpretable.
 *
 * THE REQUIREMENT (shared by every fixture):
 *   Prevent any change to a file under infra/. Leave everything outside infra/
 *   untouched. The protection must still hold if the guard's own script is
 *   deleted or crashes.
 *
 * WHY THE REQUIREMENT HAS NO EXEMPTION CLAUSE
 * -------------------------------------------
 * An earlier draft added "unless the content carries an APPROVED-<4 digits>
 * token". That requirement is NOT SATISFIABLE, and finding out why is itself the
 * lesson:
 *   - A command hook alone fails the last clause: a missing or crashing command
 *     hook fails OPEN by documented design.
 *   - A permissions deny rule survives handler deletion, but the official
 *     permissions page states a broad deny rule "can't carry allowlist
 *     exceptions", so it cannot express the exemption.
 *   - Both together means deny wins, so approved changes get blocked too.
 * Dropping the exemption makes the requirement satisfiable by exactly one
 * mechanism, and that mechanism is the one the GitHub corpus says users never
 * reach for.
 *
 * THE CORRECT ANSWER is a permissions deny rule `Edit(infra/**)`, NOT a hook.
 * Two documented facts make it the only passing answer:
 *   1. It is harness-owned, so it still denies when the handler is gone.
 *   2. It must be written as Edit(...), because "Claude Code checks file
 *      permissions against Edit(path) and Read(path) rules only. If you write a
 *      path rule for Write ... Claude Code accepts the rule but never consults
 *      it." An Edit rule covers every file-editing tool including Write.
 *
 * `correct-guard` is the CONTROL: both tools under test must pass it. Without a
 * control the bench would be a check that cannot fail, which is the defect it
 * exists to expose.
 *
 * Run with --check to assert committed fixtures match the generator (drift gate).
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'fixtures');
const IS_MAIN = process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url);

const REQUIREMENT =
  'Prevent any change to a file under infra/. Leave everything outside infra/ untouched. ' +
  'The protection must still hold if the guard\'s own script is deleted or crashes.';

const CONFORMANCE = (name) => ({
  extension: name,
  mechanism: 'hook-or-permission-rule',
  requirement: REQUIREMENT,
  cases: [
    { id: 'C1', kind: 'enforce', event: 'PreToolUse',
      input: { tool_name: 'Write', tool_input: { file_path: 'infra/main.tf', content: 'resource "aws_s3_bucket" "x" {}' } },
      expect: { decision: 'deny' } },
    { id: 'C2', kind: 'near-miss', event: 'PreToolUse',
      input: { tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'export const x = 1;' } },
      expect: { decision: { not: 'deny' } } },
    { id: 'C3', kind: 'wiring', event: 'PreToolUse',
      input: { tool_name: 'Edit', tool_input: { file_path: 'infra/main.tf', content: 'resource "y" {}' } },
      expect: { decision: 'deny' } },
    { id: 'C4', kind: 'near-miss', event: 'PreToolUse',
      input: { tool_name: 'Write', tool_input: { file_path: 'infrastructure-notes.md', content: 'notes' } },
      expect: { decision: { not: 'deny' } } },
    { id: 'C5', kind: 'enforce', event: 'PreToolUse',
      input: { tool_name: 'Write', tool_input: { file_path: 'infra/nested/deep/x.tf', content: 'resource "z" {}' } },
      expect: { decision: 'deny' } },
    { id: 'C6', kind: 'fail-posture', event: 'PreToolUse', mutate: 'delete-handler',
      input: { tool_name: 'Write', tool_input: { file_path: 'infra/main.tf', content: 'resource "z" {}' } },
      expect: { decision: { not: 'allow' } } },
    { id: 'C7', kind: 'fail-posture', event: 'PreToolUse', mutate: 'crash-handler',
      input: { tool_name: 'Write', tool_input: { file_path: 'infra/main.tf', content: 'resource "z" {}' } },
      expect: { decision: { not: 'allow' } } },
  ],
});

const GUARD = `#!/usr/bin/env node
// Denies Write/Edit under infra/. ESM: the file is .mjs, so require is not in scope.
import { readFileSync } from 'node:fs';
const raw = readFileSync(0, 'utf8');
let ev; try { ev = JSON.parse(raw); } catch { process.exit(2); }
const p = ((ev.tool_input && ev.tool_input.file_path) || '').replace(/\\\\/g, '/');
if (/^infra\\//.test(p)) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'infra is protected' } }));
}
process.exit(0);
`;

const FIXTURES = [
  { name: 'correct-guard', control: true,
    defect: 'none. CONTROL: a permissions deny rule Edit(infra/**), which is harness-owned and survives handler deletion. Both tools must pass this.',
    citation: 'permissions page: "Use Edit(docs/**) in place of Write(docs/**)" and "An Edit rule covers all file-editing tools".',
    matcher: 'Write|Edit', handler: GUARD, deny: ['Edit(infra/**)'] },

  { name: 'hook-only-no-deny-rule',
    defect: 'A correct hook and nothing else. Passes every live case and fails the fail-posture cases, because a command hook fails OPEN when deleted or crashing.',
    citation: 'hooks.md: a non-zero exit "is indistinguishable from a crash" and does not block. This is the mechanism users reach for and the deny rule they never consider.',
    matcher: 'Write|Edit', handler: GUARD },

  { name: 'deny-rule-never-consulted',
    defect: 'Uses Write(infra/**) as the deny rule. Claude Code accepts it and NEVER consults it, so it protects nothing while looking correct.',
    citation: 'permissions page: "If you write a path rule for Write, NotebookEdit, Glob, or the legacy MultiEdit tool instead, Claude Code accepts the rule but never consults it." (v2.1.210+)',
    matcher: 'Write|Edit', handler: GUARD, deny: ['Write(infra/**)'], noHook: true },

  { name: 'allows-what-it-blocks',
    defect: 'The guard tests an unset variable, so it never fires and always allows.',
    citation: 'test-hook.sh:245-252 treats exit 0 and exit 2 alike, so it cannot see this.',
    matcher: 'Write|Edit',
    handler: GUARD.replace("if (/^infra\\//.test(p)) {", 'if (process.env.NEVER_SET === "1") {') },

  { name: 'matcher-wrong-tool',
    defect: 'Handler logic is correct but the matcher is scoped to Write only, so an Edit to infra/ never reaches it.',
    citation: 'hooks.md: "Matcher: exact string, list (A|B), or regex (unanchored)". test-hook.sh never reads hooks.json at all.',
    matcher: 'Write', handler: GUARD },

  { name: 'stdout-theatre',
    defect: 'Prints a convincing BLOCKED banner to stdout but exits 0 with no hookSpecificOutput, so nothing is blocked.',
    citation: 'hooks.md: "prefer exit 0 with a JSON decision". A banner is not a decision.',
    matcher: 'Write|Edit',
    handler: GUARD.replace(/console\.log\(JSON\.stringify\([^\n]*\n/, "console.log('BLOCKED: infra is protected. Denied.');\n") },

  { name: 'fails-open-on-crash',
    defect: 'Throws before reaching the guard; a non-zero exit is a non-blocking error, so it fails open.',
    citation: 'hooks.md: a non-zero exit is indistinguishable from a crash and does not block.',
    matcher: 'Write|Edit',
    handler: "#!/usr/bin/env node\nimport { readFileSync } from 'node:fs';\nreadFileSync(0, 'utf8');\nthrow new Error('boom');\n" },

  { name: 'handler-path-missing',
    defect: 'settings.json points at a handler file that does not exist. Command hooks fail OPEN.',
    citation: 'hooks.md: a missing handler fails open and blocks nothing while looking installed.',
    matcher: 'Write|Edit', handler: GUARD, omitHandlerFile: true },

  { name: 'jq-dependency',
    defect: 'Handler shells out to jq, absent on many Windows installs, so it exits non-zero and fails open.',
    citation: 'hooks.md:125: "jq is absent on many Windows installs, so the handler exits non-zero, fails open, and silently blocks nothing while looking installed."',
    matcher: 'Write|Edit',
    handler: "#!/usr/bin/env node\nimport { execFileSync } from 'node:child_process';\nimport { readFileSync } from 'node:fs';\nconst raw = readFileSync(0, 'utf8');\nconst p = execFileSync('jq', ['-r', '.tool_input.file_path'], { input: raw, encoding: 'utf8' }).trim();\nif (/^infra\\//.test(p)) process.exit(2);\nprocess.exit(0);\n" },

  { name: 'blocks-the-near-miss',
    defect: 'Matches the bare substring "infra", so infrastructure-notes.md is blocked too.',
    citation: 'A guard that blocks safe work gets disabled, so a false positive is weighted exactly like a miss.',
    matcher: 'Write|Edit',
    handler: GUARD.replace("/^infra\\//.test(p)", "p.includes('infra')") },

  { name: 'shallow-glob-misses-nested',
    defect: 'Deny rule uses Edit(infra/*), which does not span a directory separator, so nested paths are unprotected.',
    citation: 'permissions page glob semantics: * does not cross a separator; ** does.',
    matcher: 'Write|Edit', handler: GUARD, deny: ['Edit(infra/*)'], noHook: true },
];

function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const f of FIXTURES) {
    const dir = join(OUT, f.name);
    mkdirSync(dir, { recursive: true });
    const handlerName = 'guard.mjs';
    if (!f.omitHandlerFile) writeFileSync(join(dir, handlerName), f.handler);
    const settings = {};
    if (!f.noHook) {
      settings.hooks = { PreToolUse: [{ matcher: f.matcher, hooks: [{ type: 'command', command: `node "${handlerName}"` }] }] };
    }
    if (f.deny) settings.permissions = { deny: f.deny };
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
    writeFileSync(join(dir, 'conformance.json'), JSON.stringify(CONFORMANCE(f.name), null, 2) + '\n');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      name: f.name, control: !!f.control, requirement: REQUIREMENT,
      defect: f.defect, citation: f.citation,
      matcher: f.noHook ? null : f.matcher, deny: f.deny || null,
    }, null, 2) + '\n');
  }
  return FIXTURES.length;
}

/**
 * Hash the fixture tree with line endings NORMALISED.
 *
 * Hashing raw bytes was tried and is wrong here. Git rewrites LF to CRLF on
 * checkout under the default Windows config, so a byte hash makes --check pass
 * on Linux CI and fail on every fresh Windows clone. This repo has already paid
 * for that once (see the tier3-strip.mjs CRLF note). Normalising means the gate
 * asserts CONTENT drift, which is what it is for, and stays silent about a line
 * ending the checkout chose.
 */
function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { h.update('D:' + relative(OUT, p).replace(/\\/g, '/')); walk(p); }
      else {
        h.update('F:' + relative(OUT, p).replace(/\\/g, '/'));
        h.update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function main() {
  if (process.argv.includes('--check')) {
    if (!existsSync(OUT)) { console.error('fixtures missing; run without --check'); process.exit(1); }
    const before = treeHash(OUT);
    build();
    const after = treeHash(OUT);
    if (before !== after) { console.error(`FAIL fixtures drifted\n  on disk:   ${before}\n  generated: ${after}`); process.exit(1); }
    console.log(`PASS fixtures match generator (${FIXTURES.length} fixtures, sha256 ${after.slice(0, 16)})`);
    process.exit(0);
  }
  const n = build();
  console.log(`wrote ${n} fixtures to ${OUT}`);
  console.log(`  1 control (correct-guard), ${n - 1} deliberately defective`);
}

if (IS_MAIN) main();
export { FIXTURES, REQUIREMENT, CONFORMANCE };
