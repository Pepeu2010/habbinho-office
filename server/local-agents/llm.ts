// Modelos locais: Ollama (/api/chat, /api/tags, /api/ps) e LM Studio (API compatível com OpenAI, /v1/*). Só
// endereços deste computador: uma URL configurada fora do loopback é recusada (nada de o servidor virar ponte
// para outra máquina). Nenhuma chave é usada nem guardada.
import { TOOL_SPECS } from './tools';

export type Backend = 'ollama' | 'lmstudio';

export interface LocalModel {
  /** `ollama:qwen3:8b` / `lmstudio:<id>`: o que a página escolhe. */
  id: string;
  backend: Backend;
  name: string;
  /** Carregado na memória agora (Ollama /api/ps; LM Studio state=loaded), quando o backend informa. */
  loaded?: boolean;
  /** Tamanho em bytes (Ollama). */
  size?: number;
  /** Parâmetros ("8.2B"), quando informado. */
  params?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  /** Resposta de ferramenta: id da chamada (OpenAI) e nome (Ollama). */
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  thinking?: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
}

export interface LlmConfig {
  ollama?: string;
  lmstudio?: string;
  /** Janela de contexto pedida ao Ollama (tokens). O padrão dele (4096) corta o começo da conversa. */
  ctx?: number;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** URL base aceita (http/https em loopback, sem credenciais nem caminho estranho) ou undefined. */
export function loopbackBase(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !LOOPBACK.has(u.hostname)) return undefined;
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

export function llmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    ollama: env.HABBLAUD_OLLAMA === '0' ? undefined : loopbackBase(env.HABBLAUD_OLLAMA_URL || 'http://127.0.0.1:11434'),
    lmstudio: env.HABBLAUD_LMSTUDIO === '0' ? undefined : loopbackBase(env.HABBLAUD_LMSTUDIO_URL || 'http://127.0.0.1:1234'),
    ctx: clampCtx(Number(env.HABBLAUD_LOCAL_CTX || 8192)),
  };
}

/** Contexto entre 2048 e 131072 tokens (padrão 8192: cabe numa GPU de 8 GB com um modelo de 8B). */
export function clampCtx(n: number): number {
  return Number.isFinite(n) ? Math.min(131_072, Math.max(2_048, Math.round(n))) : 8_192;
}

type Fetch = typeof fetch;

async function getJson(fetchFn: Fetch, url: string, ms = 2_500): Promise<unknown> {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Modelos instalados nos backends que respondem (um backend desligado só não aparece). */
export async function listModels(cfg: LlmConfig, fetchFn: Fetch = fetch): Promise<{ models: LocalModel[]; backends: Record<Backend, boolean> }> {
  const models: LocalModel[] = [];
  const backends: Record<Backend, boolean> = { ollama: false, lmstudio: false };
  const tasks: Promise<void>[] = [];
  if (cfg.ollama) {
    tasks.push(
      (async () => {
        const tags = (await getJson(fetchFn, `${cfg.ollama}/api/tags`)) as { models?: { name: string; size?: number; details?: { parameter_size?: string } }[] };
        let loaded = new Set<string>();
        try {
          const ps = (await getJson(fetchFn, `${cfg.ollama}/api/ps`)) as { models?: { name: string }[] };
          loaded = new Set((ps.models ?? []).map((m) => m.name));
        } catch {
          // /api/ps indisponível: segue sem saber quem está carregado
        }
        backends.ollama = true;
        for (const m of tags.models ?? []) {
          if (typeof m.name !== 'string') continue;
          models.push({ id: `ollama:${m.name}`, backend: 'ollama', name: m.name, loaded: loaded.has(m.name), size: m.size, params: m.details?.parameter_size });
        }
      })().catch(() => undefined),
    );
  }
  if (cfg.lmstudio) {
    tasks.push(
      (async () => {
        let list: { id: string; state?: string; type?: string }[] = [];
        try {
          list = ((await getJson(fetchFn, `${cfg.lmstudio}/api/v0/models`)) as { data?: typeof list }).data ?? [];
        } catch {
          list = ((await getJson(fetchFn, `${cfg.lmstudio}/v1/models`)) as { data?: typeof list }).data ?? [];
        }
        backends.lmstudio = true;
        for (const m of list) {
          if (typeof m.id !== 'string' || m.type === 'embeddings') continue;
          models.push({ id: `lmstudio:${m.id}`, backend: 'lmstudio', name: m.id, loaded: m.state ? m.state === 'loaded' : undefined });
        }
      })().catch(() => undefined),
    );
  }
  await Promise.all(tasks);
  return { models, backends };
}

/** `ollama:qwen3:8b` → backend e nome. */
export function parseModelId(id: string): { backend: Backend; name: string } | undefined {
  const i = id.indexOf(':');
  if (i < 0) return undefined;
  const backend = id.slice(0, i);
  const name = id.slice(i + 1);
  if ((backend !== 'ollama' && backend !== 'lmstudio') || !name || name.length > 200) return undefined;
  return { backend, name };
}

const OPENAI_TOOLS = TOOL_SPECS.map((t) => ({ type: 'function' as const, function: t }));

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Uma rodada de conversa com as ferramentas oferecidas. */
export async function chat(cfg: LlmConfig, modelId: string, messages: ChatMessage[], signal: AbortSignal, fetchFn: Fetch = fetch): Promise<ChatResult> {
  const m = parseModelId(modelId);
  if (!m) throw new Error('modelo inválido');
  const timeout = AbortSignal.timeout(10 * 60_000);
  const sig = AbortSignal.any([signal, timeout]);
  if (m.backend === 'ollama') {
    if (!cfg.ollama) throw new Error('Ollama desligado');
    const body = {
      model: m.name,
      stream: false,
      think: false,
      options: { num_ctx: cfg.ctx ?? 8_192 },
      tools: OPENAI_TOOLS,
      messages: messages.map((x) => ({
        role: x.role,
        content: x.content,
        ...(x.tool_calls ? { tool_calls: x.tool_calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}),
        ...(x.role === 'tool' && x.name ? { tool_name: x.name } : {}),
      })),
    };
    const r = await fetchFn(`${cfg.ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: sig });
    if (!r.ok) throw new Error(`Ollama respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { message?: { content?: string; thinking?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] }; prompt_eval_count?: number; eval_count?: number };
    const calls = (j.message?.tool_calls ?? []).map((c, i) => ({ id: `call_${Date.now().toString(36)}_${i}`, name: String(c.function?.name ?? ''), args: parseArgs(c.function?.arguments) }));
    return { content: j.message?.content ?? '', thinking: j.message?.thinking, toolCalls: calls.filter((c) => c.name), tokensIn: j.prompt_eval_count ?? 0, tokensOut: j.eval_count ?? 0 };
  }
  if (!cfg.lmstudio) throw new Error('LM Studio desligado');
  const body = {
    model: m.name,
    stream: false,
    tools: OPENAI_TOOLS,
    messages: messages.map((x) => ({
      role: x.role,
      content: x.content,
      ...(x.tool_calls ? { tool_calls: x.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
      ...(x.role === 'tool' ? { tool_call_id: x.tool_call_id } : {}),
    })),
  };
  const r = await fetchFn(`${cfg.lmstudio}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: sig });
  if (!r.ok) throw new Error(`LM Studio respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const msg = j.choices?.[0]?.message;
  const calls = (msg?.tool_calls ?? []).map((c, i) => ({ id: c.id ?? `call_${i}`, name: String(c.function?.name ?? ''), args: parseArgs(c.function?.arguments) }));
  return { content: msg?.content ?? '', toolCalls: calls.filter((c) => c.name), tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
}
