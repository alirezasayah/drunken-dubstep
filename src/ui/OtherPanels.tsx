import { useRef, useState } from 'react';
import { RES_KEYS, TECH_BY_KEY, TECHS, techCost } from '../engine/config';
import { researchAvailability } from '../engine/operations';
import { formatDuration } from '../engine/simulation';
import type { CampaignState } from '../engine/types';
import { store } from '../store';
import { Bar, Btn, Card, Cost, fmt, rate, RES_COLOR, RES_ICON, Row, Section, timeLeft } from './common';
import { economy, getFaction, storageCapacity } from './helpers';
import { enterBattle } from './WorldPanel';

export function ResearchPanel({ s }: { s: CampaignState }) {
  const f = getFaction(s, s.playerFactionId);
  const rows = s.research[f.id];
  const branches = ['industrial', 'military', 'defense', 'logistics'] as const;
  return (
    <div>
      <p className="text-xs text-stone-400 mb-3">One research project at a time. Prerequisites must be complete.</p>
      {branches.map((br) => (
        <Section key={br} title={br}>
          <div className="relative pl-3 border-l border-[#3a4034]">
            {TECHS.filter((t) => t.branch === br).map((t) => {
              const row = rows.find((r) => r.key === t.key)!;
              const why = researchAvailability(s, f.id, t.key);
              const maxed = row.level >= t.maxLevel;
              return (
                <Card key={t.key} active={row.status === 'researching'}>
                  <div className="flex justify-between text-sm">
                    <span>{t.name}</span>
                    <span className="text-stone-400">{row.level}/{t.maxLevel}</span>
                  </div>
                  <div className="text-xs text-stone-400">{t.effect}</div>
                  {t.requires.length > 0 && <div className="text-[11px] text-stone-500">Requires {t.requires.map((r) => `${TECH_BY_KEY[r.key].name} ${r.level}`).join(', ')}</div>}
                  {row.status === 'researching' ? (
                    <div className="mt-1.5"><Bar value={(s.gameTime - (row.startedAt ?? 0)) / Math.max(1, (row.finishesAt ?? 1) - (row.startedAt ?? 0))} /><div className="text-xs text-stone-400 mt-0.5">{timeLeft(s, row.finishesAt)} remaining</div></div>
                  ) : !maxed ? (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs"><Cost cost={techCost(t, row.level + 1)} have={f.resources} /> · {Math.round((t.time * Math.pow(1.4, row.level)) / s.settings.speed)}s</span>
                      <Btn disabled={!!why} title={why ?? ''} onClick={() => store.exec('start_research', { key: t.key }, { okText: `Researching ${t.name}` })}>Research</Btn>
                    </div>
                  ) : (
                    <div className="text-xs text-[#a8cf6a] mt-1">Complete</div>
                  )}
                </Card>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}

export function ReportsPanel({ s }: { s: CampaignState }) {
  const [tab, setTab] = useState<'alerts' | 'intel' | 'battles'>('alerts');
  const me = s.playerFactionId;
  const color = { info: 'border-l-stone-500', success: 'border-l-[#7a8f3a]', warning: 'border-l-[#e6c94f]', danger: 'border-l-[#e0533f]', battle: 'border-l-[#e0533f]' };
  return (
    <div>
      <div className="flex gap-1 mb-3">
        {(['alerts', 'intel', 'battles'] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); if (t === 'alerts') store.exec('mark_read', {}, { silent: true }); }} className={`flex-1 py-1.5 text-sm rounded border capitalize ${tab === t ? 'border-[#a8b37a] bg-[#2f3528]' : 'border-[#3a4034]'}`}>{t}</button>
        ))}
      </div>
      {tab === 'alerts' && (
        <div>
          {s.notifications.slice(0, 60).map((n) => (
            <div key={n.id} className={`border-l-4 ${color[n.kind]} bg-[#23271f] rounded-r px-3 py-2 mb-1.5 cursor-pointer`} onClick={() => openRef(s, n.ref)}>
              <div className="flex justify-between text-sm"><span className={n.read ? 'text-stone-300' : 'text-stone-50 font-medium'}>{n.title}</span><span className="text-[11px] text-stone-500">{formatDuration(s.gameTime - n.at)} ago</span></div>
              <div className="text-xs text-stone-400">{n.body}</div>
            </div>
          ))}
        </div>
      )}
      {tab === 'intel' && (
        <div>
          {s.intel.map((rec) => {
            const r = s.regions.find((x) => x.id === rec.regionId)!;
            if (!rec.discovered) return <Card key={rec.regionId}><div className="text-sm text-stone-500">Unexplored region ({r.area})</div></Card>;
            const owner = rec.ownerId ? getFaction(s, rec.ownerId) : null;
            const seen = s.gameTime - (rec.lastSeenAt ?? 0);
            return (
              <Card key={rec.regionId} onClick={() => store.set({ selection: { kind: 'region', id: r.id }, screen: 'world', focus: r.seed })}>
                <div className="flex justify-between text-sm">
                  <span>{r.name}</span>
                  <span style={{ color: owner ? `#${owner.color.toString(16).padStart(6, '0')}` : '#999' }}>{owner?.id === me ? 'Yours' : owner?.name ?? 'Neutral'}</span>
                </div>
                <div className="text-xs text-stone-400">Strength {rec.estStrength == null ? 'unknown' : `~${rec.estStrength}`} · {seen < 3 ? 'live' : `seen ${formatDuration(seen)} ago`}</div>
              </Card>
            );
          })}
        </div>
      )}
      {tab === 'battles' && (
        <div>
          {s.battles.filter((b) => b.attackerFactionId === me || b.defenderFactionId === me).length === 0 && <p className="text-sm text-stone-500">No engagements yet.</p>}
          {[...s.battles].reverse().filter((b) => b.attackerFactionId === me || b.defenderFactionId === me).map((b) => {
            const won = b.result && (b.result === 'attacker') === (b.attackerFactionId === me);
            return (
              <Card key={b.id}>
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <div>Battle of {s.regions.find((r) => r.id === b.regionId)?.name}</div>
                    <div className="text-xs text-stone-400">{b.attackerFactionId === me ? 'Attacking' : 'Defending'} vs {getFaction(s, b.attackerFactionId === me ? b.defenderFactionId : b.attackerFactionId).name}</div>
                  </div>
                  {b.status === 'resolved' ? <span className={won ? 'text-[#a8cf6a]' : 'text-[#e0533f]'}>{won ? 'Victory' : 'Defeat'}</span> : <Btn kind="danger" onClick={() => enterBattle(b.id)}>Command</Btn>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function openRef(s: CampaignState, ref?: { kind: string; id: string }) {
  if (!ref) return;
  if (ref.kind === 'battle') {
    const b = s.battles.find((x) => x.id === ref.id);
    if (b && b.status !== 'resolved') return enterBattle(b.id);
    return;
  }
  if (ref.kind === 'region') { const r = s.regions.find((x) => x.id === ref.id); return store.set({ selection: { kind: 'region', id: ref.id }, screen: 'world', focus: r?.seed ?? null }); }
  if (ref.kind === 'base') { const b = s.bases.find((x) => x.id === ref.id); return store.set({ selection: { kind: 'base', id: ref.id }, screen: 'bases', focus: b ? { x: b.x, y: b.y } : null }); }
  if (ref.kind === 'building') return store.set({ selection: { kind: 'building', id: ref.id }, screen: 'bases' });
  if (ref.kind === 'site') return store.set({ selection: { kind: 'site', id: ref.id }, screen: 'world' });
  if (ref.kind === 'army') return store.set({ selection: { kind: 'army', id: ref.id }, screen: 'world' });
  if (ref.kind === 'research') return store.set({ screen: 'research' });
}

export function EconomyPanel({ s }: { s: CampaignState }) {
  const f = getFaction(s, s.playerFactionId);
  const eco = economy(s, f.id);
  const cap = storageCapacity(s, f.id);
  const ledger = s.ledger.filter((t) => t.factionId === f.id).slice(0, 25);
  return (
    <div>
      {(f.deficit || f.lowEnergy) && (
        <div className="rounded border border-[#a3483f] bg-[#3a201c] px-3 py-2 mb-3 text-sm">
          {f.deficit && <div>Maintenance deficit: production and readiness reduced to 50%.</div>}
          {f.lowEnergy && <div>Energy shortage: production reduced. Build or upgrade a Power Plant.</div>}
        </div>
      )}
      <Section title="Resources">
        <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-3 gap-y-1 text-sm">
          <span className="text-stone-500 text-xs">res</span><span className="text-stone-500 text-xs text-right">stock</span><span className="text-stone-500 text-xs text-right">net</span><span className="text-stone-500 text-xs text-right">storage</span>
          {RES_KEYS.map((k) => (
            <FragmentRow key={k} k={k} stock={f.resources[k]} net={eco.net[k]} cap={k === 'money' ? null : cap} income={eco.income[k]} upkeep={eco.upkeep[k]} />
          ))}
        </div>
        <Row label="Efficiency">{Math.round(eco.efficiency * 100)}%</Row>
      </Section>
      <Section title="Production & maintenance by source">
        {eco.lines.map((l) => (
          <div key={l.ref + l.source} className="flex justify-between text-xs py-0.5 border-b border-[#2a2e26]">
            <span className="text-stone-300">{l.source}</span>
            <span className="text-right">
              {Object.entries(l.delta).filter(([, v]) => Math.abs(v as number) > 1e-4).map(([k, v]) => (
                <span key={k} className={`ml-2 ${(v as number) >= 0 ? RES_COLOR[k as keyof typeof RES_COLOR] : 'text-[#e08a7f]'}`}>{RES_ICON[k as keyof typeof RES_ICON]}{rate(v as number)}</span>
              ))}
            </span>
          </div>
        ))}
      </Section>
      <Section title="Transaction ledger">
        {ledger.map((t) => (
          <div key={t.id} className="flex justify-between text-xs py-0.5">
            <span className="text-stone-400">{t.type.replace('_', ' ')}</span>
            <span className={t.amount >= 0 ? 'text-[#a8cf6a]' : 'text-[#e08a7f]'}>{t.amount >= 0 ? '+' : ''}{Math.round(t.amount)} {t.resource}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function FragmentRow({ k, stock, net, cap, income, upkeep }: { k: keyof typeof RES_ICON; stock: number; net: number; cap: number | null; income: number; upkeep: number }) {
  return (
    <>
      <span className={RES_COLOR[k]}>{RES_ICON[k]} {k}</span>
      <span className="text-right">{fmt(stock)}</span>
      <span className={`text-right ${net >= 0 ? 'text-[#a8cf6a]' : 'text-[#e08a7f]'}`} title={`income ${rate(income)} / upkeep ${rate(-upkeep)}`}>{rate(net)}</span>
      <span className={`text-right ${cap != null && stock >= cap - 1 ? 'text-[#e6c94f]' : 'text-stone-400'}`}>{cap == null ? '—' : fmt(cap)}</span>
    </>
  );
}

export function SettingsPanel({ s }: { s: CampaignState }) {
  const id = s.id;
  const [label, setLabel] = useState('');
  const [, force] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const snaps = store.server.listSnapshots(id);
  const exportFile = () => {
    const blob = new Blob([store.server.exportCampaign(id)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `frontline-${s.name.replace(/\W+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <Section title="Game speed">
        <div className="flex gap-1">
          {[0.5, 1, 2, 5, 10].map((v) => (
            <button key={v} onClick={() => store.exec('set_speed', { speed: v })} className={`flex-1 py-1.5 text-sm rounded border ${s.settings.speed === v ? 'border-[#a8b37a] bg-[#2f3528]' : 'border-[#3a4034]'}`}>{v}×</button>
          ))}
        </div>
        <p className="text-xs text-stone-500 mt-1">Campaign time keeps running while the game is closed, at this speed.</p>
      </Section>
      <Section title="Audio">
        <label className="flex items-center gap-2 text-sm mb-1">
          <input type="checkbox" checked={s.settings.audio.enabled} onChange={(e) => store.exec('update_settings', { audio: { ...s.settings.audio, enabled: e.target.checked } })} /> Alert sounds
        </label>
        <input type="range" min={0} max={1} step={0.05} value={s.settings.audio.volume} className="w-full accent-[#7a8f3a]" onChange={(e) => store.exec('update_settings', { audio: { ...s.settings.audio, volume: Number(e.target.value) } }, { persist: false })} />
      </Section>
      <Section title="Graphics">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.settings.visual.labels} onChange={(e) => store.exec('update_settings', { visual: { ...s.settings.visual, labels: e.target.checked } })} /> Map labels</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.settings.visual.effects} onChange={(e) => store.exec('update_settings', { visual: { ...s.settings.visual, effects: e.target.checked } })} /> Combat effects</label>
      </Section>
      <Section title="Campaign">
        <Row label="Name">{s.name}</Row>
        <Row label="Difficulty"><span className="capitalize">{s.difficulty}</span></Row>
        <Row label="Campaign time">{formatDuration(s.gameTime)}</Row>
        <Row label="World seed">{s.seed}</Row>
        <p className="text-xs text-stone-500 mt-1">Saved automatically after every action.</p>
      </Section>
      <Section title="Manual save slots">
        <div className="flex gap-2 mb-2">
          <input className="flex-1 min-w-0 bg-[#1b1e19] border border-[#3a4034] rounded text-sm px-2 py-1.5" placeholder="Slot label" value={label} maxLength={30} onChange={(e) => setLabel(e.target.value)} />
          <Btn onClick={() => { store.server.saveSnapshot(id, label); setLabel(''); force((x) => x + 1); store.toast('ok', 'Saved'); }}>Save</Btn>
        </div>
        {snaps.length === 0 && <p className="text-xs text-stone-500">No manual saves. Up to 5 slots.</p>}
        {snaps.map((sn) => (
          <Card key={sn.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm"><div>{sn.label}</div><div className="text-[11px] text-stone-500">{new Date(sn.savedAt).toLocaleString()} · T+{formatDuration(sn.gameTime)}</div></div>
              <div className="flex gap-1">
                <Btn kind="warn" onClick={() => { if (confirm('Restore this save? Current progress since then is lost.')) { store.server.restoreSnapshot(id, sn.id); store.open(id); store.toast('ok', 'Save restored'); } }}>Load</Btn>
                <Btn kind="ghost" onClick={() => { store.server.deleteSnapshot(id, sn.id); force((x) => x + 1); }}>✕</Btn>
              </div>
            </div>
          </Card>
        ))}
      </Section>
      <Section title="Files">
        <div className="flex flex-wrap gap-2">
          <Btn kind="ghost" onClick={exportFile}>Export campaign</Btn>
          <Btn kind="ghost" onClick={() => fileRef.current?.click()}>Import campaign</Btn>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try { const c = store.server.importCampaign(await file.text()); store.open(c.id); store.toast('ok', 'Campaign imported'); } catch (err) { store.toast('error', (err as Error).message); }
          }} />
          <Btn kind="ghost" onClick={() => store.close()}>Main menu</Btn>
        </div>
      </Section>
    </div>
  );
}
