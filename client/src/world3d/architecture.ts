// A arquitetura envolve o andar da simulação. Os níveis de visita existem
// apenas no renderer e não criam salas, agentes ou andares no estado do jogo.
import * as THREE from 'three';
import { BUILDING_H, CORRIDOR_H, CORRIDOR_Y } from '../world/constants';
import type { BuildingView } from '../world/api';
import { block, mat, mergeStatic, plane, put, texMat } from './kit';
import { prop, type PropName } from './props';

const STOREY = 3.12;
const ROOF = STOREY * 4;
const D = BUILDING_H;
const PORTAL = CORRIDOR_Y + CORRIDOR_H / 2;
const STONE = '#e7d6b8';
const SAND = '#c6a577';
const FRAME = '#335a55';
const COPPER = '#be785e';
const GREEN = '#68846c';

interface Wing {
  x: number;
  z: number;
  w: number;
  d: number;
}

const darkGlass = ['#477377', '#608786', '#527e82'];

function place(group: THREE.Object3D, name: PropName, x: number, y: number, z: number, rotation: number, fit: { w?: number; h?: number; d?: number }): void {
  const obj = prop(name, fit);
  if (!obj) return;
  obj.position.set(x, y, z);
  obj.rotation.y = rotation;
  group.add(obj);
}

const miniBay = (total: number, index: number) => -total / 2 + index * 3.0;

/** Peça de metal a cada bordo, separada da espessura do vidro. */
function rim(g: THREE.Group, x: number, z: number, w: number, d: number, y: number, h: number, material: string | THREE.Material) {
  for (const s of [-1, 1]) {
    block(g, w, h, 0.16, material, x, y, z + s * d / 2, 0.027);
    block(g, 0.16, h, d - 0.24, material, x + s * w / 2, y, z, 0.027);
  }
}

function glassPartition(g: THREE.Group, x: number, z: number, width: number, y: number, turn = 0): void {
  const section = new THREE.Group();
  section.position.set(x, y, z);
  section.rotation.y = turn;
  g.add(section);
  block(section, width, 0.22, 0.14, STONE, 0, 0, 0, 0.021);
  // A parte alta deixa o interior legível de cima.
  block(section, width - 0.08, 1.49, 0.035,
    mat('#93bdb6', { opacity: 0.26, rough: 0.25 }), 0, 0.22, 0, 0.011).castShadow = false;
  block(section, width, 0.061, 0.10, FRAME, 0, 1.71, 0, 0.009);
  const n = Math.ceil(width / 2.1);
  for (let i = 0; i <= n; i++) block(section, 0.055, 1.53, 0.093, FRAME, width * (i / n - 0.5), 0.22, 0, 0.011);
}

export class Architecture3D {
  readonly root = new THREE.Group();
  private readonly threshold = new THREE.Group();
  private readonly podium = new THREE.Group();
  private readonly tower = new THREE.Group();
  private readonly mezzanine = new THREE.Group();
  private readonly terrace = new THREE.Group();
  private readonly warmGlass = new THREE.MeshStandardMaterial({
    color: '#92745d', emissive: '#ffc385', emissiveIntensity: 0, roughness: 0.33, metalness: 0.12,
  });
  private readonly entryGlow = new THREE.MeshStandardMaterial({
    color: '#e9dcb9', emissive: '#ffd196', emissiveIntensity: 0.3, roughness: 0.48,
  });
  private view: BuildingView = 'office';
  private width = 48;
  private wing: Wing = { x: 24, z: D / 2, w: 29, d: 20.8 };

  constructor() {
    this.root.name = 'Habblaud · prédio';
    this.threshold.name = 'Estrutura do escritório em corte';
    this.podium.name = 'Fachada · térreo';
    this.tower.name = 'Fachada · torre';
    this.mezzanine.name = 'Mezanino';
    this.terrace.name = 'Cobertura';
    this.root.add(this.threshold, this.podium, this.tower, this.mezzanine, this.terrace);
    this.setView('office');
  }

