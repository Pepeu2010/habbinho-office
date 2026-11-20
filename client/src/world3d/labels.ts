// Etiquetas sobre os personagens 3D (nome e balão de atividade), em DOM por cima do canvas. As regras de QUAL balão
// aparecer seguem as do mundo 2D (render/overlay.ts: bubbleFor), com os mesmos textos.
import * as THREE from 'three';
import type { WorldOptions } from '../world/api';
import { sayIcon, SHELL_BUBBLE_ICON, waitBubbleText } from '../world/render/overlay';
import type { Character } from '../world/sim/character';
import { shellBubbleText } from '../world/sim/shell';
import type { Sim } from '../world/sim/sim';
import type { AvatarView } from './characters';
import './labels.css';

const RECENT_MS = 4000;

interface Tag {
  el: HTMLDivElement;
  name: HTMLSpanElement;
  badge: HTMLSpanElement;
  badgeText: string;
  bubble: HTMLDivElement;
  text: string;
  nameText: string;
  tone: string;
}

export class Labels {
  readonly root: HTMLDivElement;
  private tags = new Map<string, Tag>();
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'w3d-labels';
    this.root.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.root);
  }

  update(sim: Sim, avatars: (id: string) => AvatarView | undefined, camera: THREE.Camera, w: number, h: number, now: number, opts: WorldOptions, selected: string | null, hovered: string | null): void {
    const seen = new Set<string>();
    for (const ch of sim.chars.values()) {
      const av = avatars(ch.id);
      if (!av || !av.visible) continue;
      this.v.copy(av.head).project(camera);
      if (this.v.z > 1 || this.v.z < -1) continue;
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      if (x < -80 || y < -40 || x > w + 80 || y > h + 40) continue;
      const bubble = bubbleFor(sim, ch, now, opts, ch.id === selected, ch.id === hovered);
      if (!opts.showNames && !bubble && ch.id !== selected && ch.id !== hovered) continue;
      seen.add(ch.id);
      let t = this.tags.get(ch.id);
      if (!t) t = this.make(ch.id);
      const nameText = ch.info.name;
      if (t.nameText !== nameText) {
        t.nameText = nameText;
        t.name.textContent = nameText;
      }
      t.name.hidden = !opts.showNames && ch.id !== selected && ch.id !== hovered;
      const badge = av.badge ?? '';
      if (badge !== t.badgeText) {
        t.badgeText = badge;
        t.badge.textContent = badge;
      }
      t.badge.hidden = !badge || t.name.hidden;
      const text = bubble ? `${bubble.icon} ${bubble.text}` : '';
      if (text !== t.text) {
        t.text = text;
        t.bubble.textContent = text;
        t.bubble.hidden = !text;
      }
      const tone = bubble?.tone ?? '';
      if (tone !== t.tone) {
        t.tone = tone;
        t.bubble.dataset.tone = tone;
      }
      t.bubble.style.opacity = bubble ? String(bubble.alpha) : '0';
      t.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      t.el.style.zIndex = String(Math.round((1 - this.v.z) * 10000));
      t.el.classList.toggle('is-selected', ch.id === selected);
      t.el.hidden = false;
    }
    for (const [id, t] of this.tags) {
      if (seen.has(id)) continue;
      if (!sim.chars.has(id)) {
        t.el.remove();
        this.tags.delete(id);
      } else t.el.hidden = true;
    }
  }

  private make(id: string): Tag {
    const el = document.createElement('div');
    el.className = 'w3d-tag';
    const bubble = document.createElement('div');
    bubble.className = 'w3d-bubble';
    bubble.hidden = true;
    const name = document.createElement('span');
    name.className = 'w3d-name';
    const badge = document.createElement('span');
    badge.className = 'w3d-badge';
    badge.hidden = true;
    el.append(bubble, name, badge);
    this.root.appendChild(el);
    const t: Tag = { el, name, badge, badgeText: '', bubble, text: '', nameText: '', tone: '' };
    this.tags.set(id, t);
    return t;
  }

  destroy(): void {
    this.root.remove();
    this.tags.clear();
  }
}

interface BubbleInfo {
  icon: string;
  text: string;
  tone: 'alert' | 'deliver' | 'say' | 'info' | 'shell';
  alpha: number;
}

/** Mesmas regras de render/overlay.ts (bubbleFor), sem o rateio de balões por sala. */
export function bubbleFor(sim: Pick<Sim, 'visit'>, ch: Character, now: number, opts: WorldOptions, selected: boolean, hovered: boolean): BubbleInfo | null {
  if (opts.bubbles === 'none') return null;
  if (ch.mode === 'wait') return { icon: '✋', text: waitBubbleText(ch.info.waitingFor), tone: 'alert', alpha: 1 };
  if (ch.bubbleText && now < ch.bubbleUntil) return { icon: ch.bubbleIcon, text: ch.bubbleText, tone: 'deliver', alpha: Math.min(1, (now - ch.bubbleAt) / 150, (ch.bubbleUntil - now) / 400) };
  if (ch.sayText && now < ch.sayUntil && !ch.leaving) return { icon: sayIcon(ch.sayText), text: ch.sayText, tone: 'say', alpha: Math.min(1, (now - ch.sayAt) / 120, (ch.sayUntil - now) / 300) };
  if (ch.mode === 'shell' && ch.shellSince > 0 && !ch.leaving && (selected || hovered || opts.bubbles === 'all')) {
    return { icon: SHELL_BUBBLE_ICON, text: sim.visit ? ch.shellLabel : shellBubbleText(ch.shellLabel, now - ch.shellSince), tone: 'shell', alpha: 1 };
  }
  const act = ch.info.activity;
  if (!act || ch.leaving) return null;
  const age = now - ch.activityChangedAt;
  if (selected || hovered || (opts.bubbles === 'all' && ch.mode === 'work')) return { icon: act.icon, text: act.text, tone: 'info', alpha: 1 };
  if (age < RECENT_MS && ch.activityChangedAt > 0) return { icon: act.icon, text: act.text, tone: 'info', alpha: Math.min(1, age / 150, (RECENT_MS - age) / 500) };
  return null;
}
