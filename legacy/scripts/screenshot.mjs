// Renders dist/preview.html in Chromium and saves screenshots.
// Usage: node scripts/screenshot.mjs <outDir> [today=YYYY-MM-DD] [rowsFile] [extraFile]
// rowsFile: a saved Lightdash query result ({result:{rows}}) to render real data.
// extraFile: the background rows as {deals, tasks, features} (Lightdash rows each).
// Real-data screenshots must never be written inside the repo.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const out = process.argv[2] || 'shots';
const today = process.argv[3] || '2026-10-09';
const rowsFile = process.argv[4];
const extraFile = process.argv[5];
if (rowsFile && resolve(out).startsWith(resolve('.'))) throw new Error('Real-data screenshots must go outside the repo');
const rows = rowsFile ? JSON.parse(readFileSync(rowsFile, 'utf8')).result.rows : null;
const extra = extraFile ? JSON.parse(readFileSync(extraFile, 'utf8')) : null;
const url = `${pathToFileURL(resolve('dist/preview.html')).href}?today=${today}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];

async function shot(name, viewport, fn, scheme = 'light') {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, colorScheme: scheme });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  if (rows) await page.addInitScript((r) => { window.__RP_ROWS__ = r; }, rows);
  if (extra) await page.addInitScript((x) => { window.__RP_EXTRA__ = x; }, extra);
  await page.goto(url);
  if (fn) await fn(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}

const desk = { width: 1700, height: 1000 };
await shot('1-grid', desk);
await shot('2-drawer-month', desk, (p) => p.click('td.cell[data-period="2026-11"][data-skill="BE"]'));
await shot('3-drawer-pot', desk, (p) => p.click('td.cell.pot[data-period="2026-Q4-pot"][data-skill="FE"]'));
await shot('4-grid-dark', desk, null, 'dark');
await shot('5-mobile', { width: 390, height: 844 });
const qcell = (team, skill, q) => `td.cell[data-team="${team}"][data-skill="${skill}"][data-period="${q}"]`;
const [pushTeam, pushQ, pullTeam, pullQ] = rows
  ? ['Transport Planning', '2027-Q1', 'Order + Invoice', '2026-Q4']
  : ['Transport Planning', '2026-Q4', 'Trip Execution', '2026-Q4'];
const tall = { width: 1700, height: 1400 };
await shot('6-push-out', tall, (p) => p.click(qcell(pushTeam, 'BE', pushQ)));
await shot('7-pull-forward', tall, (p) => p.click(qcell(pullTeam, 'BE', pullQ)));
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('screenshots ok');
