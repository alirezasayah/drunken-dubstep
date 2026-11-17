// World queries and derived values shared by operations, simulation, AI and UI.
import {
  ADJACENCY, BUILDINGS, DOCTRINES, levelOutputMult, RES_KEYS, SITE_OUTPUT, SUPPLY, TECH_BY_KEY, TERRAIN, TERRAIN_CODES, UNITS, WORLD,
} from './config';
import type {
  Army, Base, Building, BuildingType, CampaignState, Region, Resources, Terrain, UnitGroup, Vec2,
} from './types';

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export function newId(s: CampaignState, prefix: string) {
  s.idCounter += 1;
  return `${prefix}_${s.idCounter.toString(36)}`;
}

export const getFaction = (s: CampaignState, id: string) => s.factions.find((f) => f.id === id)!;
export const getRegion = (s: CampaignState, id: string) => s.regions.find((r) => r.id === id)!;
export const getBase = (s: CampaignState, id: string) => s.bases.find((b) => b.id === id);
export const player = (s: CampaignState) => getFaction(s, s.playerFactionId);

export function terrainAt(s: CampaignState, x: number, y: number): Terrain {
  const { cell, cols, rows, terrain } = s.world;
  const c = Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
  return TERRAIN_CODES[terrain.charCodeAt(r * cols + c) - 48];
}

export function regionIndexAt(s: CampaignState, x: number, y: number): number {
  const { cell, cols, rows, regionMap } = s.world;
  const c = Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
  return regionMap.charCodeAt(r * cols + c) - 65;
}

export function regionAt(s: CampaignState, x: number, y: number): Region | undefined {
  const idx = regionIndexAt(s, x, y);
  return s.regions.find((r) => r.index === idx);
}

export function techLevel(s: CampaignState, factionId: string, key: string): number {
  return s.research[factionId]?.find((r) => r.key === key)?.level ?? 0;
}

export function techBonus(s: CampaignState, factionId: string, key: string): number {
  return techLevel(s, factionId, key) * (TECH_BY_KEY[key]?.value ?? 0);
}

export const factionBases = (s: CampaignState, fid: string) => s.bases.filter((b) => b.factionId === fid);
export const baseBuildings = (s: CampaignState, baseId: string) => s.buildings.filter((b) => b.baseId === baseId);
export const isOperational = (b: Building) => b.status !== 'constructing'; // upgrading buildings keep working

export function buildingFaction(s: CampaignState, b: Building): string | undefined {
  return getBase(s, b.baseId)?.factionId;
}

export function adjacencyBonus(s: CampaignState, b: Building): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  const peers = baseBuildings(s, b.baseId);
  for (const rule of ADJACENCY.filter((r) => r.type === b.type)) {
    const n = peers.filter((p) => p.id !== b.id && p.type === rule.near && isOperational(p) && dist(p, b) <= rule.radius).length;
    if (n > 0) out.push({ label: rule.label, value: Math.min(rule.max, n * rule.bonus) });
  }
  return out;
}
export const adjacencyTotal = (s: CampaignState, b: Building) => adjacencyBonus(s, b).reduce((a, x) => a + x.value, 0);

// Storage capacity for stockpiled resources (money is uncapped).
export function storageCapacity(s: CampaignState, fid: string): number {
  let cap = 0;
  for (const base of factionBases(s, fid)) {
    cap += base.type === 'main' ? 800 : 300;
    for (const b of baseBuildings(s, base.id)) {
      const def = BUILDINGS[b.type];
      if (def.storage && isOperational(b)) cap += def.storage * levelOutputMult(b.level);
    }
  }
  return Math.round(cap * (1 + techBonus(s, fid, 'bulk_storage')));
}

export interface EconomyLine {
  source: string;
  ref: string;
  delta: Partial<Resources>;
}

