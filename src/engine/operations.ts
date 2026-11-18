// Authoritative game operations. Each validates ownership, prerequisites, resources and state.
// Used identically by the player (through the server) and by AI factions.
import {
  BUILDINGS, COMMANDER_NAMES, DOCTRINE_RETRAIN, DOCTRINES, FORWARD_BASE_COST, levelCostMult, levelTimeMult, MAX_CONCURRENT_RESEARCH, MAX_LEVEL,
  SITE_UPGRADE_COST, SITE_UPGRADE_TIME, TECH_BY_KEY, techCost, TRAINING_COST, TRAINING_LEVELS, TRAINING_TIME, UNITS, WORLD, BASE_LIMIT,
} from './config';
import { applyCommand, createBattle, stepBattle, survivorsByUnit, TICK_RATE, type BattleCommand } from './battle';
import { missingFor, notify, refreshIntel, spend } from './intel';
import type { Army, Base, Building, BuildingType, CampaignState, Doctrine, OpResult, Region, Resources, UnitGroup, UnitType } from './types';
import {
  adjacencyTotal, armySpeed, armySupply, baseBuildings, dist, factionBases, footprint, getBase, getFaction, getRegion, isOperational, newId,
  regionAt, regionDefenders, scaleCost, techBonus, techLevel, travelTime, validateBaseSite, validatePlacement,
} from './world';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function hqLevel(s: CampaignState, fid: string): number {
  const f = getFaction(s, fid);
  const hq = f.hqBaseId ? baseBuildings(s, f.hqBaseId).find((b) => b.type === 'headquarters') : undefined;
  return hq?.level ?? 1;
}

export function constructionSlots(s: CampaignState, fid: string) {
  const max = 2 + Math.floor((hqLevel(s, fid) - 1) / 3);
  const used = s.buildings.filter((b) => b.status !== 'operational' && getBase(s, b.baseId)?.factionId === fid).length;
  return { max, used };
}

export function baseCapacity(s: CampaignState, base: Base) {
  const max = base.type === 'main' ? 8 + 2 * (hqLevel(s, base.factionId) - 1) : 6;
  return { max, used: baseBuildings(s, base.id).length };
}

export function buildCost(type: BuildingType): Partial<Resources> {
  return BUILDINGS[type].cost;
}

export function upgradeCost(b: Pick<Building, 'type' | 'level'>): Partial<Resources> {
  if (b.type === 'headquarters') return scaleCost({ money: 800, iron: 250, gold: 20 }, levelCostMult(b.level + 1) / 1.6);
  return scaleCost(BUILDINGS[b.type].cost, levelCostMult(b.level + 1) * 0.8);
}

export function opTime(s: CampaignState, fid: string, type: BuildingType, level: number) {
  const base = type === 'headquarters' ? 90 : BUILDINGS[type].buildTime;
  return Math.max(5, Math.round(base * levelTimeMult(level) * (1 - techBonus(s, fid, 'construction_methods'))));
}

export function buildingAvailable(s: CampaignState, fid: string, base: Base, type: BuildingType): string | null {
  const def = BUILDINGS[type];
  if (!def.buildable) return 'Cannot be constructed.';
  if (base.type === 'forward' && !def.forwardAllowed) return 'Not available at forward bases.';
  if (def.requiresTech && techLevel(s, fid, def.requiresTech) < 1) return `Requires research: ${TECH_BY_KEY[def.requiresTech].name}.`;
  if (def.maxPerBase && baseBuildings(s, base.id).filter((b) => b.type === type).length >= def.maxPerBase) return `Limit ${def.maxPerBase} per base.`;
  const cap = baseCapacity(s, base);
  if (cap.used >= cap.max) return `Base is at capacity (${cap.max}). Upgrade the Headquarters.`;
  return null;
}

