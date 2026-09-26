// Enter play mode, tap a few pieces, screenshot right after (sticks + labels visible).
import { chromium, webkit } from 'playwright';
const [,, name = 'play', device = 'ipad', engineName = 'chromium', taps = 'hihat,snare'] = process.argv;
const presets = {
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'ipad-portrait': { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'iphone-portrait': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const engine = engineName === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, ...(engine === chromium ? { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] } : {}) });
const ctx = await browser.newContext(presets[device]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 200)); });
await page.goto(process.env.URL || 'http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.tap('#start');
await page.waitForTimeout(300);
await page.tap('[data-station="drums"]');
await page.waitForTimeout(1400);
for (const id of taps.split(',').filter(Boolean)) {
  const xy = await page.evaluate((id) => {
    const app = window.app, p = app.kit.pieces.get(id);
    const w = p.surface.localToWorld(new (app.kit.root.position.constructor)(p.radius * 0.35, 0, -p.radius * 0.2)).project(app.stage.camera);
    return [(w.x + 1) / 2 * innerWidth, (1 - w.y) / 2 * innerHeight];
  }, id);
  await page.touchscreen.tap(xy[0], xy[1]);
}
await page.waitForTimeout(Number(process.env.WAIT || 40));
await page.screenshot({ path: `.cache/shots/${name}.png` });
console.log('errors:', errors.filter((e) => !e.includes('X4122')).slice(0, 8));
await browser.close();
