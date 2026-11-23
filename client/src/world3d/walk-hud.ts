// Controles na tela do modo Passear: o que dá para fazer aqui ("E · Sentar"), atalhos e botões (1ª/3ª pessoa, outro
// visual, sair). Fica sobre o canvas do 3D, abaixo dos painéis da UI.
import { tr } from '../../../shared/i18n';
import type { BuildingView } from '../world/api';
import { NEXT_VIEW, type WalkView } from './walk';
import './walk.css';

export interface WalkHud {
  show(view: WalkView | null): void;
  prompt(text: string | null): void;
  /** Painel de andares do elevador. */
  floors(open: boolean): void;
  readonly floorsOpen: boolean;
  dispose(): void;
}

export function createWalkHud(parent: HTMLElement, on: { view(): void; exit(): void; editOwner(): void; interact(): void; floor(view: BuildingView): void }): WalkHud {
  const root = document.createElement('div');
  root.className = 'w3d-walk';
  root.hidden = true;
  const prompt = document.createElement('button');
  prompt.type = 'button';
  prompt.className = 'w3d-walk__prompt';
  prompt.hidden = true;
  prompt.addEventListener('click', on.interact);
  const bar = document.createElement('div');
  bar.className = 'w3d-walk__bar';
  const keys = document.createElement('p');
  keys.className = 'w3d-walk__keys';
  keys.textContent = tr('WASD ou clique para andar · Shift correr · arraste para olhar · E interagir · V câmera · Esc sair');
  const btn = (text: string, cb: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'w3d-walk__btn';
    b.textContent = text;
    b.addEventListener('click', cb);
    return b;
  };
  const viewBtn = btn('', on.view);
  // shortcut: mezanino e cobertura só trocam a vista (o boneco não anda lá), virar andares caminháveis se pedirem
  const floors = document.createElement('div');
  floors.className = 'w3d-walk__floors';
  floors.hidden = true;
  floors.setAttribute('role', 'group');
  floors.setAttribute('aria-label', tr('Andares'));
  floors.append(
    btn(tr('Térreo · escritório'), () => on.floor('office')),
    btn(tr('Mezanino'), () => on.floor('mezzanine')),
    btn(tr('Cobertura'), () => on.floor('roof')),
  );
  bar.append(keys, viewBtn, btn(tr('Editar meu personagem'), on.editOwner), btn(tr('Sair'), on.exit));
  root.append(floors, prompt, bar);
  parent.append(root);
  let last: string | null = '';
  return {
    show(view) {
      root.hidden = !view;
      if (!view) floors.hidden = true;
      const next = view ? NEXT_VIEW[view] : 'first';
      viewBtn.textContent = next === 'first' ? tr('Primeira pessoa') : next === 'above' ? tr('Vista de cima') : tr('Terceira pessoa');
    },
    prompt(text) {
      if (text === last) return;
      last = text;
      prompt.hidden = !text;
      prompt.textContent = text ? `E · ${text}` : '';
    },
    floors(open) {
      floors.hidden = !open;
      if (open) (floors.firstElementChild as HTMLElement).focus();
    },
    get floorsOpen() {
      return !floors.hidden;
    },
    dispose() {
      root.remove();
    },
  };
}