export function placeBuilding(
  s: CampaignState, fid: string, a: { baseId: string; type: BuildingType; x: number; y: number; rotation?: 0 | 90 },
): OpResult<{ buildingId: string }> {
  const base = getBase(s, a.baseId);
  if (!base || base.factionId !== fid) return fail('You do not control this base.');
  if (!BUILDINGS[a.type]) return fail('Unknown building type.');
  const avail = buildingAvailable(s, fid, base, a.type);
  if (avail) return fail(avail);
  const slots = constructionSlots(s, fid);
  if (slots.used >= slots.max) return fail(`All ${slots.max} construction crews are busy.`);
  const rot = a.rotation === 90 ? 90 : 0;
  const x = Math.round(a.x), y = Math.round(a.y);
  const v = validatePlacement(s, fid, base.id, a.type, x, y, rot);
  if (!v.ok) return fail(v.reason!);
  const cost = buildCost(a.type);
  const f = getFaction(s, fid);
  const id = newId(s, 'bd');
  if (!spend(s, fid, cost, 'construction', id)) return fail(`Insufficient resources: need ${missingFor(f.resources, cost)}.`);
  const { w, h } = footprint(a.type, rot);
  const t = opTime(s, fid, a.type, 1);
  s.buildings.push({
    id, baseId: base.id, type: a.type, level: 1, x, y, rotation: rot, w, h, health: 1, status: 'constructing',
    opStartedAt: s.gameTime, opFinishesAt: s.gameTime + t, createdAt: s.gameTime,
  });
  return { ok: true, data: { buildingId: id } };
}

export function upgradeBuilding(s: CampaignState, fid: string, a: { buildingId: string }): OpResult {
  const b = s.buildings.find((x) => x.id === a.buildingId);
  if (!b) return fail('Building not found.');
  const base = getBase(s, b.baseId);
  if (!base || base.factionId !== fid) return fail('You do not control this building.');
  if (b.status !== 'operational') return fail('Building is busy.');
  if (b.level >= MAX_LEVEL) return fail('Maximum level reached.');
  if (b.type !== 'headquarters' && b.level >= hqLevel(s, fid) + 1) return fail(`Upgrade the Headquarters first (buildings may be at most HQ level + 1).`);
  const slots = constructionSlots(s, fid);
  if (slots.used >= slots.max) return fail(`All ${slots.max} construction crews are busy.`);
  const cost = upgradeCost(b);
  if (!spend(s, fid, cost, 'upgrade', b.id)) return fail(`Insufficient resources: need ${missingFor(getFaction(s, fid).resources, cost)}.`);
  b.status = 'upgrading';
  b.opStartedAt = s.gameTime;
  b.opFinishesAt = s.gameTime + opTime(s, fid, b.type, b.level + 1);
  return { ok: true };
}

export function upgradeSite(s: CampaignState, fid: string, a: { siteId: string }): OpResult {
  const site = s.sites.find((x) => x.id === a.siteId);
  if (!site) return fail('Site not found.');
  if (getRegion(s, site.regionId).ownerId !== fid) return fail('You do not control this site.');
  if (site.status !== 'operational') return fail('Site is not operational.');
  if (site.level >= MAX_LEVEL) return fail('Maximum level reached.');
  const cost = SITE_UPGRADE_COST(site.level);
  if (!spend(s, fid, cost, 'site_upgrade', site.id)) return fail(`Insufficient resources: need ${missingFor(getFaction(s, fid).resources, cost)}.`);
  site.status = 'upgrading';
  site.opFinishesAt = s.gameTime + SITE_UPGRADE_TIME(site.level) * (1 - techBonus(s, fid, 'construction_methods'));
  return { ok: true };
}

// ---------- Recruitment & training ----------

export function queueCapacity(b: Building) {
  return 2 + b.level;
}

export function recruitTimePerUnit(s: CampaignState, fid: string, b: Building, type: UnitType) {
  const speed = (1 + 0.15 * (b.level - 1)) * (1 + adjacencyTotal(s, b));
  return (UNITS[type].time * (1 - techBonus(s, fid, 'recruitment_drill'))) / speed;
}

function buildingQueueEnd(s: CampaignState, buildingId: string) {
  return s.queues.filter((q) => q.buildingId === buildingId).reduce((a, q) => Math.max(a, q.finishesAt), s.gameTime);
}

