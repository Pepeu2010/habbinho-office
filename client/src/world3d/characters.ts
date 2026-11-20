// Personagens 3D: um avatar chibi para cada personagem da simulação (sim/character.ts). A simulação decide onde cada
// um está, o que faz e para onde olha; aqui a pose vira clipe (anim-map.ts), com crossfade, suavização de posição e
// rotação, altura do assento, item na mão e o anel de seleção. Nada daqui volta para a simulação.
import * as THREE from 'three';
import type { HeldItem } from '../art/api';
import { TILE } from '../world/constants';
import type { Character } from '../world/sim/character';
import type { Sim } from '../world/sim/sim';
import type { SpotKind } from '../world/layout/types';
import { REACTION_MS, clipForPose, reactionClip, reactionForIcon, resolveClip, type Reaction } from './anim-map';
import { BONE, CHAR_H, defaultModelFor, type CharacterAssets, type CharacterModelDef, type LoadedModel } from './assets';
import { SEAT_H, STOOL_H } from './furniture';
import { PAL, cyl, mat, rbox, sphere } from './kit';
import { ChibiFace, chibiKey, chibiMaterials, dressChibi, type Expression } from './chibi';
import type { LookStore } from './looks';

/** Altura do assento por tipo de lugar (topo da almofada). */
function seatHeight(kind: SpotKind | undefined): number {
  switch (kind) {
    case 'stool':
      return STOOL_H;
    case 'beanbag':
      return 0.2;
    case 'bench':
    case 'cafe_seat':
      return SEAT_H;
    default:
      return SEAT_H;
  }
}

const FADE = 0.22;
/** Velocidade (tiles/s) em que o clipe Walk não desliza os pés (calibrado no navegador). */
const WALK_REF = 1.55;
const RUN_REF = 3.6;
const FOOT_SHIFT = 3 / TILE;

export interface AvatarView {
  id: string;
  root: THREE.Group;
  /** Ponto acima da cabeça (para etiquetas). */
  head: THREE.Vector3;
  visible: boolean;
  badge?: string;
}

