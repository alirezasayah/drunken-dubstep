// Deterministic tactical battle simulation (10 ticks/sec, seeded randomness).
import { DOCTRINES, TERRAIN, TRAINING_MULT, UNITS } from './config';
import { nextRandom, Rng } from './rng';
import type { Battle, BattleSim, CampaignState, Formation, Side, Squad, UnitGroup, UnitType } from './types';
import { armySupply, getBase, getRegion, isOperational, newId, techBonus } from './world';

export const TICK_RATE = 10;
const DT = 1 / TICK_RATE;
const SQUAD_SIZE: Record<UnitType, number> = { infantry: 12, tank: 4, artillery: 3 };
const COOLDOWN: Record<UnitType, number> = { infantry: 10, tank: 15, artillery: 28 };
const CELL = 40;
const CODE_TERRAIN: Record<string, keyof typeof TERRAIN> = { g: 'grassland', f: 'forest', r: 'rocky', d: 'desert', m: 'mountain' };

export const alive = (q: Squad) => q.state !== 'destroyed' && q.state !== 'withdrawn';

export function createBattle(
  s: CampaignState,
  regionId: string,
  attackerArmyId: string,
  defenderFactionId: string,
  defenderUnits: UnitGroup[],
): Battle {
  const region = getRegion(s, regionId);
  const army = s.armies.find((a) => a.id === attackerArmyId)!;
  const seed = (s.seed ^ (s.idCounter * 2654435761)) >>> 0;
  const rng = new Rng(seed);
  const width = 1400, height = 880, cols = width / CELL, rows = height / CELL;
  const baseCode = ({ grassland: 'g', desert: 'd', forest: 'f', rocky: 'r', mountain: 'r', water: 'g' } as const)[region.terrain];
  const cells: string[] = new Array(cols * rows).fill(baseCode);
  for (let i = 0; i < 9; i++) {
    const cx = rng.int(4, cols - 4), cy = rng.int(1, rows - 2), rad = rng.int(1, 3);
    const code = rng.pick(['f', 'f', 'r', 'm', 'g']);
    for (let y = cy - rad; y <= cy + rad; y++)
      for (let x = cx - rad; x <= cx + rad; x++)
        if (x >= 0 && y >= 0 && x < cols && y < rows && Math.hypot(x - cx, y - cy) <= rad + 0.3) cells[y * cols + x] = code;
  }
  const objective = { x: width * 0.72, y: height / 2, r: 90, progress: -1, owner: 'D' as Side };
  // keep the objective and deployment zones open ground
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const wx = x * CELL + CELL / 2, wy = y * CELL + CELL / 2;
      if (Math.hypot(wx - objective.x, wy - objective.y) < objective.r + 20 && cells[y * cols + x] === 'm') cells[y * cols + x] = 'g';
      if (wx < 260 && cells[y * cols + x] === 'm') cells[y * cols + x] = 'g';
    }

  const regionBases = s.bases.filter((b) => b.regionId === regionId && b.factionId === defenderFactionId);
  const forts = s.buildings.filter((b) => b.type === 'fortification' && regionBases.some((rb) => rb.id === b.baseId) && isOperational(b));
  const fortifications = forts.slice(0, 6).map((f, i) => ({
    x: objective.x - 110 + (i % 3) * 30, y: objective.y - 140 + Math.floor(i / 3) * 280 + (i % 3) * 40, level: f.level,
  }));

  const squads: Squad[] = [];
  const attackerUnits = s.units.filter((u) => u.armyId === attackerArmyId && u.quantity > 0);
  const atkSupply = armySupply(s, army).factor;
  const mixed = (units: UnitGroup[]) => new Set(units.map((u) => u.type)).size > 1;
  const build = (units: UnitGroup[], side: Side, supplyFactor: number, factionId: string) => {
    const combo = mixed(units);
    let idx = 0;
    const total = units.reduce((a, u) => a + Math.ceil(u.quantity / SQUAD_SIZE[u.type]), 0);
    for (const u of units) {
      const d = UNITS[u.type];
      const doc = DOCTRINES[u.doctrine];
      const train = TRAINING_MULT[u.trainingLevel];
      const ready = 0.55 + 0.45 * u.readiness;
      const comboBonus = u.doctrine === 'combined_arms' && combo ? 1.1 : 1;
      const fortTech = side === 'D' ? 1 + techBonus(s, factionId, 'fortification_engineering') : 1;
      let left = u.quantity;
      while (left > 0) {
        const qty = Math.min(SQUAD_SIZE[u.type], left);
        left -= qty;
        const lane = (idx + 0.5) / total;
        const back = u.type === 'artillery' ? 1 : 0;
        const x = side === 'A' ? 140 - back * 70 + rng.range(-15, 15) : objective.x + 40 + back * 120 + rng.range(-30, 30);
        const y = side === 'A' ? 120 + lane * (height - 240) : objective.y - 200 + lane * 400 + rng.range(-10, 10);
        squads.push({
          id: `q${squads.length}`, side, type: u.type, sourceUnitId: u.id, qty, startQty: qty, hpPer: d.hp,
          hp: qty * d.hp * Math.max(0.3, u.health), x, y, tx: x, ty: y,
          state: side === 'D' ? 'holding' : 'idle', order: side === 'D' ? 'hold' : 'none', followId: null, formation: 'line',
          atk: d.atk * train * doc.atk * ready * supplyFactor * comboBonus,
          def: d.def * train * doc.def * ready * comboBonus * fortTech,
          range: d.range, speed: d.speed * doc.speed, cooldown: Math.floor(rng.range(0, COOLDOWN[u.type])), targetId: null,
        });
        idx++;
      }
    }
  };
  build(attackerUnits, 'A', atkSupply, army.factionId);
  build(defenderUnits.filter((u) => u.quantity > 0), 'D', 1, defenderFactionId);

  const sim: BattleSim = {
    tick: 0, rng: rng.state, width, height, cols, rows, cells: cells.join(''), objective, fortifications, squads, shots: [],
    log: [{ tick: 0, text: `Engagement at ${region.name} begins.` }], timeLimit: 6 * 60 * TICK_RATE, ended: false, result: null,
  };
  void getBase;
  return {
    id: newId(s, 'bt'), regionId, attackerFactionId: army.factionId, defenderFactionId, attackerArmyId,
    defenderUnitIds: defenderUnits.map((u) => u.id), status: 'pending', result: null, createdAt: s.gameTime, endedAt: null, sim, commands: [],
  };
}

