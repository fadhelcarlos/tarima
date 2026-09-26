import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.tap('#start');
await page.waitForTimeout(1300);
const target = process.argv[2] || 'snare';
await page.evaluate((id) => {
  const app = window.app; const p = app.kit.pieces.get(id);
  const c = p.surface.getWorldPosition(new (app.kit.root.position.constructor)());
  app.rig.update = () => {};
  const cam = app.stage.camera; cam.fov = 35; cam.updateProjectionMatrix();
  cam.position.set(c.x + 0.05, c.y + 0.45, c.z + 0.4); cam.lookAt(c);
  window.__hitNow = () => app.hit({ piece: id, zone: 'center', velocity: 1, local: new (app.kit.root.position.constructor)(0.03, 0, 0.02), world: c, time: performance.now(), pointerId: 1 });
}, target);
await page.screenshot({ path: `.cache/shots/close-${target}-0.png` });
await page.evaluate(() => window.__hitNow());
for (let i = 1; i <= 4; i++) { await page.waitForTimeout(40); await page.screenshot({ path: `.cache/shots/close-${target}-${i}.png` }); }
await browser.close();
