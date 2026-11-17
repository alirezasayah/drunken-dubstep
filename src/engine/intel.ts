import { RES_KEYS } from './config';
import type { CampaignState, Notification, Resources } from './types';
import { canAfford, countVisible, newId, regionStrength } from './world';

/** Updates the player's intelligence picture. Undiscovered regions remain unknown; stale ones keep last-known values. */
export function refreshIntel(s: CampaignState) {
  const vis = countVisible(s, s.playerFactionId);
  for (const rec of s.intel) {
    if (!vis.has(rec.regionId)) continue;
    const region = s.regions.find((r) => r.id === rec.regionId)!;
    rec.discovered = true;
    rec.lastSeenAt = s.gameTime;
    rec.ownerId = region.ownerId;
    const str = regionStrength(s, region);
    // Own regions are exact; foreign estimates are rounded to hide precision.
    rec.estStrength = region.ownerId === s.playerFactionId ? Math.round(str) : Math.round(str / 25) * 25;
  }
}

export function notify(s: CampaignState, factionId: string, kind: Notification['kind'], title: string, body: string, ref?: Notification['ref']) {
  if (factionId !== s.playerFactionId) return;
  // De-duplicate identical alerts within 2 game minutes
  const dup = s.notifications.find((n) => n.title === title && n.body === body && s.gameTime - n.at < 120);
  if (dup) return;
  s.notifications.unshift({ id: newId(s, 'n'), at: s.gameTime, kind, title, body, ref, read: false });
  if (s.notifications.length > 150) s.notifications.length = 150;
}

export function ledger(s: CampaignState, factionId: string, delta: Partial<Resources>, type: string, ref: string | null) {
  for (const k of RES_KEYS) {
    const v = delta[k];
    if (!v) continue;
    s.ledger.unshift({ id: newId(s, 't'), at: s.gameTime, factionId, resource: k, amount: Math.round(v * 100) / 100, type, ref });
  }
  if (s.ledger.length > 500) s.ledger.length = 500;
}

/** Atomic spend: validates the full cost before deducting anything. */
export function spend(s: CampaignState, factionId: string, cost: Partial<Resources>, type: string, ref: string | null): boolean {
  const f = s.factions.find((x) => x.id === factionId)!;
  if (!canAfford(f.resources, cost)) return false;
  const delta: Partial<Resources> = {};
  for (const k of RES_KEYS) {
    const v = cost[k] ?? 0;
    if (v) {
      f.resources[k] -= v;
      delta[k] = -v;
    }
  }
  ledger(s, factionId, delta, type, ref);
  return true;
}

export function missingFor(r: Resources, cost: Partial<Resources>): string {
  return RES_KEYS.filter((k) => (cost[k] ?? 0) > r[k] + 1e-9)
    .map((k) => `${Math.ceil((cost[k] ?? 0) - r[k])} ${k}`)
    .join(', ');
}
