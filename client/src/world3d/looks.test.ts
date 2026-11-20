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
