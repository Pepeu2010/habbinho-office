/** Carros do campus: alguns rodando na rua e um estacionamento a noroeste do prédio. Só decoração. */
import * as THREE from 'three';
import { block, cyl, mat, put, rbox } from './kit';

const COLORS = ['#c8463d', '#3f6fa8', '#e8e4da', '#2f3438', '#e0b440', '#5d8a5a', '#9aa3ab'];
/** Estacionamento (metros): a noroeste, longe da entrada e dos jardins. */
export const LOT = { x0: -17, x1: -4, z0: -13, z1: -4 };
export const inLot = (x: number, z: number, pad = 1) => x > LOT.x0 - pad && x < LOT.x1 + pad && z > LOT.z0 - pad && z < LOT.z1 + pad;

interface Moving { car: THREE.Group; dir: 1 | -1; speed: number }

export class Traffic {
  private readonly moving: Moving[] = [];
  private readonly lamps = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffe7a8', emissiveIntensity: 0.2 });
  private readonly off = mat('#c9c4b8', { rough: 0.4 });
  private readonly tails = new THREE.MeshStandardMaterial({ color: '#7a1d18', emissive: '#ff3b2b', emissiveIntensity: 0.2 });

  /** lanes: z de cada faixa (dir 1 = vai para +x). x0/x1: limites da rua. */
  constructor(g: THREE.Object3D, lanes: { z: number; dir: 1 | -1 }[], private readonly x0: number, private readonly x1: number, seed: number) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    lanes.forEach((lane, i) => {
      for (let k = 0; k < 2; k++) {
        const car = this.car(COLORS[(i * 3 + k * 2) % COLORS.length]!);
        car.position.set(x0 + rnd() * (x1 - x0), 0, lane.z);
        car.rotation.y = lane.dir > 0 ? 0 : Math.PI;
        car.userData.dynamic = true;
        g.add(car);
        this.moving.push({ car, dir: lane.dir, speed: 3 + rnd() * 2.5 });
      }
    });
    // estacionamento: asfalto, faixas brancas e carros parados de frente para o meio
    const lot = LOT;
    const asphalt = block(g, lot.x1 - lot.x0, 0.02, lot.z1 - lot.z0, '#4d5257', (lot.x0 + lot.x1) / 2, -0.012, (lot.z0 + lot.z1) / 2, 0.01);
    asphalt.castShadow = false;
    const paint = mat('#efece2', { rough: 0.9 });
    for (const [row, turn] of [[lot.z0 + 2.2, Math.PI / 2], [lot.z1 - 2.2, -Math.PI / 2]] as const) {
      for (let x = lot.x0 + 0.6; x <= lot.x1 - 0.6; x += 2.4) {
        put(g, rbox(0.08, 0.004, 4, 0.002), paint, x, 0.001, row, { shadow: false });
        const cx = x + 1.2;
        if (cx > lot.x1 - 0.6 || rnd() < 0.3) continue;
        const car = this.car(COLORS[Math.floor(rnd() * COLORS.length)]!, false);
        car.position.set(cx, 0, row);
        car.rotation.y = turn;
        g.add(car);
      }
    }
  }

  private car(color: string, lit = true): THREE.Group {
    const c = new THREE.Group();
    const paint = mat(color, { rough: 0.35, metal: 0.25 });
    block(c, 3.6, 0.55, 1.6, paint, 0, 0.28, 0, 0.12);
    block(c, 1.9, 0.5, 1.42, paint, -0.2, 0.8, 0, 0.14);
    block(c, 1.95, 0.36, 1.46, mat('#2b3a46', { rough: 0.15, metal: 0.4 }), -0.2, 0.82, 0, 0.1);
    const tyre = mat('#1c1d1f', { rough: 0.8 });
    for (const x of [-1.15, 1.15]) for (const z of [-0.74, 0.74]) put(c, cyl(0.3, 0.3, 0.22, 12), tyre, x, 0.19, z, { rx: Math.PI / 2 }); // put mede a base antes de girar
    for (const z of [-0.55, 0.55]) {
      put(c, rbox(0.06, 0.12, 0.3, 0.02), lit ? this.lamps : this.off, 1.81, 0.46, z, { shadow: false });
      put(c, rbox(0.06, 0.1, 0.3, 0.02), lit ? this.tails : this.off, -1.81, 0.48, z, { shadow: false });
    }
    return c;
  }

  update(dt: number, night: number): void {
    this.lamps.emissiveIntensity = 0.2 + night * 2.2;
    this.tails.emissiveIntensity = 0.2 + night * 1.4;
    const span = this.x1 - this.x0;
    for (const m of this.moving) {
      let x = m.car.position.x + m.dir * m.speed * Math.min(dt, 0.1);
      if (x > this.x1) x -= span;
      if (x < this.x0) x += span;
      m.car.position.x = x;
    }
  }

  dispose(): void {
    this.lamps.dispose();
    this.tails.dispose();
  }
}
