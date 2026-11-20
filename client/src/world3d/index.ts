// Mundo 3D do escritório. Implementa o MESMO contrato (world/api.ts: WorldApi) que o mundo 2D, então a UI, o store,
// a cidade e o timelapse continuam iguais. A simulação também é a mesma (world/sim/Sim): sessões, salas, caminhos,
// vida social e estados vêm dela; este módulo só desenha em 3D e trata câmera e entrada.
import * as THREE from 'three';
import * as artModule from '../art';
import type { ArtModule } from '../art/api';
import type { OfficeStore } from '../net/store';
import { DEFAULT_WORLD_OPTIONS, type Selection, type SocialEvent, type SoundCue, type WorldApi, type WorldOptions, type WorldPlayback } from '../world/api';
import type { Camera } from '../world/camera';
import { BUILDING_H, COL_W, TILE } from '../world/constants';
import { rebaseSnapshot } from '../world/playback';
import { Sim } from '../world/sim/sim';
import { VISITOR_ID } from '../world/sim/visitor';
import { SoundCues } from '../world/sound-cues';
import { CharacterAssets, NatureKit } from './assets';
import { Building3D } from './building';
import { StrategicCamera } from './camera';
import { Avatars } from './characters';
import { Labels } from './labels';
import { LookStore } from './looks';
import { createLookEditor } from './editor';
import { screenModeFor } from './screens';
import { loadQuality, saveQuality, Stage, type Quality } from './stage';

const art: ArtModule = artModule;

export interface World3DExtras {
  /** Presets gráficos (persistidos no navegador). */
  getQuality(): Quality;
  setQuality(q: Quality): void;
  /** Aparências 3D (editor de personagens). */
  looks: LookStore;
  assets: CharacterAssets;
  /** Números do último quadro, para depuração e benchmark. */
  stats(): { fps: number; calls: number; triangles: number; avatars: number };
  /** Acesso direto para depuração no console (window.habblaud.world.debug). */
  debug: { cam: StrategicCamera; stage: Stage; sim: () => Sim; building: Building3D; avatars: () => Avatars; view(x: number, z: number, dist: number, pitch: number, yaw: number): void };
}