class Avatar implements AvatarView {
  readonly root = new THREE.Group();
  readonly head = new THREE.Vector3();
  visible = false;
  private body: THREE.Object3D | null = null;
  private model: LoadedModel | null = null;
  private modelId = '';
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: { name: string; action: THREE.AnimationAction } | null = null;
  private yaw = 0;
  private pos = new THREE.Vector3();
  private last = new THREE.Vector3();
  private placed = false;
  private poseKey = '';
  private poseCount = 0;
  private sitHips = 0.25;
  private headBone: THREE.Object3D | null = null;
  private handBone: THREE.Object3D | null = null;
  private heldKind: HeldItem = 'none';
  private heldObj: THREE.Object3D | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];
  private face: ChibiFace | null = null;
  private faceMat: THREE.Material | null = null;
  private rnd = Math.random;
  private loading = false;
  readonly ring: THREE.Mesh;
  private shadowBlob: THREE.Mesh;
  private lookKey = '';
  private iconAt = 0;
  private reaction: { kind: Reaction; t0: number } | null = null;
  /** Chamado quando uma reação começa (efeitos de partícula sobre a cabeça). */
  onReact?: (kind: Reaction, head: THREE.Vector3) => void;
  /** Identificação profissional escolhida no editor (etiqueta). */
  badge = '';

  constructor(readonly id: string) {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.012;
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    this.root.add(this.ring);
    // sombra de contato: mantém o boneco "no chão" mesmo com sombras desligadas
    this.shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), blobMat());
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.position.y = 0.008;
    this.shadowBlob.renderOrder = 1;
    this.root.add(this.shadowBlob);
  }

  async ensureModel(assets: CharacterAssets, def: CharacterModelDef): Promise<void> {
    if (this.modelId === def.id || this.loading) return;
    this.loading = true;
    try {
      const model = await assets.load(def);
      this.setModel(assets, model);
    } finally {
      this.loading = false;
    }
  }

  private setModel(assets: CharacterAssets, model: LoadedModel): void {
    if (this.body) {
      this.root.remove(this.body);
      this.mixer?.stopAllAction();
      for (const m of this.materials) m.dispose();
      this.face?.dispose();
    }
    assets.refreshClips(model);
    this.model = model;
    this.modelId = model.def.id;
    this.lookKey = '';
    const body = assets.instantiate(model);
    // o visual é o Habbinho (vestido em update(), quando a aparência é conhecida)
    this.face = new ChibiFace();
    const mats = chibiMaterials(this.face);
    this.materials = [mats.body, mats.face];
    this.faceMat = mats.face;
    this.body = body;
    this.root.add(body);
    this.headBone = body.getObjectByName(model.bones[BONE.head] ?? '') ?? null;
    // o objeto segurado vai no osso do braço, na mão visível do Habbinho (braço modelado mais baixo que o osso)
    this.handBone = body.getObjectByName(model.bones[BONE.armR] ?? '') ?? null;
    this.mixer = new THREE.AnimationMixer(body);
    this.actions.clear();
    this.current = null;
    this.sitHips = this.measureSitHips();
    this.heldKind = 'none';
    this.heldObj = null;
  }

  /** Altura do quadril (acima dos pés) na pose sentada: posiciona o boneco sobre cada assento. */
  private measureSitHips(): number {
    const sit = this.model?.clips.get('Sit');
    if (!sit || !this.mixer || !this.body || !this.model) return 0.25;
    const hips = this.body.getObjectByName(this.model.bones[BONE.hips] ?? '');
    if (!hips) return 0.25;
    const a = this.mixer.clipAction(sit);
    a.play();
    this.mixer.setTime(0.3);
    this.body.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    hips.getWorldPosition(v);
    const rootY = this.body.getWorldPosition(new THREE.Vector3()).y;
    a.stop();
    this.mixer.setTime(0);
    return v.y - rootY;
  }

  private action(name: string): THREE.AnimationAction | null {
    if (!this.mixer || !this.model) return null;
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.model.clips.get(name);
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      this.actions.set(name, a);
    }
    return a;
  }

  private play(name: string, speed: number, loop: boolean): void {
    if (this.current?.name === name) {
      this.current.action.timeScale = speed;
      return;
    }
    const next = this.action(name);
    if (!next) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = speed;
    // desencontra personagens que começam o mesmo clipe juntos
    next.time = loop ? (hash01(this.id) * next.getClip().duration) % next.getClip().duration : 0;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current) this.current.action.crossFadeTo(next, FADE, false);
    this.current = { name, action: next };
  }

  update(ch: Character, sim: Sim, dt: number, now: number, looks: LookStore): void {
    const spot = ch.atSpot ? sim.spots.get(ch.atSpot) : undefined;
    // posição alvo (pés), em tiles
    let tx: number;
    let tz: number;
    if (ch.seated && spot) {
      tx = spot.x / TILE;
      tz = spot.ty + 0.5;
    } else {
      tx = (ch.x + ch.offX) / TILE;
      tz = (ch.y + ch.offY) / TILE - FOOT_SHIFT;
    }
    const target = new THREE.Vector3(tx, 0, tz);
    if (!this.placed || this.pos.distanceTo(target) > 1.2) {
      this.pos.copy(target);
      this.last.copy(target);
      this.placed = true;
    } else {
      const k = 1 - Math.exp(-dt * (ch.seated ? 10 : 22));
      this.pos.lerp(target, k);
    }
    const moved = Math.hypot(this.pos.x - this.last.x, this.pos.z - this.last.z);
    const speed = dt > 0 ? moved / dt : 0;
    // direção: para onde anda; parado, a direção da simulação
    let goalYaw = this.yaw;
    if (moved > 0.0008 && !ch.seated) goalYaw = Math.atan2(this.pos.x - this.last.x, this.pos.z - this.last.z);
    else goalYaw = dirYaw(ch.dir);
    this.last.copy(this.pos);
    this.yaw = approachAngle(this.yaw, goalYaw, 1 - Math.exp(-dt * 12));

    const seatY = ch.seated ? Math.max(0, seatHeight(spot?.kind) + 0.03 - this.sitHips) : 0;
    this.root.position.set(this.pos.x, this.root.position.y + (seatY - this.root.position.y) * (1 - Math.exp(-dt * 14)), this.pos.z);
    if (this.body) this.body.rotation.y = this.yaw;

    this.visible = ch.visible && !ch.inside && !ch.gone && now >= ch.hiddenUntil && !!this.body;
    this.root.visible = this.visible;
    this.shadowBlob.visible = !ch.seated;
    if (!this.body || !this.mixer || !this.model) return;

    // aparência do agente (a mesma do 2D) e identificação escolhida no editor 3D
    this.badge = looks.get(ch.id, ch.info).badge ?? '';
    const lk = chibiKey(ch.appearance);
    if (lk !== this.lookKey) {
      this.lookKey = lk;
      dressChibi(this.body, this.model.rig, ch.appearance, { body: this.materials[0]!, face: this.materials[1]! }, this.face ?? undefined);
    }

    // animação
    const key = `${ch.pose}|${ch.seated}|${ch.held}`;
    if (key !== this.poseKey) {
      this.poseKey = key;
      this.poseCount++;
    }
    const variant = hash01(`${this.id}:${this.poseCount}`);
    const choice = clipForPose(ch.pose, ch.seated, ch.held, variant);
    // reação a um ícone novo da simulação (concluiu, erro, atenção): só os recentes (não ao carregar a página)
    if (ch.icon && ch.iconAt !== this.iconAt) {
      this.iconAt = ch.iconAt;
      const kind = reactionForIcon(ch.icon);
      if (kind && now - ch.iconAt < 2_000) {
        this.reaction = { kind, t0: now };
        this.onReact?.(kind, this.head);
      }
    }
    if (this.reaction && now - this.reaction.t0 > REACTION_MS[this.reaction.kind]) this.reaction = null;
    const override = this.reaction ? reactionClip(this.reaction.kind, ch.seated, ch.pose) : null;
    const name = override && this.model.clips.has(override) ? override : resolveClip(choice, (n) => this.model!.clips.has(n));
    let rate = choice.speed;
    if (name === 'Walk' || name === 'WalkCall') rate = THREE.MathUtils.clamp(speed / WALK_REF, 0.6, 2.4);
    else if (name === 'Run') rate = THREE.MathUtils.clamp(speed / RUN_REF, 0.7, 1.8);
    this.play(name, rate, choice.loop);
    this.mixer.update(dt);

    // camadas procedurais sobre o clipe: cochilo (cabeça baixa)
    if (this.headBone && ch.pose === 'sleep') this.headBone.rotateX(0.45);
    if (this.reaction) {
      const t = Math.min(1, (now - this.reaction.t0) / REACTION_MS[this.reaction.kind]);
      const k = 1 - t;
      if (this.reaction.kind === 'celebrate') this.body.position.y = Math.abs(Math.sin(t * Math.PI * 3)) * 0.09 * k;
      else if (this.reaction.kind === 'oops' && this.headBone) this.headBone.rotateY(Math.sin(t * Math.PI * 6) * 0.4 * k);
      else if (this.headBone) this.headBone.rotateX(-Math.sin(t * Math.PI * 2) * 0.3 * k);
    } else this.body.position.y = 0;

    // expressão do rosto
    this.face?.update(expressionFor(ch.pose, this.reaction?.kind, ch.mode), now, this.rnd);

    // alpha (chegada/saída)
    const alpha = THREE.MathUtils.clamp(ch.alpha, 0, 1);
    for (const m of this.materials) {
      const tr = alpha < 0.999 || m === this.faceMat;
      if (m.transparent !== tr) {
        m.transparent = tr;
        m.needsUpdate = true;
      }
      m.opacity = alpha;
    }
    this.syncHeld(ch.held);
    if (this.heldObj && this.body) {
      // o objeto fica "em pé" no mundo, virado para onde o boneco olha (a mão gira com a animação)
      this.heldObj.parent!.updateWorldMatrix(true, false);
      const hand = this.heldObj.parent!.getWorldQuaternion(new THREE.Quaternion());
      const body = this.body.getWorldQuaternion(new THREE.Quaternion());
      this.heldObj.quaternion.copy(hand.invert().multiply(body));
    }

    // ponto acima da cabeça
    this.root.updateMatrixWorld();
    if (this.headBone) {
      this.headBone.getWorldPosition(this.head);
      this.head.y += 0.62;
    } else this.head.set(this.pos.x, CHAR_H + 0.2, this.pos.z);
  }

  private syncHeld(kind: HeldItem): void {
    if (kind === this.heldKind) return;
    this.heldKind = kind;
    if (this.heldObj) {
      this.heldObj.parent?.remove(this.heldObj);
      this.heldObj = null;
    }
    if (kind === 'none' || !this.handBone || !this.model) return;
    const obj = heldModel(kind);
    if (!obj) return;
    // a mão está dentro do armature (escala 0,01 e girado): compensa para o objeto ficar no tamanho do mundo
    const holder = new THREE.Group();
    holder.add(obj);
    const s = new THREE.Vector3();
    this.handBone.updateWorldMatrix(true, false);
    this.handBone.getWorldScale(s);
    holder.scale.setScalar(1 / Math.max(1e-6, s.x));
    holder.position.copy(this.model.rig.handR);
    this.handBone.add(holder);
    this.heldObj = holder;
  }

  setRing(color: string | null, opacity = 0.9): void {
    this.ring.visible = !!color;
    if (color) {
      const m = this.ring.material as THREE.MeshBasicMaterial;
      m.color.set(color);
      m.opacity = opacity;
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    for (const m of this.materials) m.dispose();
    this.face?.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    this.shadowBlob.geometry.dispose();
  }
}

