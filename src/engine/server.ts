// Authoritative game server. The client only sends explicit operations; every operation
// reloads the campaign, advances world time from stored timestamps, validates, mutates and saves.
// Storage is pluggable: localStorage in the browser, an in-memory map in tests, a Supabase table later.
import { SCHEMA_VERSION } from './config';
import * as ops from './operations';
import { advanceWorld } from './simulation';
import type { CampaignState, Difficulty, OpResult } from './types';
import { createCampaign } from './worldgen';

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorage implements StorageAdapter {
  map = new Map<string, string>();
  get(k: string) { return this.map.get(k) ?? null; }
  set(k: string, v: string) { this.map.set(k, v); }
  remove(k: string) { this.map.delete(k); }
}

export class BrowserStorage implements StorageAdapter {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
  set(k: string, v: string) { localStorage.setItem(k, v); }
  remove(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
}

export interface CampaignMeta {
  id: string;
  name: string;
  difficulty: Difficulty;
  createdAt: number;
  updatedAt: number;
  gameTime: number;
  status: string;
}

export interface SnapshotMeta {
  id: string;
  label: string;
  savedAt: number;
  gameTime: number;
}

const K = {
  index: 'frontline:index',
  campaign: (id: string) => `frontline:c:${id}`,
  version: (id: string) => `frontline:c:${id}:v`,
  snaps: (id: string) => `frontline:snaps:${id}`,
  snap: (id: string, sid: string) => `frontline:snap:${id}:${sid}`,
};

export type OpName =
  | 'advance_world' | 'place_building' | 'upgrade_building' | 'upgrade_site' | 'start_recruitment' | 'start_training' | 'change_doctrine'
  | 'start_research' | 'create_army' | 'launch_mission' | 'disband_army' | 'establish_base' | 'capture_territory' | 'start_battle'
  | 'submit_battle_command' | 'advance_battle' | 'save_battle_state' | 'set_speed' | 'update_settings' | 'mark_read' | 'rename_campaign';

/** Upgrades older saves in place. */
export function migrate(raw: any): CampaignState {
  const s = raw as CampaignState & { schemaVersion?: number };
  if (!s.schemaVersion || s.schemaVersion < 2) {
    // v1 saves had no macro areas, no request ledger and no visual settings
    const areas = ['Northern Reach', 'Eastern Steppe', 'Southern Basin', 'Western March'];
    for (const r of s.regions as any[]) if (!r.area) r.area = areas[(r.index >= 8 ? 2 : 0) + (r.index % 4 >= 2 ? 1 : 0)];
    s.processedRequests ??= [];
    s.settings ??= { speed: 1, audio: { enabled: true, volume: 0.6 }, visual: { labels: true, effects: true } };
    s.settings.visual ??= { labels: true, effects: true };
    s.schemaVersion = 2;
  }
  if (s.schemaVersion > SCHEMA_VERSION) throw new Error('Save was created by a newer version of FRONTLINE.');
  return s;
}

export class GameServer {
  private cache = new Map<string, { version: number; state: CampaignState; dirty: boolean }>();
  constructor(private storage: StorageAdapter, private clock: () => number = () => Date.now()) {}

  now() { return this.clock(); }

  listCampaigns(): CampaignMeta[] {
    try { return JSON.parse(this.storage.get(K.index) ?? '[]'); } catch { return []; }
  }

  private writeIndex(s: CampaignState) {
    const list = this.listCampaigns().filter((c) => c.id !== s.id);
    list.unshift({ id: s.id, name: s.name, difficulty: s.difficulty, createdAt: s.createdAt, updatedAt: this.clock(), gameTime: s.gameTime, status: s.status });
    this.storage.set(K.index, JSON.stringify(list));
  }

  createCampaign(a: { name: string; difficulty: Difficulty; seed?: number }): CampaignState {
    const name = a.name.trim().slice(0, 40) || 'Campaign';
    const s = createCampaign({ name, difficulty: a.difficulty, seed: a.seed, now: this.clock() });
    this.persist(s, 0);
    return s;
  }

  deleteCampaign(id: string) {
    for (const snap of this.listSnapshots(id)) this.storage.remove(K.snap(id, snap.id));
    this.storage.remove(K.snaps(id));
    this.storage.remove(K.campaign(id));
    this.storage.remove(K.version(id));
    this.storage.set(K.index, JSON.stringify(this.listCampaigns().filter((c) => c.id !== id)));
    this.cache.delete(id);
  }

  private read(id: string): CampaignState {
    const stored = Number(this.storage.get(K.version(id)) ?? '0');
    const c = this.cache.get(id);
    if (c && (c.version === stored || c.dirty)) return c.state;
    const raw = this.storage.get(K.campaign(id));
    if (!raw) throw new Error('Campaign not found.');
    const state = migrate(JSON.parse(raw));
    this.cache.set(id, { version: stored, state, dirty: false });
    return state;
  }

  private persist(s: CampaignState, prevVersion?: number) {
    const stored = Number(this.storage.get(K.version(s.id)) ?? '0');
    const expected = prevVersion ?? this.cache.get(s.id)?.version ?? stored;
    if (stored !== expected) {
      // Another tab wrote in between: drop our copy, caller must retry.
      this.cache.delete(s.id);
      throw new Error('Campaign was modified elsewhere. Reloaded the latest state.');
    }
    const v = stored + 1;
    this.storage.set(K.campaign(s.id), JSON.stringify(s));
    this.storage.set(K.version(s.id), String(v));
    this.cache.set(s.id, { version: v, state: s, dirty: false });
    this.writeIndex(s);
  }

  /** load_campaign: restores and advances the persistent world to now. */
  loadCampaign(id: string): CampaignState {
    const s = this.read(id);
    advanceWorld(s, this.clock());
    this.persist(s);
    return s;
  }

