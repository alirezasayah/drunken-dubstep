// create_campaign: deterministic world generation from a seed.
import { AI_NAMES, DIFFICULTY, FACTION_COLORS, MACRO_AREAS, REGION_NAMES, SCHEMA_VERSION, TECHS, TERRAIN, TERRAIN_CODES, WORLD, BUILDINGS } from './config';
import { makeNoise, Rng } from './rng';
import type { Base, Building, BuildingType, CampaignState, Difficulty, Faction, Region, Research, Terrain, UnitGroup } from './types';
import { dist, newId } from './world';
import { refreshIntel } from './intel';

const PLAYER_REGION = 0;
const AI_REGIONS = [
  [3, 7],
  [15, 14],
  [12, 8],
];

export function createCampaign(opts: { name: string; difficulty: Difficulty; seed?: number; now: number; id?: string }): CampaignState {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = new Rng(seed);
  const { width, height, cell, regionGrid } = WORLD;
  const cols = width / cell, rows = height / cell;

  const s: CampaignState = {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id ?? `c_${seed.toString(36)}_${opts.now.toString(36)}`,
    name: opts.name,
    difficulty: opts.difficulty,
    seed,
    createdAt: opts.now,
    lastSimulatedAt: opts.now,
    gameTime: 0,
    status: 'active',
    idCounter: 0,
    playerFactionId: '',
    settings: { speed: 1, audio: { enabled: true, volume: 0.6 }, visual: { labels: true, effects: true } },
    world: { width, height, cell, cols, rows, terrain: '', regionMap: '' },
    regions: [], factions: [], bases: [], buildings: [], sites: [], units: [], queues: [], armies: [], missions: [],
    research: {}, battles: [], notifications: [], ledger: [], intel: [], ai: [], processedRequests: [],
  };

  // --- Regions (seed points on a jittered grid)
  const step = width / regionGrid;
  const names = [...REGION_NAMES];
  for (let r = 0; r < regionGrid; r++)
    for (let c = 0; c < regionGrid; c++) {
      const idx = r * regionGrid + c;
      const macro = MACRO_AREAS[(r < 2 ? 0 : 2) + (c < 2 ? 0 : 1)];
      const region: Region = {
        id: `r_${idx}`, index: idx, name: names[idx], area: macro,
        seed: { x: step * c + step / 2 + rng.range(-120, 120), y: step * r + step / 2 + rng.range(-120, 120) },
        terrain: 'grassland', ownerId: null, status: 'neutral', occupation: null,
      };
      s.regions.push(region);
    }

  // --- Terrain + region map
  const elev = makeNoise(seed ^ 0x9e3779b9);
  const moist = makeNoise(seed ^ 0x85ebca6b);
  const warp = makeNoise(seed ^ 0xc2b2ae35);
  const ter: Terrain[] = new Array(cols * rows);
  const reg: number[] = new Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const e = elev(x / 16, y / 16);
      const m = moist(x / 12 + 50, y / 12 + 50);
      let t: Terrain = 'grassland';
      if (e < 0.3) t = 'water';
      else if (e > 0.72) t = 'mountain';
      else if (e > 0.64) t = 'rocky';
      else if (m > 0.6) t = 'forest';
      else if (m < 0.36) t = 'desert';
      ter[y * cols + x] = t;
      const wx = x * cell + cell / 2, wy = y * cell + cell / 2;
      let best = 0, bd = Infinity;
      for (const rg of s.regions) {
        const d = dist(rg.seed, { x: wx, y: wy }) + (warp(wx / 90, wy / 90) - 0.5) * 140;
        if (d < bd) { bd = d; best = rg.index; }
      }
      reg[y * cols + x] = best;
    }
  const clear = (cx: number, cy: number, radius: number) => {
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const wx = x * cell + cell / 2, wy = y * cell + cell / 2;
        const d = Math.hypot(wx - cx, wy - cy);
        if (d <= radius && !TERRAIN[ter[y * cols + x]].buildable) ter[y * cols + x] = 'grassland';
        if (d <= radius * 0.6 && ter[y * cols + x] !== 'grassland' && d < 80) ter[y * cols + x] = 'grassland';
      }
  };
  // Make every region seed passable/buildable; bases get a larger cleared area.
  for (const rg of s.regions) clear(rg.seed.x, rg.seed.y, 70);
  const baseRegions = [PLAYER_REGION, ...AI_REGIONS.flat()];
  for (const idx of baseRegions) clear(s.regions[idx].seed.x, s.regions[idx].seed.y, idx === PLAYER_REGION || AI_REGIONS.some((a) => a[0] === idx) ? 200 : 140);
  // Ensure each region seed belongs to its own region
  for (const rg of s.regions) {
    const cx = Math.floor(rg.seed.x / cell), cy = Math.floor(rg.seed.y / cell);
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) if (x >= 0 && y >= 0 && x < cols && y < rows) reg[y * cols + x] = rg.index;
  }
  s.world.terrain = ter.map((t) => String.fromCharCode(48 + TERRAIN_CODES.indexOf(t))).join('');
  s.world.regionMap = reg.map((r) => String.fromCharCode(65 + r)).join('');
  for (const rg of s.regions) {
    const counts: Record<string, number> = {};
    for (let i = 0; i < reg.length; i++) if (reg[i] === rg.index) counts[ter[i]] = (counts[ter[i]] ?? 0) + 1;
    rg.terrain = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'grassland') as Terrain;
  }

  // --- Factions
  const research = (): Research[] => TECHS.map((t) => ({ key: t.key, level: 0, status: 'idle', startedAt: null, finishesAt: null }));
  const diff = DIFFICULTY[opts.difficulty];
  const pf: Faction = {
    id: 'f_player', name: 'Your Command', color: FACTION_COLORS.player, personality: 'player', isPlayer: true, hqBaseId: null,
    status: 'active', resources: { money: diff.startMoney, oil: 200, iron: 300, gold: 40, energy: 150 }, deficit: false, lowEnergy: false,
  };
  s.factions.push(pf);
  s.playerFactionId = pf.id;
  s.research[pf.id] = research();
  AI_NAMES.forEach((a, i) => {
    const f: Faction = {
      id: `f_ai${i}`, name: a.name, color: FACTION_COLORS.ai[i], personality: a.personality, isPlayer: false, hqBaseId: null,
      status: 'active', resources: { money: 1500, oil: 300, iron: 400, gold: 40, energy: 200 }, deficit: false, lowEnergy: false,
    };
    s.factions.push(f);
    s.research[f.id] = research();
    s.ai.push({ factionId: f.id, nextDecisionAt: 20 + i * 7, focus: 'build', lastAction: 'Established' });
  });

  const addBase = (fid: string, regionIdx: number, type: 'main' | 'forward', name: string): Base => {
    const rg = s.regions[regionIdx];
    rg.ownerId = fid;
    rg.status = 'controlled';
    const base: Base = {
      id: newId(s, 'b'), factionId: fid, regionId: rg.id, name, type, x: Math.round(rg.seed.x), y: Math.round(rg.seed.y),
      radius: type === 'main' ? WORLD.mainBaseRadius : WORLD.forwardBaseRadius, createdAt: 0,
    };
    s.bases.push(base);
    return base;
  };
  const addBuilding = (base: Base, type: BuildingType, dx: number, dy: number, level = 1) => {
    const d = BUILDINGS[type];
    const b: Building = {
      id: newId(s, 'bd'), baseId: base.id, type, level, x: base.x + dx, y: base.y + dy, rotation: 0, w: d.w, h: d.h, health: 1,
      status: 'operational', opStartedAt: null, opFinishesAt: null, createdAt: 0,
    };
    s.buildings.push(b);
    return b;
  };
  const addUnits = (fid: string, base: Base, type: UnitGroup['type'], qty: number, training: 0 | 1 | 2 = 0) => {
    s.units.push({
      id: newId(s, 'u'), factionId: fid, baseId: base.id, armyId: null, type, quantity: qty, trainingLevel: training,
      doctrine: 'combined_arms', health: 1, readiness: 1, busyUntil: null, createdAt: 0,
    });
  };

  const hq = addBase(pf.id, PLAYER_REGION, 'main', 'Main HQ');
  pf.hqBaseId = hq.id;
  addBuilding(hq, 'headquarters', 0, 0);
  addBuilding(hq, 'barracks', -95, -5);
  addBuilding(hq, 'drill_grounds', -95, 60);
  addBuilding(hq, 'supply_depot', 90, 0);
  addUnits(pf.id, hq, 'infantry', 24);

  AI_REGIONS.forEach(([main, fwd], i) => {
    const f = s.factions[i + 1];
    const b = addBase(f.id, main, 'main', `${f.name.split(' ')[0]} HQ`);
    f.hqBaseId = b.id;
    addBuilding(b, 'headquarters', 0, 0);
    addBuilding(b, 'barracks', -95, -5);
    addBuilding(b, 'supply_depot', 90, 0);
    addBuilding(b, 'power_plant', 0, 90);
    if (f.personality === 'defensive') {
      addBuilding(b, 'fortification', 0, -85);
      addBuilding(b, 'fortification', -60, -70);
    }
    addUnits(f.id, b, 'infantry', f.personality === 'expansionist' ? 34 : 28);
    const fb = addBase(f.id, fwd, 'forward', `${f.name.split(' ')[0]} Outpost`);
    addBuilding(fb, 'supply_depot', 70, 0);
    addBuilding(fb, 'fortification', -55, 0);
    addUnits(f.id, fb, 'infantry', f.personality === 'defensive' ? 18 : 12);
  });

  // --- Resource sites (20): 1 per AI region, 14 across neutral regions, oil guaranteed next to the player.
  const plan: { region: number; type?: 'oil' | 'iron' | 'gold' }[] = [];
  for (const idx of AI_REGIONS.flat()) plan.push({ region: idx });
  plan.push({ region: 1, type: 'oil' }, { region: 4, type: 'iron' });
  for (const idx of [2, 5, 6, 9, 10, 11, 13]) plan.push({ region: idx });
  for (const idx of [5, 6, 9, 10, 11]) plan.push({ region: idx });
  for (const p of plan.slice(0, WORLD.resourceSites)) {
    const rg = s.regions[p.region];
    const type = p.type ?? (rng.next() < 0.4 ? 'oil' : rng.next() < 0.67 ? 'iron' : 'gold');
    let pos = { x: rg.seed.x + 110, y: rg.seed.y };
    for (let tries = 0; tries < 80; tries++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(90, 190);
      const c = { x: rg.seed.x + Math.cos(a) * r, y: rg.seed.y + Math.sin(a) * r };
      const ci = Math.floor(c.y / cell) * cols + Math.floor(c.x / cell);
      if (c.x < 30 || c.y < 30 || c.x > width - 30 || c.y > height - 30) continue;
      if (reg[ci] !== rg.index || !TERRAIN[ter[ci]].buildable) continue;
      if (s.sites.some((o) => dist(o, c) < 90)) continue;
      if (s.bases.some((b) => dist(b, c) < 120)) continue;
      pos = c;
      break;
    }
    s.sites.push({
      id: newId(s, 's'), regionId: rg.id, type, x: Math.round(pos.x), y: Math.round(pos.y), quality: Math.round(rng.range(0.7, 1.35) * 100) / 100,
      level: 1, status: rg.ownerId ? 'operational' : 'neutral', opFinishesAt: null,
    });
  }

  // Intel records
  s.intel = s.regions.map((r) => ({ regionId: r.id, discovered: false, lastSeenAt: null, ownerId: null, estStrength: null }));
  refreshIntel(s);
  s.notifications.push({
    id: newId(s, 'n'), at: 0, kind: 'info', title: 'Command established',
    body: 'Your headquarters is operational. Scouts report an unclaimed oil field in the neighbouring region.', read: false,
  });
  return s;
}
