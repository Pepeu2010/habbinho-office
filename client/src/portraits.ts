// Registro de retratos dos agentes: a UI pede um retrato (ui/avatar.ts) e, se o mundo 3D registrou um provedor, recebe o
// busto do personagem 3D; sem provedor (mundo 2D) a UI usa o busto em pixel art. Fica fora de ui/ e de world3d/ para
// nenhum dos dois depender do outro.
import type { AppearanceParts } from '../../shared/appearance';

export interface PortraitRequest {
  seed: number;
  look?: 'f' | 'm';
  sub: boolean;
  parts?: AppearanceParts;
  /** Lado do retrato em px CSS. */
  px: number;
}

type Provider = (r: PortraitRequest) => string | null;

let provider: Provider | null = null;
const listeners = new Set<() => void>();

export function setPortraitProvider(p: Provider | null): void {
  provider = p;
  notifyPortraits();
}

/** Data URL do retrato, ou null (sem provedor ou ainda carregando). */
export function portrait(r: PortraitRequest): string | null {
  return provider?.(r) ?? null;
}

/** Avisa a UI que os retratos mudaram (provedor novo ou pronto). */
export function notifyPortraits(): void {
  listeners.forEach((cb) => cb());
}

export function onPortraits(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
