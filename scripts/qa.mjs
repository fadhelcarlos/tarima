// Device-class sweep: key screens on iPad/iPhone in both orientations.
import { chromium } from 'playwright';
const presets = {
  'ipad-land': { viewport: { width: 1180, height: 820 } },
  'ipad-port': { viewport: { width: 820, height: 1180 } },
  'iphone-land': { viewport: { width: 844, height: 390 } },
  'iphone-port': { viewport: { width: 390, height: 844 } },
};
const which = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
for (const [name, p] of Object.entries(presets)) {
  if (which.length && !which.includes(name)) continue;
  const ctx = await browser.newContext({ ...p, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('baqueta:settings:v1', JSON.stringify({ tourSeen: true, tipSeen: true })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
  await page.tap('#start');
await page.waitForTimeout(300);
await page.tap('[data-station="drums"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `.cache/shots/qa-${name}-1free.png` });
  await page.tap('#settings-btn');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `.cache/shots/qa-${name}-2settings.png` });
  await page.tap('#settings-sheet [data-close]');
  await page.tap('[data-mode="learn"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `.cache/shots/qa-${name}-3lessons.png` });
  await page.tap('[data-song="backinblack"]');
  await page.waitForTimeout(300);
  await page.tap('[data-step="2"]');
  await page.evaluate(() => {
    const app = window.app, coach = app.coach, canvas = document.getElementById('scene');
    for (const n of coach.notes) {
      if (Math.random() < 0.12) continue; // a few misses, like a person
      const at = coach.perfStart + n.time * 1000 + (Math.random() - 0.5) * 70;
      setTimeout(() => {
        const pc = app.kit.pieces.get(n.piece), T = app.kit.root.position.constructor;
        const w = n.piece === 'kick' ? new T(0.03, 0.06, 0.16) : pc.surface.localToWorld(new T(pc.radius * 0.3, 0, 0));
        w.project(app.stage.camera);
        const x = (w.x + 1) / 2 * innerWidth, y = (1 - w.y) / 2 * innerHeight, id = Math.floor(Math.random() * 1e6);
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true }));
      }, at - performance.now());
    }
  });
  await page.waitForTimeout(4200);
  await page.screenshot({ path: `.cache/shots/qa-${name}-4song.png` });
  await page.waitForFunction(() => !document.getElementById('summary').hidden, null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `.cache/shots/qa-${name}-5summary.png` });
  console.log(name, 'errors', errors.length ? errors : 'none');
  await ctx.close();
}
await browser.close();
