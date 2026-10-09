// Bundles the modules into ONE HTML file at publish time (dist/roadmap-planner.html)
// plus dist/preview.html, the same page wrapped in a full document for local testing.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const js = await build({
  entryPoints: ['src/ui/app.js'], bundle: true, format: 'iife', write: false,
  target: 'es2020', minify: false, legalComments: 'none',
});
const css = await readFile('src/ui/styles.css', 'utf8');
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = `<title>Roadmap Planner</title>\n<style>\n${css}</style>\n<script>\n${script}</script>\n`;

await mkdir('dist', { recursive: true });
await writeFile('dist/roadmap-planner.html', page);
await writeFile('dist/preview.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n${page}</body></html>\n`);
console.log(`dist/roadmap-planner.html ${page.length} bytes`);
