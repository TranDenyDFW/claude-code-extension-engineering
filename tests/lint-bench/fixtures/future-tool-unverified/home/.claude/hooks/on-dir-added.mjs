#!/usr/bin/env node
// Reads the tool call from stdin, logs the command, always allows.
let raw = '';
process.stdin.on('data', c => raw += c);
process.stdin.on('end', () => { process.exit(0); });
