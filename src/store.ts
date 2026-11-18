// Client-side store: holds UI state and talks to the authoritative GameServer through explicit operations.
import { useSyncExternalStore } from 'react';
import { BrowserStorage, GameServer, type OpName } from './engine/server';
import type { BuildingType, CampaignState, Formation } from './engine/types';

export type Screen = 'world' | 'bases' | 'military' | 'research' | 'reports' | 'economy' | 'settings';
export type Selection = null | { kind: 'region' | 'base' | 'building' | 'site' | 'army'; id: string };

export interface UiState {
  campaignId: string | null;
  screen: Screen;
  panelOpen: boolean;
  selection: Selection;
  placement: null | { baseId: string; type: BuildingType; rotation: 0 | 90; ghost: { x: number; y: number } | null };
  basePlacement: null | { ghost: { x: number; y: number } | null };
  targeting: null | { armyId: string; type: 'capture' | 'move' };
  battleId: string | null;
  battle: { paused: boolean; speed: number; selected: string[]; followMode: boolean; formation: Formation };
  toasts: { id: number; kind: 'error' | 'ok' | 'info'; text: string }[];
  focus: { x: number; y: number; zoom?: number } | null;
}

const server = new GameServer(new BrowserStorage());
let ui: UiState = {
  campaignId: null, screen: 'world', panelOpen: false, selection: null, placement: null, basePlacement: null, targeting: null, battleId: null,
  battle: { paused: true, speed: 1, selected: [], followMode: false, formation: 'line' }, toasts: [], focus: null,
};
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const l of listeners) l();
};

export const store = {
  server,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get ui() {
    return ui;
  },
  get state(): CampaignState | null {
    if (!ui.campaignId) return null;
    try { return server.peek(ui.campaignId); } catch { return null; }
  },
  version: () => version,
  set(patch: Partial<UiState>) {
    ui = { ...ui, ...patch };
    emit();
  },
  setBattle(patch: Partial<UiState['battle']>) {
    ui = { ...ui, battle: { ...ui.battle, ...patch } };
    emit();
  },
  toast(kind: 'error' | 'ok' | 'info', text: string) {
    const id = Date.now() + Math.random();
    ui = { ...ui, toasts: [...ui.toasts.slice(-3), { id, kind, text }] };
    emit();
    setTimeout(() => {
      ui = { ...ui, toasts: ui.toasts.filter((t) => t.id !== id) };
      emit();
    }, kind === 'error' ? 4500 : 2800);
  },
  /** Send an operation to the server. Returns true on success; errors surface as toasts. */
  exec(op: OpName, args: any = {}, opts: { persist?: boolean; silent?: boolean; okText?: string } = {}): any {
    if (!ui.campaignId) return false;
    const requestId = opts.persist === false ? undefined : `${op}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = server.exec(ui.campaignId, op, args, { requestId, persist: opts.persist });
    if (!res.ok && !opts.silent) store.toast('error', res.error);
    if (res.ok && opts.okText) store.toast('ok', opts.okText);
    emit();
    return res.ok ? res.data ?? true : false;
  },
  open(campaignId: string) {
    try {
      server.loadCampaign(campaignId);
      ui = { ...ui, campaignId, screen: 'world', panelOpen: false, selection: null, placement: null, targeting: null, battleId: null, focus: null };
      try { localStorage.setItem('frontline:last', campaignId); } catch { /* ignore */ }
      emit();
    } catch (e) {
      store.toast('error', (e as Error).message);
    }
  },
  close() {
    if (ui.campaignId) server.flush(ui.campaignId);
    ui = { ...ui, campaignId: null, battleId: null, placement: null, targeting: null, selection: null };
    emit();
  },
  flush() {
    if (ui.campaignId) {
      try { server.flush(ui.campaignId); } catch { /* conflict reload happens on next read */ }
    }
  },
};

// Persistent world heartbeat: advance authoritative time once per second, persist every 5 seconds.
let beat = 0;
setInterval(() => {
  if (!ui.campaignId) return;
  beat++;
  const persist = beat % 5 === 0;
  server.exec(ui.campaignId, 'advance_world', {}, { persist });
  emit();
}, 1000);
window.addEventListener('beforeunload', () => store.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flush();
});

export function useStore() {
  useSyncExternalStore(store.subscribe, store.version);
  return { ui: store.ui, state: store.state };
}
