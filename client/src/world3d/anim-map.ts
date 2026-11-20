// Tradução do estado da simulação (pose, sentado, item na mão) para clipes da biblioteca Gobkit. Puro e testável:
// a simulação continua sendo a dona do comportamento; aqui só se escolhe a animação que o representa.
import type { HeldItem, Pose } from '../art/api';

export interface ClipChoice {
  /** Clipes em ordem de preferência (o primeiro que existir na biblioteca é usado). */
  clips: readonly string[];
  /** Fator de velocidade da animação. */
  speed: number;
  /** Repetir (false = toca uma vez e segura o último quadro). */
  loop: boolean;
}

const C = (clips: readonly string[], speed = 1, loop = true): ClipChoice => ({ clips, speed, loop });

/**
 * Clipe para uma pose. `variant` (0..1, estável por personagem e por mudança de pose) escolhe entre alternativas
 * equivalentes, para dois colegas conversando não gesticularem em sincronia.
 */
export function clipForPose(pose: Pose, seated: boolean, held: HeldItem, variant: number): ClipChoice {
  const alt = <T,>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(variant * list.length))]!;
  switch (pose) {
    case 'walk':
      return C(held === 'phone' ? ['WalkCall', 'Walk'] : ['Walk'], 1);
    case 'run':
      return C(['Run', 'Walk'], 1);
    case 'type':
      return C(['SitType', 'Sit'], 1);
    case 'sit':
      return seated ? C(held === 'phone' ? ['SitCall', 'Sit'] : held === 'papers' ? ['SitCalc', 'Sit'] : ['Sit']) : C(['Idle']);
    case 'sleep':
      return C(seated ? ['Sit'] : ['Idle'], 0.45);
    case 'wait':
      return C(seated ? ['Sit'] : ['Watch', 'Idle'], 0.8);
    case 'talk':
      return seated ? C(['TalkSit', 'Sit']) : C([alt(['Talk', 'TalkAsk', 'TalkExcited', 'Explain']), 'Talk', 'Idle']);
    case 'raise_hand':
      return seated ? C(['TalkSit', 'Sit']) : C(['Wave', 'Point', 'Idle']);
    case 'cheer':
      return seated ? C(['TalkSit', 'Sit'], 1.4) : C(['Cheer', 'Wave', 'Idle']);
    case 'laugh':
      return seated ? C(['TalkSit', 'Sit'], 1.6) : C(['Laugh', 'Cheer', 'Idle']);
    case 'sulk':
      return seated ? C(['Sit'], 0.6) : C(['Shake', 'Shrug', 'Idle'], 0.8);
    case 'stretch':
      return C(seated ? ['Sit'] : ['Cheer', 'Idle'], 0.5);
    case 'read':
      if (held === 'phone') return seated ? C(['SitCall', 'Sit']) : C(['Text', 'Call', 'Think', 'Idle']);
      return seated ? C(['SitCalc', 'Sit']) : C(['Calculate', 'Think', 'Idle']);
    case 'drink':
      return C(seated ? ['Sit'] : ['Think', 'Idle']);
    case 'use':
      return C(seated ? ['SitType', 'Sit'] : ['Type', 'Point', 'Idle']);
    case 'game':
      return C(seated ? ['SitType', 'Sit'] : ['Type', 'Idle'], 1.3);
    case 'play':
      return C(['Attack', 'Point', 'Idle'], 1.2);
    case 'rps':
      return C(held === 'none' ? ['Nod', 'Idle'] : ['Point', 'Idle'], 1.2);
    case 'groom':
      return C(['Scratch', 'Think', 'Idle']);
    case 'stand':
    default:
      return C(seated ? ['Sit'] : ['Idle']);
  }
}

/** Primeiro clipe da lista que existe na biblioteca (ou 'Idle'). */
export function resolveClip(choice: ClipChoice, has: (name: string) => boolean): string {
  for (const c of choice.clips) if (has(c)) return c;
  return 'Idle';
}
