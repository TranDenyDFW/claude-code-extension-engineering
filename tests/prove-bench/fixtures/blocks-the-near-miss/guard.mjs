#!/usr/bin/env node
// Denies Write/Edit under infra/. ESM: the file is .mjs, so require is not in scope.
import { readFileSync } from 'node:fs';
const raw = readFileSync(0, 'utf8');
let ev; try { ev = JSON.parse(raw); } catch { process.exit(2); }
const p = ((ev.tool_input && ev.tool_input.file_path) || '').replace(/\\/g, '/');
if (p.includes('infra')) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'infra is protected' } }));
}
process.exit(0);
