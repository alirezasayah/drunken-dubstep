import { useEffect, useRef, useState } from 'react';
import { RES_KEYS } from './engine/config';
import type { CampaignState, Difficulty } from './engine/types';
import { formatDuration } from './engine/simulation';
import { PhaserView } from './game/PhaserView';
import { store, useStore, type Screen } from './store';
import { BasesPanel } from './ui/BasesPanel';
import { BattleHUD } from './ui/BattleHUD';
import { Btn, fmt, rate, RES_COLOR, RES_ICON } from './ui/common';
import { economy, storageCapacity } from './ui/helpers';
import { MilitaryPanel } from './ui/MilitaryPanel';
import { EconomyPanel, ReportsPanel, ResearchPanel, SettingsPanel } from './ui/OtherPanels';
import { enterBattle, WorldPanel } from './ui/WorldPanel';
import { BUILDINGS } from './engine/config';

export default function App() {
  const { ui, state } = useStore();
  useEffect(() => {
    const last = localStorage.getItem('frontline:last');
    if (last && store.server.listCampaigns().some((c) => c.id === last)) store.open(last);
  }, []);
  return (
    <div className="fixed inset-0 bg-[#141712] text-stone-200 font-sans overflow-hidden">
      {ui.campaignId && state ? <GameShell s={state} /> : <CampaignMenu />}
      <Toasts />
    </div>
  );
}

function CampaignMenu() {
  const [name, setName] = useState('Operation Frontline');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [, force] = useState(0);
  const list = store.server.listCampaigns();
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-4 py-10">
        <h1 className="text-4xl font-black tracking-[0.3em] text-[#c8d39a]">FRONTLINE</h1>
        <p className="text-sm text-stone-400 mb-8">Persistent military strategy. Build bases, secure resources, expand your territory.</p>
        <section className="rounded-lg border border-[#3a4034] bg-[#1f231c] p-4 mb-6">
          <h2 className="text-[11px] tracking-[0.18em] uppercase text-[#a8b37a] mb-3">New campaign</h2>
          <input className="w-full bg-[#141712] border border-[#3a4034] rounded px-3 py-2 mb-3" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-1 mb-3">
            {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
              <button key={d} onClick={() => setDifficulty(d)} className={`flex-1 py-2 text-sm rounded border capitalize ${difficulty === d ? 'border-[#a8b37a] bg-[#2f3528]' : 'border-[#3a4034]'}`}>{d}</button>
            ))}
          </div>
          <p className="text-xs text-stone-500 mb-3">
            {difficulty === 'easy' ? 'AI factions never attack your territory.' : difficulty === 'normal' ? 'AI factions may contest your outer territories after 60 minutes of campaign time.' : 'AI factions grow faster and may attack after 25 minutes.'}
          </p>
          <Btn className="w-full py-2" onClick={() => { const s = store.server.createCampaign({ name, difficulty }); store.open(s.id); }}>Start campaign</Btn>
        </section>
        {list.length > 0 && (
          <section>
            <h2 className="text-[11px] tracking-[0.18em] uppercase text-[#a8b37a] mb-2">Continue</h2>
            {list.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded border border-[#3a4034] bg-[#1f231c] px-3 py-2 mb-2">
                <div className="min-w-0">
                  <div className="truncate">{c.name}</div>
                  <div className="text-xs text-stone-500 capitalize">{c.difficulty} · T+{formatDuration(c.gameTime)} · {c.status} · last played {new Date(c.updatedAt).toLocaleString()}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Btn onClick={() => store.open(c.id)}>Open</Btn>
                  <Btn kind="ghost" onClick={() => { if (confirm(`Delete campaign "${c.name}"?`)) { store.server.deleteCampaign(c.id); force((x) => x + 1); } }}>✕</Btn>
                </div>
              </div>
            ))}
          </section>
        )}
        <p className="text-[11px] text-stone-600 mt-8">Campaigns are stored on this device. The world keeps progressing while the game is closed.</p>
      </div>
    </div>
  );
}

