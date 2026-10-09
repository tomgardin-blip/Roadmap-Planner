// Renders dist/preview.html in Chromium and saves screenshots.
// Usage: node scripts/screenshot.mjs <outDir> [today=YYYY-MM-DD]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const out = process.argv[2] || 'shots';
const today = process.argv[3] || '2026-10-09';
const url = `${pathToFileURL(resolve('dist/preview.html')).href}?today=${today}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];

async function shot(name, viewport, fn, scheme = 'light') {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, colorScheme: scheme });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(url);
  if (fn) await fn(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}

const desk = { width: 1600, height: 1000 };
await shot('1-grid', desk);
await shot('2-drawer-over', desk, (p) => p.click('td.cell.red[data-period$="-12"]'));
await shot('3-drawer-quarter', desk, (p) => p.click('td.cell.qt[data-period$="-Q1"]'));
await shot('4-grid-dark', desk, null, 'dark');
await shot('5-mobile', { width: 390, height: 844 });
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('screenshots ok');
