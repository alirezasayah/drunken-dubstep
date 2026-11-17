import { useState } from 'react';
import { DOCTRINES, TRAINING_LEVELS, UNITS } from '../engine/config';
import type { CampaignState } from '../engine/types';
import { store } from '../store';
import { RecruitBox, TrainingBox } from './BasesPanel';
import { Btn, Card, pct, Row, Section, timeLeft } from './common';
import { armyStrength, armySupply, armyUnits } from './helpers';
import { selectArmy } from './WorldPanel';

export function MilitaryPanel({ s }: { s: CampaignState }) {
  const [tab, setTab] = useState<'recruit' | 'training' | 'armies'>('armies');
  return (
    <div>
      <div className="flex gap-1 mb-3">
        {(['armies', 'recruit', 'training'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-1.5 text-sm rounded border capitalize ${tab === t ? 'border-[#a8b37a] bg-[#2f3528]' : 'border-[#3a4034]'}`}>{t}</button>
        ))}
      </div>
      {tab === 'recruit' && <Recruit s={s} />}
      {tab === 'training' && <Training s={s} />}
      {tab === 'armies' && <Armies s={s} />}
    </div>
  );
}

function Recruit({ s }: { s: CampaignState }) {
  const facilities = s.buildings.filter((b) => ['barracks', 'tank_base', 'artillery_facility'].includes(b.type) && s.bases.find((x) => x.id === b.baseId)?.factionId === s.playerFactionId);
  return (
    <div>
      {facilities.length === 0 && <p className="text-sm text-stone-500">Build a Barracks to recruit infantry.</p>}
      {facilities.map((b) => (
        <Card key={b.id}>
          <div className="text-xs text-stone-400 mb-1">{s.bases.find((x) => x.id === b.baseId)?.name} · L{b.level}</div>
          <RecruitBox s={s} b={b} />
        </Card>
      ))}
    </div>
  );
}

function Training({ s }: { s: CampaignState }) {
  const drills = s.buildings.filter((b) => b.type === 'drill_grounds' && s.bases.find((x) => x.id === b.baseId)?.factionId === s.playerFactionId);
  return (
    <div>
      <p className="text-xs text-stone-400 mb-2">Training raises combat performance (Basic → Intermediate → Advanced). Doctrines: {Object.values(DOCTRINES).map((d) => `${d.name}: ${d.describe}`).join(' ')}</p>
      {drills.length === 0 && <p className="text-sm text-stone-500">Build Drill Grounds to train units.</p>}
      {drills.map((b) => (
        <Card key={b.id}>
          <div className="text-xs text-stone-400 mb-1">{s.bases.find((x) => x.id === b.baseId)?.name}</div>
          <TrainingBox s={s} b={b} />
        </Card>
      ))}
    </div>
  );
}

function Armies({ s }: { s: CampaignState }) {
  const me = s.playerFactionId;
  const bases = s.bases.filter((b) => b.factionId === me);
  const [baseId, setBaseId] = useState(bases[0]?.id ?? '');
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const garrison = s.units.filter((u) => u.baseId === baseId && !u.armyId && u.factionId === me);
  const armies = s.armies.filter((a) => a.factionId === me);
  const total = Object.values(alloc).reduce((a, b) => a + b, 0);
  const create = () => {
    const res = store.exec('create_army', { baseId, name, allocations: Object.entries(alloc).map(([unitId, quantity]) => ({ unitId, quantity })) });
    if (res) {
      setAlloc({});
      setName('');
      store.toast('ok', 'Army formed. Select a target on the map.');
      selectArmy(store.state!, res.armyId);
    }
  };
  return (
    <div>
      <Section title="Army groups">
        {armies.length === 0 && <p className="text-sm text-stone-500">No armies yet.</p>}
        {armies.map((a) => {
          const sup = armySupply(s, a);
          const m = a.missionId ? s.missions.find((x) => x.id === a.missionId) : null;
          return (
            <Card key={a.id} onClick={() => selectArmy(s, a.id)}>
              <div className="flex justify-between text-sm"><span>{a.name}</span><span className="text-stone-400">{a.status.replace('_', ' ')}{m ? ` · ${timeLeft(s, m.arrivesAt)}` : ''}</span></div>
              <div className="text-xs text-stone-400">
                {armyUnits(s, a.id).map((u) => `${u.quantity} ${UNITS[u.type].name}`).join(', ')} · strength {Math.round(armyStrength(s, a.id))} · supply {sup.status}
              </div>
            </Card>
          );
        })}
      </Section>
      <Section title="Form new army">
        <div className="flex flex-col sm:flex-row gap-2 mb-2">
          <select className="flex-1 min-w-0 bg-[#1b1e19] border border-[#3a4034] rounded text-sm px-2 py-1.5" value={baseId} onChange={(e) => { setBaseId(e.target.value); setAlloc({}); }}>
            {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input className="flex-1 min-w-0 bg-[#1b1e19] border border-[#3a4034] rounded text-sm px-2 py-1.5" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
        </div>
        {garrison.length === 0 && <p className="text-sm text-stone-500">No garrisoned units at this base.</p>}
        {garrison.map((u) => {
          const busy = u.busyUntil != null && u.busyUntil > s.gameTime;
          const v = alloc[u.id] ?? 0;
          return (
            <div key={u.id} className={`rounded border border-[#3a4034] px-2 py-1.5 mb-1.5 ${busy ? 'opacity-50' : ''}`}>
              <div className="flex justify-between text-sm">
                <span>{UNITS[u.type].name} · {TRAINING_LEVELS[u.trainingLevel]} · {DOCTRINES[u.doctrine].name}</span>
                <span className="text-stone-400">{v}/{u.quantity}</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={u.quantity} value={v} disabled={busy} className="flex-1 accent-[#7a8f3a]" onChange={(e) => setAlloc({ ...alloc, [u.id]: Number(e.target.value) })} />
                <button className="text-xs text-[#a8b37a]" disabled={busy} onClick={() => setAlloc({ ...alloc, [u.id]: u.quantity })}>all</button>
              </div>
              <div className="text-[11px] text-stone-500">health {pct(u.health)} · readiness {pct(u.readiness)}{busy ? ' · in training' : ''}</div>
            </div>
          );
        })}
        <Row label="Assigned">{total} units</Row>
        <Btn className="w-full mt-1" disabled={total === 0} onClick={create}>Create army</Btn>
      </Section>
    </div>
  );
}