  setView(view: BuildingView): void {
    this.view = view;
    this.threshold.visible = view === 'office';
    this.podium.visible = view !== 'office';
    this.tower.visible = view === 'exterior' || view === 'roof';
    this.mezzanine.visible = view === 'mezzanine';
    this.terrace.visible = this.tower.visible;
  }

  setNight(night: number): void {
    this.warmGlass.emissiveIntensity = 0.06 + night * 0.98;
    this.entryGlow.emissiveIntensity = 0.25 + night * 0.9;
  }

  framing(view: Exclude<BuildingView, 'office'>) {
    const { x, z, w, d } = this.wing;
    if (view === 'mezzanine') return { target: new THREE.Vector3(x, STOREY + 0.4, z), w: w + 3, d: d + 2, pitch: 0.93, yaw: -0.58 };
    if (view === 'roof') return { target: new THREE.Vector3(x, ROOF + 0.9, z), w: w + 3, d: d + 2, pitch: 0.86, yaw: -0.58 };
    return { target: new THREE.Vector3(this.width / 2 - 1.4, 4.7, D / 2 + 0.8), w: this.width + 8, d: D + 13, pitch: 0.57, yaw: -0.55 };
  }

  build(width: number): void {
    this.clear();
    this.width = width;
    this.wing = { x: width * 0.515, z: D * 0.49, w: Math.min(38, width * 0.60), d: 21.9 };
    this.buildThreshold();
    this.buildPodium();
    this.buildTower();
    this.buildMezzanine();
    this.buildRoof();
    for (const group of this.root.children) mergeStatic(group, () => false);
    this.setView(this.view);
  }

  private buildThreshold(): void {
    const g = this.threshold;
    const w = this.width;
    for (const z of [0, D]) {
      block(g, w + 0.54, 0.22, 0.24, STONE, w / 2, -0.10, z, 0.047);
      block(g, w + 0.49, 0.036, 0.10, SAND, w / 2, 0.12, z, 0.011);
    }
    for (const [z, d] of [[(PORTAL - 2.7) / 2, PORTAL - 2.7], [(D + PORTAL + 2.7) / 2, D - PORTAL - 2.7]] as const) {
      for (const x of [0, w]) block(g, 0.22, 0.22, d, STONE, x, -0.10, z, 0.043);
    }
    this.portal(g);
  }

  private buildPodium(): void {
    const g = this.podium;
    const w = this.width;
    block(g, w + 0.58, 0.38, D + 0.58, '#9f9080', w / 2, -0.30, D / 2, 0.10);
    this.storey(g, { x: w / 2, z: D / 2, w, d: D }, 0.07, 2.77, 0, true);
    block(g, w + 0.84, 0.38, D + 0.87, STONE, w / 2, 2.78, D / 2, 0.08);
    block(g, w + 0.49, 0.10, D + 0.47, '#abab90', w / 2, 3.14, D / 2, 0.03);
    rim(g, w / 2, D / 2, w + 0.24, D + 0.24, 3.24, 0.35, STONE);
    this.portal(g);
    this.podiumGardens(g);
    // Entrada de apresentação na fachada voltada à rua.
    const x = this.wing.x - this.wing.w * 0.26;
    block(g, 7.4, 0.31, 1.75, STONE, x, 2.17, D + 0.72, 0.13);
    block(g, 7.62, 0.12, 1.86, COPPER, x, 2.465, D + 0.77, 0.038);
    for (let i = -3; i <= 3; i++) {
      block(g, 0.42, 0.098, 1.86, '#e5b68e', x + i * 0.91, 2.497, D + 0.77, 0.028);
    }
    for (const side of [-1, 1]) block(g, 0.20, 2.19, 0.22, FRAME, x + side * 3.38, 0, D + 1.27, 0.04);
    block(g, 6.74, 0.035, 0.18, this.entryGlow, x, 2.116, D + 0.80, 0.012);
    put(g, plane(6.74, 0.58), this.brand(), x, 2.46, D + 0.30, { shadow: false });
  }