const cellAt = (sim: BattleSim, x: number, y: number) => {
  const c = Math.min(sim.cols - 1, Math.max(0, Math.floor(x / CELL)));
  const r = Math.min(sim.rows - 1, Math.max(0, Math.floor(y / CELL)));
  return CODE_TERRAIN[sim.cells[r * sim.cols + c]] ?? 'grassland';
};

function formationMods(f: Formation) {
  return f === 'column' ? { atk: 0.95, def: 0.9, speed: 1.15 } : f === 'wedge' ? { atk: 1.05, def: 1.05, speed: 1 } : { atk: 1.1, def: 1, speed: 0.95 };
}

export function formationTargets(squads: Squad[], x: number, y: number, formation: Formation) {
  const n = squads.length;
  const cx = squads.reduce((a, q) => a + q.x, 0) / n, cy = squads.reduce((a, q) => a + q.y, 0) / n;
  let dx = x - cx, dy = y - cy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const px = -dy, py = dx; // perpendicular
  const sp = 42;
  return squads.map((_, i) => {
    const k = i - (n - 1) / 2;
    if (formation === 'column') return { x: x - dx * sp * i, y: y - dy * sp * i };
    if (formation === 'wedge') {
      const row = Math.abs(k);
      return { x: x + px * k * sp - dx * row * sp * 0.8, y: y + py * k * sp - dy * row * sp * 0.8 };
    }
    return { x: x + px * k * sp, y: y + py * k * sp };
  });
}

export type BattleCommand = { command: 'move' | 'hold' | 'retreat' | 'defend' | 'follow' | 'regroup' | 'formation' | 'return'; squadIds: string[]; x?: number; y?: number; followId?: string; formation?: Formation };

