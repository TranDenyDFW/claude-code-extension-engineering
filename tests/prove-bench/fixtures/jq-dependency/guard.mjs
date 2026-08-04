#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const raw = readFileSync(0, 'utf8');
const p = execFileSync('jq', ['-r', '.tool_input.file_path'], { input: raw, encoding: 'utf8' }).trim();
if (/^infra\//.test(p)) process.exit(2);
process.exit(0);