/** Per-game-second income/upkeep breakdown. Efficiency penalties applied for deficit/low energy. */
export function economy(s: CampaignState, fid: string): { lines: EconomyLine[]; income: Resources; upkeep: Resources; net: Resources; efficiency: number } {
  const f = getFaction(s, fid);
  const lines: EconomyLine[] = [];
  const efficiency = (f.deficit ? 0.5 : 1) * (f.lowEnergy ? 0.6 : 1);
  const ai = !f.isPlayer;
  const diffMult = ai ? ({ easy: 0.8, normal: 1, hard: 1.25 } as const)[s.difficulty] : 1;
  const upkeepMult = 1 - techBonus(s, fid, 'maintenance_efficiency');

  for (const base of factionBases(s, fid)) {
    for (const b of baseBuildings(s, base.id)) {
      if (!isOperational(b)) continue;
      const def = BUILDINGS[b.type];
      const delta: Partial<Resources> = {};
      const lvl = levelOutputMult(b.level);
      const adj = 1 + adjacencyTotal(s, b);
      if (def.produces) for (const [k, v] of Object.entries(def.produces)) delta[k as keyof Resources] = (v as number) * lvl * adj * efficiency * diffMult * b.health;
      for (const [k, v] of Object.entries(def.upkeep)) {
        const key = k as keyof Resources;
        delta[key] = (delta[key] ?? 0) - (v as number) * (0.6 + 0.4 * b.level) * upkeepMult;
      }
      lines.push({ source: `${def.name} L${b.level} (${base.name})`, ref: b.id, delta });
    }
  }
  const extraction = 1 + techBonus(s, fid, 'resource_extraction');
  for (const site of s.sites) {
    const region = getRegion(s, site.regionId);
    if (region.ownerId !== fid || (site.status !== 'operational' && site.status !== 'upgrading')) continue;
    const amt = SITE_OUTPUT[site.type] * site.quality * levelOutputMult(site.level) * extraction * efficiency * diffMult;
    lines.push({ source: `${site.type[0].toUpperCase() + site.type.slice(1)} site L${site.level} (${region.name})`, ref: site.id, delta: { [site.type]: amt, money: -0.03 * site.level * upkeepMult } });
  }
  // Unit upkeep
  const unitUp: Partial<Resources> = {};
  for (const u of s.units) {
    if (u.factionId !== fid) continue;
    for (const [k, v] of Object.entries(UNITS[u.type].upkeep)) {
      const key = k as keyof Resources;
      unitUp[key] = (unitUp[key] ?? 0) - (v as number) * u.quantity * upkeepMult;
    }
  }
  if (Object.keys(unitUp).length) lines.push({ source: 'Military upkeep', ref: 'units', delta: unitUp });

  const income = { money: 0, oil: 0, iron: 0, gold: 0, energy: 0 };
  const upkeep = { money: 0, oil: 0, iron: 0, gold: 0, energy: 0 };
  for (const l of lines)
    for (const [k, v] of Object.entries(l.delta)) {
      const key = k as keyof Resources;
      if ((v as number) >= 0) income[key] += v as number;
      else upkeep[key] -= v as number;
    }
  const net = { ...income };
  for (const k of RES_KEYS) net[k] = income[k] - upkeep[k];
  return { lines, income, upkeep, net, efficiency };
}

export function canAfford(r: Resources, cost: Partial<Resources>) {
  return RES_KEYS.every((k) => (r[k] ?? 0) + 1e-9 >= (cost[k] ?? 0));
}

export function scaleCost(cost: Partial<Resources>, m: number): Partial<Resources> {
  const out: Partial<Resources> = {};
  for (const [k, v] of Object.entries(cost)) out[k as keyof Resources] = Math.round((v as number) * m);
  return out;
}

export function fmtCost(cost: Partial<Resources>) {
  return Object.entries(cost)
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]) => `${Math.round(v as number)} ${k}`)
    .join(', ');
}

// ---------- Supply ----------

export function supplyRadius(s: CampaignState, base: Base): number {
  const depots = baseBuildings(s, base.id).filter((b) => b.type === 'supply_depot' && isOperational(b));
  const lvl = depots.reduce((a, d) => a + d.level, 0);
  const r = (base.type === 'main' ? SUPPLY.baseRadius : SUPPLY.forwardRadius) + 40 * lvl;
  return r * (1 + techBonus(s, base.factionId, 'supply_lines'));
}

export function baseSupplyCapacity(s: CampaignState, base: Base): number {
  let cap = 0;
  for (const b of baseBuildings(s, base.id)) if (BUILDINGS[b.type].supply && isOperational(b)) cap += (BUILDINGS[b.type].supply ?? 0) * levelOutputMult(b.level);
  return Math.round(cap * (1 + techBonus(s, base.factionId, 'supply_lines')));
}

export function baseSupplyDemand(s: CampaignState, baseId: string): number {
  return s.units.filter((u) => u.baseId === baseId && !u.armyId).reduce((a, u) => a + u.quantity * UNITS[u.type].supply, 0);
}

export interface SupplyReport {
  status: 'supplied' | 'stretched' | 'disconnected';
  factor: number;
  reasons: string[];
}