export function applyCommand(sim: BattleSim, side: Side, cmd: BattleCommand): string | null {
  const sel = sim.squads.filter((q) => cmd.squadIds.includes(q.id) && q.side === side && alive(q));
  if (!sel.length) return 'No controllable units selected.';
  const clampX = (v: number) => Math.min(sim.width - 10, Math.max(10, v));
  const clampY = (v: number) => Math.min(sim.height - 10, Math.max(10, v));
  switch (cmd.command) {
    case 'move': {
      if (cmd.x == null || cmd.y == null) return 'Move requires a destination.';
      const tg = formationTargets(sel, clampX(cmd.x), clampY(cmd.y), sel[0].formation);
      sel.forEach((q, i) => {
        if (q.state === 'retreating') return;
        q.tx = clampX(tg[i].x); q.ty = clampY(tg[i].y); q.order = 'move'; q.state = 'moving'; q.followId = null;
      });
      break;
    }
    case 'hold':
      sel.forEach((q) => { if (q.state !== 'retreating') { q.tx = q.x; q.ty = q.y; q.order = 'hold'; q.state = 'holding'; q.followId = null; } });
      break;
    case 'retreat':
    case 'return':
      sel.forEach((q) => { q.order = 'retreat'; q.state = 'retreating'; q.followId = null; });
      break;
    case 'defend': {
      const tg = formationTargets(sel, sim.objective.x + (side === 'A' ? -10 : 10), sim.objective.y, 'line');
      sel.forEach((q, i) => {
        if (q.state === 'retreating') return;
        const artBack = q.type === 'artillery' ? (side === 'A' ? -180 : 140) : 0;
        q.tx = clampX(tg[i].x * 0.4 + sim.objective.x * 0.6 + artBack); q.ty = clampY(tg[i].y * 0.5 + sim.objective.y * 0.5);
        q.order = 'defend'; q.state = 'moving'; q.followId = null;
      });
      break;
    }
    case 'follow': {
      const leader = sim.squads.find((q) => q.id === cmd.followId && q.side === side && alive(q));
      if (!leader) return 'Choose a friendly unit to follow.';
      sel.filter((q) => q.id !== leader.id).forEach((q) => { if (q.state !== 'retreating') { q.order = 'follow'; q.followId = leader.id; q.state = 'moving'; } });
      break;
    }
    case 'regroup': {
      const own = sim.squads.filter((q) => q.side === side && alive(q) && q.state !== 'retreating');
      const cx = own.reduce((a, q) => a + q.x, 0) / own.length, cy = own.reduce((a, q) => a + q.y, 0) / own.length;
      const tg = formationTargets(sel, cx, cy, sel[0].formation);
      sel.forEach((q, i) => { if (q.state !== 'retreating') { q.tx = clampX(tg[i].x); q.ty = clampY(tg[i].y); q.order = 'regroup'; q.state = 'moving'; q.followId = null; } });
      break;
    }
    case 'formation':
      if (!cmd.formation) return 'Formation required.';
      sel.forEach((q) => (q.formation = cmd.formation!));
      break;
    default:
      return 'Unknown command.';
  }
  return null;
}

const power = (sim: BattleSim, side: Side) =>
  sim.squads.filter((q) => q.side === side && alive(q) && q.state !== 'retreating').reduce((a, q) => a + q.hp * q.atk, 0);

