// Escolhas só do mundo 3D, por personagem: hoje, a identificação profissional que aparece na etiqueta. O visual do
// boneco vem da aparência do agente (a mesma do 2D, guardada pelo servidor; ver chibi.ts). Fica no navegador
// (localStorage), indexada pela semente do personagem — a mesma que o servidor guarda para o agente de cada projeto
// (server/model: setCharacter), então a escolha sobrevive a novas sessões do mesmo projeto.
import type { AgentInfo } from '../../../shared/types';

// v1 guardava também modelo Gobkit, cores do atlas e acessório: hoje só a identificação é lida dali
const KEY = 'habblaud.3d.looks.v1';
export const BADGE_MAX = 24;

export interface LookDraft {
  /** Identificação profissional (aparece na etiqueta). */
  badge?: string;
}

export interface Look extends LookDraft {
  /** Assinatura (muda quando qualquer escolha muda). */
  key: string;
}

const DEFAULT: Look = { key: 'default' };

export class LookStore {
  private data: Record<string, LookDraft> = {};
  private cache = new Map<string, Look>();
  private listeners = new Set<() => void>();

  constructor(private storage: Storage | null = safeStorage()) {
    try {
      const raw = this.storage?.getItem(KEY);
      if (raw) this.data = sanitize(JSON.parse(raw));
    } catch {
      this.data = {};
    }
  }

  static idOf(info: Pick<AgentInfo, 'seed'>): string {
    return `seed:${info.seed}`;
  }

  get(_id: string, info: Pick<AgentInfo, 'seed'>): Look {
    const k = LookStore.idOf(info);
    let l = this.cache.get(k);
    if (!l) {
      const s = this.data[k];
      l = s ? { ...s, key: JSON.stringify([s.badge ?? '']) } : DEFAULT;
      this.cache.set(k, l);
    }
    return l;
  }

  /** Guarda (validado como o que vem do armazenamento); null volta ao padrão. */
  set(info: Pick<AgentInfo, 'seed'>, look: LookDraft | null): void {
    const k = LookStore.idOf(info);
    const clean = look ? sanitize({ [k]: look })[k] : undefined;
    if (clean?.badge) this.data[k] = clean;
    else delete this.data[k];
    this.cache.delete(k);
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // armazenamento cheio ou bloqueado: a escolha vale só nesta página
    }
    this.listeners.forEach((cb) => cb());
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Validação do que veio do armazenamento (pode ter sido editado à mão). */
export function sanitize(raw: unknown): Record<string, LookDraft> {
  const out: Record<string, LookDraft> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^seed:-?\d{1,12}$/.test(k) || !v || typeof v !== 'object') continue;
    const s = v as { badge?: unknown };
    if (typeof s.badge !== 'string') continue;
    // texto livre, mas curto e sem caracteres de controle (vai para o DOM como textContent)
    const b = s.badge.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, BADGE_MAX);
    if (b) out[k] = { badge: b };
  }
  return out;
}
