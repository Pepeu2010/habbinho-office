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
  it('descarta entradas inválidas e campos antigos do armazenamento', () => {
    const out = sanitize({ 'seed:12': { model: 'ceo', colors: { '17': '#AABBCC' }, badge: ' QA ' }, hack: { badge: 'x' }, 'seed:1': { model: 'x' } });
    expect(out).toEqual({ 'seed:12': { badge: 'QA' } });
  });

  it('guarda e relê a identificação pela semente, validada', () => {
    const mem = new MemStorage();
    new LookStore(mem as unknown as Storage).set({ seed: 42 }, { badge: '  Revisora\u0007 de código muito muito longa  ' });
    const b = new LookStore(mem as unknown as Storage);
    expect(b.get('x', { seed: 42 }).badge).toBe('Revisora de código muito');
    expect(b.get('y', { seed: 7 }).key).toBe('default');
  });

  it('restaurar padrão apaga a escolha', () => {
    const mem = new MemStorage();
    const a = new LookStore(mem as unknown as Storage);
    a.set({ seed: 1 }, { badge: 'Dev' });
    a.set({ seed: 1 }, null);
    expect(new LookStore(mem as unknown as Storage).get('x', { seed: 1 }).key).toBe('default');
  });
});