/** Simple objective-driven battle AI for sides not controlled by the player. */
function aiControl(sim: BattleSim, side: Side) {
  const own = sim.squads.filter((q) => q.side === side && alive(q));
  if (!own.length) return;
  const enemy = sim.squads.filter((q) => q.side !== side && alive(q) && q.state !== 'retreating');
  const ratio = power(sim, side) / Math.max(1, power(sim, side === 'A' ? 'D' : 'A'));
  if (ratio < (side === 'A' ? 0.3 : 0.22) && sim.tick > 50) {
    const active = own.filter((q) => q.state !== 'retreating');
    if (active.length) {
      applyCommand(sim, side, { command: 'retreat', squadIds: active.map((q) => q.id) });
      sim.log.push({ tick: sim.tick, text: `${side === 'A' ? 'Attacking' : 'Defending'} forces withdraw.` });
    }
    return;
  }
  const obj = sim.objective;
  for (const q of own) {
    if (q.state === 'retreating') continue;
    // engage enemies threatening the objective, otherwise hold the objective
    const threat = enemy
      .filter((e) => Math.hypot(e.x - obj.x, e.y - obj.y) < (side === 'D' ? 330 : 9999))
      .sort((a, b) => Math.hypot(a.x - q.x, a.y - q.y) - Math.hypot(b.x - q.x, b.y - q.y))[0];
    if (side === 'D') {
      if (threat && q.type !== 'artillery') {
        const d = Math.hypot(threat.x - q.x, threat.y - q.y);
        if (d > q.range * 0.9) { q.tx = threat.x + ((q.x - threat.x) / d) * q.range * 0.8; q.ty = threat.y + ((q.y - threat.y) / d) * q.range * 0.8; q.state = 'moving'; q.order = 'defend'; }
      } else if (Math.hypot(q.x - obj.x, q.y - obj.y) > obj.r + 80 && q.order !== 'defend') {
        applyCommand(sim, side, { command: 'defend', squadIds: [q.id] });
      }
    } else if (q.order !== 'defend') {
      applyCommand(sim, side, { command: 'defend', squadIds: [q.id] });
    }
  }
}

