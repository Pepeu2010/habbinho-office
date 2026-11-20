// Câmera estratégica: órbita em volta de um alvo no chão, com transições suaves (foco num agente, numa sala, visão
// geral) e respeito às margens cobertas pelos painéis da UI (o alvo fica no centro da área livre).
//
// Mouse: arrastar com o botão esquerdo move (pan), botão direito gira, roda aproxima. Teclado: WASD/setas movem,
// Q/E giram, +/- aproximam, F foca o selecionado, 0 volta à visão geral.
import * as THREE from 'three';
import type { ViewInsets } from '../world/api';

export interface CameraState {
  target: THREE.Vector3;
  /** Distância do alvo. */
  dist: number;
  /** Giro em volta do alvo (0 = câmera ao sul olhando para o norte). */
  yaw: number;
  /** Inclinação acima do horizonte. */
  pitch: number;
}

export const DIST_MIN = 5;
export const DIST_MAX = 140;
const PITCH_MIN = 0.32;
const PITCH_MAX = 1.42;

export class StrategicCamera {
  readonly state: CameraState = { target: new THREE.Vector3(30, 0, 14), dist: 60, yaw: 0, pitch: 0.95 };
  private from: CameraState | null = null;
  private to: CameraState | null = null;
  private t0 = 0;
  private dur = 0;
  insets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Limites do alvo (o prédio com folga). */
  bounds = new THREE.Box3(new THREE.Vector3(-20, 0, -16), new THREE.Vector3(84, 0, 52));

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  get animating(): boolean {
    return !!this.to;
  }

  stop(): void {
    this.from = this.to = null;
  }

  animateTo(goal: Partial<CameraState>, ms = 520): void {
    const s = this.state;
    this.from = { target: s.target.clone(), dist: s.dist, yaw: s.yaw, pitch: s.pitch };
    this.to = { target: (goal.target ?? s.target).clone(), dist: goal.dist ?? s.dist, yaw: goal.yaw ?? s.yaw, pitch: goal.pitch ?? s.pitch };
    // gira pelo caminho mais curto
    let dy = this.to.yaw - this.from.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.to.yaw = this.from.yaw + dy;
    this.t0 = performance.now();
    this.dur = ms;
  }

  /** Distância que enquadra uma largura/profundidade no chão (com a área livre da tela). */
  fitDistance(w: number, d: number, viewW: number, viewH: number): number {
    const freeW = Math.max(120, viewW - this.insets.left - this.insets.right);
    const freeH = Math.max(120, viewH - this.insets.top - this.insets.bottom);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (viewW / Math.max(1, viewH)));
    // a profundidade aparece encurtada pela inclinação; a projeção cobre a tela toda, só a área livre conta
    const depth = d * Math.sin(this.state.pitch) + 2.2 * Math.cos(this.state.pitch);
    const byH = (depth / 2 / Math.tan(vfov / 2)) * (viewH / freeH);
    const byW = (w / 2 / Math.tan(hfov / 2)) * (viewW / freeW);
    return THREE.MathUtils.clamp(Math.max(byH, byW) * 1.08, DIST_MIN, DIST_MAX);
  }

  pan(dx: number, dz: number): void {
    // no referencial da câmera (giro), em tiles
    const c = Math.cos(this.state.yaw);
    const s = Math.sin(this.state.yaw);
    this.state.target.x += dx * c + dz * s;
    this.state.target.z += -dx * s + dz * c;
    this.clamp();
  }

  rotate(dyaw: number, dpitch: number): void {
    this.state.yaw += dyaw;
    this.state.pitch = THREE.MathUtils.clamp(this.state.pitch + dpitch, PITCH_MIN, PITCH_MAX);
  }

  zoom(factor: number): void {
    this.state.dist = THREE.MathUtils.clamp(this.state.dist * factor, DIST_MIN, DIST_MAX);
  }

  clamp(): void {
    const t = this.state.target;
    t.x = THREE.MathUtils.clamp(t.x, this.bounds.min.x, this.bounds.max.x);
    t.z = THREE.MathUtils.clamp(t.z, this.bounds.min.z, this.bounds.max.z);
  }

  update(now: number, follow: THREE.Vector3 | null, dt: number, viewW: number, viewH: number): void {
    if (this.to && this.from) {
      const p = Math.min(1, (now - this.t0) / this.dur);
      const e = 1 - Math.pow(1 - p, 3);
      this.state.target.lerpVectors(this.from.target, this.to.target, e);
      this.state.dist = this.from.dist + (this.to.dist - this.from.dist) * e;
      this.state.yaw = this.from.yaw + (this.to.yaw - this.from.yaw) * e;
      this.state.pitch = this.from.pitch + (this.to.pitch - this.from.pitch) * e;
      if (p >= 1) this.from = this.to = null;
    } else if (follow) {
      const k = 1 - Math.exp(-dt * 6);
      this.state.target.x += (follow.x - this.state.target.x) * k;
      this.state.target.z += (follow.z - this.state.target.z) * k;
      this.state.target.y += (follow.y - this.state.target.y) * k;
    }
    const s = this.state;
    const cp = Math.cos(s.pitch);
    this.camera.position.set(s.target.x + Math.sin(s.yaw) * cp * s.dist, s.target.y + Math.sin(s.pitch) * s.dist, s.target.z + Math.cos(s.yaw) * cp * s.dist);
    this.camera.lookAt(s.target);
    // painéis da UI: desloca a projeção para o alvo ficar no centro da área livre
    const ox = (this.insets.left - this.insets.right) / 2;
    const oy = (this.insets.top - this.insets.bottom) / 2;
    if (ox || oy) this.camera.setViewOffset(viewW, viewH, -ox, -oy, viewW, viewH);
    else this.camera.clearViewOffset();
    this.camera.near = Math.max(0.3, s.dist * 0.05);
    this.camera.far = s.dist * 4 + 120;
    this.camera.updateProjectionMatrix();
  }
}
