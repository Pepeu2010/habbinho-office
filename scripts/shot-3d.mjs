// Captura de tela do escritório 3D (Playwright), para revisão visual.
// Uso: node scripts/shot-3d.mjs --out arquivo.jpg [--url http://127.0.0.1:4747/?mock=1] [--eval "js"] [--wait 2500]
//      [--channel msedge] [--w 1920 --h 1080]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const url = new URL(opt('url', 'http://127.0.0.1:4747/?mock=1'));
if (!url.searchParams.has('view')) url.searchParams.set('view', '3d');
const browser = await chromium.launch({ headless: true, channel: opt('channel', 'msedge'), args: ['--use-angle=default', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +opt('w', 1920), height: +opt('h', 1080) } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.goto(url.toString());
await page.waitForFunction(() => window.habblaud?.world?.debug?.avatars?.().list.size > 0, null, { timeout: 40000 }).catch(() => console.log('sem avatares'));
await page.waitForTimeout(+opt('wait', 2500));
const js = opt('eval');
if (js) {
  console.log(JSON.stringify(await page.evaluate(js)));
  await page.waitForTimeout(+opt('wait2', 1500));
}
await page.screenshot({ path: opt('out', 'shot.jpg'), quality: 85, type: 'jpeg' });
await browser.close();
