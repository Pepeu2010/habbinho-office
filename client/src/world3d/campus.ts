import * as THREE from 'three';
import { BUILDING_H, CORRIDOR_H, CORRIDOR_Y } from '../world/constants';
import type { TileRect } from '../world/layout/types';
import { block, cyl, mat, put, sphere, texMat } from './kit';
import { prop } from './props';

interface Pocket {
  x: number;
  z: number;
  w: number;
  d: number;
}

function outline(w: number, d: number, r: number): THREE.Shape {
  const x = w / 2, y = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y); s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r); s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y); s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r); s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}

function surface(g: THREE.Object3D, area: Pocket, radius: number, y: number, material: THREE.Material, depth = 0): void {
  const s = outline(area.w, area.d, radius);
  const geo = depth
    ? new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 })
    : new THREE.ShapeGeometry(s, 8);
  geo.rotateX(-Math.PI / 2);
  const mesh = put(g, geo, material, area.x, y, area.z, { shadow: false });
  mesh.userData.ownGeo = true;
}

export class Campus {
  private readonly pockets: [Pocket, Pocket, Pocket];
  private readonly lilies: THREE.Group[] = [];
  private water?: THREE.Texture;

  constructor(private readonly bounds: TileRect, width: number) {
    this.pockets = [
      { x: -8.2, z: CORRIDOR_Y + CORRIDOR_H / 2, w: 10.5, d: 8.5 },
      { x: width + 7, z: BUILDING_H - 6, w: 10.5, d: 9 },
      { x: width * 0.67, z: BUILDING_H + 16, w: 15, d: 10 },
    ];
  }

  paved(x: number, z: number): boolean {
    const garden = this.pockets[1];
    const hall = CORRIDOR_Y + CORRIDOR_H / 2;
    const entryPath = z >= hall - 0.6 && z <= hall + 0.6 && x >= garden.x - 7 && x <= garden.x + 0.25;
    const gardenPath = Math.abs(x - garden.x + 0.2) < 1.55 && z >= hall && z <= garden.z;
    return entryPath || gardenPath || this.pockets.some((p) => Math.abs(p.x - x) < p.w / 2 + 0.3 && Math.abs(p.z - z) < p.d / 2 + 0.3);
  }

  update(now: number): void {
    if (this.water) this.water.offset.set((now / 48_000) % 1, (now / 67_000) % 1);
    this.lilies.forEach((lily, i) => {
      const phase = now / 1_550 + i * 2.1;
      lily.position.y = 0.285 + Math.sin(phase) * 0.011;
      lily.rotation.x = Math.sin(phase + 1.1) * 0.055;
      lily.rotation.y = Math.cos(phase * 0.55) * 0.22;
    });
  }

  build(g: THREE.Object3D, grass: THREE.Material): void {
    const b = this.bounds;
    const island = { x: b.x + b.w / 2, z: b.y + b.h / 2, w: b.w, d: b.h };
    surface(g, island, 4, -0.31, mat('#a78d71'), 0.24);
    surface(g, island, 4, -0.035, grass);
    const stones = mat('#e0caaa', { rough: 0.93 });
    const edge = mat('#c3a687');
    const curb = (p: Pocket, radius: number) => {
      surface(g, p, radius, -0.032, edge, 0.039);
      surface(g, { ...p, w: p.w - 0.22, d: p.d - 0.22 }, radius - 0.11, 0.012, stones);
    };
    this.pockets.forEach((p, i) => {
      curb(p, i === 2 ? 3.1 : 1.9);
      for (const offset of [-1, 1]) {
        const x = p.x + offset * (p.w / 2 - 1.9);
        const z = p.z + p.d / 2 - 1.35;
        const bench = prop('craftedGardenBench', { w: 1.82 });
        if (bench) {
          bench.position.set(x, 0.016, z);
          bench.rotation.y = Math.PI;
          g.add(bench);
        }
        const flowerbed = prop('craftedGardenPlanter', { w: 1.6, h: 0.68, d: 0.75 });
        if (flowerbed) {
          flowerbed.position.set(x, 0.016, p.z - p.d / 2 + 1.25);
          g.add(flowerbed);
        }
      }
    });
    const [entry, garden, green] = this.pockets;
    curb({ x: (entry.x + 0.6) / 2, z: entry.z, w: -entry.x - 0.6, d: 2.6 }, 0.9);
    const east = garden.x - 7;
    const hall = CORRIDOR_Y + CORRIDOR_H / 2;
    curb({ x: east + 3.4, z: hall, w: 6.9, d: 1.05 }, 0.46);
    curb({ x: garden.x - 0.2, z: (hall + garden.z) / 2, w: 2.9, d: garden.z - hall + 1 }, 0.5);
    curb({ x: garden.x, z: BUILDING_H + 0.6, w: 2.5, d: 4.9 }, 0.68);
    curb({ x: green.x, z: BUILDING_H + 11.4, w: 2.7, d: 4.6 }, 0.68);

    const basin = { x: green.x, z: green.z, w: 5.6, d: 3.85 };
    surface(g, basin, 1.62, 0.015, mat('#bca287'), 0.27);
    const water = texMat('campus-pond', 128, 128, (c, w, h) => {
      c.fillStyle = '#74a7a3';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#afcfbe';
      c.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const x = (i * 37) % w, y = (i * 53) % h;
        c.beginPath();
        c.ellipse(x, y, 4 + i % 5, 2 + i % 3, 0.2, -0.3, 2.7);
        c.stroke();
      }
    });
    water.map!.wrapS = water.map!.wrapT = THREE.RepeatWrapping;
    water.map!.repeat.setScalar(0.28);
    this.water = water.map!;
    surface(g, { ...basin, w: 5.32, d: 3.57 }, 1.49, 0.288, water);
    for (const [dx, dz] of [[-1.2, 0.1], [-0.82, 0.48], [1.4, -0.52]] as const) {
      const lily = new THREE.Group();
      lily.position.set(green.x + dx, 0.29, green.z + dz);
      lily.userData.dynamic = true;
      put(lily, cyl(0.22, 0.23, 0.026, 13), mat('#709855'), 0, 0, 0);
      put(lily, sphere(0.087, 10), mat('#ecb0a0'), 0, 0.025, 0);
      this.lilies.push(lily);
      g.add(lily);
    }
    // Paraciclos ao lado da praça, deixando o caminho central aberto.
    for (let i = 0; i < 4; i++) {
      const x = entry.x - 2.6 + i * 0.7, z = entry.z - 1.65;
      for (const end of [-1, 1]) put(g, cyl(0.04, 0.04, 0.43, 8), mat('#50716d'), x, 0.014, z + end * 0.24);
      block(g, 0.08, 0.08, 0.52, '#50716d', x, 0.39, z);
    }
    const turf = mat('#7f9a68');
    for (const [x, z, w, d, h] of [
      [b.x + 6, b.y + 6, 9, 5.8, 0.9],
      [b.x + 14.7, b.y + 5.4, 12, 6.8, 0.7],
      [b.x + b.w - 7, b.y + 6, 10, 7.5, 0.9],
    ] as const) {
      const hill = put(g, sphere(1, 16), turf, x, -h * 0.58, z, { shadow: false });
      hill.position.y = -0.02;
      hill.scale.set(w / 2, h, d / 2);
    }
  }
}
