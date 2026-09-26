// Taps every piece like a finger would and checks the right sound fires.
import { chromium, webkit } from 'playwright';
const engineName = process.argv[2] || 'chromium';
const device = process.argv[3] || 'ipad';
const presets = {
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'iphone-portrait': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const engine = engineName === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, ...(engine === chromium ? { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] } : {}) });
const ctx = await browser.newContext(presets[device]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.env.URL || 'http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.tap('#start');
await page.waitForTimeout(1300);
await page.evaluate(() => {
  window.__plays = [];
  const a = window.app.audio;
  const orig = a.play.bind(a);
  a.play = (...args) => { const ok = orig(...args); window.__plays.push([...args.slice(0, 3), ok]); return ok; };
});
// screen position of each piece's centre (and a few zone probes)
const probes = await page.evaluate(() => {
  const app = window.app; const cam = app.stage.camera; const out = [];
  const V = (x, y, z) => ({ x, y, z });
  for (const p of app.kit.pieces.values()) {
    const pts = p.id === 'kick' ? [[0, 0, 0]] : p.id === 'hhpedal' ? [[0, 0.02, -0.12]] : [[0, 0, 0], [p.radius * 0.85, 0, 0], [p.radius * 1.03, 0, 0]];
    for (const [x, y, z] of pts) {
      const w = p.surface.localToWorld(new (app.kit.root.position.constructor)(x, y, z));
      if (p.id === 'kick') w.set(0.03, 0.06, 0.16);
      w.project(cam);
      out.push({ id: p.id, r: Math.hypot(x, z) / p.radius, sx: (w.x + 1) / 2 * innerWidth, sy: (1 - w.y) / 2 * innerHeight });
    }
  }
  return out;
});
const results = [];
for (const pr of probes) {
  await page.evaluate(() => { window.__plays.length = 0; });
  await page.touchscreen.tap(pr.sx, pr.sy);
  await page.waitForTimeout(120);
  const plays = await page.evaluate(() => window.__plays.slice());
  results.push(`${pr.id.padEnd(8)} r=${pr.r.toFixed(2)} @(${pr.sx.toFixed(0)},${pr.sy.toFixed(0)}) -> ${plays.map((p) => `${p[0]}/${p[1]} v${p[2].toFixed(2)} ${p[3] ? 'ok' : 'NO SOUND'}`).join(', ') || 'nothing'}`);
}
console.log(results.join('\n'));
const state = await page.evaluate(() => ({ ctx: window.app.audio.ctx.state, rate: window.app.audio.ctx.sampleRate, latency: window.app.audio.latency }));
console.log('audio', JSON.stringify(state));
// animation capture: crash + snare + tom, then screenshot mid-motion
const crash = probes.find((p) => p.id === 'crash' && p.r > 0.8);
const snare = probes.find((p) => p.id === 'snare' && p.r === 0);
const tom = probes.find((p) => p.id === 'tom1' && p.r === 0);
await page.touchscreen.tap(crash.sx, crash.sy);
await page.touchscreen.tap(snare.sx, snare.sy);
await page.touchscreen.tap(tom.sx, tom.sy);
await page.waitForTimeout(90);
await page.screenshot({ path: `.cache/shots/anim-${engineName}-${device}.png` });
console.log('errors:', errors.slice(0, 10));
await browser.close();
