import { NAME_MAX, parseCharacterName } from '../../../shared/appearance';
import { tr } from '../../../shared/i18n';
import { appearanceFromSeed } from '../art';
import { AppearanceFields } from '../ui/appearance-fields';
import { changedParts } from '../ui/character-model';
import { h } from '../ui/dom';
import type { CharacterAssets } from './assets';
import { createLookEditor } from './editor';
import type { WalkMode } from './walk';
import './owner-editor.css';

export function openOwnerEditor(walk: WalkMode, assets: CharacterAssets, onClose: () => void): HTMLDialogElement {
  let draft = walk.profile();
  const appearance = () => appearanceFromSeed(draft.seed, { look: draft.look, parts: draft.parts });
  const title = h('h2', { attrs: { id: 'owner-editor-title' }, text: tr('Dono do escritório') });
  const dialog = h('dialog', { class: 'ui-panel w3d-owner', attrs: { 'aria-labelledby': title.id } });
  const close = h('button', { class: 'ui-btn', type: 'button', text: tr('Cancelar'), on: { click: () => dialog.close() } });
  const name = h('input', { class: 'ui-char__name', type: 'text', attrs: { maxlength: NAME_MAX, placeholder: tr('Dono do escritório'), autofocus: true, autocomplete: 'off' } });
  name.value = draft.name;
  let preview: ReturnType<typeof createLookEditor> | undefined;
  try {
    preview = createLookEditor(assets, appearance());
  } catch {
    // O canvas de peças continua disponível se o navegador não puder abrir outro contexto WebGL.
  }
  const fields = new AppearanceFields((a) => preview?.preview?.(a));
  const redraw = () => {
    const a = appearance();
    fields.set(a);
    preview?.preview?.(a);
  };
  redraw();
  const roll = h('button', {
    class: 'ui-btn', type: 'button', text: tr('Sortear'),
    on: { click: () => {
      draft = { ...draft, seed: Math.floor(Math.random() * 1e9), look: draft.look === 'f' ? 'm' : 'f', parts: undefined };
      redraw();
    } },
  });
  const status = h('p', { class: 'w3d-owner__status', role: 'status' });
  const form = h('form', {},
    h('header', {}, title, h('p', { text: tr('Crie o personagem que você controla ao passear pelo escritório.') })),
    h('div', { class: 'w3d-owner__body' },
      h('div', { class: 'w3d-owner__preview' }, preview?.el ?? fields.preview, roll),
      h('div', { class: 'w3d-owner__fields' },
        h('label', { class: 'ui-char__label' }, h('span', { text: tr('Nome') }), name),
        fields.groups)),
    h('footer', {}, status, close, h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: tr('Salvar personagem') })));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const clean = name.value.trim() ? parseCharacterName(name.value) : '';
    if (clean === null) {
      status.textContent = tr('Escolha um nome válido.');
      name.focus();
      return;
    }
    const base = appearanceFromSeed(draft.seed, { look: draft.look });
    const parts = changedParts(base, fields.value ?? base);
    if (!walk.saveProfile({ ...draft, name: clean, parts })) {
      status.textContent = tr('Não foi possível salvar o personagem neste navegador.');
      return;
    }
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    preview?.dispose();
    dialog.remove();
    onClose();
  }, { once: true });
  dialog.append(form);
  (document.querySelector('.ui-root') ?? document.body).append(dialog);
  dialog.showModal();
  return dialog;
}
