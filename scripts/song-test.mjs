// Opens a song, plays one step with timed synthetic taps, captures the guide and the result.
import { chromium } from 'playwright';
const [,, songId = 'billie', step = '2', device = 'ipad', jitter = '25'] = process.argv;
const presets = {
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  'iphone-portrait': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext(presets[device])).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.tap('#start');
await page.waitForTimeout(1000);
await page.evaluate(() => document.getElementById('tip-ok')?.click());
await page.tap('[data-mode="learn"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `.cache/shots/songs-${device}.png` });
await page.tap(`[data-song="${songId}"]`);
await page.waitForTimeout(500);
await page.screenshot({ path: `.cache/shots/song-${songId}-${device}.png` });
await page.tap(`[data-step="${step}"]`);
await page.waitForTimeout(300);
const wait = await page.evaluate(() => window.app.coach.wait);
await page.evaluate((jit) => {
  const app = window.app, coach = app.coach, canvas = document.getElementById('scene');
  window.__taps = 0;
  const fire = (n) => {
    const p = app.kit.pieces.get(n.piece), T = app.kit.root.position.constructor;
    const w = n.piece === 'kick' ? new T(0.03, 0.06, 0.16) : p.surface.localToWorld(new T(n.zone === 'open' ? p.radius * 0.9 : p.radius * 0.3, 0, -p.radius * 0.1));
    w.project(app.stage.camera);
    const x = (w.x + 1) / 2 * innerWidth, y = (1 - w.y) / 2 * innerHeight;
    const id = 10 + Math.floor(Math.random() * 1e6);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true }));
    window.__taps++;
  };
  if (coach.wait) {
    // wait mode: hit whatever is blocking, a little late, like a beginner
    const iv = setInterval(() => {
      if (!coach.running) return clearInterval(iv);
      const due = coach.notes.filter((n) => n.state === 'pending' && n.time <= coach.songPos + 0.001);
      due.forEach(fire);
    }, 180);
  } else {
    for (const n of coach.notes) {
      const at = coach.perfStart + n.time * 1000 + (Math.random() - 0.5) * jit;
      setTimeout(() => fire(n), at - performance.now());
    }
  }
}, Number(jitter));
await page.waitForTimeout(5200);
await page.screenshot({ path: `.cache/shots/song-play-${songId}-${device}.png` });
await page.waitForFunction(() => !document.getElementById('summary').hidden, null, { timeout: 180000 });
await page.waitForTimeout(900);
const res = await page.evaluate(() => ({ acc: document.getElementById('sum-acc').textContent, stars: document.querySelectorAll('#sum-stars i.on').length, next: !document.getElementById('sum-next').hidden && document.getElementById('sum-next').textContent, stats: document.getElementById('sum-stats').innerText.replace(/\n/g, ' '), taps: window.__taps }));
console.log(JSON.stringify({ wait, ...res }));
await page.screenshot({ path: `.cache/shots/song-result-${songId}-${device}.png` });
console.log('errors', errors);
await browser.close();
