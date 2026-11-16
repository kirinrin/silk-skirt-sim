// usage: node shot.cjs out.png "js to eval before shot" [w h]
const { chromium } = require('playwright');
(async () => {
  const [out, js, w = 1280, h = 800] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 600)); });
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await p.goto('http://localhost:5173/');
  await p.waitForFunction(() => window.__app, null, { timeout: 60000 });
  await p.evaluate(() => { window.__app.P.paused = true; });
  if (js) { const r = await p.evaluate(js); if (r !== undefined) console.log('result:', JSON.stringify(r)); }
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.screenshot({ path: out });
  await b.close();
})();
