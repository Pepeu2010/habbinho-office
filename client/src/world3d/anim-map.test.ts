import { describe, expect, it } from 'vitest';
import { clipForPose, resolveClip } from './anim-map';

const LIB = new Set(['Idle', 'Walk', 'Run', 'Sit', 'SitType', 'Talk', 'TalkSit', 'Cheer', 'Wave', 'Think']);
const has = (n: string) => LIB.has(n);

describe('clipForPose', () => {
  it('digitar sentado usa SitType', () => {
    expect(resolveClip(clipForPose('type', true, 'none', 0), has)).toBe('SitType');
  });
  it('conversar sentado usa TalkSit; em pé, um dos clipes de fala', () => {
    expect(resolveClip(clipForPose('talk', true, 'none', 0.2), has)).toBe('TalkSit');
    expect(resolveClip(clipForPose('talk', false, 'none', 0.0), has)).toBe('Talk');
  });
  it('cai para um clipe existente quando o preferido não está na biblioteca', () => {
    // 'Laugh' não existe aqui: usa Cheer
    expect(resolveClip(clipForPose('laugh', false, 'none', 0), has)).toBe('Cheer');
    // 'Watch' não existe: espera em pé fica em Idle
    expect(resolveClip(clipForPose('wait', false, 'none', 0), has)).toBe('Idle');
  });
  it('pedir atenção em pé acena', () => {
    expect(resolveClip(clipForPose('raise_hand', false, 'none', 0), has)).toBe('Wave');
  });
  it('nunca devolve vazio', () => {
    expect(resolveClip({ clips: ['Nada'], speed: 1, loop: true }, has)).toBe('Idle');
  });
});

describe('reações', () => {
  it('ícone da simulação vira reação; sentado ou andando não troca o clipe', async () => {
    const { reactionForIcon, reactionClip } = await import('./anim-map');
    expect(reactionForIcon('check')).toBe('celebrate');
    expect(reactionForIcon('sweat')).toBe('oops');
    expect(reactionForIcon('coffee')).toBeNull();
    expect(reactionClip('celebrate', false, 'stand')).toBe('Cheer');
    expect(reactionClip('celebrate', true, 'type')).toBeNull();
    expect(reactionClip('oops', false, 'walk')).toBeNull();
  });
});
