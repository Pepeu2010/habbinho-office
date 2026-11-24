import { tr } from '../../../shared/i18n';
import type { BuildingView, WorldApi } from '../world/api';
import { h, iconButton, setAttr } from './dom';
import { ICONS } from './icons';

const VIEWS = [
  { view: 'exterior', label: tr('Fachada'), hint: tr('Vista externa do prédio') },
  { view: 'office', label: tr('Escritório'), hint: tr('Andar dos agentes') },
  { view: 'mezzanine', label: tr('Mezanino'), hint: tr('Biblioteca e sala de reunião') },
  { view: 'roof', label: tr('Cobertura'), hint: tr('Terraço e jardim') },
] satisfies { view: BuildingView; label: string; hint: string }[];

type GalleryView = Exclude<BuildingView, 'office'>;
const MEDIA: Record<GalleryView, string> = {
  exterior: 'fachada',
  mezzanine: 'mezanino',
  roof: 'cobertura',
};

export class BuildingNavigator {
  readonly button: HTMLButtonElement;

  constructor(root: HTMLElement, world: WorldApi) {
    this.button = iconButton(ICONS.office, tr('Prédio do escritório'), () => activate(), 'ui-btn-building');
    this.button.setAttribute('aria-haspopup', 'dialog');
    const activate = world.setBuildingView
      ? this.createMenu(root, world)
      : this.createGallery(root);
    const requested = new URLSearchParams(location.search).get('building');
    if (!world.setBuildingView && (requested === 'exterior' || requested === 'mezzanine' || requested === 'roof')) {
      queueMicrotask(() => activate());
    }
  }

  private createMenu(root: HTMLElement, world: WorldApi): () => void {
    const panel = h('div', {
      class: 'ui-panel ui-building-nav',
      attrs: { id: 'ui-building-nav', popover: 'auto', role: 'dialog', 'aria-label': tr('Vistas do prédio') },
    });
    this.button.setAttribute('aria-controls', panel.id);
    this.button.setAttribute('aria-expanded', 'false');
    const rows = VIEWS.map(({ view, label, hint }) => {
      const button = h('button', {
        type: 'button', class: 'ui-building-nav__option',
        on: { click: () => { panel.hidePopover(); world.setBuildingView?.(view); } },
      }, h('span', { class: 'ui-building-nav__label', text: label }), h('span', { class: 'ui-building-nav__hint', text: hint }));
      return { view, button };
    });
    const sync = (active: BuildingView) => {
      for (const row of rows) setAttr(row.button, 'aria-pressed', String(row.view === active));
      setAttr(this.button, 'aria-pressed', String(active !== 'office'));
    };
    // andares do escritório: um botão por andar (só aparece com mais de um)
    const floors = h('div', { class: 'ui-building-nav__floors', role: 'group', attrs: { 'aria-label': tr('Andares') } });
    const syncFloors = () => {
      const info = world.getFloor?.();
      floors.hidden = !info || info.count < 2;
      if (!info || floors.hidden) return;
      floors.replaceChildren(...Array.from({ length: info.count }, (_, f) => {
        const b = h('button', {
          type: 'button', class: 'ui-building-nav__option', text: f ? tr('Andar {0}', [f]) : tr('Térreo'),
          on: { click: () => { panel.hidePopover(); world.setBuildingView?.('office'); world.setFloor?.(f); } },
        });
        setAttr(b, 'aria-pressed', String(f === info.floor && world.getBuildingView?.() === 'office'));
        return b;
      }));
    };
    world.onBuildingView?.((v) => { sync(v); syncFloors(); });
    world.onFloor?.(syncFloors);
    sync(world.getBuildingView?.() ?? 'office');
    panel.addEventListener('toggle', () => {
      setAttr(this.button, 'aria-expanded', String(panel.matches(':popover-open')));
    });
    panel.append(...rows.map(({ button }) => button), floors);
    root.append(panel);
    return () => {
      if (panel.matches(':popover-open')) {
        panel.hidePopover();
        return;
      }
      syncFloors();
      const rect = this.button.getBoundingClientRect();
      panel.style.top = `${rect.bottom + 8}px`;
      panel.style.right = `${Math.max(8, Math.min(innerWidth - rect.right, innerWidth - 254))}px`;
      panel.showPopover();
      rows.find(({ view }) => view === world.getBuildingView?.())?.button.focus();
    };
  }

  private createGallery(root: HTMLElement): () => void {
    const dialog = h('dialog', {
      class: 'ui-panel ui-building-gallery',
      attrs: { id: 'ui-building-gallery', 'aria-labelledby': 'ui-building-gallery-title' },
    });
    this.button.setAttribute('aria-controls', dialog.id);
    const close = iconButton(ICONS.close, tr('Fechar'), () => dialog.close());
    const title = h('h2', { attrs: { id: 'ui-building-gallery-title' }, text: tr('Prédio do escritório') });
    const image = h('img', { class: 'ui-building-gallery__image', attrs: { width: 1440, height: 900 } });
    const actions = h('div', { class: 'ui-building-gallery__actions', role: 'group', attrs: { 'aria-label': tr('Vistas do prédio') } });
    const options = VIEWS.filter(({ view }) => view !== 'office').map(({ view, label }) => ({
      view: view as GalleryView,
      label,
      button: h('button', { type: 'button', text: label, on: { click: () => select(view as GalleryView) } }),
    }));
    const select = (view: GalleryView) => {
      image.src = `/assets/3d/building/${MEDIA[view]}.webp`;
      image.alt = options.find((entry) => entry.view === view)?.label ?? '';
      for (const entry of options) setAttr(entry.button, 'aria-pressed', String(entry.view === view));
    };
    actions.append(...options.map(({ button }) => button));
    dialog.append(h('header', {}, title, close), actions, image,
      h('p', { class: 'ui-building-gallery__note', text: tr('Vista renderizada. A exploração interativa está disponível no modo 3D.') }));
    root.append(dialog);
    return () => {
      if (dialog.open) return;
      const requested = new URLSearchParams(location.search).get('building');
      select(requested === 'mezzanine' || requested === 'roof' ? requested : 'exterior');
      dialog.showModal();
    };
  }
}

