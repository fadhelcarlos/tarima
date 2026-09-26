// Screenshot harness: node scripts/shot.mjs <name> [--device=ipad|iphone|iphone-portrait|desktop] [--engine=chromium|webkit] [--view=play] [--wait=ms] [--js="..."]
import { chromium, webkit, devices } from 'playwright';
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const name = process.argv[2] || 'shot';
const presets = {
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'ipad-portrait': { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'iphone-portrait': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const engine = args.engine === 'webkit' ? webkit : chromium;
const launchArgs = engine === chromium ? { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] } : {};
const browser = await engine.launch({ headless: true, ...launchArgs });
const ctx = await browser.newContext({ ...presets[args.device || 'ipad'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const url = args.url || 'http://localhost:5173/';
await page.goto(url);
await page.waitForSelector('#start:not([hidden])', { timeout: 120000 });
if (args.loader) await page.screenshot({ path: `.cache/shots/${name}-loader.png` });
if (!args.noenter) {
  await page.click('#start');
}
if (args.view) await page.evaluate((v) => window.app.rig.setView(v, true), args.view);
await page.waitForTimeout(Number(args.wait || 1800));
if (args.js) { const r = await page.evaluate(args.js); if (r !== undefined) console.log('js:', JSON.stringify(r)); }
await page.screenshot({ path: `.cache/shots/${name}.png` });
const info = await page.evaluate(() => { const r = window.app?.stage?.renderer; return r ? { calls: r.info.render.calls, tris: r.info.render.triangles, gl: r.getContext().getParameter(r.getContext().VERSION) } : null; });
console.log(JSON.stringify(info));
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
