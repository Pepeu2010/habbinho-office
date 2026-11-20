import { describe, expect, it } from 'vitest';
import { LookStore, sanitize } from './looks';

class MemStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('looks', () => {
  it('descarta entradas inválidas do armazenamento', () => {
    const out = sanitize({ 'seed:12': { model: 'ceo', colors: { '17': '#AABBCC', '999': '#000000', '3': 'red' } }, hack: { model: 'x' }, 'seed:1': { model: '../../x' } });
    expect(out).toEqual({ 'seed:12': { model: 'ceo', colors: { '17': '#aabbcc' } }, 'seed:1': {} });
  });

  it('guarda e relê a aparência pela semente', () => {
    const mem = new MemStorage();
    const a = new LookStore(mem as unknown as Storage);
    a.set({ seed: 42 }, { model: 'intern', colors: { 5: '#112233' } });
    const b = new LookStore(mem as unknown as Storage);
    const l = b.get('x', { seed: 42 });
    expect(l.model).toBe('intern');
    expect(l.colors).toEqual({ 5: '#112233' });
    expect(b.get('y', { seed: 7 }).key).toBe('default');
  });

  it('restaurar padrão apaga a escolha', () => {
    const mem = new MemStorage();
    const a = new LookStore(mem as unknown as Storage);
    a.set({ seed: 1 }, { model: 'ceo', colors: {} });
    a.set({ seed: 1 }, null);
    expect(new LookStore(mem as unknown as Storage).get('x', { seed: 1 }).key).toBe('default');
  });
});

describe('regiões do atlas', () => {
  it('reconhece pele e separa por altura', async () => {
    const { regionKind, isSkinTone } = await import('./looks');
    expect(isSkinTone('#f1c27d')).toBe(true);
    expect(isSkinTone('#8d5524')).toBe(true);
    expect(isSkinTone('#3366cc')).toBe(false);
    expect(regionKind({ height: 0.85, color: '#2b1d14', weight: 0.2 })).toBe('hair');
    expect(regionKind({ height: 0.8, color: '#f1c27d', weight: 0.2 })).toBe('skin');
    expect(regionKind({ height: 0.5, color: '#3366cc', weight: 0.2 })).toBe('top');
    expect(regionKind({ height: 0.2, color: '#222222', weight: 0.1 })).toBe('bottom');
    expect(regionKind({ height: 0.03, color: '#111111', weight: 0.05 })).toBe('shoes');
    // a mesma cor no cabelo (maioria) e nos sapatos: a média cai no tronco, a faixa dominante diz cabelo
    expect(regionKind({ height: 0.5, color: '#361b1b', weight: 0.2, bands: [0.3, 0, 0, 0.7] })).toBe('hair');
  });

  it('guarda acessório, cor e identificação validados', () => {
    const mem = new MemStorage();
    const a = new LookStore(mem as unknown as Storage);
    a.set({ seed: 3 }, { colors: {}, accessory: 'glasses', accessoryColor: '#FFAA00', badge: '  Revisora\u0007 de código muito muito longa  ' });
    const l = new LookStore(mem as unknown as Storage).get('x', { seed: 3 });
    expect(l.accessory).toBe('glasses');
    expect(l.accessoryColor).toBe('#ffaa00');
    expect(l.badge).toBe('Revisora de código muito');
    expect(sanitize({ 'seed:1': { accessory: 'jetpack' } })).toEqual({ 'seed:1': {} });
  });
});
