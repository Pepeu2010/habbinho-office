// Agente local (botão na barra do topo): abre uma sessão com um modelo do Ollama ou do LM Studio rodando neste
// computador (POST /api/local-agents; server/local-agents). O agente entra na sala do projeto, só LÊ arquivos da pasta
// (não executa comandos nem edita) e recebe novas tarefas pela caixa de mensagem da gaveta, como os outros.
import { tr } from '../../../shared/i18n';
import type { UiContext } from './context';
import { h, iconButton, setText } from './dom';
import { ICONS } from './icons';
import { shortPath, spawnFolders } from './spawn';

export const LOCAL_PROMPT_MAX = 20_000;
const LAST_MODEL_KEY = 'habblaud.local.model';

interface LocalModel {
  id: string;
  backend: 'ollama' | 'lmstudio';
  name: string;
  loaded?: boolean;
  size?: number;
  params?: string;
}

interface ModelsResponse {
  models: LocalModel[];
  backends: Record<string, boolean>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new Error(tr('o Habbinho Office não respondeu'));
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? tr('erro {0}', [res.status]));
  return body;
}

/** Rótulo de um modelo na lista: nome, parâmetros, backend e se já está carregado. */
export function modelLabel(m: LocalModel): string {
  const bits = [m.params, m.backend === 'ollama' ? 'Ollama' : 'LM Studio', m.loaded ? tr('carregado') : ''].filter(Boolean);
  return `${m.name} · ${bits.join(' · ')}`;
}

export class LocalAgentPanel {
  readonly el: HTMLElement;
  private readonly model: HTMLSelectElement;
  private readonly folder: HTMLInputElement;
  private readonly folders: HTMLDataListElement;
  private readonly titleInput: HTMLInputElement;
  private readonly prompt: HTMLTextAreaElement;
  private readonly submitBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private anchor?: HTMLElement;
  private busy = false;