  private podiumGardens(g: THREE.Group): void {
    const { x, w } = this.wing;
    const terraces = [[1.5, x - w * 0.5 - 1.7], [x + w * 0.5 + 1.7, this.width - 1.5]] as const;
    for (const [start, end] of terraces) {
      if (end - start < 2.5) continue;
      const center = (start + end) / 2;
      const span = end - start;
      // Dois canteiros extensivos ficam separados por uma passagem de serviço.
      for (const z of [6.1, D - 6.1]) {
        block(g, span, 0.12, 7.5, '#aaa08a', center, 3.246, z, 0.042);
        block(g, span - 0.27, 0.057, 7.19, '#66816b', center, 3.362, z, 0.038);
        for (let i = 0; i < Math.floor(span / 2); i++) {
          place(g, 'craftedGardenPlanter', start + 0.93 + i * 1.96, 3.41, z + (i % 2 === 0 ? 2.05 : -2.05),
            i % 2 === 0 ? 0 : Math.PI, { w: 1.64, h: 0.63, d: 0.63 });
        }
      }
      for (let i = 0; i < 5; i++) block(g, span * 0.85, 0.035, 0.93, i % 2 ? '#989a8b' : '#a5a494', center, 3.252, D / 2 + (i - 2) * 0.95, 0.015);
    }
  }

  private portal(g: THREE.Group): void {
    // Vestíbulo envidraçado, sob a marquise, alinhado ao corredor caminhável.
    block(g, 3.64, 0.20, 6.12, STONE, -1.48, 2.59, PORTAL, 0.055);
    block(g, 3.72, 0.055, 6.20, FRAME, -1.48, 2.79, PORTAL, 0.022);
    for (const s of [-1, 1]) {
      block(g, 0.25, 2.54, 0.22, FRAME, -2.86, 0.045, PORTAL + s * 2.70, 0.037);
      block(g, 0.44, 0.10, 0.44, STONE, -2.86, -0.013, PORTAL + s * 2.70, 0.027);
      block(g, 2.62, 0.026, 0.046, this.entryGlow, -1.52, 2.56, PORTAL + s * 1.90, 0.005);
    }
    const sign = this.brand();
    put(g, plane(4.94, 0.52), sign, -3.365, 2.21, PORTAL, { ry: -Math.PI / 2, shadow: false });
    put(g, plane(3.57, 0.40), sign, -1.48, 2.60, PORTAL + 3.115, { shadow: false });
  }

  private brand(): THREE.MeshStandardMaterial {
    return texMat('arquitetura:habblaud:marquise', 640, 144, (c, w, h) => {
      c.fillStyle = '#263b45';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#f5ecdb';
      c.font = '700 81px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('HABBLAUD', w / 2, h / 2 + 2, w - 84);
    }, 0.24);
  }