export function armySupply(s: CampaignState, army: Pick<Army, 'factionId' | 'x' | 'y'>): SupplyReport {
  const bases = factionBases(s, army.factionId);
  const f = getFaction(s, army.factionId);
  const reasons: string[] = [];
  let best: { base: Base; d: number; r: number } | null = null;
  for (const b of bases) {
    const d = dist(b, army);
    const r = supplyRadius(s, b);
    if (!best || d - r < best.d - best.r) best = { base: b, d, r };
  }
  if (!best) return { status: 'disconnected', factor: 0.6, reasons: ['No friendly bases remain.'] };
  if (f.deficit) reasons.push('Faction maintenance deficit reduces supply throughput.');
  if (best.d <= best.r) {
    reasons.unshift(`Within ${Math.round(best.r)}u supply radius of ${best.base.name} (${Math.round(best.d)}u away).`);
    return { status: 'supplied', factor: f.deficit ? 0.85 : 1, reasons };
  }
  if (best.d <= best.r * 1.6) {
    reasons.unshift(`${Math.round(best.d - best.r)}u beyond the supply radius of ${best.base.name}. Build a forward base or Supply Depot closer.`);
    return { status: 'stretched', factor: 0.85, reasons };
  }
  reasons.unshift(`Out of supply: nearest base ${best.base.name} is ${Math.round(best.d)}u away (radius ${Math.round(best.r)}u).`);
  return { status: 'disconnected', factor: 0.65, reasons };
}

export function baseSupply(s: CampaignState, base: Base): SupplyReport {
  const cap = baseSupplyCapacity(s, base);
  const demand = baseSupplyDemand(s, base.id);
  const reasons = [`Capacity ${cap} / garrison demand ${demand}.`];
  if (demand <= cap) return { status: 'supplied', factor: 1, reasons };
  reasons.push('Garrison exceeds supply capacity. Build or upgrade Supply Depots or move units into armies.');
  return { status: demand <= cap * 1.5 ? 'stretched' : 'disconnected', factor: demand <= cap * 1.5 ? 0.9 : 0.75, reasons };
}

// ---------- Military strength ----------

export function groupStrength(u: Pick<UnitGroup, 'type' | 'quantity' | 'health' | 'readiness' | 'trainingLevel'>) {
  const d = UNITS[u.type];
  return u.quantity * (d.atk * 2 + d.def + d.hp / 10) * (0.4 + 0.6 * u.health) * (0.5 + 0.5 * u.readiness) * [1, 1.18, 1.38][u.trainingLevel];
}

export const armyUnits = (s: CampaignState, armyId: string) => s.units.filter((u) => u.armyId === armyId);

export function armyStrength(s: CampaignState, armyId: string) {
  return armyUnits(s, armyId).reduce((a, u) => a + groupStrength(u), 0);
}

export function regionDefenders(s: CampaignState, region: Region): { units: UnitGroup[]; armies: Army[] } {
  if (!region.ownerId) return { units: [], armies: [] };
  const baseIds = new Set(s.bases.filter((b) => b.regionId === region.id && b.factionId === region.ownerId).map((b) => b.id));
  const armies = s.armies.filter((a) => a.factionId === region.ownerId && a.regionId === region.id && a.status === 'stationed');
  const armyIds = new Set(armies.map((a) => a.id));
  const units = s.units.filter(
    (u) => u.factionId === region.ownerId && u.quantity > 0 && ((u.baseId && baseIds.has(u.baseId) && !u.armyId) || (u.armyId && armyIds.has(u.armyId))),
  );
  return { units, armies };
}

export function regionStrength(s: CampaignState, region: Region) {
  const { units } = regionDefenders(s, region);
  const forts = s.buildings.filter((b) => b.type === 'fortification' && getBase(s, b.baseId)?.regionId === region.id && isOperational(b));
  const fortMult = 1 + forts.reduce((a, f) => a + 0.08 * f.level, 0);
  return units.reduce((a, u) => a + groupStrength(u), 0) * fortMult;
}

export function armySpeed(s: CampaignState, army: Army): number {
  const units = armyUnits(s, army.id);
  if (!units.length) return 6;
  const min = Math.min(...units.map((u) => UNITS[u.type].mobility * DOCTRINES[u.doctrine].speed));
  return min * (1 + techBonus(s, army.factionId, 'transport_efficiency'));
}

/** Travel time sampled along the straight path; terrain slows movement. */
export function travelTime(s: CampaignState, from: Vec2, to: Vec2, speed: number, supplyFactor = 1): number {
  const d = dist(from, to);
  const steps = Math.max(4, Math.ceil(d / 40));
  let t = 0;
  for (let i = 0; i < steps; i++) {
    const p = (i + 0.5) / steps;
    const ter = terrainAt(s, from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p);
    t += d / steps / (speed * TERRAIN[ter].move);
  }
  return t / Math.max(0.7, supplyFactor);
}