const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: 'world', label: 'World', icon: '◎' },
  { key: 'bases', label: 'Bases', icon: '▣' },
  { key: 'military', label: 'Military', icon: '⚔' },
  { key: 'research', label: 'Research', icon: '⚗' },
  { key: 'reports', label: 'Reports', icon: '☰' },
];

function GameShell({ s }: { s: CampaignState }) {
  const ui = store.ui;
  useSounds(s);
  const unread = s.notifications.filter((n) => !n.read).length;
  const pendingBattle = s.battles.find((b) => b.status !== 'resolved' && (b.attackerFactionId === s.playerFactionId || b.defenderFactionId === s.playerFactionId));
  const openScreen = (k: Screen) => {
    const same = ui.screen === k && ui.panelOpen;
    store.set({ screen: k, panelOpen: !same, selection: k === ui.screen ? ui.selection : k === 'world' ? ui.selection : null, placement: null, targeting: null, basePlacement: null });
    if (k === 'reports') store.exec('mark_read', {}, { silent: true });
  };
  return (
    <div className="absolute inset-0">
      <PhaserView />
      {ui.battleId ? (
        <BattleHUD s={s} />
      ) : (
        <>
          <TopBar s={s} />
          {s.status !== 'active' && (
            <div className={`absolute top-14 left-1/2 -translate-x-1/2 z-20 rounded px-4 py-2 text-sm font-semibold ${s.status === 'victory' ? 'bg-[#3d4630] text-[#d7e3a8]' : 'bg-[#5a2420] text-[#f6dcd6]'}`}>
              {s.status === 'victory' ? 'VICTORY — all rival factions defeated' : 'DEFEAT — your command has fallen'}
            </div>
          )}
          <ModeBar s={s} />
          {!ui.panelOpen && <Briefing s={s} />}
          {pendingBattle && !ui.panelOpen && !ui.placement && !ui.targeting && (
            <button onClick={() => enterBattle(pendingBattle.id)} className="absolute left-1/2 -translate-x-1/2 bottom-20 z-20 rounded-full px-4 py-2 bg-[#80372f] border border-[#e0533f] text-sm font-semibold animate-pulse">
              ⚔ Battle at {s.regions.find((r) => r.id === pendingBattle.regionId)?.name} — take command
            </button>
          )}
          {ui.panelOpen && (
            <aside className="absolute z-20 bg-[#1b1e19]/96 border-[#3a4034] overflow-y-auto overscroll-contain
              left-0 right-0 bottom-14 max-h-[58vh] border-t rounded-t-xl
              md:left-auto md:right-0 md:top-12 md:bottom-14 md:w-[400px] md:max-h-none md:border-l md:border-t-0 md:rounded-none">
              <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-[#1b1e19] border-b border-[#2a2e26]">
                <span className="text-xs tracking-[0.2em] uppercase text-[#c8d39a]">{ui.screen}</span>
                <button className="text-stone-400 text-lg leading-none px-2" onClick={() => store.set({ panelOpen: false })}>✕</button>
              </div>
              <div className="p-4">
                {ui.screen === 'world' && <WorldPanel s={s} />}
                {ui.screen === 'bases' && <BasesPanel s={s} />}
                {ui.screen === 'military' && <MilitaryPanel s={s} />}
                {ui.screen === 'research' && <ResearchPanel s={s} />}
                {ui.screen === 'reports' && <ReportsPanel s={s} />}
                {ui.screen === 'economy' && <EconomyPanel s={s} />}
                {ui.screen === 'settings' && <SettingsPanel s={s} />}
              </div>
            </aside>
          )}
          <nav className="absolute bottom-0 inset-x-0 z-30 h-14 flex bg-[#1b1e19] border-t border-[#3a4034]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {NAV.map((n) => (
              <button key={n.key} onClick={() => openScreen(n.key)} className={`relative flex-1 flex flex-col items-center justify-center text-[11px] ${ui.screen === n.key && ui.panelOpen ? 'text-[#d7e3a8] bg-[#252a20]' : 'text-stone-400'}`}>
                <span className="text-lg leading-none">{n.icon}</span>
                {n.label}
                {n.key === 'reports' && unread > 0 && <span className="absolute top-1 right-[calc(50%-22px)] min-w-4 h-4 px-1 rounded-full bg-[#a3483f] text-[10px] text-white grid place-items-center">{unread > 99 ? '99+' : unread}</span>}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

function TopBar({ s }: { s: CampaignState }) {
  const f = s.factions.find((x) => x.isPlayer)!;
  const eco = economy(s, f.id);
  const cap = storageCapacity(s, f.id);
  return (
    <header className="absolute top-0 inset-x-0 z-30 h-12 flex items-center gap-1 px-2 bg-[#1b1e19]/95 border-b border-[#3a4034]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <button className="hidden sm:block font-black tracking-[0.25em] text-[#c8d39a] text-sm px-2" onClick={() => store.set({ screen: 'settings', panelOpen: true })}>FRONTLINE</button>
      <div className="flex-1 flex items-center gap-x-3 overflow-x-auto no-scrollbar" onClick={() => store.set({ screen: 'economy', panelOpen: true, selection: null })}>
        {RES_KEYS.map((k) => {
          const full = k !== 'money' && f.resources[k] >= cap - 1;
          const low = (k === 'money' && f.deficit) || (k === 'energy' && f.lowEnergy);
          return (
            <div key={k} className="flex flex-col leading-tight shrink-0 cursor-pointer" title={k}>
              <span className={`text-sm font-semibold ${low ? 'text-[#e0533f]' : full ? 'text-[#e6c94f]' : RES_COLOR[k]}`}>{RES_ICON[k]} {fmt(f.resources[k])}</span>
              <span className={`text-[10px] ${eco.net[k] >= 0 ? 'text-stone-500' : 'text-[#e08a7f]'}`}>{rate(eco.net[k])}</span>
            </div>
          );
        })}
      </div>
      <span className="hidden md:inline text-[11px] text-stone-500 px-2">T+{formatDuration(s.gameTime)} · {s.settings.speed}×</span>
      <button className="text-stone-300 px-2 text-lg" title="Settings" onClick={() => store.set({ screen: 'settings', panelOpen: !(store.ui.panelOpen && store.ui.screen === 'settings') })}>⚙</button>
    </header>
  );
}

function ModeBar({ s }: { s: CampaignState }) {
  const ui = store.ui;
  if (!ui.placement && !ui.targeting && !ui.basePlacement) return null;
  let text = '';
  let confirm: (() => void) | null = null;
  if (ui.placement) {
    const p = ui.placement;
    text = `Placing ${BUILDINGS[p.type].name}: tap inside the highlighted base radius. Green = valid.`;
    if (p.ghost) confirm = () => { if (store.exec('place_building', { baseId: p.baseId, type: p.type, x: p.ghost!.x, y: p.ghost!.y, rotation: p.rotation }, { okText: `${BUILDINGS[p.type].name} construction started` })) store.set({ placement: null }); };
  } else if (ui.basePlacement) {
    text = 'Placing forward base: tap inside your territory, at least 320u from other bases.';
    if (ui.basePlacement.ghost) confirm = () => { const r = store.exec('establish_base', ui.basePlacement!.ghost); if (r) store.set({ basePlacement: null, selection: { kind: 'base', id: r.baseId }, screen: 'bases', panelOpen: true }); };
  } else if (ui.targeting) {
    const a = s.armies.find((x) => x.id === ui.targeting!.armyId);
    text = `${a?.name}: tap a region to ${ui.targeting.type === 'capture' ? 'capture' : 'reposition to'}.`;
  }
  return (
    <div className="absolute top-14 inset-x-2 md:left-1/2 md:-translate-x-1/2 md:w-[560px] z-20 rounded border border-[#b0903a] bg-[#2b2617]/95 px-3 py-2 flex flex-wrap items-center gap-2">
      <span className="text-sm flex-1 min-w-[200px]">{text}</span>
      {ui.placement && <Btn kind="ghost" onClick={() => store.set({ placement: { ...ui.placement!, rotation: ui.placement!.rotation === 0 ? 90 : 0 } })}>Rotate</Btn>}
      {confirm && <Btn onClick={confirm}>Confirm</Btn>}
      <Btn kind="ghost" onClick={() => store.set({ placement: null, targeting: null, basePlacement: null })}>Cancel</Btn>
    </div>
  );
}

function Briefing({ s }: { s: CampaignState }) {
  const [open, setOpen] = useState(true);
  const me = s.playerFactionId;
  const startRegion = s.bases.find((b) => b.id === s.factions.find((f) => f.isPlayer)?.hqBaseId)?.regionId;
  const steps = [
    { t: 'Place a new building (Bases → Main HQ → Construct)', done: s.buildings.some((b) => b.createdAt > 0 && s.bases.find((x) => x.id === b.baseId)?.factionId === me) },
    { t: 'Recruit infantry at the Barracks', done: s.ledger.some((l) => l.factionId === me && l.type === 'recruitment') },
    { t: 'Form an army (Military → Armies)', done: s.armies.some((a) => a.factionId === me) || s.regions.filter((r) => r.ownerId === me).length > 1 },
    { t: 'Capture the neutral oil field next to your HQ', done: s.regions.some((r) => r.ownerId === me && r.id !== startRegion && s.sites.some((x) => x.regionId === r.id && x.type === 'oil')) },
    { t: 'Establish a forward base in captured territory', done: s.bases.some((b) => b.factionId === me && b.type === 'forward') },
    { t: 'Win a battle against an AI faction', done: s.battles.some((b) => b.status === 'resolved' && ((b.attackerFactionId === me && b.result === 'attacker') || (b.defenderFactionId === me && b.result === 'defender'))) },
    { t: 'Research a technology', done: Object.values(s.research[me]).some((r) => r.level > 0) },
  ];
  const left = steps.filter((x) => !x.done);
  if (!left.length) return null;
  return (
    <div className="absolute left-2 top-14 z-10 max-w-[280px] rounded border border-[#3a4034] bg-[#1b1e19]/90 px-3 py-2">
      <button className="w-full flex justify-between text-[11px] tracking-[0.18em] uppercase text-[#a8b37a]" onClick={() => setOpen(!open)}>
        <span>Briefing {steps.length - left.length}/{steps.length}</span><span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="mt-1 text-xs space-y-0.5">
          {steps.map((x, i) => (
            <li key={i} className={x.done ? 'text-stone-500 line-through' : x === left[0] ? 'text-stone-100' : 'text-stone-400'}>{x.done ? '✓' : '○'} {x.t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toasts() {
  const { ui } = useStore();
  return (
    <div className="absolute z-50 top-16 right-2 left-2 md:left-auto md:w-96 flex flex-col gap-1.5 pointer-events-none">
      {ui.toasts.map((t) => (
        <div key={t.id} className={`rounded px-3 py-2 text-sm border shadow-lg ${t.kind === 'error' ? 'bg-[#3a201c] border-[#a3483f]' : t.kind === 'ok' ? 'bg-[#263020] border-[#7a8f3a]' : 'bg-[#23271f] border-[#40463a]'}`}>{t.text}</div>
      ))}
    </div>
  );
}

function useSounds(s: CampaignState) {
  const seen = useRef<string | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    const latest = s.notifications[0];
    if (!latest || latest.id === seen.current) return;
    const first = seen.current === null;
    seen.current = latest.id;
    if (first || !s.settings.audio.enabled || latest.kind === 'info') return;
    try {
      ctx.current ??= new AudioContext();
      const ac = ctx.current;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square';
      o.frequency.value = latest.kind === 'battle' || latest.kind === 'danger' ? 220 : latest.kind === 'warning' ? 330 : 520;
      g.gain.setValueAtTime(0.04 * s.settings.audio.volume, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25);
      o.connect(g).connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 0.25);
    } catch { /* audio unavailable */ }
  });
}
