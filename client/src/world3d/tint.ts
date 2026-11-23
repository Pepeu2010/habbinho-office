// Personagem personalizado (dono e agentes editados) com a qualidade do elenco Blender: escolhe o boneco do elenco
// mais parecido com a aparência do editor (penteado e acessório) e repinta as cores de vértice dele com as cores da
// aparência. A paleta abaixo é a mesma de office-collection/characters.py (CAST); mudou lá, mude aqui.
import * as THREE from 'three';
import type { Appearance } from '../art/api';
import type { CollectionId } from './assets';

interface Cast { skin: string; cheek: string; hair: string; highlight: string; hairShape: string; upper: string; accent: string; lower: string; suit: boolean; item: string }

const CAST: Record<CollectionId, Cast> = {
  ceo: { skin: 'edb184', cheek: 'da896a', hair: '4b3027', highlight: '654435', hairShape: 'sweep', upper: '26464d', accent: 'd78b48', lower: '333a49', suit: true, item: 'glasses' },
  developer: { skin: 'ba7c59', cheek: 'a45646', hair: '222934', highlight: '384458', hairShape: 'curls', upper: '365568', accent: 'dba666', lower: '262e41', suit: false, item: 'headphones' },
  designer: { skin: 'edbc9d', cheek: 'd9887e', hair: 'ac5340', highlight: 'd27b5c', hairShape: 'bob', upper: '6a5182', accent: 'ffca72', lower: '4a3b52', suit: false, item: 'earrings' },
  'data-analyst': { skin: 'c99168', cheek: 'b06355', hair: '282732', highlight: '484457', hairShape: 'bun', upper: '5e837c', accent: 'd9bb83', lower: '2c4544', suit: false, item: 'round-glasses' },
  marketing: { skin: 'a9654c', cheek: 'a24b4d', hair: '342633', highlight: '604154', hairShape: 'pony', upper: 'c66c68', accent: 'ffe2b2', lower: '493346', suit: false, item: 'earrings' },
  hr: { skin: 'f0ba91', cheek: 'd99177', hair: '6b493b', highlight: '976851', hairShape: 'waves', upper: 'b28458', accent: 'e3b5a1', lower: '645358', suit: false, item: 'necklace' },
  support: { skin: 'e0a587', cheek: 'be7767', hair: '292831', highlight: '444153', hairShape: 'crop', upper: '4f5f92', accent: '9ed9cf', lower: '393c55', suit: false, item: 'headset' },
  finance: { skin: 'a5674e', cheek: '8e5147', hair: '2d282a', highlight: '534046', hairShape: 'locs', upper: '38595b', accent: 'c49465', lower: '373d47', suit: true, item: 'round-glasses' },
  sales: { skin: 'e4b088', cheek: 'ca8068', hair: '614031', highlight: '956247', hairShape: 'quiff', upper: '926576', accent: 'f4bc83', lower: '49435b', suit: false, item: 'pocket' },
  intern: { skin: 'cb916e', cheek: 'ba7464', hair: '69524a', highlight: '9c7761', hairShape: 'fringe', upper: '558982', accent: 'efd177', lower: '3b5962', suit: false, item: 'cap' },
};

/** Penteado do editor → formas de cabelo do elenco que lembram ele (a primeira é a mais parecida). */
const HAIR: Record<Appearance['hairStyle'], string[]> = {
  short: ['fringe', 'sweep'], buzz: ['crop'], spiky: ['quiff', 'crop'], side_part: ['sweep', 'quiff'], curly: ['curls', 'locs'],
  afro: ['curls', 'locs'], bob: ['bob', 'waves'], long: ['waves', 'bob'], ponytail: ['pony', 'bun'], bun: ['bun', 'pony'],
  pigtails: ['pony', 'bun'], mohawk: ['quiff', 'crop'], bald: ['crop'], wavy: ['waves', 'bob'],
};