export function startRecruitment(s: CampaignState, fid: string, a: { buildingId: string; unitType: UnitType; quantity: number }): OpResult {
  const b = s.buildings.find((x) => x.id === a.buildingId);
  if (!b) return fail('Facility not found.');
  const base = getBase(s, b.baseId);
  if (!base || base.factionId !== fid) return fail('You do not control this facility.');
  const def = UNITS[a.unitType];
  if (!def) return fail('Unknown unit type.');
  if (def.facility !== b.type) return fail(`${def.name} requires a ${BUILDINGS[def.facility].name}.`);
  if (!isOperational(b)) return fail('Facility is under construction.');
  const qty = Math.floor(a.quantity);
  if (!(qty >= 1 && qty <= 50)) return fail('Quantity must be between 1 and 50.');
  if (s.queues.filter((q) => q.buildingId === b.id).length >= queueCapacity(b)) return fail(`Queue full (${queueCapacity(b)}). Upgrade the facility.`);
  const cost = scaleCost(def.cost, qty);
  const id = newId(s, 'q');
  if (!spend(s, fid, cost, 'recruitment', id)) return fail(`Insufficient resources: need ${missingFor(getFaction(s, fid).resources, cost)}.`);
  const start = buildingQueueEnd(s, b.id);
  s.queues.push({
    id, factionId: fid, baseId: base.id, buildingId: b.id, kind: 'recruit', unitType: a.unitType, quantity: qty, unitId: null,
    startedAt: start, finishesAt: start + recruitTimePerUnit(s, fid, b, a.unitType) * qty,
  });
  return { ok: true };
}

function drillFor(s: CampaignState, fid: string, buildingId: string, unit: UnitGroup): Building | string {
  const b = s.buildings.find((x) => x.id === buildingId);
  if (!b || b.type !== 'drill_grounds') return 'Training requires Drill Grounds.';
  const base = getBase(s, b.baseId);
  if (!base || base.factionId !== fid) return 'You do not control this facility.';
  if (!isOperational(b)) return 'Drill Grounds under construction.';
  if (unit.factionId !== fid) return 'Not your unit.';
  if (unit.armyId) return 'Unit is assigned to an army. Disband or return it first.';
  if (unit.baseId !== base.id) return 'Unit must be garrisoned at this base.';
  if (unit.busyUntil && unit.busyUntil > s.gameTime) return 'Unit is already in training.';
  if (s.queues.filter((q) => q.buildingId === b.id).length >= queueCapacity(b)) return 'Training queue full.';
  return b;
}

export function startTraining(s: CampaignState, fid: string, a: { unitId: string; buildingId: string }): OpResult {
  const unit = s.units.find((u) => u.id === a.unitId);
  if (!unit) return fail('Unit not found.');
  if (unit.type !== 'infantry') return fail('Only infantry train at Drill Grounds in this build.');
  if (unit.trainingLevel >= 2) return fail('Already at Advanced training.');
  const b = drillFor(s, fid, a.buildingId, unit);
  if (typeof b === 'string') return fail(b);
  const target = (unit.trainingLevel + 1) as 1 | 2;
  const cost = TRAINING_COST(unit.type, unit.quantity, target);
  const id = newId(s, 'q');
  if (!spend(s, fid, cost, 'training', id)) return fail(`Insufficient resources: need ${missingFor(getFaction(s, fid).resources, cost)}.`);
  const start = buildingQueueEnd(s, b.id);
  const time = TRAINING_TIME(unit.quantity, target) / ((1 + 0.15 * (b.level - 1)) * (1 + adjacencyTotal(s, b)));
  s.queues.push({ id, factionId: fid, baseId: b.baseId, buildingId: b.id, kind: 'train', unitType: unit.type, quantity: unit.quantity, unitId: unit.id, targetTraining: target, startedAt: start, finishesAt: start + time });
  unit.busyUntil = start + time;
  return { ok: true, data: { level: TRAINING_LEVELS[target] } };
}

export function changeDoctrine(s: CampaignState, fid: string, a: { unitId: string; buildingId: string; doctrine: Doctrine }): OpResult {
  const unit = s.units.find((u) => u.id === a.unitId);
  if (!unit) return fail('Unit not found.');
  if (!DOCTRINES[a.doctrine]) return fail('Unknown doctrine.');
  if (unit.doctrine === a.doctrine) return fail('Unit already follows this doctrine.');
  const b = drillFor(s, fid, a.buildingId, unit);
  if (typeof b === 'string') return fail(b);
  const cost = { money: DOCTRINE_RETRAIN.money * unit.quantity };
  const id = newId(s, 'q');
  if (!spend(s, fid, cost, 'doctrine', id)) return fail(`Insufficient resources: need ${missingFor(getFaction(s, fid).resources, cost)}.`);
  const start = buildingQueueEnd(s, b.id);
  const time = DOCTRINE_RETRAIN.time + unit.quantity * 0.5;
  s.queues.push({ id, factionId: fid, baseId: b.baseId, buildingId: b.id, kind: 'doctrine', unitType: unit.type, quantity: unit.quantity, unitId: unit.id, targetDoctrine: a.doctrine, startedAt: start, finishesAt: start + time });
  unit.busyUntil = start + time;
  return { ok: true };
}

