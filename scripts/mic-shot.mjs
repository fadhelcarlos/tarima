// Opens the mic station with a fake microphone singing, starts a song, and screenshots.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const [,, device = 'ipad', song = 'cumple', wait = '6000'] = process.argv;
const presets = {
  ipad: { viewport: { width: 1180, height: 820 } },
  'ipad-port': { viewport: { width: 820, height: 1180 } },
  iphone: { viewport: { width: 844, height: 390 } },
  'iphone-port': { viewport: { width: 390, height: 844 } },
};
const wav = resolve('.cache/vox/test_voice.wav');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ...presets[device], deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['microphone'] });
await ctx.addInitScript(() => localStorage.setItem('baqueta:settings:v1', JSON.stringify({ tourSeen: true, tipSeen: true })));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/');
await page.waitForSelector('#start:not([hidden])', { timeout: 180000 });
await page.tap('#start');
await page.waitForTimeout(500);
await page.screenshot({ path: `.cache/shots/picker-${device}.png` });
await page.tap('[data-station="mic"]');
await page.waitForTimeout(1500);
await page.tap('#mic-btn');
await page.waitForTimeout(300);
await page.tap('[data-hp="1"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: `.cache/shots/mic-free-${device}.png` });
if (song !== 'none') {
  await page.tap('#mic-songs');
  await page.waitForTimeout(400);
  await page.tap(`[data-ksong="${song}"]`);
  await page.waitForTimeout(Number(wait));
  await page.screenshot({ path: `.cache/shots/mic-song-${device}.png` });
}
console.log('errors', errors.filter((e) => !e.includes('X4122') && !e.includes('X3595')));
await browser.close();