let blob: THREE.Material | null = null;
function blobMat(): THREE.Material {
  if (blob) return blob;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(20,24,30,0.42)');
  g.addColorStop(1, 'rgba(20,24,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  blob = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  return blob;
}

/** Objetos que cabem na mão (em tiles; a origem fica na palma). */
function heldModel(kind: HeldItem): THREE.Object3D | null {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat(color, { rough: 0.5 }));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  switch (kind) {
    case 'coffee':
      add(cyl(0.045, 0.04, 0.09, 12), PAL.cream, 0, 0, 0.04);
      add(cyl(0.04, 0.04, 0.005, 12), '#5b3a24', 0, 0.045, 0.04);
      break;
    case 'water':
      add(cyl(0.04, 0.035, 0.1, 12), '#bfe3f5', 0, 0, 0.04);
      break;
    case 'papers':
      add(rbox(0.16, 0.2, 0.01, 0.003), PAL.paper, 0, 0, 0.06);
      break;
    case 'book':
      add(rbox(0.14, 0.18, 0.04, 0.008), PAL.coral, 0, 0, 0.06);
      break;
    case 'laptop':
      add(rbox(0.24, 0.015, 0.17, 0.006), PAL.grey, 0, 0, 0.08);
      break;
    case 'box':
      add(rbox(0.26, 0.2, 0.22, 0.01), '#c99a68', 0, 0, 0.1);
      break;
    case 'phone':
      add(rbox(0.06, 0.11, 0.012, 0.006), PAL.charcoal, 0, 0, 0.04);
      break;
    case 'controller':
      add(rbox(0.13, 0.03, 0.07, 0.02), PAL.greyDark, 0, 0, 0.05);
      break;
    case 'paddle':
      add(cyl(0.07, 0.07, 0.012, 16), PAL.red, 0, 0.06, 0.04).rotation.x = Math.PI / 2;
      break;
    case 'popcorn':
      add(cyl(0.06, 0.045, 0.12, 12), PAL.red, 0, 0, 0.05);
      add(sphere(0.05, 8), '#fff3c4', 0, 0.07, 0.05);
      break;
    default:
      return null;
  }
  return g;
}