export function stepBattle(sim: BattleSim, ticks: number, aiSides: Side[]) {
  for (let t = 0; t < ticks && !sim.ended; t++) {
    sim.tick++;
    if (sim.tick % 10 === 1) for (const side of aiSides) aiControl(sim, side);
    const live = sim.squads.filter(alive);
    // movement
    for (const q of live) {
      const fm = formationMods(q.formation);
      const terrainMove = TERRAIN[cellAt(sim, q.x, q.y)].move;
      const spd = q.speed * fm.speed * Math.max(0.45, terrainMove) * DT;
      if (q.state === 'retreating') {
        const ex = q.side === 'A' ? 0 : sim.width;
        q.x += Math.sign(ex - q.x) * spd * 1.15;
        if ((q.side === 'A' && q.x <= 8) || (q.side === 'D' && q.x >= sim.width - 8)) {
          q.state = 'withdrawn';
          sim.log.push({ tick: sim.tick, text: `${UNITS[q.type].name} squad ${q.id} withdrew (${q.qty} remaining).` });
        }
        continue;
      }
      if (q.order === 'follow') {
        const leader = sim.squads.find((l) => l.id === q.followId);
        if (!leader || !alive(leader)) { q.order = 'hold'; q.state = 'holding'; q.tx = q.x; q.ty = q.y; }
        else { q.tx = leader.x - 30; q.ty = leader.y + 30; }
      } else if (q.state === 'idle' || (q.state === 'holding' && q.order !== 'hold')) {
        // short pursuit for idle squads
        const near = live.filter((e) => e.side !== q.side && e.state !== 'retreating').sort((a, b) => Math.hypot(a.x - q.x, a.y - q.y) - Math.hypot(b.x - q.x, b.y - q.y))[0];
        if (near && q.type !== 'artillery') {
          const d = Math.hypot(near.x - q.x, near.y - q.y);
          if (d > q.range && d < q.range * 1.8) { q.tx = near.x + ((q.x - near.x) / d) * q.range * 0.85; q.ty = near.y + ((q.y - near.y) / d) * q.range * 0.85; }
        }
      }
      const dx = q.tx - q.x, dy = q.ty - q.y, d = Math.hypot(dx, dy);
      if (d > 2) {
        const m = Math.min(d, spd);
        q.x += (dx / d) * m; q.y += (dy / d) * m;
        if (q.state !== 'moving' && q.order !== 'hold') q.state = 'moving';
      } else if (q.state === 'moving') {
        q.state = q.order === 'move' || q.order === 'regroup' ? 'idle' : q.order === 'follow' ? 'moving' : 'holding';
      }
    }
    // firing
    for (const q of live) {
      if (!alive(q) || q.state === 'retreating') continue;
      if (q.cooldown > 0) { q.cooldown--; continue; }
      const minRange = q.type === 'artillery' ? 50 : 0;
      let best: Squad | null = null, bd = Infinity;
      for (const e of live) {
        if (e.side === q.side || !alive(e)) continue;
        const d = Math.hypot(e.x - q.x, e.y - q.y);
        if (d <= q.range && d >= minRange && d < bd) { bd = d; best = e; }
      }
      if (!best) { q.targetId = null; continue; }
      q.targetId = best.id;
      const [r, ns] = nextRandom(sim.rng);
      sim.rng = ns;
      const fm = formationMods(q.formation), tfm = formationMods(best.formation);
      const ter = TERRAIN[cellAt(sim, best.x, best.y)].def;
      const fort = best.side === 'D' ? sim.fortifications.filter((f) => Math.hypot(f.x - best!.x, f.y - best!.y) < 130).reduce((a, f) => a + 0.12 * f.level, 0) : 0;
      const holding = best.state === 'holding' ? 1.1 : 1;
      const moving = q.state === 'moving' ? 0.65 : 1;
      const vs = UNITS[q.type].vs[best.type] ?? 1;
      const raw = q.qty * q.atk * (COOLDOWN[q.type] * DT) * 0.5 * vs * fm.atk * moving * (0.85 + r * 0.3);
      const mitigation = 6 / (6 + best.def * ter * tfm.def * holding * (1 + Math.min(0.5, fort)));
      const dmg = raw * mitigation * (best.type === 'tank' ? 1.6 : 1);
      best.hp -= dmg;
      best.qty = Math.max(0, Math.ceil(best.hp / best.hpPer));
      q.cooldown = COOLDOWN[q.type];
      sim.shots.push({ from: q.id, to: best.id, tick: sim.tick });
      if (best.hp <= 0) {
        best.hp = 0; best.qty = 0; best.state = 'destroyed';
        sim.log.push({ tick: sim.tick, text: `${best.side === 'A' ? 'Attacking' : 'Defending'} ${UNITS[best.type].name.toLowerCase()} squad ${best.id} destroyed.` });
      }
    }
    if (sim.shots.length > 60) sim.shots.splice(0, sim.shots.length - 60);
    // objective
    const obj = sim.objective;
    const inA = live.some((q) => q.side === 'A' && alive(q) && q.state !== 'retreating' && Math.hypot(q.x - obj.x, q.y - obj.y) <= obj.r);
    const inD = live.some((q) => q.side === 'D' && alive(q) && q.state !== 'retreating' && Math.hypot(q.x - obj.x, q.y - obj.y) <= obj.r);
    const rate = 1 / (12 * TICK_RATE);
    if (inA && !inD) obj.progress = Math.min(1, obj.progress + rate);
    else if (inD && !inA) obj.progress = Math.max(-1, obj.progress - rate);
    if (obj.progress >= 1 && obj.owner !== 'A') { obj.owner = 'A'; sim.log.push({ tick: sim.tick, text: 'Command point captured by the attacker.' }); }
    // end conditions
    const aLeft = sim.squads.some((q) => q.side === 'A' && alive(q) && q.state !== 'retreating');
    const dLeft = sim.squads.some((q) => q.side === 'D' && alive(q) && q.state !== 'retreating');
    let result: BattleSim['result'] = null;
    if (obj.owner === 'A') result = 'attacker';
    else if (!aLeft) result = 'defender';
    else if (!dLeft) result = 'attacker';
    else if (sim.tick >= sim.timeLimit) result = 'defender';
    if (result) {
      sim.ended = true;
      sim.result = result;
      sim.log.push({ tick: sim.tick, text: result === 'attacker' ? 'Attacker victory.' : 'Defender holds the territory.' });
    }
  }
  if (sim.log.length > 80) sim.log.splice(0, sim.log.length - 80);
}

/** Map battle survivors back onto the persistent unit groups. */
export function survivorsByUnit(sim: BattleSim) {
  const map = new Map<string, { qty: number; start: number; hp: number; maxHp: number }>();
  for (const q of sim.squads) {
    const e = map.get(q.sourceUnitId) ?? { qty: 0, start: 0, hp: 0, maxHp: 0 };
    e.qty += q.state === 'destroyed' ? 0 : q.qty;
    e.start += q.startQty;
    e.hp += Math.max(0, q.hp);
    e.maxHp += q.qty * q.hpPer;
    map.set(q.sourceUnitId, e);
  }
  return map;
}
