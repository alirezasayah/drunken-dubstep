// advance_world: timestamp-based persistent simulation with bounded, event-aligned steps.
import { BUILDINGS, RES_KEYS, TECH_BY_KEY, UNITS, WORLD } from './config';
import { runAi } from './ai';
import { ledger, notify, refreshIntel } from './intel';
import { completeOccupation, handleArrival } from './operations';
import type { CampaignState, Resources, UnitGroup } from './types';
import { armySupply, baseSupply, economy, getBase, getFaction, newId, storageCapacity, techBonus } from './world';

function nextEventTime(s: CampaignState): number {
  let t = Infinity;
  for (const b of s.buildings) if (b.opFinishesAt != null && b.status !== 'operational') t = Math.min(t, b.opFinishesAt);
  for (const site of s.sites) if (site.opFinishesAt != null && (site.status === 'occupying' || site.status === 'upgrading')) t = Math.min(t, site.opFinishesAt);
  for (const q of s.queues) t = Math.min(t, q.finishesAt);
  for (const m of s.missions) if (m.status === 'active') t = Math.min(t, m.arrivesAt);
  for (const r of s.regions) if (r.occupation) t = Math.min(t, r.occupation.finishesAt);
  for (const rows of Object.values(s.research)) for (const r of rows) if (r.status === 'researching' && r.finishesAt != null) t = Math.min(t, r.finishesAt);
  for (const a of s.ai) if (getFaction(s, a.factionId).status === 'active') t = Math.min(t, a.nextDecisionAt);
  return t;
}

export function advanceWorld(s: CampaignState, now: number): number {
  const real = Math.max(0, (now - s.lastSimulatedAt) / 1000);
  s.lastSimulatedAt = now;
  if (s.status !== 'active') return 0;
  let remaining = Math.min(real * s.settings.speed, WORLD.maxOfflineSeconds);
  const total = remaining;
  if (remaining <= 0) return 0;
  const before = { ...getFaction(s, s.playerFactionId).resources };
  // Bounded step size: long offline periods use coarser economy steps, events still fire at their own times.
  const step = Math.max(WORLD.maxStepSeconds, remaining / 1500);
  let guard = 0;
  while (remaining > 1e-6 && guard++ < 50000) {
    const toEvent = nextEventTime(s) - s.gameTime;
    const dt = Math.min(step, remaining, Math.max(0.01, toEvent));
    stepWorld(s, dt);
    remaining -= dt;
    if (s.status !== 'active') break;
  }
  if (total >= 60) {
    const after = getFaction(s, s.playerFactionId).resources;
    const delta: Partial<Resources> = {};
    for (const k of RES_KEYS) delta[k] = after[k] - before[k];
    ledger(s, s.playerFactionId, delta, 'offline_progress', null);
    if (total >= 300) notify(s, s.playerFactionId, 'info', 'While you were away', `${formatDuration(total)} of campaign time elapsed. Net: ${RES_KEYS.map((k) => `${k} ${delta[k]! >= 0 ? '+' : ''}${Math.round(delta[k]!)}`).join(', ')}.`);
  }
  refreshIntel(s);
  return total;
}