function dirYaw(dir: string): number {
  switch (dir) {
    case 'up':
      return Math.PI;
    case 'left':
      return -Math.PI / 2;
    case 'right':
      return Math.PI / 2;
    default:
      return 0;
  }
}

function approachAngle(cur: number, goal: number, k: number): number {
  let d = goal - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Todos os avatares: cria, atualiza e remove conforme os personagens da simulação. */
export class Avatars {
  readonly group = new THREE.Group();
  readonly list = new Map<string, Avatar>();

  constructor(
    private assets: CharacterAssets,
    private looks: LookStore,
    private onReact?: (kind: Reaction, head: THREE.Vector3) => void,
  ) {}

  /** `chars`: os personagens a desenhar (os da simulação; os NPCs ambientais têm a lista deles). */
  update(sim: Sim, dt: number, now: number, selected: string | null, hovered: string | null, chars: ReadonlyMap<string, Character> = sim.chars): void {
    for (const [id, a] of this.list) {
      if (!chars.has(id)) {
        this.group.remove(a.root);
        a.dispose();
        this.list.delete(id);
      }
    }
    for (const ch of chars.values()) {
      let a = this.list.get(ch.id);
      if (!a) {
        a = new Avatar(ch.id);
        a.onReact = this.onReact;
        this.list.set(ch.id, a);
        this.group.add(a.root);
      }
      void a.ensureModel(this.assets, defaultModelFor());
      a.update(ch, sim, dt, now, this.looks);
      const status = ch.mode === 'wait' ? PAL.orange : null;
      if (ch.id === selected) a.setRing('#ffffff', 0.95);
      else if (ch.id === hovered) a.setRing('#ffffff', 0.5);
      else a.setRing(status, 0.85);
    }
  }

  get(id: string): AvatarView | undefined {
    return this.list.get(id);
  }

  dispose(): void {
    for (const a of this.list.values()) a.dispose();
    this.list.clear();
    this.group.clear();
  }
}

/** Expressão do Habbinho pela pose e pelas reações. */
export function expressionFor(pose: string, reaction: Reaction | undefined, status?: string): Expression {
  if (reaction === 'celebrate') return 'happy';
  if (reaction === 'oops') return 'worried';
  if (reaction === 'attention') return 'surprised';
  switch (pose) {
    case 'sleep':
      return 'sleep';
    case 'talk':
    case 'rps':
      return 'talk';
    case 'cheer':
    case 'laugh':
    case 'play':
    case 'game':
      return 'happy';
    case 'type':
    case 'read':
      return 'focused';
    case 'wait':
    case 'raise_hand':
      return status === 'wait' ? 'worried' : 'neutral';
    default:
      return 'neutral';
  }
}
