// Captures a burst of frames right after hits to check motion (ripples, swing, beater).
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.tap('#start');
await page.waitForTimeout(1300);
const pos = await page.evaluate(() => {
  const app = window.app, cam = app.stage.camera, out = {};
  for (const id of ['crash', 'snare', 'tom1', 'floor']) {
    const p = app.kit.pieces.get(id);
    const w = p.surface.localToWorld(new (app.kit.root.position.constructor)(id === 'crash' ? p.radius * 0.9 : p.radius * 0.3, 0, 0)).project(cam);
    out[id] = [(w.x + 1) / 2 * innerWidth, (1 - w.y) / 2 * innerHeight];
  }
  const k = new (app.kit.root.position.constructor)(0.03, 0.06, 0.16).project(cam);
  out.kick = [(k.x + 1) / 2 * innerWidth, (1 - k.y) / 2 * innerHeight];
  return out;
});
for (const id of ['crash', 'snare', 'tom1', 'floor', 'kick']) await page.touchscreen.tap(...pos[id]);
for (let i = 0; i < 6; i++) {
  await page.screenshot({ path: `.cache/shots/f${i}.png`, clip: { x: 150, y: 150, width: 800, height: 650 } });
  await page.waitForTimeout(i < 3 ? 30 : 180);
}
await browser.close();
