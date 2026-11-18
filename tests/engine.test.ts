import { describe, expect, it } from 'vitest';
import { GameServer, MemoryStorage, migrate } from '../src/engine/server';
import type { CampaignState } from '../src/engine/types';
import { validatePlacement, economy, getRegion } from '../src/engine/world';
import { RES_KEYS } from '../src/engine/config';

function setup(seed = 12345) {
  const storage = new MemoryStorage();
  let now = 1_700_000_000_000;
  const clock = { advance: (sec: number) => (now += sec * 1000), get: () => now };
  const server = new GameServer(storage, () => now);
  const s = server.createCampaign({ name: 'Test', difficulty: 'normal', seed });
  return { storage, server, clock, id: s.id };
}

function findSpot(s: CampaignState, baseId: string, type: any) {
  const base = s.bases.find((b) => b.id === baseId)!;
  for (let r = 60; r < base.radius; r += 10)
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const x = Math.round(base.x + Math.cos(a) * r), y = Math.round(base.y + Math.sin(a) * r);
      if (validatePlacement(s, s.playerFactionId, baseId, type, x, y, 0).ok) return { x, y };
    }
  throw new Error('no spot');
}

function assertConsistent(s: CampaignState) {
  for (const f of s.factions) for (const k of RES_KEYS) {
    expect(Number.isFinite(f.resources[k])).toBe(true);
    expect(f.resources[k]).toBeGreaterThanOrEqual(0);
  }
  for (const u of s.units) {
    expect(u.quantity).toBeGreaterThan(0);
    if (u.armyId) expect(s.armies.some((a) => a.id === u.armyId)).toBe(true);
    if (u.baseId) expect(s.bases.some((b) => b.id === u.baseId)).toBe(true);
  }
  for (const b of s.buildings) expect(s.bases.some((x) => x.id === b.baseId)).toBe(true);
  for (const a of s.armies) {
    expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
    if (a.missionId) expect(s.missions.some((m) => m.id === a.missionId)).toBe(true);
  }
}

