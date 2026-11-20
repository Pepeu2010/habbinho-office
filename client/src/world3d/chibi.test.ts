import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Appearance, HairStyle, TopStyle } from '../art/api';
import { BONE } from './assets';
import { chibiGeometry, measureRig } from './chibi';
import { expressionFor } from './characters';

/** Esqueleto sintético com as juntas do Gobkit em repouso (pose T), y para cima. */
function fakeRig() {
  const at: [number, number, number][] = [
    [0, 0, 0],
    [0, 3.29, 0],
    [1.4, 3.52, 0],
    [1.4, 1.09, 0],
    [-1.4, 3.52, 0],
    [-1.4, 1.09, 0],
    [0, 4.71, 0],
    [1.84, 4.89, 0],
    [5.27, 4.89, 0],
    [-1.84, 4.89, 0],
    [-5.27, 4.89, 0],
    [0, 5.4, 0.17],
    [0, 6.92, 0.43],
  ];
  const root = new THREE.Group();
  const names = at.map((_, i) => `b${i}`);
  at.forEach(([x, y, z], i) => {
    const b = new THREE.Bone();
    b.name = names[i]!;
    b.position.set(x, y, z);
    root.add(b);
  });
  return measureRig(root, names);
}

const HAIR: HairStyle[] = ['short', 'buzz', 'spiky', 'side_part', 'curly', 'afro', 'bob', 'long', 'ponytail', 'bun', 'pigtails', 'mohawk', 'bald', 'wavy'];
const TOPS: TopStyle[] = ['tshirt', 'hoodie', 'shirt_tie', 'sweater', 'jacket', 'blouse', 'polo'];

function look(i: number): Appearance {
  return {
    skin: '#e0ac69',
    hair: '#3b2a20',
    hairStyle: HAIR[i % HAIR.length]!,
    eyes: '#3a2b2b',
    top: '#4477cc',
    topAccent: '#ffffff',
    topStyle: TOPS[i % TOPS.length]!,
    bottom: '#223344',
    shoes: '#111111',
    accessory: (['none', 'glasses', 'sunglasses', 'headphones', 'cap', 'beanie', 'earrings', 'bow'] as const)[i % 8]!,
    accessoryColor: '#ff8800',
    lanyard: i % 3 ? null : '#22aa66',
    look: i % 2 ? 'f' : 'm',
    facialHair: (['none', 'stubble', 'beard', 'mustache', 'goatee'] as const)[i % 5],
    bottomStyle: (['pants', 'shorts', 'skirt'] as const)[i % 3],
  };
}

describe('Habbinho', () => {
  const rig = fakeRig();

  it('mede o esqueleto (unidade, cabeça e altura plausíveis)', () => {
    expect(rig.u).toBeCloseTo(1, 1);
    expect(rig.headC.y).toBeGreaterThan(7);
    expect(rig.height).toBeGreaterThan(8);
    expect(rig.height).toBeLessThan(11);
    // a mão visível fica abaixo do ombro (braço modelado mais baixo que a pose T)
    expect(rig.handR.length()).toBeGreaterThan(2);
  });

  it('gera malha válida para todos os penteados, roupas, acessórios e barbas', { timeout: 30_000 }, () => {
    // 14 combinações cobrem todos os penteados, roupas (i % 7), acessórios (i % 8), barbas e partes de baixo
    for (let i = 0; i < HAIR.length; i++) {
      const { body, face } = chibiGeometry(look(i), rig);
      const n = body.attributes.position!.count;
      expect(n).toBeGreaterThan(1000);
      expect(body.attributes.color!.count).toBe(n);
      const si = body.attributes.skinIndex!;
      const sw = body.attributes.skinWeight!;
      for (let v = 0; v < n; v += 7) {
        expect(si.getX(v)).toBeLessThan(13);
        expect(si.getY(v)).toBeLessThan(13);
        expect(sw.getX(v) + sw.getY(v)).toBeCloseTo(1, 5);
      }
      expect(face.attributes.skinIndex!.getX(0)).toBe(BONE.head);
    }
  });

  it('a mesma aparência reaproveita a geometria', () => {
    expect(chibiGeometry(look(3), rig).body).toBe(chibiGeometry(look(3), rig).body);
  });

  it('expressões seguem a pose e as reações', () => {
    expect(expressionFor('sleep', undefined)).toBe('sleep');
    expect(expressionFor('type', undefined)).toBe('focused');
    expect(expressionFor('stand', 'celebrate')).toBe('happy');
    expect(expressionFor('type', 'oops')).toBe('worried');
    expect(expressionFor('wait', undefined, 'wait')).toBe('worried');
    expect(expressionFor('walk', undefined)).toBe('neutral');
  });
});
