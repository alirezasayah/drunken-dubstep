import { DOCTRINES, SITE_OUTPUT, SITE_UPGRADE_COST, TRAINING_LEVELS, UNITS } from '../engine/config';
import { forwardBaseCost } from '../engine/operations';
import type { CampaignState } from '../engine/types';
import { armySpeed, armyStrength, armySupply, armyUnits, dist, getFaction, levelOut, regionStrength, travelTime } from './helpers';
import { store } from '../store';
import { Bar, Btn, Card, Cost, pct, Row, Section, timeLeft } from './common';

export function WorldPanel({ s }: { s: CampaignState }) {
  const sel = store.ui.selection;
  if (!sel) return <Overview s={s} />;
  if (sel.kind === 'region') return <RegionView s={s} id={sel.id} />;
  if (sel.kind === 'army') return <ArmyView s={s} id={sel.id} />;
  if (sel.kind === 'site') return <SiteView s={s} id={sel.id} />;
  if (sel.kind === 'base') {
    const base = s.bases.find((b) => b.id === sel.id);
    if (base) return <RegionView s={s} id={base.regionId} baseId={base.id} />;
  }
  return <Overview s={s} />;
}

function Overview({ s }: { s: CampaignState }) {
  const pending = s.battles.filter((b) => b.status !== 'resolved' && (b.attackerFactionId === s.playerFactionId || b.defenderFactionId === s.playerFactionId));
  const armies = s.armies.filter((a) => a.factionId === s.playerFactionId);
  return (
    <div>
      <p className="text-sm text-stone-400 mb-3">Tap a region, base, resource site or army on the map to inspect it. Drag to pan; pinch or scroll to zoom.</p>
      {pending.length > 0 && (
        <Section title="Engagements">
          {pending.map((b) => (
            <Card key={b.id}>
              <div className="flex items-center justify-between">
                <span className="text-sm">Battle of {s.regions.find((r) => r.id === b.regionId)?.name}</span>
                <Btn kind="danger" onClick={() => enterBattle(b.id)}>Command</Btn>
              </div>
            </Card>
          ))}
        </Section>
      )}
      <Section title="Your armies">
        {armies.length === 0 && <p className="text-sm text-stone-500">No armies. Form one in Military → Armies.</p>}
        {armies.map((a) => (
          <Card key={a.id} onClick={() => selectArmy(s, a.id)}>
            <div className="flex justify-between text-sm"><span>{a.name}</span><span className="text-stone-400">{a.status.replace('_', ' ')}</span></div>
          </Card>
        ))}
      </Section>
    </div>
  );
}

export function enterBattle(battleId: string) {
  const ok = store.exec('start_battle', { battleId });
  if (ok) store.set({ battleId, panelOpen: false, placement: null, targeting: null, battle: { ...store.ui.battle, paused: true, selected: [], followMode: false } });
}

export function selectArmy(s: CampaignState, id: string) {
  const a = s.armies.find((x) => x.id === id);
  store.set({ selection: { kind: 'army', id }, screen: 'world', panelOpen: true, focus: a ? { x: a.x, y: a.y } : null });
}