export function formatDuration(sec: number) {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function stepWorld(s: CampaignState, dt: number) {
  // --- Economy (same rules for every faction)
  for (const f of s.factions) {
    if (f.status !== 'active') continue;
    const eco = economy(s, f.id);
    const cap = storageCapacity(s, f.id);
    for (const k of RES_KEYS) {
      f.resources[k] += eco.net[k] * dt;
      if (k !== 'money') f.resources[k] = Math.min(f.resources[k], Math.max(cap, 0));
    }
    const wasDeficit = f.deficit;
    if (f.resources.money < 0) { f.resources.money = 0; f.deficit = true; }
    else if (f.deficit && (eco.net.money > 0 || f.resources.money > 100)) f.deficit = false;
    const wasLow = f.lowEnergy;
    if (f.resources.energy <= 0) { f.resources.energy = 0; f.lowEnergy = true; }
    else if (f.lowEnergy && f.resources.energy > 20) f.lowEnergy = false;
    for (const k of ['oil', 'iron', 'gold'] as const) if (f.resources[k] < 0) f.resources[k] = 0;
    if (f.isPlayer) {
      if (!wasDeficit && f.deficit) notify(s, f.id, 'danger', 'Maintenance deficit', 'Money exhausted. Buildings and forces operate at reduced efficiency until income recovers.');
      if (!wasLow && f.lowEnergy) notify(s, f.id, 'danger', 'Energy shortage', 'Energy reserves depleted. Production reduced. Build or upgrade a Power Plant.');
      if (eco.net.money < 0 && f.resources.money > 0 && f.resources.money / -eco.net.money < 300) notify(s, f.id, 'warning', 'Deficit warning', `At current upkeep, money runs out in ${formatDuration(f.resources.money / -eco.net.money)}.`);
      if (eco.net.energy < 0 && f.resources.energy > 0 && f.resources.energy / -eco.net.energy < 240) notify(s, f.id, 'warning', 'Energy warning', `Energy runs out in ${formatDuration(f.resources.energy / -eco.net.energy)}.`);
    }
  }

  // --- Readiness and recovery
  const supplyCache = new Map<string, number>();
  for (const u of s.units) {
    const f = getFaction(s, u.factionId);
    const readyRate = 0.006 * (1 + techBonus(s, u.factionId, 'unit_readiness'));
    if (u.baseId && !u.armyId) {
      const base = getBase(s, u.baseId);
      if (!base) continue;
      let factor = supplyCache.get(base.id);
      if (factor == null) { factor = baseSupply(s, base).factor; supplyCache.set(base.id, factor); }
      u.health = Math.min(1, u.health + 0.004 * dt);
      const cap = f.deficit ? 0.6 : factor;
      u.readiness = recover(u, cap, readyRate * dt);
    } else if (u.armyId) {
      const army = s.armies.find((a) => a.id === u.armyId);
      if (!army || army.status === 'in_battle') continue;
      let factor = supplyCache.get(army.id);
      if (factor == null) { factor = armySupply(s, army).factor; supplyCache.set(army.id, factor); }
      const cap = (f.deficit ? 0.6 : 1) * (factor >= 1 ? 1 : factor < 0.8 ? 0.45 : 0.75);
      u.readiness = recover(u, cap, readyRate * 0.5 * dt);
      if (factor >= 1) u.health = Math.min(1, u.health + 0.0015 * dt);
    }
  }

  s.gameTime += dt;
  const t = s.gameTime;

  // --- Construction & upgrades
  for (const b of s.buildings) {
    if (b.status === 'operational' || b.opFinishesAt == null || b.opFinishesAt > t + 1e-6) continue;
    const base = getBase(s, b.baseId);
    const def = BUILDINGS[b.type];
    if (b.status === 'upgrading') b.level += 1;
    const wasNew = b.status === 'constructing';
    b.status = 'operational';
    b.opFinishesAt = null;
    b.opStartedAt = null;
    b.health = 1;
    if (base) notify(s, base.factionId, 'success', wasNew ? `${def.name} completed` : `${def.name} upgraded to L${b.level}`, `${base.name}`, { kind: 'building', id: b.id });
  }
  for (const site of s.sites) {
    if (site.opFinishesAt == null || site.opFinishesAt > t + 1e-6) continue;
    if (site.status === 'upgrading') site.level += 1;
    if (site.status === 'occupying' || site.status === 'upgrading') {
      const region = s.regions.find((r) => r.id === site.regionId)!;
      site.status = region.ownerId ? 'operational' : 'neutral';
      site.opFinishesAt = null;
      if (region.ownerId) notify(s, region.ownerId, 'success', `${cap(site.type)} facility operational`, `${region.name} site (L${site.level}) is producing.`, { kind: 'site', id: site.id });
    }
  }

  // --- Recruitment / training queues
  for (const q of [...s.queues].sort((a, b) => a.finishesAt - b.finishesAt)) {
    if (q.finishesAt > t + 1e-6) continue;
    s.queues = s.queues.filter((x) => x.id !== q.id); // idempotent removal
    const base = getBase(s, q.baseId);
    if (!base || base.factionId !== q.factionId) continue;
    if (q.kind === 'recruit') {
      addRecruits(s, q.factionId, base.id, q.unitType, q.quantity);
      notify(s, q.factionId, 'success', `${q.quantity} ${UNITS[q.unitType].name.toLowerCase()} ready`, `Recruited at ${base.name}.`, { kind: 'base', id: base.id });
    } else {
      const u = s.units.find((x) => x.id === q.unitId);
      if (u) {
        if (q.kind === 'train' && q.targetTraining != null) u.trainingLevel = Math.max(u.trainingLevel, q.targetTraining) as 0 | 1 | 2;
        if (q.kind === 'doctrine' && q.targetDoctrine) u.doctrine = q.targetDoctrine;
        u.busyUntil = null;
        notify(s, q.factionId, 'success', q.kind === 'train' ? 'Training complete' : 'Doctrine retraining complete', `${u.quantity} ${UNITS[u.type].name.toLowerCase()} at ${base.name}.`, { kind: 'base', id: base.id });
      }
    }
  }

  // --- Research
  for (const [fid, rows] of Object.entries(s.research)) {
    for (const r of rows) {
      if (r.status !== 'researching' || r.finishesAt == null || r.finishesAt > t + 1e-6) continue;
      r.level += 1;
      r.status = 'idle';
      r.startedAt = r.finishesAt = null;
      notify(s, fid, 'success', 'Research complete', `${TECH_BY_KEY[r.key].name} ${r.level}: ${TECH_BY_KEY[r.key].effect}.`, { kind: 'research', id: r.key });
    }
  }

  // --- Missions (movement continues offline)
  for (const m of s.missions.filter((m) => m.status === 'active' && m.arrivesAt <= t + 1e-6).sort((a, b) => a.arrivesAt - b.arrivesAt)) handleArrival(s, m.id);
  s.missions = s.missions.filter((m) => m.status === 'active' || t - m.arrivesAt < 600);

  // --- Occupations
  for (const r of s.regions) if (r.occupation && r.occupation.finishesAt <= t + 1e-6) completeOccupation(s, r.id);

  // --- AI decisions
  for (const ai of s.ai) {
    if (ai.nextDecisionAt > t + 1e-6) continue;
    ai.nextDecisionAt = t + WORLD.aiDecisionInterval;
    if (getFaction(s, ai.factionId).status === 'active') runAi(s, ai);
  }
}

function recover(u: UnitGroup, cap: number, rate: number) {
  if (u.readiness < cap) return Math.min(cap, u.readiness + rate);
  return Math.max(cap, u.readiness - rate * 0.5);
}

const cap = (x: string) => x[0].toUpperCase() + x.slice(1);

export function addRecruits(s: CampaignState, fid: string, baseId: string, type: UnitGroup['type'], qty: number) {
  const existing = s.units.find((u) => u.factionId === fid && u.baseId === baseId && !u.armyId && u.type === type && u.trainingLevel === 0 && u.doctrine === 'combined_arms' && !u.busyUntil);
  if (existing) {
    const total = existing.quantity + qty;
    existing.health = (existing.health * existing.quantity + qty) / total;
    existing.readiness = (existing.readiness * existing.quantity + qty * 0.8) / total;
    existing.quantity = total;
    return existing;
  }
  const u: UnitGroup = {
    id: newId(s, 'u'), factionId: fid, baseId, armyId: null, type, quantity: qty, trainingLevel: 0, doctrine: 'combined_arms',
    health: 1, readiness: 0.8, busyUntil: null, createdAt: s.gameTime,
  };
  s.units.push(u);
  return u;
}