// ---------- Research ----------

export function researchAvailability(s: CampaignState, fid: string, key: string): string | null {
  const def = TECH_BY_KEY[key];
  if (!def) return 'Unknown technology.';
  const row = s.research[fid].find((r) => r.key === key)!;
  if (row.level >= def.maxLevel) return 'Fully researched.';
  if (row.status === 'researching') return 'In progress.';
  for (const req of def.requires) if (techLevel(s, fid, req.key) < req.level) return `Requires ${TECH_BY_KEY[req.key].name} ${req.level}.`;
  if (s.research[fid].filter((r) => r.status === 'researching').length >= MAX_CONCURRENT_RESEARCH) return 'Research capacity in use.';
  return null;
}

export function startResearch(s: CampaignState, fid: string, a: { key: string }): OpResult {
  const why = researchAvailability(s, fid, a.key);
  if (why) return fail(why);
  const def = TECH_BY_KEY[a.key];
  const row = s.research[fid].find((r) => r.key === a.key)!;
  const cost = techCost(def, row.level + 1);
  if (!spend(s, fid, cost, 'research', a.key)) return fail(`Insufficient resources: need ${missingFor(getFaction(s, fid).resources, cost)}.`);
  row.status = 'researching';
  row.startedAt = s.gameTime;
  row.finishesAt = s.gameTime + def.time * Math.pow(1.4, row.level);
  return { ok: true };
}

// ---------- Armies & missions ----------

