import { BUILDINGS, levelOutputMult, MAX_LEVEL, TRAINING_COST, TRAINING_LEVELS, UNITS, DOCTRINES, DOCTRINE_RETRAIN } from '../engine/config';
import {
  baseCapacity, buildCost, buildingAvailable, constructionSlots, opTime, queueCapacity, recruitTimePerUnit, upgradeCost,
} from '../engine/operations';
import type { Base, Building, BuildingType, CampaignState, Doctrine, UnitType } from '../engine/types';
import { useState } from 'react';
import { store } from '../store';
import { adjacencyBonus, baseSupply, economy, getFaction, groupStrength, storageCapacity } from './helpers';
import { Bar, Btn, Card, Cost, pct, rate, Row, Section, timeLeft } from './common';

export function BasesPanel({ s }: { s: CampaignState }) {
  const sel = store.ui.selection;
  const mine = s.bases.filter((b) => b.factionId === s.playerFactionId);
  if (sel?.kind === 'building') {
    const b = s.buildings.find((x) => x.id === sel.id);
    if (b) return <BuildingDetails s={s} b={b} />;
  }
  const base = sel?.kind === 'base' ? mine.find((b) => b.id === sel.id) : undefined;
  if (base) return <BaseView s={s} base={base} />;
  const slots = constructionSlots(s, s.playerFactionId);
  return (
    <div>
      <p className="text-xs text-stone-400 mb-3">Construction crews: {slots.used}/{slots.max} busy</p>
      {mine.map((b) => (
        <Card key={b.id} onClick={() => store.set({ selection: { kind: 'base', id: b.id }, focus: { x: b.x, y: b.y } })}>
          <div className="flex justify-between text-sm">
            <span>{b.name}</span>
            <span className="text-stone-400">{b.type === 'main' ? 'Main' : 'Forward'} · {s.buildings.filter((x) => x.baseId === b.id).length} buildings</span>
          </div>
          <div className="text-xs text-stone-500">{s.regions.find((r) => r.id === b.regionId)?.name} · role: {baseRole(s, b)}</div>
        </Card>
      ))}
    </div>
  );
}

function baseRole(s: CampaignState, b: Base) {
  const types = s.buildings.filter((x) => x.baseId === b.id).map((x) => x.type);
  if (types.includes('headquarters')) return 'Main Headquarters';
  const count = (t: BuildingType[]) => types.filter((x) => t.includes(x)).length;
  const scores: [string, number][] = [
    ['Infantry Training', count(['barracks', 'drill_grounds'])],
    ['Armored', count(['tank_base'])],
    ['Industrial', count(['power_plant', 'oil_refinery', 'warehouse'])],
    ['Forward Operating', count(['supply_depot', 'fortification'])],
  ];
  scores.sort((a, c) => c[1] - a[1]);
  return scores[0][1] ? scores[0][0] : 'Unspecialized';
}

