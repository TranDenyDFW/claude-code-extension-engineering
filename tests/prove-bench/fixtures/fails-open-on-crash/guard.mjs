#!/usr/bin/env node
import { readFileSync } from 'node:fs';
readFileSync(0, 'utf8');
throw new Error('boom');
