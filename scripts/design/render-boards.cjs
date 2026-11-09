// Render launch boards (docs/design/launch/*.dc.html) to PNGs so a builder or verifier can put a picture beside its board.
// Usage: node scripts/design/render-boards.cjs <outDir> [Board-390 ...] [--port 16590] [--dark]
// support.js is the Design canvas runtime (copied from the canvas artifact, 9 Nov 2026); boards load the design system
// from docs/design/ds/voices. Fonts come from Google Fonts; nothing else leaves the machine.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '../../docs/design');
const args = process.argv.slice(2); const out = args.shift();
let port = 16590; const pi = args.indexOf('--port'); if (pi >= 0) { port = Number(args[pi + 1]); args.splice(pi, 2); }
const dark = args.includes('--dark'); const names = args.filter(a => a !== '--dark');
const boards = names.length ? names : fs.readdirSync(path.join(root, 'launch')).filter(f => f.endsWith('.dc.html')).map(f => f.replace('.dc.html', ''));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
}).listen(port, '127.0.0.1', async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1600, height: 1200 }, colorScheme: dark ? 'dark' : 'light' });
  for (const n of boards) {
    await pg.goto(`http://127.0.0.1:${port}/launch/${n}.dc.html`, { waitUntil: 'networkidle' });
    if (dark) await pg.evaluate(() => document.querySelectorAll('[data-theme]').forEach(e => e.setAttribute('data-theme', 'dark')));
    await pg.waitForTimeout(800);
    const f = path.join(out, `${n}${dark ? '-dark' : ''}.png`); await pg.screenshot({ path: f, fullPage: true }); console.log('board', f);
  }
  await b.close(); srv.close();
});