  private storey(root: THREE.Group, wing: Wing, base: number, height: number, index: number, lobby = false): void {
    const { x, z, w, d } = wing;
    const sides = [
      { length: w, x, z: z + d / 2, angle: 0 },
      { length: w, x, z: z - d / 2, angle: Math.PI },
      { length: d, x: x + w / 2, z, angle: Math.PI / 2 },
      { length: d, x: x - w / 2, z, angle: -Math.PI / 2 },
    ];
    sides.forEach(({ length, x, z, angle }, side) => {
      const count = Math.ceil(length / (lobby ? 3.08 : 3.42));
      const cell = length / count;
      const g = new THREE.Group();
      g.position.set(x, base, z);
      g.rotation.y = angle;
      root.add(g);
      block(g, length + 0.04, 0.31, 0.30, lobby ? SAND : STONE, 0, 0, 0, 0.041);
      block(g, length + 0.08, 0.18, 0.32, STONE, 0, height - 0.18, 0.021, 0.035);
      for (let i = 0; i < count; i++) {
        const pos = -length / 2 + (i + 0.5) * cell;
        // Na face oeste do térreo, a abertura acompanha o eixo da marquise.
        if (lobby && side === 3 && Math.abs(pos) < 2.63) continue;
        const tone = (i * 13 + side * 7 + index * 3) % 11;
        const glass = tone < 3 ? this.warmGlass : mat(darkGlass[tone % darkGlass.length]!, { rough: 0.28, metal: 0.12 });
        block(g, cell - 0.12, height - 0.43, 0.15, glass, pos, 0.27, 0.013, 0.046);
        block(g, 0.054, height - 0.52, 0.069, FRAME, pos, 0.30, 0.107, 0.008);
        block(g, cell - 0.11, 0.049, 0.069, FRAME, pos, 0.79, 0.109, 0.008);
        const accent = mat('#6d8b91', { rough: 0.39 });
        block(g, cell * 0.41, 0.029, 0.023, accent, pos - cell * 0.24, height - 0.45, 0.10, 0.003).castShadow = false;
      }
      for (let i = 0; i <= count; i++) {
        const pos = -length / 2 + i * cell;
        if (lobby && side === 3 && Math.abs(pos) < 2.42) continue;
        const pilaster = i === 0 || i === count || (i % 4 === 0 && !lobby);
        block(g, pilaster ? 0.25 : 0.10, height, pilaster ? 0.41 : 0.20,
          pilaster ? (lobby ? STONE : SAND) : FRAME, pos, 0, 0.09, 0.026);
      }
    });
  }

  private buildTower(): void {
    const { x, z, w, d } = this.wing;
    for (let floor = 1; floor < 4; floor++) {
      const waist = floor === 3 ? 0.86 : 1;
      const wing = { ...this.wing, w: w * waist, d: d * waist };
      this.storey(this.tower, wing, floor * STOREY + 0.10, STOREY - 0.18, floor);
      block(this.tower, wing.w + 0.48, 0.205, wing.d + 0.48, floor % 2 ? '#d9cdb8' : '#cbb89b', x, floor * STOREY - 0.035, z, 0.052);
    }
    // Núcleo vertical em cobre no canto iluminado. A profundidade revela os andares de perfil.
    block(this.tower, 1.34, ROOF - STOREY + 0.10, d * 0.88, '#9c7455', x - w / 2 + 0.65, STOREY, z, 0.11);
    for (const s of [-1, 1]) {
      block(this.tower, 0.076, ROOF - STOREY - 0.089, 0.055, COPPER, x - w / 2 + 0.7, STOREY + 0.16, z + s * d * 0.442, 0.007);
    }
    block(this.tower, w * 0.86 + 0.61, 0.23, d * 0.86 + 0.61, STONE, x, ROOF - 0.11, z, 0.07);
  }

