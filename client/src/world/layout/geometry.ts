// Geometria do prédio: mapeamento de slots, colunas e retângulos. Puro e testável.
import { BUILDING_H, COL_W, CORE_COLS, FLOOR_COLS, CORRIDOR_H, CORRIDOR_Y, NORTH_Y, ROOM_H, SOUTH_Y, TILE } from '../constants';
import type { TileRect } from './types';

export type Side = 'north' | 'south';

/** Salas de projeto por andar (2 colunas x norte/sul; a 1ª coluna do andar é o hall + reuniões). */
export const ROOMS_PER_FLOOR = 4;

/** Andar (0 = térreo) de um tile x. Os andares ficam lado a lado na grade; o 3D empilha. */
export function floorOfX(tx: number): number {
  return Math.floor(tx / (FLOOR_COLS * COL_W));
}

export function slotFloor(slot: number): number {
  return 1 + Math.floor(Math.max(0, slot) / ROOMS_PER_FLOOR);
}

/** Coluna do prédio (0 = núcleo A) ocupada por um slot de sala de projeto. */
export function slotColumn(slot: number): number {
  const s = Math.max(0, slot);
  return FLOOR_COLS * slotFloor(s) + 1 + Math.floor((s % ROOMS_PER_FLOOR) / 2);
}

/** Coluna de hall (1ª de cada andar acima do térreo): não tem slot de projeto. */
export function isHallColumn(col: number): boolean {
  return col >= CORE_COLS && col % FLOOR_COLS === 0;
}

/** Slot par = norte do corredor; ímpar = sul. */
export function slotSide(slot: number): Side {
  return Math.max(0, slot) % 2 === 0 ? 'north' : 'south';
}

/** Retângulo (tiles) de uma sala em uma coluna/lado. */
export function cellRect(col: number, side: Side): TileRect {
  return { x: col * COL_W, y: side === 'north' ? NORTH_Y : SOUTH_Y, w: COL_W, h: ROOM_H };
}

export function slotRect(slot: number): TileRect {
  return cellRect(slotColumn(slot), slotSide(slot));
}

/** Slot correspondente a uma coluna/lado de projeto (inverso de slotColumn/slotSide). */
export function slotAt(col: number, side: Side): number {
  if (col < CORE_COLS || isHallColumn(col)) return -1;
  return (Math.floor(col / FLOOR_COLS) - 1) * ROOMS_PER_FLOOR + ((col % FLOOR_COLS) - 1) * 2 + (side === 'north' ? 0 : 1);
}

/** Total de colunas do prédio para um conjunto de slots em uso (mínimo: 1 coluna de projeto). */
export function columnsFor(slots: Iterable<number>): number {
  let top = 1;
  for (const s of slots) top = Math.max(top, slotFloor(s));
  return FLOOR_COLS * (top + 1);
}

export function corridorRect(cols: number): TileRect {
  return { x: 0, y: CORRIDOR_Y, w: cols * COL_W, h: CORRIDOR_H };
}

export function buildingRect(cols: number): TileRect {
  return { x: 0, y: 0, w: cols * COL_W, h: BUILDING_H };
}

export function rectPx(r: TileRect): { x: number; y: number; w: number; h: number } {
  return { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE };
}

export function inRect(r: TileRect, tx: number, ty: number): boolean {
  return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
}