function RegionView({ s, id, baseId }: { s: CampaignState; id: string; baseId?: string }) {
  const r = s.regions.find((x) => x.id === id)!;
  const rec = s.intel.find((i) => i.regionId === id)!;
  const me = s.playerFactionId;
  const ownerId = rec.discovered ? (rec.lastSeenAt === s.gameTime ? r.ownerId : rec.ownerId) : null;
  const owner = ownerId ? getFaction(s, ownerId) : null;
  const sites = s.sites.filter((x) => x.regionId === id);
  const bases = s.bases.filter((b) => b.regionId === id);
  const stationed = s.armies.filter((a) => a.factionId === me && a.status === 'stationed');
  const mine = r.ownerId === me;
  const stale = rec.lastSeenAt != null && s.gameTime - rec.lastSeenAt > 2;
  return (
    <div>
      <h2 className="text-lg font-semibold text-stone-100">{rec.discovered ? r.name : 'Unexplored region'}</h2>
      <p className="text-xs text-stone-500 mb-3">{r.area}{rec.discovered ? ` · ${r.terrain}` : ''}</p>
      {!rec.discovered ? (
        <p className="text-sm text-stone-400">No intelligence. Move an army nearby or build a Radar Station to reveal this region.</p>
      ) : (
        <>
          <Row label="Control">{owner ? owner.name : 'Neutral'}{r.status === 'contested' ? ' (contested)' : ''}</Row>
          <Row label="Defensive strength">{mine ? Math.round(regionStrength(s, r)) : rec.estStrength == null ? 'unknown' : `~${rec.estStrength}${stale ? ' (last known)' : ''}`}</Row>
          {r.occupation && (
            <div className="my-2">
              <Row label={`Occupation by ${getFaction(s, r.occupation.factionId).name}`}>{timeLeft(s, r.occupation.finishesAt)}</Row>
            </div>
          )}
          {bases.filter((b) => b.factionId === me || rec.discovered).map((b) => (
            <Row key={b.id} label="Base">{b.name}{b.id === baseId ? ' ◂' : ''}</Row>
          ))}
          {sites.length > 0 && (
            <Section title="Resource sites">
              {sites.map((st) => (
                <Card key={st.id} onClick={() => store.set({ selection: { kind: 'site', id: st.id } })}>
                  <div className="flex justify-between text-sm"><span className="capitalize">{st.type} · L{st.level}</span><span className="text-stone-400">{st.status} · quality {pct(st.quality)}</span></div>
                </Card>
              ))}
            </Section>
          )}
        </>
      )}
      {!mine && (
        <Section title="Send an army">
          {stationed.length === 0 && <p className="text-sm text-stone-500">No stationed armies available. Create one under Military → Armies.</p>}
          {stationed.map((a) => {
            const t = travelTime(s, a, r.seed, armySpeed(s, a), armySupply(s, a).factor) / s.settings.speed;
            return (
              <Card key={a.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <div>{a.name}</div>
                    <div className="text-xs text-stone-400">Strength {Math.round(armyStrength(s, a.id))} · ETA {Math.round(t)}s</div>
                  </div>
                  <Btn kind="warn" onClick={() => store.exec('launch_mission', { armyId: a.id, type: 'capture', targetRegionId: r.id }, { okText: `${a.name} advancing on ${r.name}` })}>Capture</Btn>
                </div>
              </Card>
            );
          })}
        </Section>
      )}
      {mine && (
        <Section title="Forward base">
          <p className="text-xs text-stone-400 mb-2">Extends construction area and supply radius. Cost <Cost cost={forwardBaseCost(s, me)} have={getFaction(s, me).resources} /></p>
          <Btn onClick={() => store.set({ basePlacement: { ghost: null }, panelOpen: false, focus: { x: r.seed.x, y: r.seed.y } })}>Place forward base…</Btn>
        </Section>
      )}
    </div>
  );
}

function SiteView({ s, id }: { s: CampaignState; id: string }) {
  const st = s.sites.find((x) => x.id === id)!;
  const r = s.regions.find((x) => x.id === st.regionId)!;
  const mine = r.ownerId === s.playerFactionId;
  const out = SITE_OUTPUT[st.type] * st.quality * levelOut(st.level);
  return (
    <div>
      <h2 className="text-lg font-semibold capitalize">{st.type} facility</h2>
      <p className="text-xs text-stone-500 mb-3">{r.name}</p>
      <Row label="Owner">{r.ownerId ? getFaction(s, r.ownerId).name : 'Neutral'}</Row>
      <Row label="Status">{st.status}{st.opFinishesAt ? ` (${timeLeft(s, st.opFinishesAt)})` : ''}</Row>
      <Row label="Deposit quality">{pct(st.quality)}</Row>
      <Row label="Facility level">{st.level}</Row>
      <Row label="Output">{(out * 60).toFixed(1)} {st.type}/min (before modifiers)</Row>
      {mine ? (
        <div className="mt-3 flex items-center gap-3">
          <Btn disabled={st.status !== 'operational'} onClick={() => store.exec('upgrade_site', { siteId: st.id }, { okText: 'Facility upgrade started' })}>Upgrade to L{st.level + 1}</Btn>
          <Cost cost={SITE_UPGRADE_COST(st.level)} have={getFaction(s, s.playerFactionId).resources} />
        </div>
      ) : (
        <div className="mt-3"><Btn kind="ghost" onClick={() => store.set({ selection: { kind: 'region', id: r.id } })}>Capture this region…</Btn></div>
      )}
    </div>
  );
}

function ArmyView({ s, id }: { s: CampaignState; id: string }) {
  const a = s.armies.find((x) => x.id === id);
  if (!a) return <p className="text-sm text-stone-400">Army no longer exists.</p>;
  const mine = a.factionId === s.playerFactionId;
  const units = armyUnits(s, a.id);
  const sup = armySupply(s, a);
  const m = a.missionId ? s.missions.find((x) => x.id === a.missionId) : null;
  const battle = s.battles.find((b) => b.status !== 'resolved' && (b.attackerArmyId === a.id || b.defenderUnitIds.some((u) => units.some((x) => x.id === u))));
  const home = s.bases.find((b) => b.id === a.homeBaseId);
  const atBase = s.bases.find((b) => b.factionId === a.factionId && dist(b, a) <= b.radius + 60);
  if (!mine) {
    return (
      <div>
        <h2 className="text-lg font-semibold">{getFaction(s, a.factionId).name} force</h2>
        <Row label="Status">{a.status.replace('_', ' ')}</Row>
        <Row label="Estimated strength">~{Math.round(armyStrength(s, a.id) / 25) * 25}</Row>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-lg font-semibold">{a.name}</h2>
      <p className="text-xs text-stone-500 mb-3">{a.commander} · home {home?.name ?? '—'}</p>
      <Row label="Status">{a.status.replace('_', ' ')}</Row>
      {m && <Row label="Mission">{m.type} → {s.regions.find((r) => r.id === m.targetRegionId)?.name} · ETA {timeLeft(s, m.arrivesAt)}</Row>}
      <Row label="Strength">{Math.round(armyStrength(s, a.id))}</Row>
      <Row label="Supply"><span className={sup.status === 'supplied' ? 'text-[#a8cf6a]' : sup.status === 'stretched' ? 'text-[#e6c94f]' : 'text-[#e0533f]'}>{sup.status}</span></Row>
      <ul className="text-xs text-stone-400 list-disc ml-4 mb-3">{sup.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <Section title="Composition">
        {units.map((u) => (
          <div key={u.id} className="text-sm mb-2">
            <div className="flex justify-between"><span>{u.quantity} × {UNITS[u.type].name}</span><span className="text-stone-400">{TRAINING_LEVELS[u.trainingLevel]} · {DOCTRINES[u.doctrine].name}</span></div>
            <div className="grid grid-cols-2 gap-2 mt-1 text-[11px] text-stone-400">
              <div>Health {pct(u.health)}<Bar value={u.health} color="#9ccf5a" /></div>
              <div>Readiness {pct(u.readiness)}<Bar value={u.readiness} color="#e6c94f" /></div>
            </div>
          </div>
        ))}
      </Section>
      <div className="flex flex-wrap gap-2">
        {battle && <Btn kind="danger" onClick={() => enterBattle(battle.id)}>Command battle</Btn>}
        {a.status === 'stationed' && (
          <>
            <Btn kind="warn" onClick={() => store.set({ targeting: { armyId: a.id, type: 'capture' }, panelOpen: false })}>Capture region…</Btn>
            <Btn kind="ghost" onClick={() => store.set({ targeting: { armyId: a.id, type: 'move' }, panelOpen: false })}>Reposition…</Btn>
            {!atBase && <Btn kind="ghost" onClick={() => store.exec('launch_mission', { armyId: a.id, type: 'return' }, { okText: 'Returning to base' })}>Return to base</Btn>}
            {atBase && <Btn kind="ghost" onClick={() => store.exec('disband_army', { armyId: a.id }, { okText: `Units joined ${atBase.name} garrison` }) && store.set({ selection: null })}>Disband into garrison</Btn>}
          </>
        )}
      </div>
    </div>
  );
}
