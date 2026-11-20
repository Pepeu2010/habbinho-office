// Mede FPS do escritório 3D em variações (com/sem desfoque da interface), para achar gargalos.
// Uso: node scripts/perf-3d.mjs [--url http://127.0.0.1:4747/?mock=1] [--channel msedge]
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const url = new URL(opt('url', 'http://127.0.0.1:4747/?mock=1'));
url.searchParams.set('view', '3d');
const browser = await chromium.launch({ headless: true, channel: opt('channel', 'msedge'), args: ['--use-angle=default', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url.toString());
await page.waitForFunction(() => window.habblaud?.world?.debug?.avatars?.().list.size > 0, null, { timeout: 40000 });
await page.waitForTimeout(6000);
const fps = () => page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(+(n / 3).toFixed(1)); }; requestAnimationFrame(f); }));
const info = () => page.evaluate(() => { const i = window.habblaud.world.debug.stage.renderer.info.render; return { calls: i.calls, tris: i.triangles }; });
console.log('normal', await fps());
// cenário do teste de fumaça: agente selecionado (gaveta aberta) e visão geral
await page.evaluate(() => { const w = window.habblaud.world; const id = [...w.debug.sim().chars.keys()][0]; w.select({ type: 'agent', id }); w.overview(); w.setQuality('high'); });
await page.waitForTimeout(2500);
console.log('gaveta + visão geral', await fps(), JSON.stringify(await page.evaluate(() => window.habblaud.world.stats?.())));
await page.addStyleTag({ content: '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
console.log('  sem desfoque', await fps());
await page.evaluate(() => { document.querySelector('.w3d-labels')?.setAttribute('style', 'display:none'); });
console.log('  sem etiquetas', await fps());
await page.evaluate(() => { const b = window.habblaud.world.debug.building; b.root.visible = false; });
console.log('  sem prédio', await fps());
await browser.close();
