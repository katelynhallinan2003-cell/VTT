// Runs every browser test in this folder, one after another, and says which passed.
// Start the built app first:  npm run build  then  npx vite preview --port 4174 --strictPort --host 127.0.0.1
// Then:  node tests/e2e/all.mjs            (or name some: node tests/e2e/all.mjs batchA batchZ5)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skip = new Set(['all.mjs', 'lib.mjs', 'perf.mjs', 'screens.mjs', 'tokens.mjs']);
const asked = process.argv.slice(2).map((n) => (n.endsWith('.mjs') ? n : n + '.mjs'));
const files = asked.length ? asked : readdirSync(here).filter((f) => f.endsWith('.mjs') && !skip.has(f)).sort();
const env = { ...process.env, BASE: process.env.BASE || 'http://127.0.0.1:4174/' };
let bad = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(here, f)], { env, encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'));
  const total = out.match(/(\d+)\/(\d+) checks passed/);
  const problems = /console problems:\s*\n(?!\(none\))\S/.test(out);
  // the older tests print no total: they are judged on how they exit and on having no FAIL line
  const passes = out.split('\n').filter((l) => l.startsWith('PASS')).length;
  const ok = r.status === 0 && !fails.length && (!total || total[1] === total[2]) && !problems;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${f.padEnd(14)} ${total ? total[0] : r.status === null ? 'timed out' : `${passes} checks passed`}  ${((Date.now() - t0) / 1000).toFixed(0)}s${problems ? '  (console problems)' : ''}`);
  for (const l of fails) console.log('        ' + l.trim());
  if (!ok && !fails.length) console.log(out.split('\n').slice(-8).map((l) => '        ' + l).join('\n'));
}
console.log(bad ? `\n${bad} of ${files.length} test files have failures` : `\nall ${files.length} test files passed`);
process.exit(bad ? 1 : 0);
