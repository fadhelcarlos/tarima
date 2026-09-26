// First-run tour: follow the lit pieces with real taps and record each instruction.
import { chromium, webkit } from 'playwright';
const [,, device = 'ipad', engineName = 'chromium'] = process.argv;
const presets = {
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  'iphone-portrait': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
};
const engine = engineName === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, ...(engine === chromium ? { args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] } : {}) });
const page = await (await browser.newContext(presets[device])).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.tap('#start');
await page.waitForTimeout(300);
await page.tap('[data-station="drums"]');
await page.waitForSelector('#tourcard:not([hidden])', { timeout: 10000 });
const texts = [];
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2600);
  const info = await page.evaluate(() => {
    const app = window.app, c = app.coach;
    const n = c.notes.find((x) => x.state === 'pending');
    const text = document.getElementById('tour-text').textContent;
    if (!n) return { text, done: true };
    const p = app.kit.pieces.get(n.piece), T = app.kit.root.position.constructor;
    const w = n.piece === 'kick' ? new T(0.03, 0.06, 0.16) : p.surface.localToWorld(new T(p.radius * 0.3, 0, 0));
    w.project(app.stage.camera);
    return { text, piece: n.piece, x: (w.x + 1) / 2 * innerWidth, y: (1 - w.y) / 2 * innerHeight, waiting: c.songPos >= n.time - 1e-3 };
  });
  texts.push(`${info.text}  [${info.piece ?? 'fin'}${info.waiting ? ', esperando' : ''}]`);
  if (i === 0) await page.screenshot({ path: `.cache/shots/tour-1-${device}.png` });
  if (i === 1) await page.screenshot({ path: `.cache/shots/tour-2-${device}.png` });
  if (info.done) break;
  await page.touchscreen.tap(info.x, info.y);
}
await page.waitForTimeout(1500);
texts.push('FINAL: ' + (await page.evaluate(() => document.getElementById('tour-text').textContent + ' | boton: ' + document.getElementById('tour-skip').textContent)));
await page.screenshot({ path: `.cache/shots/tour-end-${device}.png` });
console.log(texts.join('\n'));
console.log('errors', errors);
await browser.close();
