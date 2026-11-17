// AI factions: simplified, objective-driven decisions using the exact same operations as the player.
import { BUILDINGS, DIFFICULTY, TECHS } from './config';
import { Rng } from './rng';
import {
  buildingAvailable, createArmy, establishBase, launchMission, placeBuilding, researchAvailability, startRecruitment, startResearch, upgradeBuilding, upgradeCost, buildCost,
} from './operations';
import type { AiState, BuildingType, CampaignState, Region } from './types';
import { armyStrength, baseBuildings, canAfford, dist, factionBases, getBase, getFaction, regionStrength, validateBaseSite } from './world';

const PRIORITIES: Record<string, BuildingType[]> = {
  industrial: ['power_plant', 'warehouse', 'oil_refinery', 'supply_depot', 'barracks', 'power_plant', 'fortification', 'radar_station'],
  expansionist: ['barracks', 'supply_depot', 'power_plant', 'barracks', 'warehouse', 'fortification', 'radar_station'],
  defensive: ['fortification', 'supply_depot', 'power_plant', 'fortification', 'barracks', 'warehouse', 'radar_station', 'fortification'],
};

export function runAi(s: CampaignState, ai: AiState) {
  const f = getFaction(s, ai.factionId);
  const rng = new Rng((s.seed ^ Math.floor(s.gameTime * 1000) ^ f.id.length * 7919) >>> 0);
  const bases = factionBases(s, f.id);
  const main = bases.find((b) => b.id === f.hqBaseId) ?? bases[0];
  if (!main) return;
  const actions: string[] = [];
  const reserve = f.personality === 'industrial' ? 250 : 350;

  // 1) Infrastructure: construct by personality priority, otherwise upgrade.
  const priority = PRIORITIES[f.personality] ?? PRIORITIES.industrial;
  const owned = (type: BuildingType) => s.buildings.filter((b) => b.type === type && bases.some((bb) => bb.id === b.baseId)).length;
  const want = priority.find((type, i) => owned(type) < priority.slice(0, i + 1).filter((x) => x === type).length);
  if (want && f.resources.money > reserve + (buildCost(want).money ?? 0) && canAfford(f.resources, buildCost(want)) && !buildingAvailable(s, f.id, main, want)) {
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(60, main.radius - 35);
      const res = placeBuilding(s, f.id, { baseId: main.id, type: want, x: main.x + Math.cos(a) * r, y: main.y + Math.sin(a) * r, rotation: rng.next() < 0.5 ? 0 : 90 });
      if (res.ok) { actions.push(`build ${BUILDINGS[want].name}`); break; }
    }
  } else if (f.resources.money > 1400) {
    const cand = s.buildings.filter((b) => b.baseId === main.id && b.status === 'operational' && b.level < 4).sort((a, b) => a.level - b.level)[0];
    if (cand && canAfford(f.resources, upgradeCost(cand)) && upgradeBuilding(s, f.id, { buildingId: cand.id }).ok) actions.push(`upgrade ${BUILDINGS[cand.type].name}`);
  }

  // 2) Recruitment
  const garrison = (baseId: string) => s.units.filter((u) => u.baseId === baseId && !u.armyId).reduce((a, u) => a + u.quantity, 0);
  const target = f.personality === 'defensive' ? 45 : f.personality === 'expansionist' ? 50 : 35;
  const totalUnits = s.units.filter((u) => u.factionId === f.id).reduce((a, u) => a + u.quantity, 0);
  if (totalUnits < target * bases.length * 0.8 && f.resources.money > reserve + 180) {
    for (const base of bases) {
      const barracks = baseBuildings(s, base.id).find((b) => b.type === 'barracks' && b.status !== 'constructing');
      if (barracks && startRecruitment(s, f.id, { buildingId: barracks.id, unitType: 'infantry', quantity: 10 }).ok) { actions.push('recruit infantry'); break; }
    }
  }

  // 3) Research
  if (!s.research[f.id].some((r) => r.status === 'researching') && f.resources.money > 900) {
    const options = TECHS.filter((t) => !researchAvailability(s, f.id, t.key));
    const pref = options.filter((t) => (f.personality === 'industrial' ? t.branch === 'industrial' : f.personality === 'defensive' ? t.branch === 'defense' : t.branch === 'logistics' || t.branch === 'military'));
    const pick = (pref.length ? pref : options)[0];
    if (pick && startResearch(s, f.id, { key: pick.key }).ok) actions.push(`research ${pick.name}`);
  }

  // 4) Return idle armies that finished a capture; reinforce weak forward bases (defensive)
  for (const army of s.armies.filter((a) => a.factionId === f.id && a.status === 'stationed')) {
    const home = getBase(s, army.homeBaseId);
    if (!home || dist(home, army) > home.radius + 60) {
      launchMission(s, f.id, { armyId: army.id, type: 'return' });
      actions.push(`${army.name} returns`);
    }
  }

  // 5) Expansion
  const active = s.armies.some((a) => a.factionId === f.id && a.status !== 'stationed');
  const threshold = f.personality === 'expansionist' ? 22 : f.personality === 'industrial' ? 28 : 34;
  const keep = f.personality === 'defensive' ? 20 : 12;
  const available = garrison(main.id);
  if (!active && available >= threshold) {
    const units = s.units.filter((u) => u.baseId === main.id && !u.armyId && !(u.busyUntil && u.busyUntil > s.gameTime));
    let toSend = available - keep;
    const allocations = units.map((u) => { const q = Math.min(u.quantity, toSend); toSend -= q; return { unitId: u.id, quantity: q }; }).filter((a) => a.quantity > 0);
    const estArmy = allocations.reduce((a, al) => a + al.quantity * 5, 0);
    const aggressionAfter = DIFFICULTY[s.difficulty].aiAggressionAfter;
    const targets = s.regions
      .filter((r) => r.ownerId !== f.id && !(r.occupation && r.occupation.factionId === f.id))
      .filter((r) => !s.missions.some((m) => m.status === 'active' && m.factionId === f.id && m.targetRegionId === r.id))
      .map((r) => ({ r, score: scoreTarget(s, f.id, r, main, estArmy, aggressionAfter) }))
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => b.score - a.score);
    const choice = targets[0]?.r;
    if (choice && allocations.length) {
      const res = createArmy(s, f.id, { baseId: main.id, allocations });
      if (res.ok && res.data) {
        const m = launchMission(s, f.id, { armyId: res.data.armyId, type: 'capture', targetRegionId: choice.id });
        actions.push(m.ok ? `advance on ${choice.name}` : `army formed`);
      }
    }
  }

  // 6) Forward bases in captured regions without one
  if (f.personality !== 'defensive' && f.resources.money > 1600) {
    const region = s.regions.find((r) => r.ownerId === f.id && !s.bases.some((b) => b.regionId === r.id));
    if (region) {
      for (let i = 0; i < 12; i++) {
        const p = { x: region.seed.x + rng.range(-80, 80), y: region.seed.y + rng.range(-80, 80) };
        if (validateBaseSite(s, f.id, p.x, p.y).ok && establishBase(s, f.id, { ...p, name: `${f.name.split(' ')[0]} FOB ${region.name}` }).ok) { actions.push('establish FOB'); break; }
      }
    }
  }
  ai.lastAction = actions.join('; ') || 'consolidating';
  ai.focus = actions[0] ?? 'consolidating';
}

function scoreTarget(s: CampaignState, fid: string, r: Region, from: { x: number; y: number }, armyStr: number, aggressionAfter: number): number {
  const d = dist(from, r.seed);
  if (d > 1300) return -Infinity;
  const sites = s.sites.filter((x) => x.regionId === r.id).length;
  const f = getFaction(s, fid);
  let score = sites * 200 - d * 0.6;
  if (!r.ownerId) return score + 150;
  const def = regionStrength(s, r);
  if (r.ownerId === s.playerFactionId) {
    if (s.gameTime < aggressionAfter) return -Infinity;
    const pf = getFaction(s, r.ownerId);
    if (pf.hqBaseId && s.bases.find((b) => b.id === pf.hqBaseId)?.regionId === r.id) return -Infinity; // no HQ strikes in the MVP
    if (def > armyStr * 0.6) return -Infinity;
    return score - 200;
  }
  if (f.personality !== 'expansionist' && s.gameTime < 40 * 60) return -Infinity;
  if (def > armyStr * 0.7) return -Infinity;
  return score - 100 - def;
}

export { armyStrength };
