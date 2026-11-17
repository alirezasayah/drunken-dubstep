import { alive } from '../engine/battle';
import { playerSide } from '../engine/operations';
import type { CampaignState, Formation } from '../engine/types';
import { UNITS } from '../engine/config';
import { store } from '../store';
import { Btn } from './common';

export function BattleHUD({ s }: { s: CampaignState }) {
  const ui = store.ui;
  const b = s.battles.find((x) => x.id === ui.battleId);
  if (!b) return null;
  const side = playerSide(s, b.id) ?? 'A';
  const sim = b.sim;
  const region = s.regions.find((r) => r.id === b.regionId);
  const own = sim.squads.filter((q) => q.side === side);
  const enemy = sim.squads.filter((q) => q.side !== side);
  const sel = ui.battle.selected.filter((id) => own.some((q) => q.id === id && alive(q)));
  const cmd = (command: string, extra: any = {}) => {
    if (!sel.length) return store.toast('info', 'Select units first (tap or drag-box).');
    store.exec('submit_battle_command', { battleId: b.id, command, squadIds: sel, ...extra });
  };
  const secs = Math.floor(sim.tick / 10), limit = Math.floor(sim.timeLimit / 10);
  const strength = (arr: typeof own) => arr.filter((q) => alive(q)).reduce((a, q) => a + q.qty, 0);
  const objPct = Math.round(((side === 'A' ? sim.objective.progress : -sim.objective.progress) + 1) * 50);
  const leave = () => {
    store.setBattle({ paused: true, selected: [] });
    store.exec('save_battle_state', { battleId: b.id }, { silent: true });
    store.set({ battleId: null });
  };
  const won = b.result && (b.result === 'attacker') === (side === 'A');
  return (
    <>
      <div className="absolute top-0 inset-x-0 z-20 flex flex-wrap items-center gap-2 px-3 py-2 bg-[#1b1e19]/90 border-b border-[#3a4034]" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <div className="mr-auto min-w-0">
          <div className="text-sm font-semibold truncate">Battle of {region?.name} · {side === 'A' ? 'Attacking' : 'Defending'}</div>
          <div className="text-[11px] text-stone-400">
            {String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')} / {Math.floor(limit / 60)}:00 · Command point {objPct}% yours · Forces {strength(own)} vs {strength(enemy)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Btn kind={ui.battle.paused ? 'warn' : 'ghost'} onClick={() => store.setBattle({ paused: !ui.battle.paused })}>{ui.battle.paused ? '▶ Resume' : '❚❚ Pause'}</Btn>
          {[0.5, 1, 2, 4].map((v) => (
            <button key={v} onClick={() => store.setBattle({ speed: v })} className={`px-2 py-1.5 text-xs rounded border ${ui.battle.speed === v ? 'border-[#a8b37a] bg-[#2f3528]' : 'border-[#3a4034]'}`}>{v}×</button>
          ))}
          <Btn kind="ghost" onClick={leave} title="Leave the battle paused; it resumes when you return">Map</Btn>
        </div>
      </div>

      {b.status === 'active' && (
        <div className="absolute bottom-0 inset-x-0 z-20 bg-[#1b1e19]/92 border-t border-[#3a4034] px-2 py-2" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          <div className="flex flex-wrap gap-1.5 justify-center">
            <Btn kind="ghost" onClick={() => store.setBattle({ selected: own.filter(alive).filter((q) => q.state !== 'retreating').map((q) => q.id) })}>All</Btn>
            <Btn kind="ghost" onClick={() => cmd('hold')}>Hold</Btn>
            <Btn kind="ghost" onClick={() => cmd('defend')}>{side === 'A' ? 'Take objective' : 'Defend objective'}</Btn>
            <Btn kind="ghost" onClick={() => cmd('regroup')}>Regroup</Btn>
            <Btn kind={ui.battle.followMode ? 'warn' : 'ghost'} onClick={() => sel.length ? store.setBattle({ followMode: !ui.battle.followMode }) : cmd('follow')}>Follow…</Btn>
            <select
              className="bg-[#2a2e26] border border-[#40463a] rounded text-sm px-2"
              value={ui.battle.formation}
              onChange={(e) => { store.setBattle({ formation: e.target.value as Formation }); cmd('formation', { formation: e.target.value }); }}
            >
              <option value="line">Line (+atk)</option>
              <option value="column">Column (+speed)</option>
              <option value="wedge">Wedge (+def)</option>
            </select>
            <Btn kind="danger" onClick={() => cmd('retreat')}>Retreat</Btn>
            <Btn kind="danger" onClick={() => cmd('return')}>Return to base</Btn>
          </div>
          <div className="text-[11px] text-stone-400 text-center mt-1 truncate">
            {ui.battle.followMode ? 'Tap a friendly unit to follow.' : sel.length
              ? `${sel.length} selected: ${sel.map((id) => { const q = own.find((x) => x.id === id)!; return `${UNITS[q.type].name} ${q.qty} (${q.state})`; }).join(', ')} — tap ground to move`
              : 'Tap a unit or drag a box to select. Tap ground to move. Shift-click adds.'}
            {ui.battle.paused && ' · PAUSED — plan your orders, then resume.'}
          </div>
        </div>
      )}

      <div className="absolute right-2 top-20 z-10 w-64 max-w-[45vw] hidden md:block pointer-events-none">
        {sim.log.slice(-6).map((l, i) => (
          <div key={i} className="text-[11px] text-stone-300 bg-[#1b1e19]/70 px-2 py-0.5 mb-0.5 rounded">[{Math.floor(l.tick / 10)}s] {l.text}</div>
        ))}
      </div>

      {b.status === 'resolved' && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-[#3a4034] bg-[#1f231c] p-5 text-center">
            <div className={`text-2xl font-bold mb-1 ${won ? 'text-[#a8cf6a]' : 'text-[#e0533f]'}`}>{won ? 'VICTORY' : 'DEFEAT'}</div>
            <div className="text-sm text-stone-300 mb-3">Battle of {region?.name} · {secs}s</div>
            <div className="text-sm text-stone-400 mb-1">Your losses: {own.reduce((a, q) => a + q.startQty - (q.state === 'destroyed' ? 0 : q.qty), 0)}</div>
            <div className="text-sm text-stone-400 mb-4">Enemy losses: {enemy.reduce((a, q) => a + q.startQty - (q.state === 'destroyed' ? 0 : q.qty), 0)}</div>
            <p className="text-xs text-stone-500 mb-4">{won ? (side === 'A' ? 'Your army is occupying the region. Control transfers when occupation completes.' : 'The attack was repelled.') : side === 'A' ? 'Survivors are returning to base for recovery.' : 'The region will be occupied by the enemy.'}</p>
            <Btn className="w-full" onClick={() => store.set({ battleId: null })}>Return to world map</Btn>
          </div>
        </div>
      )}
    </>
  );
}