export function armyPositionAt(s: CampaignState, army: Army, gameTime = s.gameTime): Vec2 {
  if (army.status !== 'moving' || !army.missionId) return { x: army.x, y: army.y };
  const m = s.missions.find((mm) => mm.id === army.missionId);
  if (!m) return { x: army.x, y: army.y };
  const p = Math.min(1, Math.max(0, (gameTime - m.startedAt) / Math.max(0.001, m.arrivesAt - m.startedAt)));
  return { x: m.from.x + (m.to.x - m.from.x) * p, y: m.from.y + (m.to.y - m.from.y) * p };
}

// ---------- Placement ----------

export function footprint(type: BuildingType, rotation: 0 | 90) {
  const d = BUILDINGS[type];
  return rotation === 90 ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
}

export function validatePlacement(
  s: CampaignState,
  factionId: string,
  baseId: string,
  type: BuildingType,
  x: number,
  y: number,
  rotation: 0 | 90,
): { ok: boolean; reason?: string } {
  const base = getBase(s, baseId);
  if (!base || base.factionId !== factionId) return { ok: false, reason: 'Base not controlled.' };
  const { w, h } = footprint(type, rotation);
  const corners = [
    { x: x - w / 2, y: y - h / 2 }, { x: x + w / 2, y: y - h / 2 },
    { x: x - w / 2, y: y + h / 2 }, { x: x + w / 2, y: y + h / 2 }, { x, y },
  ];
  if (corners.some((c) => c.x < 0 || c.y < 0 || c.x > s.world.width || c.y > s.world.height)) return { ok: false, reason: 'Outside the map.' };
  if (corners.some((c) => dist(c, base) > base.radius)) return { ok: false, reason: 'Outside the base construction radius.' };
  for (const c of corners) {
    const reg = regionAt(s, c.x, c.y);
    if (!reg || reg.ownerId !== factionId) return { ok: false, reason: 'Area is not owned territory.' };
    if (!TERRAIN[terrainAt(s, c.x, c.y)].buildable) return { ok: false, reason: `Cannot build on ${terrainAt(s, c.x, c.y)}.` };
  }
  const pad = 4;
  for (const b of s.buildings) {
    if (Math.abs(b.x - x) * 2 < b.w + w + pad && Math.abs(b.y - y) * 2 < b.h + h + pad) return { ok: false, reason: `Overlaps ${BUILDINGS[b.type].name}.` };
  }
  for (const site of s.sites) {
    if (Math.abs(site.x - x) * 2 < 36 + w && Math.abs(site.y - y) * 2 < 36 + h) return { ok: false, reason: 'Overlaps a resource site.' };
  }
  return { ok: true };
}

export function validateBaseSite(s: CampaignState, factionId: string, x: number, y: number): { ok: boolean; reason?: string } {
  const reg = regionAt(s, x, y);
  if (!reg || reg.ownerId !== factionId) return { ok: false, reason: 'Forward bases need owned territory.' };
  if (reg.status === 'contested') return { ok: false, reason: 'Region is contested.' };
  if (!TERRAIN[terrainAt(s, x, y)].buildable) return { ok: false, reason: `Cannot build on ${terrainAt(s, x, y)}.` };
  for (const b of s.bases) if (dist(b, { x, y }) < WORLD.minBaseSeparation) return { ok: false, reason: `Too close to ${b.name} (min ${WORLD.minBaseSeparation}u).` };
  return { ok: true };
}

export function countVisible(s: CampaignState, fid: string): Set<string> {
  // returns ids of regions currently visible to a faction
  const f = getFaction(s, fid);
  const vis = new Set<string>();
  const visionMult = 1 + techBonus(s, fid, 'surveillance');
  const sources: { x: number; y: number; r: number }[] = [];
  for (const base of factionBases(s, fid)) {
    let r = base.type === 'main' ? 480 : 340;
    for (const b of baseBuildings(s, base.id)) {
      const def = BUILDINGS[b.type];
      if (b.type === 'radar_station' && isOperational(b)) r += (def.vision ?? 0) * levelOutputMult(b.level) * (1 + adjacencyTotal(s, b));
    }
    sources.push({ x: base.x, y: base.y, r: r * visionMult });
  }
  for (const a of s.armies.filter((a) => a.factionId === fid)) {
    const pos = armyPositionAt(s, a);
    sources.push({ ...pos, r: 300 * DOCTRINES[a.doctrine].vision * visionMult });
  }
  for (const reg of s.regions) {
    if (reg.ownerId === f.id) {
      vis.add(reg.id);
      continue;
    }
    if (sources.some((src) => dist(src, reg.seed) <= src.r)) vis.add(reg.id);
  }
  return vis;
}
