// Efeitos 3D pedidos pela simulação (sim.effects, os mesmos do 2D): confete, brilho e moedinhas voando. Um único
// InstancedMesh com um conjunto fixo de partículas (sem alocação por quadro, uma draw call para todos os efeitos).
import * as THREE from 'three';
import { PAL } from './kit';

const MAX = 600;
const CONFETTI = [PAL.coral, PAL.mustard, PAL.sage, PAL.blue, PAL.pink, PAL.lilac, PAL.teal];

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  life: number;
  age: number;
  size: number;
  gravity: number;
  /** Moeda: vai até `to` em vez de cair. */
  to?: THREE.Vector3;
  from?: THREE.Vector3;
}

export class Fx {
  readonly mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < MAX; i++) {
      this.parts.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), life: 1, age: 0, size: 0.05, gravity: 0 });
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.c.set('#ffffff'));
    }
  }

  private spawn(color: string): Particle {
    const p = this.parts[this.next]!;
    this.mesh.setColorAt(this.next, this.c.set(color));
    this.next = (this.next + 1) % MAX;
    p.alive = true;
    p.age = 0;
    p.to = p.from = undefined;
    return p;
  }

  /** Chuva de papeizinhos coloridos (concluiu, comemorou). */
  confetti(at: THREE.Vector3, n = 36): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn(CONFETTI[i % CONFETTI.length]!);
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 1.4;
      p.pos.copy(at);
      p.vel.set(Math.cos(a) * sp * 0.6, 1.8 + Math.random() * 1.6, Math.sin(a) * sp * 0.6);
      p.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      p.rot.set(0, 0, 0);
      p.life = 1.4 + Math.random() * 0.6;
      p.size = 0.045 + Math.random() * 0.03;
      p.gravity = 4.2;
    }
  }

  /** Brilhos subindo (arrumou-se no espelho, ideia). */
  sparkle(at: THREE.Vector3, n = 14): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn(i % 2 ? '#fff6c2' : '#ffffff');
      const a = (i / n) * Math.PI * 2;
      p.pos.set(at.x + Math.cos(a) * 0.25, at.y + Math.random() * 0.2, at.z + Math.sin(a) * 0.25);
      p.vel.set(0, 0.5 + Math.random() * 0.4, 0);
      p.spin.set(0, 0, 6);
      p.rot.set(0, 0, Math.PI / 4);
      p.life = 0.9 + Math.random() * 0.4;
      p.size = 0.06;
      p.gravity = 0;
    }
  }

  /** Moedinhas em arco de quem pagou para quem ganhou a aposta. */
  coins(from: THREE.Vector3, to: THREE.Vector3, n = 6): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn('#f2c14e');
      p.from = from.clone();
      p.to = to.clone();
      p.pos.copy(from);
      p.spin.set(0, 8, 0);
      p.rot.set(0, 0, 0);
      p.life = 0.9;
      p.age = -i * 0.08;
      p.size = 0.09;
      p.gravity = 0;
    }
  }

  /** Nuvenzinha cinza (erro). */
  puff(at: THREE.Vector3, n = 10): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn(i % 2 ? '#8b96a8' : '#aab3c2');
      p.pos.set(at.x + (Math.random() - 0.5) * 0.3, at.y, at.z + (Math.random() - 0.5) * 0.3);
      p.vel.set((Math.random() - 0.5) * 0.3, 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3);
      p.spin.set(0, 0, 2);
      p.rot.set(0, 0, 0);
      p.life = 1.1;
      p.size = 0.12;
      p.gravity = 0;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i]!;
      if (!p.alive) continue;
      dirty = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      if (p.age < 0) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      if (p.to && p.from) {
        const t = p.age / p.life;
        p.pos.lerpVectors(p.from, p.to, t);
        p.pos.y += Math.sin(t * Math.PI) * 0.8;
      } else {
        p.vel.y -= p.gravity * dt;
        p.vel.multiplyScalar(p.gravity ? 0.985 : 1);
        p.pos.addScaledVector(p.vel, dt);
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      // brilhos e moedas olham para a câmera; o confete gira solto
      if (p.gravity === 0) this.q.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.rot.z)));
      else this.q.setFromEuler(p.rot);
      const fade = Math.min(1, (p.life - p.age) / 0.3);
      this.s.setScalar(p.size * fade);
      this.mesh.setMatrixAt(i, this.m.compose(p.pos, this.q, this.s));
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
