import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { loopbackBase } from './llm';
import { LocalAgentRuntime, stripThinking } from './runtime';

setQuiet(true);

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

/** Ollama de mentira: devolve as respostas da lista, em ordem; `hold` segura a resposta até liberar. */
function fakeOllama(replies: unknown[], opts: { hold?: boolean } = {}) {
  const calls: { url: string; body: any }[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:8b', size: 5, details: { parameter_size: '8B' } }] });
    if (u.endsWith('/api/ps')) return Response.json({ models: [] });
    if (u.endsWith('/api/chat')) {
      calls.push({ url: u, body: JSON.parse(String(init?.body)) });
      if (opts.hold)
        await new Promise<void>((resolve, reject) => {
          gate.then(resolve);
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      return Response.json(replies.shift() ?? { message: { content: 'fim' } });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls, release: () => release() };
}

function setup(fetchFn: typeof fetch) {
  const base = mkdtempSync(join(tmpdir(), 'hb-local-rt-'));
  const proj = join(base, 'proj');
  require('node:fs').mkdirSync(proj);
  writeFileSync(join(proj, 'README.md'), '# Olá\nProjeto de teste.\n');
  let clock = 1_800_000_000_000;
  const now = () => (clock += 10);
  const late: { office?: Office } = {};
  const accounts = new AccountsService({ dirs: [], home: '/nao/existe', env: {}, now, onChange: () => late.office?.markDirty() });
  const office = new Office({ names: new NameStore(null), version: 'teste', startedAt: clock, accounts: (s) => accounts.list(s), sources: () => [], accountName: (id) => accounts.find(id)?.detected.name, now });
  late.office = office;
  const rt = new LocalAgentRuntime({ accounts, office, dataDir: join(base, 'data'), llm: { ollama: 'http://127.0.0.1:11434' }, fetch: fetchFn, now });
  rt.start();
  cleanups.push(() => {
    rt.stop();
    rmSync(base, { recursive: true, force: true });
  });
  return { rt, office, proj, base, accounts, now };
}

const settle = () => new Promise((r) => setTimeout(r, 30));
/** Espera a condição (até 3 s): não depende de um atraso fixo com a máquina ocupada. */
async function until(cond: () => boolean): Promise<void> {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < 3_000) await new Promise((r) => setTimeout(r, 10));
}

describe('runtime dos agentes locais', () => {
  it('cria a sessão, usa a ferramenta, responde e fica ocioso', async () => {
    const llm = fakeOllama([
      { message: { content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'README.md' } } }] }, prompt_eval_count: 100, eval_count: 5 },
      { message: { content: '<think>hmm</think>O README fala de um projeto de teste.' }, prompt_eval_count: 150, eval_count: 12 },
    ]);
    const { rt, office, proj } = setup(llm.fetchFn);
    const r = await rt.create({ model: 'ollama:qwen3:8b', cwd: proj, prompt: 'O que tem no README?' });
    expect('session' in r).toBe(true);
    const id = (r as { session: { agentId: string } }).session.agentId;
    expect(office.get(id)?.provider).toBe('local');
    await until(() => office.get(id)?.status === 'idle');
    const a = office.get(id)!;
    expect(a.status).toBe('idle');
    expect(a.model).toBe('qwen3:8b');
    expect(a.stats.tokensIn).toBe(250);
    expect(a.stats.toolCalls).toBe(1);
    expect(a.recent.map((x) => x.text).join(' | ')).toContain('Lendo README.md');
    // o modelo recebeu o conteúdo do arquivo como resposta da ferramenta
    expect(llm.calls[1]!.body.messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Projeto de teste') });
    // a conversa vai para o terminal no formato do Claude Code
    const lines = readFileSync(rt.transcriptPathOf(id)!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(lines[1].message.content[0]).toMatchObject({ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } });
    expect(lines[3].message.content[0].text).toBe('O README fala de um projeto de teste.');
  });

  it('recusa pasta inexistente, modelo ausente e prompt vazio', async () => {
    const { rt, proj } = setup(fakeOllama([]).fetchFn);
    expect(await rt.create({ model: 'ollama:qwen3:8b', cwd: join(proj, 'nao'), prompt: 'x' })).toMatchObject({ error: 'invalid' });
    expect(await rt.create({ model: 'ollama:llama9', cwd: proj, prompt: 'x' })).toMatchObject({ error: 'unavailable' });
    expect(await rt.create({ model: 'ollama:qwen3:8b', cwd: proj, prompt: '  ' })).toMatchObject({ error: 'invalid' });
    expect(await rt.create({ model: 'http://evil', cwd: proj, prompt: 'x' })).toMatchObject({ error: 'invalid' });
  });

  it('cancelar interrompe o turno em andamento', async () => {
    const llm = fakeOllama([], { hold: true });
    const { rt, office, proj } = setup(llm.fetchFn);
    const r = (await rt.create({ model: 'ollama:qwen3:8b', cwd: proj, prompt: 'demora' })) as { session: { agentId: string } };
    await until(() => llm.calls.length > 0);
    expect(office.get(r.session.agentId)?.status).toBe('working');
    expect(rt.cancel(r.session.agentId)).toBe(true);
    await until(() => office.get(r.session.agentId)?.status === 'idle');
    const a = office.get(r.session.agentId)!;
    expect(a.status).toBe('idle');
    expect(a.recent.at(-1)?.text).toContain('Interrompido');
  });

  it('mensagem nova continua a conversa e a sessão volta depois de reiniciar', async () => {
    const llm = fakeOllama([{ message: { content: 'primeira' } }, { message: { content: 'segunda' } }]);
    const { rt, office, proj, accounts, base } = setup(llm.fetchFn);
    const r = (await rt.create({ model: 'ollama:qwen3:8b', cwd: proj, prompt: 'oi' })) as { session: { agentId: string } };
    await until(() => rt.list()[0]?.state === 'idle');
    expect(rt.send(r.session.agentId, 'e agora?')).toEqual({ ok: true });
    await until(() => rt.list()[0]?.lastAnswer === 'segunda');
    await settle();
    expect(llm.calls[1]!.body.messages.map((m: { content: string }) => m.content)).toContain('primeira');
    expect(rt.list()[0]!.lastAnswer).toBe('segunda');
    // reinício: a mesma pasta de dados devolve a sessão, ociosa
    const office2 = new Office({ names: new NameStore(null), version: 'teste', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
    const rt2 = new LocalAgentRuntime({ accounts, office: office2, dataDir: join(base, 'data'), llm: { ollama: 'http://127.0.0.1:11434' }, fetch: llm.fetchFn });
    rt2.start();
    expect(office2.get(r.session.agentId)?.status).toBe('idle');
    expect(await rt2.end(r.session.agentId)).toBe(true);
    expect(rt2.list()).toEqual([]);
    void office;
  });

  it('só aceita backends no próprio computador e limpa o raciocínio', () => {
    expect(loopbackBase('http://127.0.0.1:11434/x')).toBe('http://127.0.0.1:11434');
    expect(loopbackBase('http://localhost:1234')).toBe('http://localhost:1234');
    expect(loopbackBase('http://10.0.0.5:11434')).toBeUndefined();
    expect(loopbackBase('http://user:pw@127.0.0.1:1')).toBeUndefined();
    expect(loopbackBase('file:///etc/passwd')).toBeUndefined();
    expect(stripThinking('<think>a\nb</think>\n ok')).toBe('ok');
  });
});

describe('contexto dos modelos locais', () => {
  it('omite resultados antigos de ferramenta antes de cortar a conversa', async () => {
    const { fitContext } = await import('./runtime');
    const msgs = [
      { role: 'system' as const, content: 'S' },
      { role: 'user' as const, content: 'primeira' },
      { role: 'assistant' as const, content: '', tool_calls: [{ id: '1', name: 'read_file', args: {} }] },
      { role: 'tool' as const, content: 'x'.repeat(5_000), tool_call_id: '1' },
      { role: 'assistant' as const, content: 'resposta 1' },
      { role: 'user' as const, content: 'segunda' },
    ];
    const out = fitContext(msgs, 1_000);
    expect(out[0]!.content).toBe('S');
    expect(out.at(-1)!.content).toBe('segunda');
    expect(out.find((m) => m.role === 'tool')?.content).toContain('omitido');
    expect(msgs[3]!.content).toHaveLength(5_000);
    // muito apertado: sobra o sistema e a pergunta atual
    expect(fitContext(msgs, 50).map((m) => m.content)).toEqual(['S', 'segunda']);
  });
});
