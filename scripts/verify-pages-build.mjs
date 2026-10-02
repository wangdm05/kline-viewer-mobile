import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const output = resolve(process.argv[2] || 'dist');
const base = process.argv[3] || '/';
assert.match(base, /^\/.*\/$|^\/$/, 'The deployment base must start and end with /');
const home = new URL(base, 'https://pages.invalid');
const manifestUrl = new URL('manifest.webmanifest', home);

function localFile(url) {
  assert.equal(url.origin, home.origin, `External dependency: ${url.href}`);
  assert.ok(url.pathname.startsWith(base), `URL leaves the application path: ${url.pathname}`);
  const file = resolve(output, decodeURIComponent(url.pathname.slice(base.length)));
  assert.ok(file.startsWith(`${output}${sep}`), `File leaves build directory: ${file}`);
  assert.ok(existsSync(file), `Missing deployed file: ${url.pathname}`);
  return file;
}

const html = readFileSync(resolve(output, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  localFile(new URL(match[1], home));
}

const manifest = JSON.parse(readFileSync(localFile(manifestUrl), 'utf8'));
for (const key of ['id', 'start_url', 'scope']) {
  assert.equal(new URL(manifest[key], manifestUrl).href, home.href, `Incorrect PWA ${key}`);
}
for (const icon of manifest.icons) localFile(new URL(icon.src, manifestUrl));
localFile(new URL('sw.js', home));

const index = JSON.parse(readFileSync(resolve(output, 'data/oi-full/index.json'), 'utf8'));
assert.ok(index.months.length > 0, 'No built-in months');
const names = new Set();
let total = 0;
for (const month of index.months) {
  assert.ok(!names.has(month.file), `Duplicate month file: ${month.file}`);
  names.add(month.file);
  const url = new URL(`data/oi-full/${encodeURIComponent(month.file)}`, home);
  const lines = readFileSync(localFile(url), 'utf8').trimEnd().split(/\r?\n/);
  assert.equal(lines.length - 1, month.rows, `Incomplete monthly data: ${month.file}`);
  total += month.rows;
}
assert.equal(total, index.rows, 'Total historical row count is inconsistent');
assert.ok(index.daily.length > 0, 'Missing daily candles');
console.log(`Verified ${base}: PWA paths, ${index.months.length} months, ${total} rows.`);