export function createWorld3D(canvas: HTMLCanvasElement, store: OfficeStore): WorldApi & World3DExtras {
  let options: WorldOptions = { ...DEFAULT_WORLD_OPTIONS };
  canvas.style.imageRendering = 'auto';
  const stage = new Stage(canvas, loadQuality());
  const cam = new StrategicCamera(stage.camera);
  let sim = new Sim(art, () => options);
  const assets = new CharacterAssets();
  const looks = new LookStore();
  const building = new Building3D(null);
  stage.scene.add(building.root);
  let avatars = new Avatars(assets, looks);
  stage.scene.add(avatars.group);
  const labels = new Labels(document.body);
  canvas.after(labels.root);
  void NatureKit.load().then((n) => building.setNature(n));

  let playback: WorldPlayback | null = null;
  let worldNow = 0;
  const selectCbs = new Set<(s: Selection) => void>();
  const hoverCbs = new Set<(id: string | null) => void>();
  const socialCbs = new Set<(e: SocialEvent) => void>();
  const soundCbs = new Set<(c: SoundCue) => void>();
  const roomMenuCbs = new Set<(roomId: string, at: { x: number; y: number }) => void>();
  let selection: Selection = null;
  let hover: string | null = null;
  let follow: string | null = null;
  let raf = 0;
  let lastTs = 0;
  let hiddenAt = 0;
  let suspended = false;
  let suspendedAt = 0;
  let userMoved = false;
  let framed = false;
  let lastCols = -1;
  let viewW = 1;
  let viewH = 1;
  let fps = 60;
  const abort = new AbortController();

  // ------------------------------------------------------------------ tamanho

  const resize = () => {
    viewW = canvas.clientWidth || window.innerWidth;
    viewH = canvas.clientHeight || window.innerHeight;
    stage.resize(viewW, viewH);
  };

  const buildingSize = () => ({ w: sim.building.cols * COL_W, d: BUILDING_H });

  const updateBounds = () => {
    const { w, d } = buildingSize();
    cam.bounds.set(new THREE.Vector3(-14, 0, -10), new THREE.Vector3(w + 14, 0, d + 16));
    stage.setBounds(new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(w + 4, 3, d + 6)));
  };

  const overview = (animate = true) => {
    follow = null;
    const { w, d } = buildingSize();
    const goal = { target: new THREE.Vector3(w / 2, 0, d / 2 + 0.5), yaw: 0, pitch: 0.95, dist: 0 };
    cam.state.pitch = animate ? cam.state.pitch : goal.pitch;
    const saved = cam.state.pitch;
    cam.state.pitch = goal.pitch;
    goal.dist = cam.fitDistance(w + 2, d + 2, viewW, viewH);
    cam.state.pitch = saved;
    if (animate) cam.animateTo(goal, 600);
    else {
      cam.stop();
      cam.state.target.copy(goal.target);
      cam.state.dist = goal.dist;
      cam.state.yaw = goal.yaw;
      cam.state.pitch = goal.pitch;
    }
  };

  // ------------------------------------------------------------------ seleção e foco

  const emitSelect = () => selectCbs.forEach((cb) => cb(selection));
  const same = (a: Selection, b: Selection) => a === b || (!!a && !!b && a.type === b.type && a.id === b.id);

  const setSelection = (sel: Selection, focus = false) => {
    const changed = !same(sel, selection);
    selection = sel;
    if (options.followSelected) follow = sel?.type === 'agent' ? sel.id : null;
    if (focus && sel) {
      if (sel.type === 'agent') focusAgent(sel.id, { follow: options.followSelected });
      else focusRoom(sel.id);
    }
    if (changed) emitSelect();
  };

  const focusAgent = (id: string, opts: { follow?: boolean } = {}) => {
    const av = avatars.get(id);
    const ch = sim.person(id);
    if (!ch) return;
    userMoved = true;
    const p = av?.root.position ?? new THREE.Vector3(ch.x / TILE, 0, ch.y / TILE);
    cam.animateTo({ target: new THREE.Vector3(p.x, 0.5, p.z), dist: Math.min(cam.state.dist, 13), pitch: Math.min(cam.state.pitch, 0.85) }, 560);
    follow = opts.follow ? id : null;
  };

  const focusRoom = (id: string) => {
    const room = sim.rooms.get(id);
    if (!room) return;
    userMoved = true;
    follow = null;
    const r = room.layout.rect;
    const target = new THREE.Vector3(r.x + r.w / 2, 0, r.y + r.h / 2 + 1);
    const pitch = 0.92;
    const saved = cam.state.pitch;
    cam.state.pitch = pitch;
    const dist = cam.fitDistance(r.w + 1, r.h, viewW, viewH);
    cam.state.pitch = saved;
    cam.animateTo({ target, dist, pitch }, 560);
  };

  // ------------------------------------------------------------------ picking

  const ndc = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  const groundAt = (sx: number, sy: number): THREE.Vector3 | null => {
    ndc.set((sx / viewW) * 2 - 1, -(sy / viewH) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(ground, p) ? p : null;
  };

  const toScreen = (v: THREE.Vector3, out: THREE.Vector3) => {
    out.copy(v).project(stage.camera);
    out.set((out.x * 0.5 + 0.5) * viewW, (-out.y * 0.5 + 0.5) * viewH, out.z);
    return out;
  };

  const pick = (sx: number, sy: number): Selection => {
    let best: string | null = null;
    let bestZ = Infinity;
    for (const [id, av] of avatars.list) {
      if (!av.visible || id === VISITOR_ID) continue;
      toScreen(av.root.position, tmpA);
      toScreen(av.head, tmpB);
      if (tmpA.z > 1) continue;
      // cápsula entre os pés e a cabeça, com largura proporcional ao tamanho na tela
      const len = Math.max(8, tmpA.y - tmpB.y);
      const r = Math.max(10, len * 0.32);
      const t = THREE.MathUtils.clamp((sy - tmpB.y) / Math.max(1, tmpA.y - tmpB.y), 0, 1);
      const cx = tmpB.x + (tmpA.x - tmpB.x) * t;
      const cy = tmpB.y + (tmpA.y - tmpB.y) * t;
      if (Math.hypot(sx - cx, sy - cy) > r) continue;
      if (tmpA.z < bestZ) {
        bestZ = tmpA.z;
        best = id;
      }
    }
    if (best) return { type: 'agent', id: best };
    const g = groundAt(sx, sy);
    const room = g ? building.areaAt(g.x, g.z, sim) : null;
    return room ? { type: 'room', id: room } : null;
  };

  const setHover = (id: string | null) => {
    if (id === hover) return;
    hover = id;
    canvas.style.cursor = id ? 'pointer' : 'grab';
    hoverCbs.forEach((cb) => cb(id));
  };

  // ------------------------------------------------------------------ entrada

  let drag: { x: number; y: number; button: number; moved: boolean; lastX: number; lastY: number } | null = null;
  let mouse: { x: number; y: number } | null = null;
  const local = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tilesPerPixel = () => (cam.state.dist * 2 * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov) / 2)) / Math.max(1, viewH);

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (suspended) return;
      const p = local(e);
      drag = { x: p.x, y: p.y, button: e.button, moved: false, lastX: p.x, lastY: p.y };
      canvas.setPointerCapture(e.pointerId);
    },
    { signal: abort.signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      const p = local(e);
      mouse = p;
      if (!drag) return;
      const dx = p.x - drag.lastX;
      const dy = p.y - drag.lastY;
      if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) > 4) {
        drag.moved = true;
        userMoved = true;
        follow = null;
        cam.stop();
        canvas.style.cursor = drag.button === 2 ? 'move' : 'grabbing';
      }
      if (drag.moved) {
        if (drag.button === 2 || (drag.button === 0 && e.shiftKey)) cam.rotate(-dx * 0.006, dy * 0.004);
        else if (drag.button === 0 || drag.button === 1) {
          const k = tilesPerPixel();
          cam.pan(-dx * k, -dy * k / Math.max(0.35, Math.sin(cam.state.pitch)));
        }
      }
      drag.lastX = p.x;
      drag.lastY = p.y;
    },
    { signal: abort.signal },
  );
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = hover ? 'pointer' : 'grab';
    if (d.moved) return;
    const p = local(e);
    if (d.button === 0) setSelection(pick(p.x, p.y));
    else if (d.button === 2 && roomMenuCbs.size) {
      const hit = pick(p.x, p.y);
      const g = groundAt(p.x, p.y);
      const roomId = hit?.type === 'room' ? hit.id : hit?.type === 'agent' ? (sim.chars.get(hit.id)?.roomId ?? null) : g ? building.areaAt(g.x, g.z, sim) : null;
      if (roomId && sim.rooms.has(roomId)) roomMenuCbs.forEach((cb) => cb(roomId, { x: e.clientX, y: e.clientY }));
    }
  };
  canvas.addEventListener('pointerup', endDrag, { signal: abort.signal });
  canvas.addEventListener('pointercancel', () => (drag = null), { signal: abort.signal });
  canvas.addEventListener('pointerleave', () => {
    mouse = null;
    setHover(null);
  }, { signal: abort.signal });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: abort.signal });
  canvas.addEventListener(
    'dblclick',
    (e) => {
      const p = local(e);
      const hit = pick(p.x, p.y);
      if (hit?.type === 'agent') {
        setSelection(hit);
        focusAgent(hit.id, { follow: true });
      } else if (hit?.type === 'room') focusRoom(hit.id);
    },
    { signal: abort.signal },
  );
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (suspended) return;
      userMoved = true;
      cam.stop();
      const factor = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016);
      // aproxima em direção ao ponto sob o cursor
      const p = local(e);
      const g = groundAt(p.x, p.y);
      const before = cam.state.dist;
      cam.zoom(factor);
      if (g && cam.state.dist !== before && !follow) {
        const k = 1 - cam.state.dist / before;
        cam.state.target.x += (g.x - cam.state.target.x) * k;
        cam.state.target.z += (g.z - cam.state.target.z) * k;
        cam.clamp();
      }
    },
    { signal: abort.signal, passive: false },
  );
  const keys = new Set<string>();
  const typingTarget = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.xterm'));
  window.addEventListener(
    'keydown',
    (e) => {
      if (suspended || e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keys.add(k);
        userMoved = true;
        follow = null;
        cam.stop();
      } else if (k === '+' || k === '=') zoomBy(1.25);
      else if (k === '-') zoomBy(0.8);
      else if (k === '0') {
        userMoved = false;
        overview(true);
      } else if (k === 'f' && selection?.type === 'agent') focusAgent(selection.id, { follow: true });
    },
    { signal: abort.signal },
  );
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()), { signal: abort.signal });
  window.addEventListener('blur', () => keys.clear(), { signal: abort.signal });

  const applyKeys = (dt: number) => {
    if (!keys.size) return;
    const sp = cam.state.dist * 0.9 * dt;
    let dx = 0;
    let dz = 0;
    if (keys.has('w') || keys.has('arrowup')) dz -= sp;
    if (keys.has('s') || keys.has('arrowdown')) dz += sp;
    if (keys.has('a') || keys.has('arrowleft')) dx -= sp;
    if (keys.has('d') || keys.has('arrowright')) dx += sp;
    if (dx || dz) cam.pan(dx, dz);
    if (keys.has('q')) cam.rotate(1.6 * dt, 0);
    if (keys.has('e')) cam.rotate(-1.6 * dt, 0);
  };

  const zoomBy = (factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    userMoved = true;
    cam.animateTo({ dist: THREE.MathUtils.clamp(cam.state.dist / factor, 5, 140) }, 240);
  };

  // ------------------------------------------------------------------ dados

  const onSnapshot = () => {
    const snap = store.snapshot;
    if (!snap) return;
    try {
      if (playback) sim.applySnapshot(rebaseSnapshot(snap, worldNow - snap.serverTime), worldNow);
      else sim.applySnapshot(snap, Date.now());
    } catch (err) {
      console.error('[mundo 3D] snapshot inválido ignorado', err);
    }
  };
  const offSnapshot = store.on('snapshot', onSnapshot);
  if (store.snapshot) onSnapshot();

  // sons: as dicas do mundo 2D precisam de uma "câmera" com o retângulo visível em px de mundo
  const soundCam = {
    get viewW() {
      return viewW;
    },
    get viewH() {
      return viewH;
    },
    get zoom() {
      return THREE.MathUtils.clamp(40 / cam.state.dist, 0.5, 4);
    },
    screenToWorld(sx: number, sy: number) {
      const half = cam.state.dist * 0.55;
      const t = cam.state.target;
      return { x: (t.x + (sx ? half : -half)) * TILE, y: (t.z + (sy ? half * 0.7 : -half * 0.7)) * TILE };
    },
  } as unknown as Camera;
  let cues = new SoundCues(sim, soundCam);

  // ------------------------------------------------------------------ laço

  const loop = (ts: number) => {
    raf = requestAnimationFrame(loop);
    const real = Date.now();
    const realDt = lastTs ? Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
    lastTs = ts;
    if (realDt > 0) fps = fps * 0.95 + (1 / realDt) * 0.05;
    const k = playback ? Math.max(0, playback.scale()) : 1;
    const dt = realDt * k;
    if (playback) worldNow += dt * 1000;
    const now = playback ? worldNow : real;
    try {
      if (canvas.clientWidth !== viewW || canvas.clientHeight !== viewH) resize();
      sim.update(dt, now);
      const events = sim.social.events;
      if (events.length) {
        if (!playback) for (const e of events) for (const cb of socialCbs) cb(e);
        events.length = 0;
      }
      building.sync(sim);
      if (sim.building.cols !== lastCols) {
        lastCols = sim.building.cols;
        updateBounds();
        if (!framed && sim.initialized) {
          overview(false);
          framed = true;
        } else if (!userMoved) overview(true);
      }
      applyKeys(realDt);
      const sel = selection?.type === 'agent' ? selection.id : null;
      avatars.update(sim, dt, now, sel, hover);
      if (follow && !sim.chars.has(follow)) follow = null;
      const fav = follow ? avatars.get(follow) : undefined;
      cam.update(performance.now(), fav ? new THREE.Vector3(fav.root.position.x, 0.5, fav.root.position.z) : null, realDt, viewW, viewH);
      // dia/noite
      const clock = playback ? new Date(playback.clock()) : new Date(real);
      const mode = options.daylight ?? (options.dayNight ? 'auto' : 'day');
      const hour = mode === 'day' ? 13 : mode === 'night' ? 22 : clock.getHours() + clock.getMinutes() / 60;
      stage.setTime(hour);
      // névoa só no horizonte, qualquer que seja o zoom
      const fog = stage.scene.fog as THREE.Fog;
      fog.near = cam.state.dist * 1.6 + 30;
      fog.far = cam.state.dist * 4 + 120;
      building.update(sim, now, stage.camera, cam.state.target, stage.night, realDt);
      // telas das mesas acompanham a atividade de quem está sentado
      for (const ch of sim.chars.values()) {
        const spot = ch.atSpot ? sim.spots.get(ch.atSpot) : undefined;
        if (!spot?.deskId) continue;
        const scr = building.screens.get(spot.deskId);
        if (scr) scr.material = screenModeFor(ch, sim.rooms.get(ch.roomId)?.theme.accent);
      }
      stage.render();
      labels.update(sim, (id) => avatars.get(id), stage.camera, viewW, viewH, now, options, sel, hover);
      if (soundCbs.size && !playback) cues.update(now, (c) => soundCbs.forEach((cb) => cb(c)));
      if (mouse && !drag) {
        const hit = pick(mouse.x, mouse.y);
        setHover(hit?.type === 'agent' ? hit.id : null);
      }
      if (selection?.type === 'agent' && !sim.chars.has(selection.id)) setSelection(null);
      if (selection?.type === 'room' && !sim.rooms.has(selection.id)) setSelection(null);
    } catch (err) {
      console.error('[mundo 3D] erro no frame', err);
    }
  };

  const onVisibility = () => {
    if (suspended) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    lastTs = 0;
    if (hiddenAt && Date.now() - hiddenAt > 5000) sim.fastForward(playback ? worldNow : Date.now());
    hiddenAt = 0;
  };
  window.addEventListener('resize', resize, { signal: abort.signal });
  document.addEventListener('visibilitychange', onVisibility, { signal: abort.signal });
  resize();
  canvas.style.cursor = 'grab';
  raf = requestAnimationFrame(loop);

  const rebuild = () => {
    sim.social.wallets.save(Date.now());
    sim = new Sim(art, () => options, playback ? null : undefined);
    stage.scene.remove(avatars.group);
    avatars.dispose();
    avatars = new Avatars(assets, looks);
    stage.scene.add(avatars.group);
    building.dispose();
    cues = new SoundCues(sim, soundCam);
    lastCols = -1;
    setHover(null);
  };

  const api: WorldApi & World3DExtras = {
    select: (sel, opts) => setSelection(sel, !!opts?.focus),
    getSelection: () => selection,
    onSelect: (cb) => {
      selectCbs.add(cb);
      return () => void selectCbs.delete(cb);
    },
    onHover: (cb) => {
      hoverCbs.add(cb);
      return () => void hoverCbs.delete(cb);
    },
    focusAgent,
    focusRoom,
    overview: () => {
      userMoved = false;
      overview(true);
    },
    zoomBy,
    getOptions: () => ({ ...options }),
    setOptions: (o) => {
      options = { ...options, ...o };
      if (o.followSelected !== undefined) follow = o.followSelected && selection?.type === 'agent' ? selection.id : null;
    },
    setViewInsets: (ins) => {
      const v = (n: number | undefined, cur: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : cur);
      const cur = cam.insets;
      cam.insets = { top: v(ins.top, cur.top), right: v(ins.right, cur.right), bottom: v(ins.bottom, cur.bottom), left: v(ins.left, cur.left) };
      if (!userMoved && framed) overview(true);
    },
    screenPositionOf: (id) => {
      const av = avatars.get(id);
      if (!av || !av.visible) return null;
      toScreen(av.head, tmpA);
      if (tmpA.z > 1 || tmpA.x < 0 || tmpA.y < 0 || tmpA.x > viewW || tmpA.y > viewH) return null;
      return { x: tmpA.x, y: tmpA.y };
    },
    social: (id) => sim.social.info(id),
    onRoomContextMenu: (cb) => {
      roomMenuCbs.add(cb);
      return () => void roomMenuCbs.delete(cb);
    },
    onSocialEvent: (cb) => {
      socialCbs.add(cb);
      return () => void socialCbs.delete(cb);
    },
    setPlayback: (p) => {
      playback = p;
      worldNow = p ? p.clock() : 0;
      rebuild();
    },
    onSound: (cb) => {
      soundCbs.add(cb);
      return () => void soundCbs.delete(cb);
    },
    setSuspended: (on) => {
      if (on === suspended) return;
      suspended = on;
      labels.root.hidden = on;
      if (on) {
        cancelAnimationFrame(raf);
        suspendedAt = Date.now();
        setHover(null);
        mouse = null;
        keys.clear();
        return;
      }
      lastTs = 0;
      if (suspendedAt && Date.now() - suspendedAt > 5000) sim.fastForward(playback ? worldNow : Date.now());
      suspendedAt = 0;
      hiddenAt = 0;
      raf = requestAnimationFrame(loop);
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      abort.abort();
      offSnapshot();
      labels.destroy();
      avatars.dispose();
      building.dispose();
      stage.dispose();
      selectCbs.clear();
      hoverCbs.clear();
      socialCbs.clear();
      soundCbs.clear();
    },
    lookEditor: (id) => {
      const info = sim.chars.get(id)?.info ?? store.snapshot?.agents.find((a) => a.id === id);
      return info ? createLookEditor(info, assets, looks) : null;
    },
    getQuality: () => stage.quality,
    setQuality: (q) => {
      stage.setQuality(q);
      saveQuality(q);
    },
    looks,
    assets,
    stats: () => ({ fps: Math.round(fps), ...stage.info(), avatars: avatars.list.size }),
    debug: {
      cam,
      stage,
      sim: () => sim,
      building,
      avatars: () => avatars,
      view: (x, z, dist, pitch, yaw) => {
        userMoved = true;
        framed = true;
        follow = null;
        cam.stop();
        cam.state.target.set(x, 0.5, z);
        Object.assign(cam.state, { dist, pitch, yaw });
      },
    },
  };
  return api;
}