function BaseView({ s, base }: { s: CampaignState; base: Base }) {
  const f = getFaction(s, s.playerFactionId);
  const buildings = s.buildings.filter((b) => b.baseId === base.id);
  const cap = baseCapacity(s, base);
  const sup = baseSupply(s, base);
  const garrison = s.units.filter((u) => u.baseId === base.id && !u.armyId);
  const forts = buildings.filter((b) => b.type === 'fortification');
  const catalog = (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => BUILDINGS[t].buildable);
  return (
    <div>
      <button className="text-xs text-[#a8b37a] mb-2" onClick={() => store.set({ selection: null })}>◂ All bases</button>
      <h2 className="text-lg font-semibold">{base.name}</h2>
      <p className="text-xs text-stone-500 mb-3">{base.type === 'main' ? 'Main base' : 'Forward base'} · {s.regions.find((r) => r.id === base.regionId)?.name} · {baseRole(s, base)}</p>
      <Row label="Building slots">{cap.used}/{cap.max}</Row>
      <Row label="Faction storage">{Math.round(storageCapacity(s, f.id))} per resource</Row>
      <Row label="Supply"><span className={sup.status === 'supplied' ? 'text-[#a8cf6a]' : 'text-[#e6c94f]'}>{sup.status}</span></Row>
      <ul className="text-xs text-stone-400 list-disc ml-4 mb-2">{sup.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <Row label="Defense">{forts.length} fortifications · garrison strength {Math.round(garrison.reduce((a, u) => a + groupStrength(u), 0))}</Row>
      <Section title="Construct">
        <div className="grid grid-cols-1 gap-1.5">
          {catalog.map((t) => {
            const why = buildingAvailable(s, f.id, base, t);
            const d = BUILDINGS[t];
            return (
              <div key={t} className={`flex items-center justify-between gap-2 rounded border border-[#3a4034] px-2 py-1.5 ${why ? 'opacity-50' : ''}`}>
                <div className="min-w-0">
                  <div className="text-sm">{d.name} <span className="text-[11px] text-stone-500">{opTime(s, f.id, t, 1)}s</span></div>
                  <div className="text-[11px]"><Cost cost={buildCost(t)} have={f.resources} /></div>
                  {why && <div className="text-[11px] text-stone-500">{why}</div>}
                </div>
                <Btn disabled={!!why} onClick={() => store.set({ placement: { baseId: base.id, type: t, rotation: 0, ghost: null }, panelOpen: false, focus: { x: base.x, y: base.y } })}>Place</Btn>
              </div>
            );
          })}
        </div>
      </Section>
      <Section title="Buildings">
        {buildings.map((b) => (
          <Card key={b.id} onClick={() => store.set({ selection: { kind: 'building', id: b.id } })}>
            <div className="flex justify-between text-sm">
              <span>{BUILDINGS[b.type].name} <span className="text-stone-400">L{b.level}</span></span>
              <span className="text-xs text-stone-400">{b.status === 'operational' ? 'operational' : `${b.status} ${timeLeft(s, b.opFinishesAt)}`}</span>
            </div>
          </Card>
        ))}
      </Section>
    </div>
  );
}

export function BuildingDetails({ s, b }: { s: CampaignState; b: Building }) {
  const f = getFaction(s, s.playerFactionId);
  const def = BUILDINGS[b.type];
  const base = s.bases.find((x) => x.id === b.baseId)!;
  const line = economy(s, f.id).lines.find((l) => l.ref === b.id);
  const adj = adjacencyBonus(s, b);
  const progress = b.opStartedAt != null && b.opFinishesAt ? (s.gameTime - b.opStartedAt) / Math.max(1, b.opFinishesAt - b.opStartedAt) : 0;
  return (
    <div>
      <button className="text-xs text-[#a8b37a] mb-2" onClick={() => store.set({ selection: { kind: 'base', id: base.id } })}>◂ {base.name}</button>
      <div className="flex items-center gap-3 mb-2">
        <BuildingIcon type={b.type} />
        <div>
          <h2 className="text-lg font-semibold">{def.name}</h2>
          <p className="text-xs text-stone-500">Level {b.level}/{MAX_LEVEL} · {def.describe}</p>
        </div>
      </div>
      <Row label="Health">{pct(b.health)}</Row>
      <Row label="Status">{b.status}</Row>
      {b.status !== 'operational' && (
        <div className="mb-2"><Bar value={progress} color="#d1b450" /><div className="text-xs text-stone-400 mt-1">{timeLeft(s, b.opFinishesAt)} remaining</div></div>
      )}
      {line && (
        <>
          {Object.entries(line.delta).filter(([, v]) => (v as number) > 0).map(([k, v]) => <Row key={k} label={`Produces ${k}`}>{rate(v as number)}</Row>)}
          {Object.entries(line.delta).filter(([, v]) => (v as number) < 0).map(([k, v]) => <Row key={k} label={`Maintenance ${k}`}>{rate(v as number)}</Row>)}
        </>
      )}
      {def.storage && <Row label="Storage">+{Math.round(def.storage * levelOutputMult(b.level))}</Row>}
      {def.supply && <Row label="Supply capacity">+{Math.round(def.supply * levelOutputMult(b.level))}</Row>}
      <Section title="Adjacency bonuses">
        {adj.length === 0 ? <p className="text-xs text-stone-500">None. Place compatible buildings nearby.</p> : adj.map((a) => <Row key={a.label} label={a.label}>+{pct(a.value)}</Row>)}
      </Section>
      {b.level < MAX_LEVEL && (
        <div className="flex items-center gap-3 mb-4">
          <Btn disabled={b.status !== 'operational'} onClick={() => store.exec('upgrade_building', { buildingId: b.id }, { okText: `Upgrading ${def.name}` })}>Upgrade to L{b.level + 1}</Btn>
          <span className="text-xs"><Cost cost={upgradeCost(b)} have={f.resources} /> · {opTime(s, f.id, b.type, b.level + 1)}s</span>
        </div>
      )}
      {(['barracks', 'tank_base', 'artillery_facility'] as BuildingType[]).includes(b.type) && <RecruitBox s={s} b={b} />}
      {b.type === 'drill_grounds' && <TrainingBox s={s} b={b} />}
    </div>
  );
}

export function BuildingIcon({ type }: { type: BuildingType }) {
  const glyph: Record<BuildingType, string> = {
    headquarters: '✚', barracks: '▤', drill_grounds: '◎', supply_depot: '▦', warehouse: '▭', power_plant: '⚡', oil_refinery: '⛽',
    tank_base: '▣', artillery_facility: '▲', radar_station: '◠', fortification: '▙',
  };
  return <div className="w-10 h-10 rounded bg-[#3d4630] border border-[#7a8f3a] grid place-items-center text-lg text-[#d7e3a8]">{glyph[type]}</div>;
}

export function RecruitBox({ s, b }: { s: CampaignState; b: Building }) {
  const f = getFaction(s, s.playerFactionId);
  const unitType = (Object.keys(UNITS) as UnitType[]).find((u) => UNITS[u].facility === b.type)!;
  const [qty, setQty] = useState(10);
  const def = UNITS[unitType];
  const cost = Object.fromEntries(Object.entries(def.cost).map(([k, v]) => [k, (v as number) * qty]));
  const queue = s.queues.filter((q) => q.buildingId === b.id);
  const t = recruitTimePerUnit(s, f.id, b, unitType) * qty;
  return (
    <Section title={`Recruit ${def.name}`}>
      <div className="flex items-center gap-2 mb-2">
        {[5, 10, 20, 30].map((n) => (
          <button key={n} onClick={() => setQty(n)} className={`px-2 py-1 text-sm rounded border ${qty === n ? 'border-[#a8b37a] bg-[#2f3528]' : 'border-[#3a4034]'}`}>{n}</button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs"><Cost cost={cost} have={f.resources} /> · {Math.round(t / s.settings.speed)}s</span>
        <Btn disabled={b.status === 'constructing'} onClick={() => store.exec('start_recruitment', { buildingId: b.id, unitType, quantity: qty }, { okText: `${qty} ${def.name.toLowerCase()} queued` })}>Recruit</Btn>
      </div>
      <div className="text-xs text-stone-500 mb-1">Queue {queue.length}/{queueCapacity(b)}</div>
      {queue.map((q) => (
        <div key={q.id} className="mb-1.5">
          <div className="flex justify-between text-xs"><span>{q.quantity} × {UNITS[q.unitType].name}</span><span className="text-stone-400">{q.startedAt > s.gameTime ? 'waiting' : timeLeft(s, q.finishesAt)}</span></div>
          <Bar value={(s.gameTime - q.startedAt) / Math.max(1, q.finishesAt - q.startedAt)} />
        </div>
      ))}
    </Section>
  );
}

export function TrainingBox({ s, b }: { s: CampaignState; b: Building }) {
  const f = getFaction(s, s.playerFactionId);
  const garrison = s.units.filter((u) => u.baseId === b.baseId && !u.armyId && u.factionId === f.id);
  const queue = s.queues.filter((q) => q.buildingId === b.id);
  return (
    <Section title="Training & doctrine">
      {garrison.length === 0 && <p className="text-xs text-stone-500">No garrisoned units at this base.</p>}
      {garrison.map((u) => {
        const busy = u.busyUntil != null && u.busyUntil > s.gameTime;
        const next = (u.trainingLevel + 1) as 1 | 2;
        return (
          <Card key={u.id}>
            <div className="flex justify-between text-sm"><span>{u.quantity} × {UNITS[u.type].name}</span><span className="text-stone-400">{TRAINING_LEVELS[u.trainingLevel]}</span></div>
            {busy ? (
              <div className="text-xs text-[#e6c94f] mt-1">In training · {timeLeft(s, u.busyUntil)}</div>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {u.type === 'infantry' && u.trainingLevel < 2 && (
                  <>
                    <Btn onClick={() => store.exec('start_training', { unitId: u.id, buildingId: b.id }, { okText: 'Training started' })}>Train → {TRAINING_LEVELS[next]}</Btn>
                    <span className="text-xs"><Cost cost={TRAINING_COST(u.type, u.quantity, next)} have={f.resources} /></span>
                  </>
                )}
                <select
                  className="bg-[#1b1e19] border border-[#3a4034] rounded text-sm px-1 py-1"
                  value={u.doctrine}
                  onChange={(e) => store.exec('change_doctrine', { unitId: u.id, buildingId: b.id, doctrine: e.target.value as Doctrine }, { okText: 'Doctrine retraining started' })}
                >
                  {(Object.keys(DOCTRINES) as Doctrine[]).map((d) => <option key={d} value={d}>{DOCTRINES[d].name}</option>)}
                </select>
                <span className="text-[11px] text-stone-500">retrain ${DOCTRINE_RETRAIN.money * u.quantity}</span>
              </div>
            )}
          </Card>
        );
      })}
      {queue.length > 0 && <div className="text-xs text-stone-500">Queue {queue.length}/{queueCapacity(b)}</div>}
    </Section>
  );
}