/** Acessório do editor → acessórios do elenco equivalentes. */
const ITEM: Record<Appearance['accessory'], string[]> = {
  none: ['pocket', 'necklace'], glasses: ['glasses', 'round-glasses'], sunglasses: ['glasses', 'round-glasses'],
  headphones: ['headphones', 'headset'], cap: ['cap'], beanie: ['cap'], earrings: ['earrings'], bow: ['earrings', 'necklace'],
};

/** O que fica no rosto/cabeça e destoa se a aparência não tiver. */
const VISIBLE_ITEMS = new Set(['glasses', 'round-glasses', 'headphones', 'headset', 'cap']);

/** Boneco do elenco mais parecido com a aparência (penteado pesa mais que acessório). */
export function collectionForLook(ap: Appearance): CollectionId {
  let best: CollectionId = 'ceo';
  let score = -Infinity;
  for (const [id, c] of Object.entries(CAST) as [CollectionId, Cast][]) {
    const hair = HAIR[ap.hairStyle]?.indexOf(c.hairShape) ?? -1;
    const items = ITEM[ap.accessory] ?? [];
    let s = hair === 0 ? 4 : hair > 0 ? 2.5 : 0;
    if (items.includes(c.item)) s += 2;
    else if (VISIBLE_ITEMS.has(c.item)) s -= 2;
    if ((ap.topStyle === 'shirt_tie' || ap.topStyle === 'jacket') === c.suit) s += 0.5;
    if (s > score) { score = s; best = id; }
  }
  return best;
}

const lin = (hex: string) => new THREE.Color(hex.startsWith('#') ? hex : `#${hex}`);
const FOOT = /foot/i;

/**
 * Repinta as cores de vértice de um boneco do elenco (geometria já clonada) com as cores da aparência.
 * As cores originais ficam em userData para repintar de novo quando a aparência mudar.
 */
export function tintCollection(body: THREE.Object3D, id: CollectionId, ap: Appearance): void {
  const c = CAST[id];
  const skin = lin(ap.skin);
  const hair = lin(ap.hair);
  const map: [THREE.Color, THREE.Color][] = [
    [lin(c.skin), skin],
    [lin(c.cheek), skin.clone().lerp(lin('#d0645c'), 0.38)],
    [lin(c.hair), hair],
    [lin(c.highlight), hair.clone().lerp(new THREE.Color(1, 1, 1), 0.12)],
    [lin(c.upper), lin(ap.top)],
    [lin(c.accent), lin(ap.topAccent)],
    [lin(c.lower), lin(ap.bottom)],
    [lin('392729'), lin(ap.eyes)],
  ];
  const shoes = lin(ap.shoes);
  if (c.suit) map.push([lin('48342e'), shoes]);
  const upper = map[4]![0];
  const tmp = new THREE.Color();
  body.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    const col = mesh.isSkinnedMesh ? mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined : undefined;
    if (!col) return;
    const orig = (mesh.userData.tintFrom ??= Float32Array.from({ length: col.count * 3 }, (_, i) => col.getComponent(Math.floor(i / 3), i % 3))) as Float32Array;
    const idx = mesh.geometry.getAttribute('skinIndex');
    const wt = mesh.geometry.getAttribute('skinWeight');
    const bones = mesh.skeleton.bones;
    for (let i = 0; i < col.count; i++) {
      tmp.setRGB(orig[i * 3]!, orig[i * 3 + 1]!, orig[i * 3 + 2]!);
      let out: THREE.Color | null = null;
      for (const [from, to] of map) {
        if (near(from, tmp)) { out = to; break; }
      }
      // tênis do elenco usam a cor da roupa: o que é dessa cor e pesa no pé vira calçado
      if (out && !c.suit && near(upper, tmp) && idx && wt && FOOT.test(bones[idx.getX(i)]?.name ?? '') && wt.getX(i) > 0.5) out = shoes;
      if (out) col.setXYZ(i, out.r, out.g, out.b);
      else col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;
  });
}

function near(a: THREE.Color, b: THREE.Color): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.012;
}
