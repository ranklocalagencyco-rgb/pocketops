#!/usr/bin/env node
/** Exports the remote D1 database to backups/pocketops-YYYY-MM-DD.sql via wrangler. */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const date = new Date().toISOString().slice(0, 10);
mkdirSync('backups', { recursive: true });
const out = `backups/pocketops-${date}.sql`;

const res = spawnSync(
  'npx',
  ['wrangler', 'd1', 'export', 'pocketops-db-eu', '--remote', '--output', out],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (res.status === 0) console.log(`Backup written to ${out}`);
process.exit(res.status ?? 1);
