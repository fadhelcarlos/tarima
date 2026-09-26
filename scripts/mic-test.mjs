// Feeds a WAV through Chromium's fake microphone into the vocal chain and saves the output.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const wav = resolve(process.argv[2] || '.cache/vox/test_voice.wav');
const presets = (process.argv[3] || 'natural,autotune,estudio,coro').split(',');
const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://localhost:5173/mic-lab.html');
await page.waitForFunction(() => window.ready);
const DRY = { reverbMix: 0, delayMix: 0, double: 0, warmth: 0, harmonyMix: 0, harmonies: [] };
for (const p of presets) {
  const [id, mode] = p.split(':');
  const b64 = await page.evaluate(([id, extra]) => window.run(id, 8, extra), [id, mode === 'dry' ? DRY : null]);
  writeFileSync(`.cache/vox/out_${p}.f32`, Buffer.from(b64, 'base64'));
  console.log('captured', p);
}
await browser.close();
