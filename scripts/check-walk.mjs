// Teste do modo Passear (Fase 6) no navegador: entra, anda (colisão), senta num sofá das áreas comuns, pega café,
// chama o elevador (painel de andares), cumprimenta um agente (abre a gaveta), clica no chão para ir, troca 3ª/1ª pessoa/vista de cima, sai; falha com erro no console.
// Uso (com o servidor rodando: npm run dev): node scripts/check-walk.mjs [--url http://127.0.0.1:4747/?mock=1]
//   [--channel msedge] [--out pasta]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const url = new URL(opt('url', 'http://127.0.0.1:4747/?mock=1'));
url.searchParams.set('view', '3d');
const out = opt('out', 'docs/screenshots/3d');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: opt('channel', 'msedge'), args: ['--use-angle=default', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket|websocket/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const wait = (ms) => page.waitForTimeout(ms);
const key = async (k, ms = 0) => {
  await page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k })), k);
  if (ms) await wait(ms);
  await page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k })), k);
};

await page.goto(url.toString());
await page.waitForFunction(() => window.habblaud?.world?.debug?.avatars?.().list.size > 0, null, { timeout: 40000 });
await wait(4000);
await page.evaluate(() => window.habblaud.world.setOptions({ daylight: 'day' }));

await key('p');
await wait(600);
const st0 = await page.evaluate(() => {
  const w = window.habblaud.world;
  return { mode: w.getWalkMode(), agents: w.debug.sim().chars.size, x: w.debug.walk.x, z: w.debug.walk.z, hidden: getComputedStyle(document.querySelector('.ui-sidebar')).display === 'none' };
});
step('entra no modo Passear (tecla P)', st0.mode === 'third', `pos ${st0.x.toFixed(1)}, ${st0.z.toFixed(1)}`);
step('lista de salas sai da frente', st0.hidden);
await key('w', 1500);
const st1 = await page.evaluate(() => {
  const w = window.habblaud.world;
  const g = w.debug.sim().building.grid;
  return { x: w.debug.walk.x, z: w.debug.walk.z, ok: g.walkable(Math.floor(w.debug.walk.x), Math.floor(w.debug.walk.z)), agents: w.debug.sim().chars.size };
});
step('anda e fica em tile caminhável', st1.ok && Math.hypot(st1.x - st0.x, st1.z - st0.z) > 0.2, `${st1.x.toFixed(1)}, ${st1.z.toFixed(1)}`);
step('o boneco do usuário não vira agente', st1.agents === st0.agents);
await page.screenshot({ path: join(out, 'passear-3a-pessoa.jpg'), type: 'jpeg', quality: 85 });

// leva o boneco para perto de cada tipo de lugar e interage com E
const near = async (kinds) =>
  page.evaluate((kinds) => {
    const w = window.habblaud.world;
    const sim = w.debug.sim();
    const walk = w.debug.walk;
    const s = [...sim.spots.all()].find((s) => kinds.includes(s.kind) && s.areaId.startsWith('core:') && sim.spots.isFree(s.id));
    if (!s) return null;
    const t = sim.building.grid.nearestWalkable(s.tx, s.ty + 1, 3);
    walk.x = t.x + 0.5;
    walk.z = t.y + 0.5;
    return s.id;
  }, kinds);
const prompt = () => page.evaluate(() => {
  const p = document.querySelector('.w3d-walk__prompt');
  return p && !p.hidden ? p.textContent : null;
});

const sofa = await near(['sofa', 'armchair', 'beanbag', 'cafe_seat']);
await wait(300);
const p1 = await prompt();
await key('e');
await wait(500);
const sat = await page.evaluate((id) => window.habblaud.world.debug.sim().spots.isFree(id) === false, sofa);
step('sentar (E)', !!sofa && sat, `${sofa} · aviso "${p1}"`);
await key('e');
await wait(300);
const stood = await page.evaluate((id) => window.habblaud.world.debug.sim().spots.isFree(id), sofa);
step('levantar (E) devolve o lugar', stood);