  constructor(private readonly ctx: UiContext) {
    this.model = h('select', { class: 'ui-rename__input ui-local__model', attrs: { id: 'ui-local-model', 'aria-label': tr('Modelo') } });
    this.folders = h('datalist', { attrs: { id: 'ui-local-folders' } });
    this.folder = h('input', {
      class: 'ui-rename__input',
      type: 'text',
      attrs: { id: 'ui-local-folder', list: 'ui-local-folders', placeholder: 'C:\\Users\\voce\\projeto', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none' },
    });
    this.titleInput = h('input', { class: 'ui-rename__input', type: 'text', attrs: { id: 'ui-local-title', maxlength: 80, placeholder: tr('Título (opcional)'), autocomplete: 'off' } });
    this.prompt = h('textarea', { class: 'ui-rename__input ui-spawn__prompt', attrs: { id: 'ui-local-prompt', rows: 5, maxlength: LOCAL_PROMPT_MAX, placeholder: tr('O que o agente deve investigar ou explicar') } });
    this.submitBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow ui-spawn__go', type: 'button', on: { click: () => void this.submit() } }, tr('Começar'));
    this.status = h('p', { class: 'ui-rename__hint ui-spawn__status', attrs: { role: 'status', 'aria-live': 'polite' } });
    for (const field of [this.folder, this.titleInput, this.prompt] as HTMLElement[]) {
      field.addEventListener('keydown', (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void this.submit();
        }
      });
      field.addEventListener('keyup', (e) => e.stopPropagation());
    }
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-spawn ui-local', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Agente local'), id: 'ui-local-agent', popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Agente local') }), close),
      h(
        'div',
        { class: 'ui-set-group ui-spawn__body' },
        h('label', { class: 'ui-spawn__label', attrs: { for: 'ui-local-model' }, text: tr('Modelo') }),
        this.model,
        h('label', { class: 'ui-spawn__label', attrs: { for: 'ui-local-folder' }, text: tr('Pasta do projeto') }),
        this.folder,
        this.folders,
        h('label', { class: 'ui-spawn__label', attrs: { for: 'ui-local-prompt' }, text: tr('Tarefa') }),
        this.titleInput,
        this.prompt,
        h('p', {
          class: 'ui-rename__hint',
          text: tr('Roda neste computador com o modelo escolhido (Ollama ou LM Studio). O agente só lê arquivos da pasta: não executa comandos, não edita e não acessa a internet. Novas tarefas vão pela caixa de mensagem; a conversa fica em ~/.habblaud/local-agents.'),
        }),
        this.submitBtn,
        this.status,
      ),
    );
    this.el.addEventListener('toggle', () => this.anchor?.setAttribute('aria-expanded', String(this.isOpen)));
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(anchor: HTMLElement): void {
    this.anchor = anchor;
    if (this.isOpen) return this.hide();
    this.folders.replaceChildren(...spawnFolders(this.ctx.store.snapshot).map((p) => h('option', { attrs: { value: p }, text: shortPath(p) })));
    if (!this.folder.value) this.folder.value = spawnFolders(this.ctx.store.snapshot)[0] ?? '';
    if (!this.busy) setText(this.status, '');
    void this.loadModels();
    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${Math.round(r.bottom + 8)}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    if (!matchMedia('(pointer: coarse)').matches) this.prompt.focus();
  }

  hide(): void {
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
  }

  private async loadModels(): Promise<void> {
    this.model.disabled = true;
    this.model.replaceChildren(h('option', { text: tr('Procurando modelos…') }));
    try {
      const r = await api<ModelsResponse>('/api/local-agents');
      const pref = readModelPref();
      this.model.replaceChildren(...r.models.map((m) => h('option', { attrs: { value: m.id }, text: modelLabel(m) })));
      if (!r.models.length) {
        this.model.append(h('option', { attrs: { value: '' }, text: tr('Nenhum modelo: abra o Ollama ou o LM Studio') }));
        this.say(tr('Nenhum modelo encontrado. Instale um no Ollama (ollama pull qwen3:8b) ou carregue um no LM Studio.'), true);
      } else {
        // preferência: a última escolha; senão um já carregado (responde mais rápido)
        const pick = r.models.find((m) => m.id === pref) ?? r.models.find((m) => m.loaded) ?? r.models[0]!;
        this.model.value = pick.id;
        this.model.disabled = false;
      }
    } catch (err) {
      this.model.replaceChildren(h('option', { attrs: { value: '' }, text: tr('Indisponível') }));
      this.say((err as Error).message, true);
    }
  }

  private say(text: string, error = false): void {
    setText(this.status, text);
    this.status.classList.toggle('is-error', error);
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const model = this.model.value;
    const cwd = this.folder.value.trim();
    const prompt = this.prompt.value;
    if (!model) return this.say(tr('Escolha um modelo.'), true);
    if (!cwd) return this.say(tr('Informe a pasta do projeto.'), true);
    if (!prompt.trim()) return this.say(tr('Escreva a tarefa.'), true);
    this.busy = true;
    this.submitBtn.disabled = true;
    this.say(tr('Abrindo…'));
    try {
      const s = await api<{ agentId: string; title: string }>('/api/local-agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, cwd, prompt, title: this.titleInput.value.trim() || undefined }),
      });
      writeModelPref(model);
      this.prompt.value = '';
      this.titleInput.value = '';
      this.say(tr('Agente local aberto: {0}', [s.title]));
      this.ctx.announce(tr('Agente local aberto: {0}', [s.title]));
      // quando o personagem chegar no snapshot, a gaveta abre nele
      const id = s.agentId;
      const t0 = Date.now();
      const tick = () => {
        if (this.ctx.agent(id)) {
          this.ctx.world.select({ type: 'agent', id }, { focus: true });
          this.hide();
        } else if (Date.now() - t0 < 8_000) setTimeout(tick, 250);
      };
      tick();
    } catch (err) {
      this.say((err as Error).message, true);
    } finally {
      this.busy = false;
      this.submitBtn.disabled = false;
    }
  }
}

function readModelPref(): string {
  try {
    return localStorage.getItem(LAST_MODEL_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeModelPref(id: string): void {
  try {
    localStorage.setItem(LAST_MODEL_KEY, id);
  } catch {
    // sem armazenamento: só não lembra
  }
}

/** Interromper/encerrar um agente local (botões da gaveta). */
export async function localAgentAction(agentId: string, action: 'cancel' | 'end'): Promise<void> {
  const path = `/api/local-agents/${encodeURIComponent(agentId)}${action === 'cancel' ? '/cancel' : ''}`;
  await api(path, { method: action === 'cancel' ? 'POST' : 'DELETE', headers: { 'content-type': 'application/json' } });
}

