// Montagem do prédio: núcleo + corredor + salas de projeto -> grade de caminhabilidade e spots.
import { FURNITURE } from '../../art/api';
import { BUILDING_H, COL_W, FLOOR_COLS } from '../constants';
import { BLOCKED, FREE, SEAT, WalkGrid } from '../path/grid';
import { furnitureBlocks, furnitureIsSeat } from './builder';
import { layoutCafe, layoutLibrary, layoutLounge, layoutMeeting, layoutReception, layoutRestroom } from './core';
import { layoutCorridor } from './corridor';
import { buildingRect } from './geometry';
import type { AreaLayout, SpotDef, TileRect } from './types';

export interface BuildingLayout {
  cols: number;
  rect: TileRect;
  core: AreaLayout[];
  corridor: AreaLayout;
  rooms: AreaLayout[];
  grid: WalkGrid;
  spots: SpotDef[];
}

let coreCache: AreaLayout[] | null = null;
const floorCache = new Map<number, AreaLayout[]>();

/** Hall de elevadores + sala de reuniões de um andar acima do térreo. */
export function floorAreas(f: number): AreaLayout[] {
  let a = floorCache.get(f);
  if (!a) floorCache.set(f, (a = [layoutReception(f), layoutMeeting(f)]));
  return a;
}

/** Áreas fixas do núcleo (calculadas uma vez). */
export function coreAreas(): AreaLayout[] {
  return (coreCache ??= [layoutReception(), layoutRestroom(), layoutCafe(), layoutLounge(), layoutLibrary(), layoutMeeting()]);
}

/** Marca na grade as células caminháveis de uma área, os bloqueios e os assentos. */
export function paintArea(grid: WalkGrid, area: AreaLayout): void {
  for (const r of area.walkable) grid.fill(r.x, r.y, r.w, r.h, FREE);
  for (const r of area.blocked ?? []) grid.fill(r.x, r.y, r.w, r.h, BLOCKED);
  for (const f of area.furniture) {
    const def = FURNITURE[f.kind];
    if (def.mount !== 'floor') continue;
    const { w, h } = def.footprint;
    if (furnitureBlocks(f.kind)) grid.fill(f.tx, f.ty, w, h, BLOCKED);
    else if (furnitureIsSeat(f.kind)) {
      for (let y = f.ty; y < f.ty + h; y++) for (let x = f.tx; x < f.tx + w; x++) if (grid.get(x, y) === FREE) grid.set(x, y, SEAT);
    }
  }
}

export function buildWalkGrid(cols: number, areas: readonly AreaLayout[], version = 0): WalkGrid {
  const width = Math.max(cols * COL_W, ...areas.map((a) => a.rect.x + a.rect.w));
  const grid = new WalkGrid(width, BUILDING_H, version);
  for (const a of areas) paintArea(grid, a);
  return grid;
}

export function assembleBuilding(cols: number, rooms: readonly AreaLayout[], version = 0, campus = false): BuildingLayout {
  const halls: AreaLayout[] = [];
  for (let f = 1; f < cols / FLOOR_COLS; f++) halls.push(...floorAreas(f));
  const core = [...coreAreas(), ...halls];
  const corridor = layoutCorridor(cols, campus);
  const all = [...core, corridor, ...rooms];
  const grid = buildWalkGrid(cols, all, version);
  const spots: SpotDef[] = [];
  for (const a of all) spots.push(...a.spots);
  return { cols, rect: buildingRect(cols), core, corridor, rooms: [...rooms], grid, spots };
}