  /** Read without saving (UI polling between operations). */
  peek(id: string): CampaignState {
    return this.read(id);
  }

  flush(id: string) {
    const c = this.cache.get(id);
    if (c?.dirty) {
      c.dirty = false;
      this.persist(c.state, c.version);
    }
  }

  exec(id: string, op: OpName, args: any = {}, opts: { requestId?: string; persist?: boolean } = {}): OpResult<any> {
    let s: CampaignState;
    try { s = this.read(id); } catch (e) { return { ok: false, error: (e as Error).message }; }
    if (opts.requestId) {
      if (s.processedRequests.includes(opts.requestId)) return { ok: true, data: { duplicate: true } };
    }
    advanceWorld(s, this.clock());
    const fid = s.playerFactionId;
    let res: OpResult<any>;
    if (s.status !== 'active' && !['advance_world', 'save_battle_state', 'set_speed', 'update_settings', 'mark_read', 'rename_campaign'].includes(op)) {
      res = { ok: false, error: `Campaign has ended (${s.status}).` };
    } else {
      try {
        res = this.dispatch(s, fid, op, args);
      } catch (e) {
        res = { ok: false, error: `Server error: ${(e as Error).message}` };
      }
    }
    if (opts.requestId && res.ok) {
      s.processedRequests.push(opts.requestId);
      if (s.processedRequests.length > 200) s.processedRequests.splice(0, s.processedRequests.length - 200);
    }
    const persistNow = opts.persist !== false;
    try {
      if (persistNow) this.persist(s);
      else {
        const c = this.cache.get(id)!;
        c.dirty = true;
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return res;
  }

  private dispatch(s: CampaignState, fid: string, op: OpName, a: any): OpResult<any> {
    switch (op) {
      case 'advance_world':
      case 'capture_territory': // occupation completes through scheduled timers inside advance_world
      case 'save_battle_state':
        return { ok: true };
      case 'place_building': return ops.placeBuilding(s, fid, a);
      case 'upgrade_building': return ops.upgradeBuilding(s, fid, a);
      case 'upgrade_site': return ops.upgradeSite(s, fid, a);
      case 'start_recruitment': return ops.startRecruitment(s, fid, a);
      case 'start_training': return ops.startTraining(s, fid, a);
      case 'change_doctrine': return ops.changeDoctrine(s, fid, a);
      case 'start_research': return ops.startResearch(s, fid, a);
      case 'create_army': return ops.createArmy(s, fid, a);
      case 'launch_mission': return ops.launchMission(s, fid, a);
      case 'disband_army': return ops.disbandArmy(s, fid, a);
      case 'establish_base': return ops.establishBase(s, fid, a);
      case 'start_battle': return ops.startBattle(s, fid, a);
      case 'submit_battle_command': return ops.submitBattleCommand(s, fid, a);
      case 'advance_battle': return ops.advanceBattle(s, fid, a);
      case 'set_speed': return ops.setSpeed(s, Number(a.speed));
      case 'update_settings':
        if (a.audio) s.settings.audio = { enabled: !!a.audio.enabled, volume: Math.min(1, Math.max(0, Number(a.audio.volume) || 0)) };
        if (a.visual) s.settings.visual = { labels: !!a.visual.labels, effects: !!a.visual.effects };
        return { ok: true };
      case 'mark_read':
        for (const n of s.notifications) n.read = true;
        return { ok: true };
      case 'rename_campaign':
        s.name = String(a.name ?? '').trim().slice(0, 40) || s.name;
        return { ok: true };
      default:
        return { ok: false, error: `Unknown operation ${op}` };
    }
  }

  // ---------- Manual save slots ----------
  listSnapshots(id: string): SnapshotMeta[] {
    try { return JSON.parse(this.storage.get(K.snaps(id)) ?? '[]'); } catch { return []; }
  }

  saveSnapshot(id: string, label: string): SnapshotMeta {
    this.flush(id);
    const s = this.read(id);
    const meta: SnapshotMeta = { id: `sv_${this.clock().toString(36)}`, label: label.trim().slice(0, 30) || 'Manual save', savedAt: this.clock(), gameTime: s.gameTime };
    this.storage.set(K.snap(id, meta.id), JSON.stringify(s));
    const list = [meta, ...this.listSnapshots(id)].slice(0, 5);
    for (const old of this.listSnapshots(id).filter((x) => !list.some((l) => l.id === x.id))) this.storage.remove(K.snap(id, old.id));
    this.storage.set(K.snaps(id), JSON.stringify(list));
    return meta;
  }

  restoreSnapshot(id: string, snapId: string): CampaignState {
    const raw = this.storage.get(K.snap(id, snapId));
    if (!raw) throw new Error('Save slot not found.');
    const s = migrate(JSON.parse(raw));
    s.lastSimulatedAt = this.clock(); // a restore rolls the campaign back; time resumes from now
    this.cache.delete(id);
    const stored = Number(this.storage.get(K.version(id)) ?? '0');
    this.persist(s, stored);
    return s;
  }

  deleteSnapshot(id: string, snapId: string) {
    this.storage.remove(K.snap(id, snapId));
    this.storage.set(K.snaps(id), JSON.stringify(this.listSnapshots(id).filter((x) => x.id !== snapId)));
  }

  exportCampaign(id: string): string {
    this.flush(id);
    return JSON.stringify(this.read(id));
  }

  importCampaign(json: string): CampaignState {
    const s = migrate(JSON.parse(json));
    if (!s.id || !s.regions || !s.factions) throw new Error('Not a FRONTLINE campaign file.');
    s.id = `${s.id}_i${this.clock().toString(36)}`;
    this.persist(s, Number(this.storage.get(K.version(s.id)) ?? '0'));
    return s;
  }
}
