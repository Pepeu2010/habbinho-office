import * as THREE from 'three';
import type { Gathering } from '../world/social/gathering';
import { mat, plane, sphere, texMat } from './kit';

const RALLY_MS = 2_200;
const BOUNCE_AT = 0.76;

export function rallyPhase(now: number, startAt: number): number {
  return (Math.max(0, now - startAt) % RALLY_MS) / RALLY_MS;
}

export function rallySoundStep(now: number, startAt: number): number {
  const phase = rallyPhase(now, startAt) * 2;
  return Math.floor(phase) * 2 + (phase % 1 >= BOUNCE_AT ? 1 : 0);
}

export class PingPongDisplay {
  readonly root = new THREE.Group();
  private readonly ball = new THREE.Mesh(sphere(0.044, 12), mat('#fff6d9'));
  private readonly scoreboard = new THREE.Mesh(plane(0.72, 0.24), mat('#2a534d'));
  private score = '';

  constructor(private readonly width: number, private readonly depth: number, private readonly height: number) {
    this.root.name = 'pingpong-display';
    this.root.userData.dynamic = true;
    this.scoreboard.position.set(width / 2, height - 0.075, depth - 0.185);
    this.scoreboard.rotation.x = -0.25;
    this.ball.name = 'pingpong-ball';
    this.root.add(this.ball, this.scoreboard);
    this.update(undefined, 0);
  }

  update(match: Gathering | undefined, now: number): void {
    const playing = match?.phase === 'run' && match.members.filter((m) => m.role === 'player' && !m.left).length === 2;
    this.ball.visible = playing;
    this.scoreboard.visible = !!match;
    if (!match) return;
    const score = match.score.join('  ·  ');
    if (score !== this.score) {
      this.score = score;
      this.scoreboard.material = texMat(`pingpong:${score}`, 160, 56, (ctx, w, h) => {
        ctx.fillStyle = '#2a534d';
        ctx.fillRect(0, 0, w, h);
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff0ca';
        ctx.fillText(score, w / 2, h / 2 + 2);
      }, 0.36);
    }
    if (playing) {
      const phase = rallyPhase(now, match.startAt);
      const u = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      const t = (phase * 2) % 1;
      const down = t / BOUNCE_AT;
      const up = (t - BOUNCE_AT) / (1 - BOUNCE_AT);
      const arc = t <= BOUNCE_AT ? 0.14 * (1 - down) + 0.19 * Math.sin(Math.PI * down) : 0.14 * up;
      this.ball.position.set(0.13 + (this.width - 0.26) * u, this.height + 0.046 + arc, this.depth / 2 + 0.18 * Math.sin(phase * Math.PI * 2));
    }
  }
}