export function createArmy(s: CampaignState, fid: string, a: { baseId: string; name?: string; allocations: { unitId: string; quantity: number }[]; doctrine?: Doctrine }): OpResult<{ armyId: string }> {
  const base = getBase(s, a.baseId);
  if (!base || base.factionId !== fid) return fail('You do not control this base.');
  const allocs = a.allocations.filter((x) => x.quantity > 0);
  if (!allocs.length) return fail('Assign at least one unit.');
  for (const al of allocs) {
    const u = s.units.find((x) => x.id === al.unitId);
    if (!u || u.factionId !== fid) return fail('Unit not found.');
    if (u.armyId || u.baseId !== base.id) return fail('Units must be garrisoned at this base.');
    if (u.busyUntil && u.busyUntil > s.gameTime) return fail('Units in training cannot deploy.');
    if (!Number.isInteger(al.quantity) || al.quantity < 1 || al.quantity > u.quantity) return fail(`Invalid quantity for ${UNITS[u.type].name}.`);
  }
  const armyCount = s.armies.filter((x) => x.factionId === fid).length;
  const id = newId(s, 'a');
  const army: Army = {
    id, factionId: fid, name: a.name?.trim().slice(0, 32) || `${ordinal(armyCount + 1)} Battle Group`,
    commander: `Cdr. ${COMMANDER_NAMES[(s.idCounter * 7) % COMMANDER_NAMES.length]}`, homeBaseId: base.id, x: base.x + 30, y: base.y + 40,
    regionId: base.regionId, status: 'stationed', missionId: null, doctrine: a.doctrine ?? 'combined_arms', createdAt: s.gameTime,
  };
  s.armies.push(army);
  for (const al of allocs) {
    const u = s.units.find((x) => x.id === al.unitId)!;
    if (al.quantity === u.quantity) {
      u.armyId = id;
      u.baseId = null;
    } else {
      u.quantity -= al.quantity;
      s.units.push({ ...u, id: newId(s, 'u'), quantity: al.quantity, armyId: id, baseId: null });
    }
  }
  return { ok: true, data: { armyId: id } };
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function disbandArmy(s: CampaignState, fid: string, a: { armyId: string }): OpResult {
  const army = s.armies.find((x) => x.id === a.armyId);
  if (!army || army.factionId !== fid) return fail('Army not found.');
  if (army.status !== 'stationed') return fail('Army must be stationed to disband.');
  const base = s.bases.find((b) => b.factionId === fid && dist(b, army) <= b.radius + 60);
  if (!base) return fail('Army must be at a friendly base to disband. Send it home first.');
  mergeIntoGarrison(s, army, base);
  return { ok: true };
}

function mergeIntoGarrison(s: CampaignState, army: Army, base: Base) {
  for (const u of s.units.filter((x) => x.armyId === army.id)) {
    u.armyId = null;
    u.baseId = base.id;
  }
  s.armies = s.armies.filter((x) => x.id !== army.id);
  s.missions = s.missions.filter((m) => m.armyId !== army.id || m.status === 'active');
}

export function launchMission(
  s: CampaignState, fid: string, a: { armyId: string; type: 'capture' | 'reinforce' | 'return' | 'move'; targetRegionId?: string; targetBaseId?: string },
): OpResult<{ arrivesIn: number }> {
  const army = s.armies.find((x) => x.id === a.armyId);
  if (!army || army.factionId !== fid) return fail('Army not found.');
  if (army.status !== 'stationed') return fail(`Army is ${army.status.replace('_', ' ')}.`);
  const units = s.units.filter((u) => u.armyId === army.id && u.quantity > 0);
  if (!units.length) return fail('Army has no units.');
  let to: { x: number; y: number };
  let targetRegionId: string;
  let targetBaseId: string | null = null;
  if (a.type === 'capture' || a.type === 'move') {
    const region = a.targetRegionId ? s.regions.find((r) => r.id === a.targetRegionId) : undefined;
    if (!region) return fail('Select a target region.');
    if (a.type === 'capture' && region.ownerId === fid) return fail('Region already under your control.');
    if (a.type === 'move' && region.ownerId !== fid) return fail('Armies may only reposition inside your territory. Use Capture for other regions.');
    if (region.id === army.regionId && a.type === 'move') return fail('Army is already in this region.');
    to = { x: region.seed.x - 40, y: region.seed.y + 30 };
    targetRegionId = region.id;
  } else {
    const base = getBase(s, a.type === 'return' ? army.homeBaseId : a.targetBaseId ?? '') ?? (a.type === 'return' ? factionBases(s, fid)[0] : undefined);
    if (!base || base.factionId !== fid) return fail('Select a friendly base.');
    to = { x: base.x + 30, y: base.y + 40 };
    targetRegionId = base.regionId;
    targetBaseId = base.id;
    if (dist(to, army) < 20) return fail('Army is already at that base.');
  }
  const supply = armySupply(s, army);
  const t = travelTime(s, army, to, armySpeed(s, army), supply.factor);
  const id = newId(s, 'm');
  s.missions.push({
    id, armyId: army.id, factionId: fid, type: a.type, from: { x: army.x, y: army.y }, to, targetRegionId, targetBaseId,
    startedAt: s.gameTime, arrivesAt: s.gameTime + t, status: 'active',
  });
  army.status = 'moving';
  army.missionId = id;
  return { ok: true, data: { arrivesIn: t } };
}

export function forwardBaseCost(s: CampaignState, fid: string) {
  return scaleCost(FORWARD_BASE_COST, 1 - techBonus(s, fid, 'forward_logistics'));
}

export function forwardBaseLimit(s: CampaignState, fid: string) {
  return BASE_LIMIT + techLevel(s, fid, 'forward_logistics');
}

export function establishBase(s: CampaignState, fid: string, a: { x: number; y: number; name?: string }): OpResult<{ baseId: string }> {
  const x = Math.round(a.x), y = Math.round(a.y);
  const v = validateBaseSite(s, fid, x, y);
  if (!v.ok) return fail(v.reason!);
  const fwd = s.bases.filter((b) => b.factionId === fid && b.type === 'forward').length;
  if (fwd >= forwardBaseLimit(s, fid)) return fail(`Forward base limit reached (${forwardBaseLimit(s, fid)}). Research Forward Logistics.`);
  const cost = forwardBaseCost(s, fid);
  const id = newId(s, 'b');
  if (!spend(s, fid, cost, 'forward_base', id)) return fail(`Insufficient resources: need ${missingFor(getFaction(s, fid).resources, cost)}.`);
  const region = regionAt(s, x, y)!;
  s.bases.push({
    id, factionId: fid, regionId: region.id, name: a.name?.trim().slice(0, 28) || `FOB ${region.name}`, type: 'forward', x, y,
    radius: WORLD.forwardBaseRadius, createdAt: s.gameTime,
  });
  notify(s, fid, 'success', 'Forward base established', `FOB ${region.name} extends your supply network.`, { kind: 'base', id });
  return { ok: true, data: { baseId: id } };
}

// ---------- Arrival, occupation, capture ----------

export function handleArrival(s: CampaignState, missionId: string) {
  const m = s.missions.find((x) => x.id === missionId);
  if (!m || m.status !== 'active') return; // idempotent
  m.status = 'arrived';
  const army = s.armies.find((a) => a.id === m.armyId);
  if (!army) return;
  army.x = m.to.x;
  army.y = m.to.y;
  army.regionId = m.targetRegionId;
  army.missionId = null;
  army.status = 'stationed';
  const region = getRegion(s, m.targetRegionId);
  if (m.type === 'reinforce' || m.type === 'return') {
    const base = getBase(s, m.targetBaseId ?? '');
    if (base && base.factionId === army.factionId) {
      mergeIntoGarrison(s, army, base);
      notify(s, army.factionId, 'info', `${army.name} arrived`, `Units joined the garrison at ${base.name}.`, { kind: 'base', id: base.id });
    }
    return;
  }
  if (m.type === 'move') {
    notify(s, army.factionId, 'info', `${army.name} arrived`, `Stationed in ${region.name}.`, { kind: 'army', id: army.id });
    return;
  }
  // capture
  if (region.ownerId === army.factionId) return;
  engageRegion(s, army, region);
}

export function engageRegion(s: CampaignState, army: Army, region: Region) {
  const occupier = region.occupation && region.occupation.factionId !== army.factionId ? s.armies.find((a) => a.id === region.occupation!.armyId) : undefined;
  let defenderFaction: string | null = null;
  let defenders: UnitGroup[] = [];
  if (region.ownerId) {
    const d = regionDefenders(s, region);
    defenderFaction = region.ownerId;
    defenders = d.units;
  }
  if (!defenders.length && occupier) {
    defenderFaction = occupier.factionId;
    defenders = s.units.filter((u) => u.armyId === occupier.id && u.quantity > 0);
  }
  if (defenders.length && defenderFaction) {
    const battle = createBattle(s, region.id, army.id, defenderFaction, defenders);
    s.battles.push(battle);
    army.status = 'in_battle';
    for (const u of defenders) if (u.armyId) {
      const da = s.armies.find((x) => x.id === u.armyId);
      if (da) da.status = 'in_battle';
    }
    region.status = 'contested';
    const attackerF = getFaction(s, army.factionId), defenderF = getFaction(s, defenderFaction);
    if (attackerF.isPlayer || defenderF.isPlayer) {
      notify(s, s.playerFactionId, 'battle', `Battle at ${region.name}`,
        attackerF.isPlayer ? `${army.name} has made contact. Take command of the engagement.` : `${attackerF.name} is attacking ${region.name}. Take command of the defense.`,
        { kind: 'battle', id: battle.id });
    } else {
      // AI vs AI: resolve with the same simulation, both sides AI-controlled.
      battle.status = 'active';
      stepBattle(battle.sim, battle.sim.timeLimit + 10, ['A', 'D']);
      resolveBattle(s, battle.id);
    }
    return;
  }
  beginOccupation(s, army, region, WORLD.occupationSeconds);
}

function beginOccupation(s: CampaignState, army: Army, region: Region, seconds: number) {
  region.occupation = { factionId: army.factionId, armyId: army.id, finishesAt: s.gameTime + seconds };
  region.status = 'contested';
  army.status = 'occupying';
  notify(s, army.factionId, 'info', `Occupying ${region.name}`, `${army.name} is establishing control (${Math.round(seconds)}s).`, { kind: 'region', id: region.id });
}

export function completeOccupation(s: CampaignState, regionId: string) {
  const region = getRegion(s, regionId);
  if (!region.occupation) return;
  const army = s.armies.find((a) => a.id === region.occupation!.armyId);
  const fid = region.occupation.factionId;
  region.occupation = null;
  if (!army || army.status !== 'occupying') {
    region.status = region.ownerId ? 'controlled' : 'neutral';
    return;
  }
  army.status = 'stationed';
  captureRegion(s, region, fid);
}

export function captureRegion(s: CampaignState, region: Region, fid: string) {
  const prev = region.ownerId;
  region.ownerId = fid;
  region.status = 'controlled';
  region.occupation = null;
  for (const site of s.sites.filter((x) => x.regionId === region.id)) {
    site.status = 'occupying';
    site.opFinishesAt = s.gameTime + 20;
  }
  const newOwner = getFaction(s, fid);
  for (const base of s.bases.filter((b) => b.regionId === region.id && b.factionId !== fid)) {
    const old = getFaction(s, base.factionId);
    s.queues = s.queues.filter((q) => q.baseId !== base.id);
    for (const u of s.units.filter((u) => u.baseId === base.id && !u.armyId)) u.quantity = 0;
    if (old.hqBaseId === base.id) {
      old.hqBaseId = factionBases(s, old.id).find((b) => b.id !== base.id)?.id ?? null;
      notify(s, s.playerFactionId, old.isPlayer ? 'danger' : 'success', 'Headquarters captured', `${old.name}'s headquarters at ${region.name} has fallen to ${newOwner.name}.`, { kind: 'region', id: region.id });
    }
    base.factionId = fid;
    base.name = `${base.name.replace(/^Captured /, '')}`.startsWith('FOB') ? base.name : `Captured ${base.name.replace(/^Captured /, '')}`;
    for (const b of baseBuildings(s, base.id)) b.health = Math.max(0.4, b.health * 0.7);
  }
  s.units = s.units.filter((u) => u.quantity > 0);
  const pl = s.playerFactionId;
  if (fid === pl) notify(s, pl, 'success', `${region.name} captured`, `Territory secured. Resource facilities enter a 20s occupation period before producing.`, { kind: 'region', id: region.id });
  else if (prev === pl) notify(s, pl, 'danger', `${region.name} lost`, `${newOwner.name} has taken control of ${region.name}.`, { kind: 'region', id: region.id });
  else if (s.intel.find((i) => i.regionId === region.id)?.discovered) notify(s, pl, 'warning', `${region.name} changed hands`, `${newOwner.name} now controls ${region.name}.`, { kind: 'region', id: region.id });
  if (prev) checkFactionStatus(s, prev);
}

export function checkFactionStatus(s: CampaignState, fid: string) {
  const f = getFaction(s, fid);
  if (f.status === 'defeated') return;
  const regions = s.regions.filter((r) => r.ownerId === fid).length;
  const bases = factionBases(s, fid).length;
  if (regions === 0 || bases === 0) {
    f.status = 'defeated';
    for (const u of s.units.filter((u) => u.factionId === fid)) u.quantity = 0;
    s.units = s.units.filter((u) => u.quantity > 0);
    s.armies = s.armies.filter((a) => a.factionId !== fid || s.units.some((u) => u.armyId === a.id));
    if (f.isPlayer) {
      s.status = 'defeat';
      notify(s, fid, 'danger', 'Campaign lost', 'Your command has no remaining bases.');
    } else {
      notify(s, s.playerFactionId, 'success', `${f.name} defeated`, `${f.name} no longer controls any territory.`);
      if (s.factions.filter((x) => !x.isPlayer).every((x) => x.status === 'defeated')) {
        s.status = 'victory';
        notify(s, s.playerFactionId, 'success', 'Victory', 'All rival factions have been defeated.');
      }
    }
  }
}

// ---------- Tactical battles ----------

export function playerSide(s: CampaignState, battleId: string): 'A' | 'D' | null {
  const b = s.battles.find((x) => x.id === battleId);
  if (!b) return null;
  return b.attackerFactionId === s.playerFactionId ? 'A' : b.defenderFactionId === s.playerFactionId ? 'D' : null;
}

export function startBattle(s: CampaignState, fid: string, a: { battleId: string }): OpResult {
  const b = s.battles.find((x) => x.id === a.battleId);
  if (!b) return fail('Battle not found.');
  if (b.attackerFactionId !== fid && b.defenderFactionId !== fid) return fail('You are not a participant.');
  if (b.status === 'resolved') return fail('Battle already resolved.');
  b.status = 'active';
  return { ok: true };
}

export function submitBattleCommand(s: CampaignState, fid: string, a: { battleId: string } & BattleCommand): OpResult {
  const b = s.battles.find((x) => x.id === a.battleId);
  if (!b || b.status !== 'active') return fail('Battle is not active.');
  const side = b.attackerFactionId === fid ? 'A' : b.defenderFactionId === fid ? 'D' : null;
  if (!side) return fail('You are not a participant.');
  const err = applyCommand(b.sim, side, a);
  if (err) return fail(err);
  b.commands.push({ tick: b.sim.tick, squadIds: a.squadIds, command: a.command, x: a.x, y: a.y });
  if (b.commands.length > 300) b.commands.splice(0, b.commands.length - 300);
  return { ok: true };
}

export function advanceBattle(s: CampaignState, fid: string, a: { battleId: string; ticks: number }): OpResult<{ ended: boolean }> {
  const b = s.battles.find((x) => x.id === a.battleId);
  if (!b || b.status !== 'active') return fail('Battle is not active.');
  const side = b.attackerFactionId === fid ? 'A' : b.defenderFactionId === fid ? 'D' : null;
  if (!side) return fail('You are not a participant.');
  const ticks = Math.max(0, Math.min(Math.floor(a.ticks), 4 * TICK_RATE)); // bounded per call
  stepBattle(b.sim, ticks, [side === 'A' ? 'D' : 'A']);
  if (b.sim.ended) resolveBattle(s, b.id);
  return { ok: true, data: { ended: b.sim.ended } };
}

export function resolveBattle(s: CampaignState, battleId: string) {
  const b = s.battles.find((x) => x.id === battleId);
  if (!b || b.status === 'resolved' || !b.sim.result) return; // idempotent
  b.status = 'resolved';
  b.result = b.sim.result;
  b.endedAt = s.gameTime;
  const surv = survivorsByUnit(b.sim);
  let lostA = 0, lostD = 0;
  for (const [unitId, e] of surv) {
    const u = s.units.find((x) => x.id === unitId);
    if (!u) continue;
    const lost = u.quantity - e.qty;
    if (u.factionId === b.attackerFactionId) lostA += lost; else lostD += lost;
    u.quantity = e.qty;
    u.health = e.maxHp > 0 ? Math.max(0.2, Math.min(1, e.hp / e.maxHp)) : 1;
    u.readiness = Math.max(0.2, u.readiness * 0.6);
  }
  s.units = s.units.filter((u) => u.quantity > 0);
  const region = getRegion(s, b.regionId);
  const army = s.armies.find((a) => a.id === b.attackerArmyId);
  const attacker = getFaction(s, b.attackerFactionId), defender = getFaction(s, b.defenderFactionId);
  // release defender armies
  for (const a of s.armies.filter((x) => x.factionId === b.defenderFactionId && x.status === 'in_battle')) a.status = 'stationed';
  // empty armies are dissolved
  const dropEmpty = () => {
    s.armies = s.armies.filter((a) => s.units.some((u) => u.armyId === a.id));
    for (const r of s.regions) if (r.occupation && !s.armies.some((a) => a.id === r.occupation!.armyId)) { r.occupation = null; r.status = r.ownerId ? 'controlled' : 'neutral'; }
  };
  if (b.result === 'attacker' && army) {
    army.status = 'stationed';
    // defenders withdraw to another base or are lost
    const fallback = factionBases(s, b.defenderFactionId).find((x) => x.regionId !== region.id);
    for (const id of b.defenderUnitIds) {
      const u = s.units.find((x) => x.id === id);
      if (!u) continue;
      if (fallback) { u.baseId = fallback.id; u.armyId = null; } else u.quantity = 0;
    }
    s.units = s.units.filter((u) => u.quantity > 0);
    dropEmpty();
    if (s.units.some((u) => u.armyId === army.id)) {
      if (region.ownerId) beginOccupation(s, army, region, 20);
      else beginOccupation(s, army, region, WORLD.occupationSeconds);
    }
  } else {
    dropEmpty();
    region.status = region.ownerId ? 'controlled' : region.occupation ? 'contested' : 'neutral';
    if (army && s.armies.includes(army)) {
      army.status = 'stationed';
      launchMission(s, army.factionId, { armyId: army.id, type: 'return' });
    }
  }
  const pl = s.playerFactionId;
  if (attacker.isPlayer || defender.isPlayer) {
    const won = (b.result === 'attacker') === attacker.isPlayer;
    notify(s, pl, won ? 'success' : 'danger', `Battle of ${region.name}: ${won ? 'victory' : 'defeat'}`,
      `Losses — ${attacker.name}: ${lostA}, ${defender.name}: ${lostD}. ${b.result === 'attacker' ? 'Attacker is occupying the region.' : 'Attack repelled.'}`,
      { kind: 'battle', id: b.id });
  }
  refreshIntel(s);
  // keep the latest 20 resolved battles
  const resolved = s.battles.filter((x) => x.status === 'resolved');
  if (resolved.length > 20) {
    const drop = new Set(resolved.slice(0, resolved.length - 20).map((x) => x.id));
    s.battles = s.battles.filter((x) => !drop.has(x.id));
  }
}

export function setSpeed(s: CampaignState, speed: number): OpResult {
  if (![0.5, 1, 2, 5, 10].includes(speed)) return fail('Invalid speed.');
  s.settings.speed = speed;
  return { ok: true };
}