  private buildMezzanine(): void {
    const g = this.mezzanine;
    const { x, z, w, d } = this.wing;
    const y = STOREY + 0.14;
    const floor = texMat('arquitetura:mezanino:carvalho', 320, 320, (c, cw, ch) => {
      c.fillStyle = '#cba97e';
      c.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 12; i++) {
        c.fillStyle = ['#d8b78d', '#c9a37b', '#d3af83'][i % 3]!;
        c.fillRect(0, (i / 12) * ch, cw, ch / 12 - 1);
        c.fillStyle = '#aa8765';
        c.fillRect((i * 77) % cw, (i / 12) * ch, 1.2, ch / 12);
      }
    });
    const deck = put(g, plane(w, d), floor, x, y, z, { rx: -Math.PI / 2, shadow: false });
    deck.position.y = y;
    if (floor.map) {
      floor.map.wrapS = floor.map.wrapT = THREE.RepeatWrapping;
      floor.map.repeat.set(4, 2.5);
      floor.map.needsUpdate = true;
    }
    rim(g, x, z, w, d, y, 0.51, STONE);
    for (const s of [-1, 1]) {
      const cx = x + s * w * 0.245;
      block(g, w * 0.42, 0.026, d * 0.56, s < 0 ? '#708a79' : '#af8b63', cx, y + 0.006, z, 0.08);
    }
    // Lounge, estantes e mesas de convivência modeladas com os objetos da coleção.
    place(g, 'craftedSofa', x - w * 0.29, y + 0.03, z + 2.5, -Math.PI / 2, { w: 4.2, h: 1.17, d: 1.25 });
    place(g, 'craftedSofa', x - w * 0.14, y + 0.03, z - 3.6, Math.PI / 2, { w: 4.2, h: 1.17, d: 1.25 });
    block(g, 2.37, 0.56, 1.62, STONE, x - w * 0.22, y + 0.018, z, 0.18);
    place(g, 'craftedBooks', x - w * 0.23, y + 0.59, z, -0.24, { h: 0.35 });
    for (let i = 0; i < 3; i++) {
      const bx = x - w * 0.42 + i * w * 0.13;
      place(g, 'craftedBookcase', bx, y, z - d * 0.37, 0, { w: 2.3, h: 2.48, d: 0.58 });
    }
    const meetX = x + w * 0.23;
    glassPartition(g, meetX, z + 4.65, w * 0.38, y);
    glassPartition(g, x + w * 0.398, z - 0.11, 9.48, y, Math.PI / 2);
    block(g, 5.72, 0.96, 1.80, '#b58660', meetX, y + 0.03, z + 0.4, 0.22);
    block(g, 4.93, 0.025, 0.47, GREEN, meetX, y + 0.99, z + 0.4, 0.033);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) place(g, 'craftedChair', meetX + (i - 1.5) * 1.24, y, z + 0.4 + s * 1.58, s > 0 ? Math.PI : 0, { h: 0.91 });
    }
    block(g, 3.45, 0.09, 1.31, '#d7c4a0', meetX, y + 0.82, z - d * 0.32, 0.028);
    block(g, 3.45, 1.62, 0.13, STONE, meetX, y, z - d * 0.32, 0.063);
    block(g, 2.95, 1.21, 0.08, FRAME, meetX, y + 0.25, z - d * 0.32 + 0.085, 0.023);
    block(g, 2.81, 1.08, 0.037, '#728d93', meetX, y + 0.33, z - d * 0.32 + 0.13, 0.014);
    for (let i = 0; i < 4; i++) {
      block(g, 0.31, 0.21 + i * 0.13, 0.042, i % 2 ? '#c29b65' : '#afd0bc',
        meetX + (i - 1.5) * 0.42, y + 0.43, z - d * 0.32 + 0.155, 0.006);
    }
    for (const offset of [-1.8, 1.8]) {
      place(g, 'craftedDesk', x - w * 0.23 + offset, y, z + d * 0.255, Math.PI, { w: 1.44, h: 0.93, d: .84 });
      place(g, 'craftedChair', x - w * 0.23 + offset, y, z + d * 0.255 + 0.90, Math.PI, { h: .90 });
      place(g, 'craftedNotebook', x - w * 0.23 + offset, y + .94, z + d * .255, 0, { w: .47 });
    }
    place(g, 'craftedCabinet', meetX + 2.65, y, z - d * 0.34, 0, { w: 2.8, h: 1.12, d: 0.82 });
    place(g, 'craftedCoffee', meetX + 3.18, y + 1.13, z - d * 0.34, 0, { h: 0.78 });
    place(g, 'craftedService', meetX + 1.92, y + 1.13, z - d * 0.34, 0, { w: 0.82 });
    for (const s of [-1, 1]) {
      place(g, 'craftedGardenPlanter', x + s * w * 0.413, y, z + d * 0.36, 0, { w: 2.88, h: 1.07, d: 1.08 });
      place(g, 'craftedGardenPlanter', x + s * 1.25, y + 0.01, z + d * 0.36, Math.PI / 2, { w: 2.65, h: 0.89, d: 0.87 });
    }
  }

  private buildRoof(): void {
    const g = this.terrace;
    const { x, z, w, d } = this.wing;
    const width = w * 0.86;
    const depth = d * 0.86;
    const y = ROOF + 0.12;
    block(g, width, 0.12, depth, '#968e80', x, y - 0.11, z, 0.043);
    rim(g, x, z, width + 0.06, depth + 0.06, y, 0.68, STONE);
    const deckW = width * 0.66;
    const deckD = depth * 0.66;
    for (let row = 0; row < 18; row++) {
      const dz = deckD / 18;
      block(g, deckW, 0.059, dz - 0.025, row % 4 === 0 ? '#b98c63' : '#c09a72', x + 0.7, y + 0.011, z + (row - 8.5) * dz, 0.021);
    }
    // Pergolado com duas áreas, lounge e mesa, e abrigo de equipamentos ao fundo.
    const p = { x: x + width * 0.14, z: z - depth * 0.06, w: width * 0.47, d: depth * 0.56 };
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) block(g, 0.16, 2.04, 0.16, FRAME, p.x + sx * (p.w / 2), y, p.z + sz * (p.d / 2), 0.028);
      block(g, p.w + 0.31, 0.17, 0.16, FRAME, p.x, y + 1.97, p.z + sx * p.d / 2, 0.026);
    }
    for (let i = 0; i < 12; i++) {
      block(g, 0.105, 0.129, p.d + 0.45, COPPER, p.x + ((i / 11) - 0.5) * p.w, y + 2.11, p.z, 0.021);
    }
    place(g, 'craftedSofa', p.x - p.w * 0.25, y + 0.074, p.z, -Math.PI / 2, { w: 3.77, h: 1.12, d: 1.16 });
    place(g, 'craftedSofa', p.x + p.w * 0.25, y + 0.074, p.z, Math.PI / 2, { w: 3.77, h: 1.12, d: 1.16 });
    block(g, 2.17, 0.53, 1.50, STONE, p.x, y + 0.072, p.z, 0.166);
    place(g, 'craftedService', p.x, y + 0.603, p.z, 0.25, { w: 0.95 });
    const coreX = x - width * 0.31;
    block(g, width * 0.28, 2.39, depth * 0.26, FRAME, coreX, y, z - depth * 0.27, 0.15);
    block(g, width * 0.29, 0.138, depth * 0.27, SAND, coreX, y + 2.37, z - depth * 0.27, 0.055);
    for (let i = 0; i < 5; i++) {
      const span = width * 0.28;
      block(g, span - 0.52, 0.065, 0.053, '#577078', coreX, y + 0.76 + i * 0.23, z - depth * 0.139, 0.009);
    }
    for (let i = 0; i < 5; i++) {
      const bx = x + miniBay(12, i);
      place(g, 'craftedGardenPlanter', bx, y + 0.03, z + depth * 0.41, 0, { w: 2.46, h: 1.01, d: 0.91 });
      if (i % 2 === 0) place(g, 'craftedGardenLamp', bx, y + 0.022, z + depth * 0.335, 0, { h: 1.34 });
    }
    place(g, 'craftedGardenBench', x - width * 0.28, y + 0.075, z + depth * 0.24, Math.PI / 2, { w: 2.42, h: 1.06, d: 0.8 });
  }

  private clear(): void {
    for (const group of this.root.children) {
      group.traverse((o) => {
        if (o.userData.merged) (o as THREE.Mesh).geometry.dispose();
      });
      group.clear();
    }
  }

  dispose(): void {
    this.clear();
    this.warmGlass.dispose();
    this.entryGlow.dispose();
  }
}