const coffee = await near(['coffee', 'water']);
await wait(300);
const p2 = await prompt();
await key('e');
await wait(300);
step('pegar café/água', !!coffee && /café|água/i.test(p2 ?? ''), `"${p2}"`);

const elev = await near(['elevator']);
await wait(300);
const p3 = await prompt();
await key('e');
await wait(300);
const floors = await page.$$eval('.w3d-walk__floors:not([hidden]) button', (b) => b.map((x) => x.textContent));
step('painel de andares do elevador (E)', floors.length === 3, floors.join(' / '));
await page.click('.w3d-walk__floors button');
await wait(1800);
const opened = await page.evaluate(() => window.habblaud.world.debug.sim().elevators.some((e) => e.door > 0));
step('chamar/tomar o elevador', !!elev && opened, `"${p3}"`);
await wait(3500);
// mezanino no painel: só a vista do andar (sai do Passear); P volta
await key('e');
await wait(300);
await page.click('.w3d-walk__floors button:nth-child(2)');
await wait(600);
const leftForView = await page.evaluate(() => !window.habblaud.world.debug.walk.active && !document.body.classList.contains('w3d-walking'));
step('painel: mezanino mostra o andar', leftForView);
await key('p');
await wait(600);

// clicar-para-ir: clique no chão à frente do boneco
const c0 = await page.evaluate(() => ({ x: window.habblaud.world.debug.walk.x, z: window.habblaud.world.debug.walk.z }));
await page.mouse.click(960, 760);
await wait(2000);
const c1 = await page.evaluate(() => {
  const w = window.habblaud.world;
  const g = w.debug.sim().building.grid;
  return { x: w.debug.walk.x, z: w.debug.walk.z, ok: g.walkable(Math.floor(w.debug.walk.x), Math.floor(w.debug.walk.z)) };
});
step('clicar no chão leva o boneco até lá', c1.ok && Math.hypot(c1.x - c0.x, c1.z - c0.z) > 0.5, `${c1.x.toFixed(1)}, ${c1.z.toFixed(1)}`);

// cumprimentar: vai até um agente visível
const agentId = await page.evaluate(() => {
  const w = window.habblaud.world;
  const walk = w.debug.walk;
  for (const [id, a] of w.debug.avatars().list) {
    if (!a.visible) continue;
    const g = w.debug.sim().building.grid.nearestWalkable(Math.floor(a.root.position.x), Math.floor(a.root.position.z), 3);
    if (!g) continue;
    walk.x = g.x + 0.5;
    walk.z = g.y + 0.5;
    return id;
  }
  return null;
});
await wait(300);
const p4 = await prompt();
await key('e');
await wait(500);
const sel = await page.evaluate(() => window.habblaud.world.getSelection());
step('cumprimentar abre a gaveta do agente', !!agentId && sel?.id === agentId, `"${p4}"`);

await key('v');
await wait(700);
step('V troca para primeira pessoa', (await page.evaluate(() => window.habblaud.world.getWalkMode())) === 'first');
await page.screenshot({ path: join(out, 'passear-1a-pessoa.jpg'), type: 'jpeg', quality: 85 });
await key('v');
await wait(700);
step('V troca para a vista de cima', (await page.evaluate(() => window.habblaud.world.getWalkMode())) === 'above');
await page.screenshot({ path: join(out, 'passear-vista-de-cima.jpg'), type: 'jpeg', quality: 85 });

const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
step('FPS passeando (1080p)', fps > 30, fps.toFixed(1));

await key('Escape');
await wait(500);
const end = await page.evaluate(() => ({ mode: window.habblaud.world.getWalkMode(), free: [...window.habblaud.world.debug.sim().spots.all()].every((s) => window.habblaud.world.debug.sim().spots.isFree(s.id, 'x') || !s) }));
step('Esc sai do modo', end.mode === null);
step('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