describe('FRONTLINE engine', () => {
  it('creates a world matching the MVP configuration', () => {
    const { server, id } = setup();
    const s = server.peek(id);
    expect(s.regions).toHaveLength(16);
    expect(s.factions.filter((f) => !f.isPlayer)).toHaveLength(3);
    expect(s.bases.filter((b) => b.factionId !== s.playerFactionId)).toHaveLength(6);
    expect(s.sites).toHaveLength(20);
    expect(s.bases.filter((b) => b.factionId === s.playerFactionId)).toHaveLength(1);
    expect(s.sites.some((x) => x.regionId === 'r_1' && x.type === 'oil' && x.status === 'neutral')).toBe(true);
    assertConsistent(s);
  });

  it('rejects invalid placements and persists valid construction across a reload', () => {
    const { server, storage, clock, id } = setup();
    const s = server.peek(id);
    const hq = s.bases[0];
    // outside territory / radius
    expect(server.exec(id, 'place_building', { baseId: hq.id, type: 'supply_depot', x: hq.x + 900, y: hq.y }).ok).toBe(false);
    // overlapping the HQ
    const overlap = server.exec(id, 'place_building', { baseId: hq.id, type: 'supply_depot', x: hq.x + 5, y: hq.y + 5 });
    expect(overlap.ok).toBe(false);
    const spot = findSpot(s, hq.id, 'barracks');
    const money = s.factions[0].resources.money;
    const res = server.exec(id, 'place_building', { baseId: hq.id, type: 'barracks', ...spot });
    expect(res.ok).toBe(true);
    expect(server.peek(id).factions[0].resources.money).toBeCloseTo(money - 250, 0);
    // close the game during construction, reopen 2 minutes later in a fresh server
    clock.advance(120);
    const server2 = new GameServer(storage, clock.get);
    const s2 = server2.loadCampaign(id);
    const b = s2.buildings.find((x) => x.id === (res as any).data.buildingId)!;
    expect(b.status).toBe('operational');
    expect(b.x).toBe(spot.x);
    // upgrade deducts the right cost
    const before = s2.factions[0].resources.iron;
    expect(server2.exec(id, 'upgrade_building', { buildingId: b.id }).ok).toBe(true);
    expect(server2.peek(id).factions[0].resources.iron).toBeLessThan(before);
  });

  it('prevents double spending and deduplicates repeated requests', () => {
    const { server, id } = setup();
    const s = server.peek(id);
    const hq = s.bases[0];
    s.factions[0].resources.money = 300; // enough for exactly one barracks
    const a = findSpot(s, hq.id, 'barracks');
    const r1 = server.exec(id, 'place_building', { baseId: hq.id, type: 'barracks', ...a }, { requestId: 'req-1' });
    const dup = server.exec(id, 'place_building', { baseId: hq.id, type: 'barracks', ...a }, { requestId: 'req-1' });
    const s1 = server.peek(id);
    const b = findSpot(s1, hq.id, 'barracks');
    const r2 = server.exec(id, 'place_building', { baseId: hq.id, type: 'barracks', ...b }, { requestId: 'req-2' });
    expect(r1.ok).toBe(true);
    expect(dup.ok && (dup as any).data.duplicate).toBe(true);
    expect(r2.ok).toBe(false);
    expect(server.peek(id).buildings.filter((x) => x.type === 'barracks' && x.baseId === hq.id)).toHaveLength(2); // starting + one
    expect(server.peek(id).factions[0].resources.money).toBeGreaterThanOrEqual(0);
  });

  it('runs the vertical slice: recruit, capture oil offline, forward base, battle, capture, resume', () => {
    const { server, storage, clock, id } = setup(777);
    let s = server.peek(id);
    const pid = s.playerFactionId;
    const hq = s.bases[0];
    const barracks = s.buildings.find((b) => b.type === 'barracks' && b.baseId === hq.id)!;
    // place a supply depot
    const spot = findSpot(s, hq.id, 'supply_depot');
    expect(server.exec(id, 'place_building', { baseId: hq.id, type: 'supply_depot', ...spot }).ok).toBe(true);
    // recruit infantry
    expect(server.exec(id, 'start_recruitment', { buildingId: barracks.id, unitType: 'infantry', quantity: 20 }).ok).toBe(true);
    clock.advance(60);
    s = server.loadCampaign(id);
    const garrison = s.units.filter((u) => u.baseId === hq.id && !u.armyId).reduce((a, u) => a + u.quantity, 0);
    expect(garrison).toBe(44);

    // create army and capture the neutral oil region
    const alloc = s.units.filter((u) => u.baseId === hq.id).map((u) => ({ unitId: u.id, quantity: u.quantity }));
    const army = server.exec(id, 'create_army', { baseId: hq.id, allocations: alloc });
    expect(army.ok).toBe(true);
    const armyId = (army as any).data.armyId;
    const oilBefore = economy(server.peek(id), pid).net.oil;
    expect(server.exec(id, 'launch_mission', { armyId, type: 'capture', targetRegionId: 'r_1' }).ok).toBe(true);
    // close the game while the army travels; return after 10 minutes
    clock.advance(600);
    s = new GameServer(storage, clock.get).loadCampaign(id);
    expect(getRegion(s, 'r_1').ownerId).toBe(pid);
    const oilSite = s.sites.find((x) => x.regionId === 'r_1' && x.type === 'oil')!;
    expect(oilSite.status).toBe('operational');
    expect(economy(s, pid).net.oil).toBeGreaterThan(oilBefore);

    // forward base inside the captured region
    const server3 = new GameServer(storage, clock.get);
    s = server3.peek(id);
    s.factions[0].resources.money += 5000; s.factions[0].resources.iron += 2000;
    const r1 = getRegion(s, 'r_1');
    let fob: any = null;
    for (let dx = -150; dx <= 150 && !fob?.ok; dx += 30)
      for (let dy = -150; dy <= 150 && !fob?.ok; dy += 30) fob = server3.exec(id, 'establish_base', { x: r1.seed.x + dx, y: r1.seed.y + dy });
    expect(fob.ok).toBe(true);

    // reinforce: recruit a large force at HQ and attack the nearest AI forward base region
    s = server3.peek(id);
    for (let i = 0; i < 3; i++) expect(server3.exec(id, 'start_recruitment', { buildingId: barracks.id, unitType: 'infantry', quantity: 30 }).ok).toBe(true);
    clock.advance(400);
    s = server3.loadCampaign(id);
    const units = s.units.filter((u) => u.baseId === hq.id && !u.armyId);
    const strike = server3.exec(id, 'create_army', { baseId: hq.id, allocations: units.map((u) => ({ unitId: u.id, quantity: u.quantity })) });
    expect(strike.ok).toBe(true);
    const strikeId = (strike as any).data.armyId;
    // merge the oil army in as well
    const target = s.regions.find((r) => r.ownerId && r.ownerId !== pid && s.bases.some((b) => b.regionId === r.id && b.type === 'forward'))!;
    const targetId = [...s.regions].filter((r) => r.ownerId && r.ownerId !== pid && s.bases.some((b) => b.regionId === r.id && b.factionId === r.ownerId)).sort((a, b) => Math.hypot(a.seed.x - r1.seed.x, a.seed.y - r1.seed.y) - Math.hypot(b.seed.x - r1.seed.x, b.seed.y - r1.seed.y))[0]?.id ?? target.id;
    expect(server3.exec(id, 'launch_mission', { armyId: strikeId, type: 'capture', targetRegionId: targetId }).ok).toBe(true);
    clock.advance(900);
    s = server3.loadCampaign(id);
    const battle = s.battles.find((b) => b.attackerArmyId === strikeId);
    if (!battle) {
      // region may have been undefended → occupation
      expect(getRegion(s, targetId).ownerId).toBe(pid);
      return;
    }
    expect(battle.status).toBe('pending');
    expect(server3.exec(id, 'start_battle', { battleId: battle.id }).ok).toBe(true);
    const squadIds = server3.peek(id).battles.find((b) => b.id === battle.id)!.sim.squads.filter((q) => q.side === 'A').map((q) => q.id);
    expect(server3.exec(id, 'submit_battle_command', { battleId: battle.id, command: 'defend', squadIds }).ok).toBe(true);
    // advance part of the battle, then "close the game" and resume from storage
    for (let i = 0; i < 20; i++) server3.exec(id, 'advance_battle', { battleId: battle.id, ticks: 10 }, { persist: false });
    server3.exec(id, 'save_battle_state', { battleId: battle.id });
    const tickSaved = server3.peek(id).battles.find((b) => b.id === battle.id)!.sim.tick;
    clock.advance(30);
    const server4 = new GameServer(storage, clock.get);
    s = server4.loadCampaign(id);
    const resumed = s.battles.find((b) => b.id === battle.id)!;
    expect(resumed.sim.tick).toBe(tickSaved); // battle paused while offline
    expect(resumed.status).toBe('active');
    let guard = 0;
    while (server4.peek(id).battles.find((b) => b.id === battle.id)!.status === 'active' && guard++ < 1000) {
      server4.exec(id, 'submit_battle_command', { battleId: battle.id, command: 'defend', squadIds: server4.peek(id).battles.find((b) => b.id === battle.id)!.sim.squads.filter((q) => q.side === 'A' && q.state === 'idle').map((q) => q.id) });
      server4.exec(id, 'advance_battle', { battleId: battle.id, ticks: 40 }, { persist: false });
    }
    server4.flush(id);
    s = server4.loadCampaign(id);
    const done = s.battles.find((b) => b.id === battle.id)!;
    expect(done.status).toBe('resolved');
    if (done.result === 'attacker') {
      clock.advance(60);
      s = server4.loadCampaign(id);
      expect(getRegion(s, targetId).ownerId).toBe(pid);
    }
    assertConsistent(s);
  });

  it('survives several days offline without corrupting the campaign', () => {
    const { server, storage, clock, id } = setup(4242);
    clock.advance(3 * 24 * 3600);
    const t0 = Date.now();
    const s = new GameServer(storage, clock.get).loadCampaign(id);
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(s.gameTime).toBeGreaterThan(3 * 24 * 3600 - 1);
    assertConsistent(s);
    // AI developed over time
    const aiBuildings = s.buildings.filter((b) => s.bases.find((x) => x.id === b.baseId)?.factionId !== s.playerFactionId);
    expect(aiBuildings.length).toBeGreaterThan(12);
    void server;
  });

  it('loads an older (v1) save', () => {
    const { server, id } = setup();
    const s = JSON.parse(JSON.stringify(server.peek(id)));
    s.schemaVersion = 1;
    for (const r of s.regions) delete r.area;
    delete s.processedRequests;
    delete s.settings.visual;
    const m = migrate(s);
    expect(m.schemaVersion).toBe(2);
    expect(m.regions.every((r) => typeof r.area === 'string')).toBe(true);
    expect(m.processedRequests).toEqual([]);
  });
});
