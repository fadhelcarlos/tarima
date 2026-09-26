// Close-up renders of the studio mic from a few angles (look-dev).
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('baqueta:settings:v1', JSON.stringify({ tourSeen: true, tipSeen: true })));
const page = await ctx.newPage();
await page.goto('http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.click('#start');
await page.waitForTimeout(300);
await page.click('[data-station="mic"]');
await page.waitForTimeout(1500);
const views = [[0.35, 0.05, 0.55], [0, 0.12, 0.62], [-0.5, 0.2, 0.25]];
let i = 0;
for (const [dx, dy, dz] of views) {
  await page.evaluate(([dx, dy, dz]) => {
    const app = window.app; app.rig.update = () => {};
    const T = app.kit.root.position.constructor;
    const h = app.venue.micHead.getWorldPosition(new T());
    const cam = app.stage.camera; cam.fov = 30; cam.updateProjectionMatrix();
    cam.position.set(h.x + dx, h.y + dy, h.z + dz); cam.lookAt(h.x, h.y - 0.04, h.z);
    document.getElementById('mic-hud').hidden = true;
  }, [dx, dy, dz]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.cache/shots/micclose-${i++}.png` });
}
await browser.close();
