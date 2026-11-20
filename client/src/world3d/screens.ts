// O que aparece no monitor de cada mesa: segue a atividade REAL de quem está sentado ali (Activity do agente).
import type * as THREE from 'three';
import type { ActivityKind } from '../../../shared/types';
import type { Character } from '../world/sim/character';
import { screenMat, type ScreenMode } from './furniture';

export function screenModeOf(kind: ActivityKind | undefined, working: boolean): ScreenMode {
  if (!working) return 'off';
  switch (kind) {
    case 'edit':
    case 'write':
    case 'git':
      return 'code';
    case 'run':
    case 'test':
    case 'wait':
      return 'term';
    case 'read':
    case 'plan':
    case 'compact':
      return 'docs';
    case 'search':
    case 'web':
    case 'browser':
    case 'mcp':
      return 'web';
    case 'delegate':
    case 'skill':
      return 'chart';
    default:
      return 'chat';
  }
}

export function screenModeFor(ch: Character, accent?: string): THREE.Material {
  const working = ch.seated && (ch.mode === 'work' || ch.mode === 'shell' || ch.mode === 'wait');
  return screenMat(screenModeOf(ch.info.activity?.kind, working), accent);
}
