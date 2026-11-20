// Teste de fumaça do escritório 3D no navegador (Playwright): abre o app, espera os personagens 3D, seleciona um
// pelo clique no canvas, confere o painel do agente, troca a qualidade gráfica, gira/aproxima a câmera, mede o FPS e
// falha se houver erro no console. Grava screenshots em --out.
//
// Uso (com o servidor rodando: npm run dev):
//   node scripts/check-3d.mjs [--url http://127.0.0.1:4747/?mock=1] [--out docs/screenshots/3d] [--chromium <exe>]
//   [--channel msedge|chrome]  (no Windows, `--channel msedge` usa o Edge instalado)
// Sem --url, usa o modo demonstração (?mock=1): os agentes são fictícios e marcados como "Simulação" na interface.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = opt('url') ?? 'http://127.0.0.1:4747/?mock=1';
const out = opt('out') ?? 'docs/screenshots/3d';
const executablePath = opt('chromium') ?? process.env.HABBLAUD_CHROMIUM;
const channel = opt('channel');
mkdirSync(out, { recursive: true });

const url = new URL(base);
url.searchParams.set('view', '3d');

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...(channel ? { channel } : {}), args: ['--use-angle=default', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => {
  // o proxy da API sem servidor (só Vite) responde 502: não é erro do 3D
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};

await page.goto(url.toString());
await page.waitForFunction(() => window.habblaud?.world?.debug?.avatars?.().list.size > 0, null, { timeout: 30000 });
const info = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'desconhecida', is3d: typeof window.habblaud.world.getQuality === 'function' };
});
step('mundo 3D carregado', info.is3d, info.gpu);

// espera os modelos e anima um pouco
await page.waitForFunction(() => [...window.habblaud.world.debug.avatars().list.values()].every((a) => a.body), null, { timeout: 30000 });
await page.evaluate(() => window.habblaud.world.setOptions({ daylight: 'day' }));
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, 'overview.png') });
step('visão geral', true, join(out, 'overview.png'));

// clique num personagem pelo canvas (posição na tela vinda do próprio mundo)
const first = await page.evaluate(() => {
  const w = window.habblaud.world;
  const ch = [...w.debug.sim().chars.values()].find((c) => w.screenPositionOf(c.id));
  if (!ch) return null;
  w.focusAgent(ch.id);
  return ch.id;
});
await page.waitForTimeout(900);
// meio do caminho entre a cabeça e os pés, na tela
const target = first
  ? await page.evaluate((id) => {
      const w = window.habblaud.world;
      const av = w.debug.avatars().list.get(id);
      const cam = w.debug.stage.camera;
      const feet = av.root.position.clone().project(cam);
      const head = w.screenPositionOf(id);
      const fy = (-feet.y * 0.5 + 0.5) * innerHeight;
      const fx = (feet.x * 0.5 + 0.5) * innerWidth;
      return head ? { id, name: w.debug.sim().chars.get(id).info.name, x: (fx + head.x) / 2, y: head.y + (fy - head.y) * 0.6 } : null;
    }, first)
  : null;
if (target) {
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(400);
  const sel = await page.evaluate(() => window.habblaud.world.getSelection());
  step('selecionar personagem pelo clique', sel?.type === 'agent' && sel.id === target.id, target.name);
  const panel = await page.locator('text=' + target.name).count();
  step('painel do agente abriu', panel > 1);
  await page.evaluate((id) => window.habblaud.world.focusAgent(id, { follow: true }), target.id);
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, 'agent.png') });
} else step('selecionar personagem pelo clique', false, 'nenhum personagem visível');

// câmera: giro (botão direito), zoom (roda), visão geral (tecla 0)
const before = await page.evaluate(() => ({ ...window.habblaud.world.debug.cam.state, target: null }));
await page.mouse.move(960, 540);
await page.mouse.down({ button: 'right' });
await page.mouse.move(1160, 500, { steps: 8 });
await page.mouse.up({ button: 'right' });
await page.mouse.wheel(0, -400);
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({ ...window.habblaud.world.debug.cam.state, target: null }));
step('girar e aproximar a câmera', after.yaw !== before.yaw && after.dist < before.dist);
await page.keyboard.press('0');
await page.waitForTimeout(800);

// qualidade gráfica
for (const q of ['low', 'ultra', 'high']) {
  await page.evaluate((q) => window.habblaud.world.setQuality(q), q);
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => window.habblaud.world.getQuality());
  step(`qualidade ${q}`, got === q);
}

// FPS (limitado pelo vsync do navegador)
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const loop = () => {
        n++;
        if (performance.now() - t0 < 4000) requestAnimationFrame(loop);
        else res(n / ((performance.now() - t0) / 1000));
      };
      requestAnimationFrame(loop);
    }),
);
step('FPS (High, 1080p)', fps > 30, fps.toFixed(1));

step('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
