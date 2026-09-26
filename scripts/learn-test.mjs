// Plays a lesson with synthetic, well-timed finger taps and checks the coach's judgement.
import { chromium } from 'playwright';
const device = process.argv[2] || 'ipad';
const presets = {
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext(presets[device])).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.tap('#start');
await page.waitForTimeout(1200);
await page.evaluate(() => document.getElementById('tip-ok')?.click());
await page.tap('[data-mode="learn"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `.cache/shots/learn-list-${device}.png` });
await page.tap('[data-lesson="rock"]');
// schedule taps inside the page, aligned to each note's heard time, via real pointer events
await page.evaluate(() => {
  const app = window.app, coach = app.coach, canvas = document.getElementById('scene');
  const notes = coach.notes; const start = coach.perfStart;
  window.__tapLog = [];
  for (const n of notes) {
    const at = start + n.time * 1000 + (Math.random() - 0.5) * 30;
    const delay = at - performance.now();
    setTimeout(() => {
      const p = app.kit.pieces.get(n.piece);
      const T = app.kit.root.position.constructor;
      const w = n.piece === 'kick' ? new T(0.03, 0.06, 0.16) : p.surface.localToWorld(new T(p.radius * 0.3, 0, -p.radius * 0.1));
      w.project(app.stage.camera);
      const x = (w.x + 1) / 2 * innerWidth, y = (1 - w.y) / 2 * innerHeight;
      const ev = new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 10 + Math.floor(Math.random() * 1000), pointerType: 'touch', bubbles: true, cancelable: true });
      canvas.dispatchEvent(ev);
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: ev.pointerId, pointerType: 'touch', bubbles: true }));
      window.__tapLog.push(n.piece);
    }, delay);
  }
});
await page.waitForTimeout(4200);
await page.screenshot({ path: `.cache/shots/learn-mid-${device}.png` });
const dur = await page.evaluate(() => (window.app.coach.notes.at(-1)?.time ?? 0) * 1000 + 1500);
await page.waitForTimeout(dur - 4000);
const res = await page.evaluate(() => ({ summaryVisible: !document.getElementById('summary').hidden, acc: document.getElementById('sum-acc').textContent, stats: document.getElementById('sum-stats').innerText.replace(/\n/g, ' '), taps: window.__tapLog.length }));
console.log(JSON.stringify(res));
await page.screenshot({ path: `.cache/shots/learn-summary-${device}.png` });
console.log('errors', errors);
await browser.close();
