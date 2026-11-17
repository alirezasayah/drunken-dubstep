import Phaser from 'phaser';
import { BUILDINGS, TERRAIN, TERRAIN_CODES } from '../engine/config';
import type { CampaignState } from '../engine/types';
import {
  armyPositionAt, armyStrength, countVisible, dist, regionAt, regionIndexAt, supplyRadius, validateBaseSite, validatePlacement,
} from '../engine/world';
import { store } from '../store';
import { COLORS, drawBuilding, drawSite } from './draw';

const PX = 2; // world units per texture pixel

export class WorldScene extends Phaser.Scene {
  private gStatic!: Phaser.GameObjects.Graphics;
  private gDyn!: Phaser.GameObjects.Graphics;
  private overlay!: HTMLCanvasElement;
  private overlayKey = '';
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private dirty = true;
  private sig = '';
  private down: { x: number; y: number; moved: boolean; t: number } | null = null;
  private pinch: number | null = null;
  private campaignId = '';
  private hover: { x: number; y: number } | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    super('world');
  }

  create() {
    const s = store.state;
    if (!s) return;
    this.campaignId = s.id;
    this.labels.clear();
    this.sig = '';
    this.buildTerrain(s);
    this.overlay = document.createElement('canvas');
    this.overlay.width = s.world.width / PX;
    this.overlay.height = s.world.height / PX;
    this.overlayKey = `overlay-${s.id}`;
    if (this.textures.exists(this.overlayKey)) this.textures.remove(this.overlayKey);
    this.textures.addCanvas(this.overlayKey, this.overlay);
    this.add.image(0, 0, this.overlayKey).setOrigin(0).setScale(PX).setDepth(1);
    this.gStatic = this.add.graphics().setDepth(2);
    this.gDyn = this.add.graphics().setDepth(5);

    const cam = this.cameras.main;
    cam.setBounds(-400, -400, s.world.width + 800, s.world.height + 800);
    cam.setBackgroundColor('#20241d');
    const hq = s.bases.find((b) => b.id === s.factions.find((f) => f.isPlayer)?.hqBaseId) ?? s.bases[0];
    cam.setZoom(Math.max(0.35, Math.min(1, Math.min(this.scale.width, this.scale.height) / 900)));
    cam.centerOn(hq.x + 200, hq.y + 200);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.input.manager.pointersTotal && this.pointersDown().length >= 2) {
        const [a, b] = this.pointersDown();
        this.pinch = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        this.down = null;
        return;
      }
      this.down = { x: p.x, y: p.y, moved: false, t: Date.now() };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const downs = this.pointersDown();
      if (downs.length >= 2 && this.pinch) {
        const [a, b] = downs;
        const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, cam.zoom * (d / this.pinch));
        this.pinch = d;
        return;
      }
      if (p.isDown && this.down) {
        if (Math.hypot(p.x - this.down.x, p.y - this.down.y) > 7) this.down.moved = true;
        if (this.down.moved) {
          cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
          cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
        }
      } else if (!p.wasTouch) {
        const w = cam.getWorldPoint(p.x, p.y);
        this.hover = { x: w.x, y: w.y };
        const ui = store.ui;
        if (ui.placement) store.ui.placement!.ghost = { x: Math.round(w.x), y: Math.round(w.y) };
        if (ui.basePlacement) store.ui.basePlacement!.ghost = { x: Math.round(w.x), y: Math.round(w.y) };
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.pointersDown().length < 2) this.pinch = null;
      if (this.down && !this.down.moved) {
        const w = cam.getWorldPoint(p.x, p.y);
        this.tap(w.x, w.y, p.wasTouch);
      }
      this.down = null;
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(p.x, p.y, cam.zoom * (dy > 0 ? 0.88 : 1.14));
    });
    this.unsub = store.subscribe(() => (this.dirty = true));
    this.events.once('shutdown', () => this.unsub?.());
    this.events.once('destroy', () => this.unsub?.());
  }

  private pointersDown() {
    return this.input.manager.pointers.filter((p) => p.isDown);
  }

  private zoomAt(sx: number, sy: number, z: number) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(z, 0.25, 3));
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.dirty = true;
  }

  private buildTerrain(s: CampaignState) {
    const key = `terrain-${s.id}`;
    if (!this.textures.exists(key)) {
      const c = document.createElement('canvas');
      c.width = s.world.width / PX;
      c.height = s.world.height / PX;
      const ctx = c.getContext('2d')!;
      const cpx = s.world.cell / PX;
      for (let r = 0; r < s.world.rows; r++)
        for (let q = 0; q < s.world.cols; q++) {
          const t = TERRAIN_CODES[s.world.terrain.charCodeAt(r * s.world.cols + q) - 48];
          const base = TERRAIN[t].color;
          const h = ((q * 73856093) ^ (r * 19349663)) & 0xff;
          const v = (h / 255 - 0.5) * 14;
          const rr = Math.max(0, Math.min(255, ((base >> 16) & 0xff) + v));
          const gg = Math.max(0, Math.min(255, ((base >> 8) & 0xff) + v));
          const bb = Math.max(0, Math.min(255, (base & 0xff) + v));
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
          ctx.fillRect(q * cpx, r * cpx, cpx, cpx);
          if (t === 'forest' && h % 3 === 0) {
            ctx.fillStyle = 'rgba(30,45,25,0.6)';
            ctx.beginPath();
            ctx.arc(q * cpx + cpx / 2, r * cpx + cpx / 2, cpx * 0.3, 0, Math.PI * 2);
            ctx.fill();
          } else if (t === 'mountain' && h % 2 === 0) {
            ctx.fillStyle = 'rgba(220,215,205,0.35)';
            ctx.beginPath();
            ctx.moveTo(q * cpx + cpx / 2, r * cpx + 1);
            ctx.lineTo(q * cpx + cpx - 1, r * cpx + cpx - 1);
            ctx.lineTo(q * cpx + 1, r * cpx + cpx - 1);
            ctx.fill();
          }
        }
      this.textures.addCanvas(key, c);
    }
    this.add.image(0, 0, key).setOrigin(0).setScale(PX).setDepth(0);
  }

  private factionColor(s: CampaignState, fid: string | null | undefined) {
    if (!fid) return COLORS.neutral;
    return s.factions.find((f) => f.id === fid)?.color ?? COLORS.neutral;
  }

  private drawOverlay(s: CampaignState, visible: Set<string>) {
    const ctx = this.overlay.getContext('2d')!;
    const { cols, rows, cell } = s.world;
    const cpx = cell / PX;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const regionByIdx = new Map(s.regions.map((r) => [r.index, r]));
    const intel = new Map(s.intel.map((i) => [i.regionId, i]));
    const hex = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
    for (let r = 0; r < rows; r++)
      for (let q = 0; q < cols; q++) {
        const idx = s.world.regionMap.charCodeAt(r * cols + q) - 65;
        const region = regionByIdx.get(idx)!;
        const rec = intel.get(region.id);
        if (!rec?.discovered) {
          ctx.fillStyle = 'rgba(14,16,12,0.72)';
        } else {
          const owner = visible.has(region.id) ? region.ownerId : rec.ownerId;
          const c = this.factionColor(s, owner);
          ctx.fillStyle = region.status === 'contested' && visible.has(region.id) ? hex(COLORS.contested, 0.32) : hex(c, owner ? 0.3 : 0.12);
        }
        ctx.fillRect(q * cpx, r * cpx, cpx, cpx);
        if (rec?.discovered && !visible.has(region.id)) {
          ctx.fillStyle = 'rgba(14,16,12,0.28)';
          ctx.fillRect(q * cpx, r * cpx, cpx, cpx);
        }
        // borders
        const right = q + 1 < cols ? s.world.regionMap.charCodeAt(r * cols + q + 1) - 65 : idx;
        const down = r + 1 < rows ? s.world.regionMap.charCodeAt((r + 1) * cols + q) - 65 : idx;
        ctx.fillStyle = 'rgba(20,22,18,0.55)';
        if (right !== idx) ctx.fillRect(q * cpx + cpx - 1, r * cpx, 2, cpx);
        if (down !== idx) ctx.fillRect(q * cpx, r * cpx + cpx - 1, cpx, 2);
      }
    (this.textures.get(this.overlayKey) as Phaser.Textures.CanvasTexture).refresh();
  }

  private label(key: string, text: string, x: number, y: number, size: number, color = '#e8e6d9') {
    let t = this.labels.get(key);
    if (!t) {
      t = this.add.text(x, y, text, { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: `${size}px`, color, stroke: '#1b1e19', strokeThickness: 3 }).setOrigin(0.5).setDepth(8);
      this.labels.set(key, t);
    }
    t.setText(text).setPosition(x, y).setColor(color).setVisible(true);
    return t;
  }

  private redrawStatic(s: CampaignState) {
    const visible = countVisible(s, s.playerFactionId);
    const sig = s.regions.map((r) => `${r.ownerId}${r.status}`).join('|') + s.intel.map((i) => (i.discovered ? 1 : 0)).join('') + [...visible].join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      this.drawOverlay(s, visible);
    }
    const g = this.gStatic;
    g.clear();
    const known = (regionId: string) => s.intel.find((i) => i.regionId === regionId)?.discovered;
    const showLabels = s.settings.visual.labels;
    for (const t of this.labels.values()) t.setVisible(false);

    // supply network (player)
    const pb = s.bases.filter((b) => b.factionId === s.playerFactionId);
    for (const b of pb) {
      g.lineStyle(1, COLORS.player, 0.35);
      g.strokeCircle(b.x, b.y, supplyRadius(s, b));
      const other = pb.filter((o) => o.id !== b.id).sort((a, c) => dist(a, b) - dist(c, b))[0];
      if (other) {
        g.lineStyle(4, 0x6b5a3a, 0.75);
        g.lineBetween(b.x, b.y, other.x, other.y);
        g.lineStyle(1, 0xc9b88a, 0.6);
        g.lineBetween(b.x, b.y, other.x, other.y);
      }
    }
    // regions
    if (showLabels)
      for (const r of s.regions) {
        const rec = s.intel.find((i) => i.regionId === r.id)!;
        this.label(`r-${r.id}`, rec.discovered ? r.name.toUpperCase() : '?', r.seed.x, r.seed.y - 70, 15, rec.discovered ? '#d9d6c5' : '#7d7a70');
      }
    // sites
    for (const site of s.sites) {
      if (!known(site.regionId)) continue;
      const region = s.regions.find((r) => r.id === site.regionId)!;
      drawSite(g, site.type, site.x, site.y, this.factionColor(s, region.ownerId), site.status === 'operational' || site.status === 'upgrading' ? 1 : 0.7);
      if (showLabels) this.label(`s-${site.id}`, `${site.type.toUpperCase()} L${site.level}`, site.x, site.y + 26, 11, '#cfc9b0');
    }
    // bases & buildings
    for (const base of s.bases) {
      if (base.factionId !== s.playerFactionId && !known(base.regionId)) continue;
      const color = this.factionColor(s, base.factionId);
      g.lineStyle(1, color, 0.5);
      g.strokeCircle(base.x, base.y, base.radius);
      for (const b of s.buildings.filter((x) => x.baseId === base.id)) {
        drawBuilding(g, b.type, b.x, b.y, b.w, b.h, color, b.status === 'constructing' ? 0.45 : 1);
        if (b.status !== 'operational' && b.opFinishesAt && b.opStartedAt != null) {
          const p = Math.min(1, (s.gameTime - b.opStartedAt) / Math.max(1, b.opFinishesAt - b.opStartedAt));
          g.fillStyle(0x1b1e19, 0.8);
          g.fillRect(b.x - b.w / 2, b.y + b.h / 2 + 3, b.w, 4);
          g.fillStyle(0xd1b450, 1);
          g.fillRect(b.x - b.w / 2, b.y + b.h / 2 + 3, b.w * p, 4);
        }
      }
      if (showLabels) this.label(`b-${base.id}`, base.name, base.x, base.y - base.radius - 12, 13, base.factionId === s.playerFactionId ? '#d7e3a8' : '#e9b5a8');
    }
    for (const t of this.labels.values()) t.setScale(1 / Math.max(0.6, this.cameras.main.zoom));
  }

  private drawDynamic(s: CampaignState) {
    const g = this.gDyn;
    g.clear();
    const ui = store.ui;
    const cam = this.cameras.main;
    const gameNow = s.gameTime + Math.min(2, (Date.now() - s.lastSimulatedAt) / 1000) * s.settings.speed;
    const visible = countVisible(s, s.playerFactionId);
    // armies
    for (const a of s.armies) {
      const pos = armyPositionAt(s, a, gameNow);
      const mine = a.factionId === s.playerFactionId;
      if (!mine) {
        const reg = regionAt(s, pos.x, pos.y);
        if (!reg || !visible.has(reg.id)) continue;
      }
      const color = this.factionColor(s, a.factionId);
      if (a.status === 'moving' && a.missionId && mine) {
        const m = s.missions.find((x) => x.id === a.missionId);
        if (m) {
          g.lineStyle(2, 0xe8e6d9, 0.5);
          const steps = Math.floor(dist(pos, m.to) / 16);
          for (let i = 0; i < steps; i += 2) {
            const p0 = i / steps, p1 = (i + 1) / steps;
            g.lineBetween(pos.x + (m.to.x - pos.x) * p0, pos.y + (m.to.y - pos.y) * p0, pos.x + (m.to.x - pos.x) * p1, pos.y + (m.to.y - pos.y) * p1);
          }
        }
      }
      const size = 10 + Math.min(12, Math.sqrt(armyStrength(s, a.id)) / 3);
      g.fillStyle(0x1b1e19, 0.5);
      g.fillCircle(pos.x + 2, pos.y + 3, size + 3);
      g.fillStyle(color, 1);
      g.lineStyle(2, 0xe8e6d9, 1);
      g.fillCircle(pos.x, pos.y, size);
      g.strokeCircle(pos.x, pos.y, size);
      g.lineStyle(3, 0x1b1e19, 0.9);
      g.lineBetween(pos.x - size * 0.5, pos.y - size * 0.1, pos.x, pos.y + size * 0.4);
      g.lineBetween(pos.x, pos.y + size * 0.4, pos.x + size * 0.5, pos.y - size * 0.1);
      if (a.status === 'in_battle' || a.status === 'occupying') {
        g.lineStyle(2, a.status === 'in_battle' ? COLORS.invalid : COLORS.contested, 0.6 + 0.4 * Math.sin(Date.now() / 200));
        g.strokeCircle(pos.x, pos.y, size + 8);
      }
    }
    // selection
    const sel = ui.selection;
    if (sel) {
      let p: { x: number; y: number; r: number } | null = null;
      if (sel.kind === 'army') { const a = s.armies.find((x) => x.id === sel.id); if (a) p = { ...armyPositionAt(s, a, gameNow), r: 26 }; }
      if (sel.kind === 'base') { const b = s.bases.find((x) => x.id === sel.id); if (b) p = { x: b.x, y: b.y, r: b.radius + 4 }; }
      if (sel.kind === 'building') { const b = s.buildings.find((x) => x.id === sel.id); if (b) p = { x: b.x, y: b.y, r: Math.max(b.w, b.h) * 0.75 }; }
      if (sel.kind === 'site') { const b = s.sites.find((x) => x.id === sel.id); if (b) p = { x: b.x, y: b.y, r: 24 }; }
      if (sel.kind === 'region') { const r = s.regions.find((x) => x.id === sel.id); if (r) p = { x: r.seed.x, y: r.seed.y, r: 40 }; }
      if (p) {
        g.lineStyle(2, 0xf0e6a0, 0.9);
        g.strokeCircle(p.x, p.y, p.r);
      }
    }
    // placement ghost
    if (ui.placement) {
      const base = s.bases.find((b) => b.id === ui.placement!.baseId);
      if (base) {
        g.lineStyle(2, 0xf0e6a0, 0.6);
        g.strokeCircle(base.x, base.y, base.radius);
      }
      const gh = ui.placement.ghost;
      if (gh) {
        const v = validatePlacement(s, s.playerFactionId, ui.placement.baseId, ui.placement.type, gh.x, gh.y, ui.placement.rotation);
        const d = BUILDINGS[ui.placement.type];
        const w = ui.placement.rotation === 90 ? d.h : d.w, h = ui.placement.rotation === 90 ? d.w : d.h;
        g.fillStyle(v.ok ? COLORS.valid : COLORS.invalid, 0.4);
        g.lineStyle(2, v.ok ? COLORS.valid : COLORS.invalid, 1);
        g.fillRect(gh.x - w / 2, gh.y - h / 2, w, h);
        g.strokeRect(gh.x - w / 2, gh.y - h / 2, w, h);
      }
    }
    if (ui.basePlacement?.ghost) {
      const gh = ui.basePlacement.ghost;
      const v = validateBaseSite(s, s.playerFactionId, gh.x, gh.y);
      g.fillStyle(v.ok ? COLORS.valid : COLORS.invalid, 0.18);
      g.lineStyle(2, v.ok ? COLORS.valid : COLORS.invalid, 1);
      g.fillCircle(gh.x, gh.y, 150);
      g.strokeCircle(gh.x, gh.y, 150);
      g.fillRect(gh.x - 6, gh.y - 6, 12, 12);
    }
    if (ui.targeting && this.hover) {
      const a = s.armies.find((x) => x.id === ui.targeting!.armyId);
      const reg = regionAt(s, this.hover.x, this.hover.y);
      if (a && reg) {
        g.lineStyle(3, 0xf0e6a0, 0.8);
        g.lineBetween(a.x, a.y, reg.seed.x, reg.seed.y);
        g.strokeCircle(reg.seed.x, reg.seed.y, 50);
      }
    }
    void cam;
  }

  private tap(x: number, y: number, touch: boolean) {
    const s = store.state;
    if (!s) return;
    const ui = store.ui;
    if (ui.placement) {
      const p = ui.placement;
      const prev = p.ghost;
      const pos = { x: Math.round(x), y: Math.round(y) };
      if (touch && (!prev || Math.hypot(prev.x - pos.x, prev.y - pos.y) > 24)) {
        store.set({ placement: { ...p, ghost: pos } });
        return;
      }
      const at = touch && prev ? prev : pos;
      const ok = store.exec('place_building', { baseId: p.baseId, type: p.type, x: at.x, y: at.y, rotation: p.rotation }, { okText: `${BUILDINGS[p.type].name} construction started` });
      if (ok) store.set({ placement: null });
      return;
    }
    if (ui.basePlacement) {
      const pos = { x: Math.round(x), y: Math.round(y) };
      const prev = ui.basePlacement.ghost;
      if (touch && (!prev || Math.hypot(prev.x - pos.x, prev.y - pos.y) > 30)) {
        store.set({ basePlacement: { ghost: pos } });
        return;
      }
      const at = touch && prev ? prev : pos;
      const res = store.exec('establish_base', at);
      if (res) store.set({ basePlacement: null, selection: { kind: 'base', id: res.baseId }, screen: 'bases', panelOpen: true });
      return;
    }
    if (ui.targeting) {
      const reg = regionAt(s, x, y);
      if (!reg) return;
      const t = ui.targeting;
      const res = store.exec('launch_mission', { armyId: t.armyId, type: t.type, targetRegionId: reg.id });
      if (res) {
        store.toast('ok', `Mission launched to ${reg.name}. ETA ${Math.round(res.arrivesIn)}s`);
        store.set({ targeting: null });
      }
      return;
    }
    // hit test (screen-size tolerant)
    const tol = 14 / this.cameras.main.zoom;
    const visible = countVisible(s, s.playerFactionId);
    const army = s.armies.find((a) => {
      const p = armyPositionAt(s, a);
      if (a.factionId !== s.playerFactionId) { const r = regionAt(s, p.x, p.y); if (!r || !visible.has(r.id)) return false; }
      return dist(p, { x, y }) < 14 + tol;
    });
    if (army) return store.set({ selection: { kind: 'army', id: army.id }, panelOpen: true, screen: 'world' });
    const known = (rid: string) => s.intel.find((i) => i.regionId === rid)?.discovered;
    const b = s.buildings.find((b) => Math.abs(b.x - x) <= b.w / 2 + 2 && Math.abs(b.y - y) <= b.h / 2 + 2 && known(s.bases.find((bb) => bb.id === b.baseId)?.regionId ?? ''));
    if (b) {
      const base = s.bases.find((bb) => bb.id === b.baseId)!;
      if (base.factionId === s.playerFactionId) return store.set({ selection: { kind: 'building', id: b.id }, panelOpen: true, screen: 'bases' });
      return store.set({ selection: { kind: 'base', id: base.id }, panelOpen: true, screen: 'world' });
    }
    const site = s.sites.find((st) => dist(st, { x, y }) < 18 + tol && known(st.regionId));
    if (site) return store.set({ selection: { kind: 'site', id: site.id }, panelOpen: true, screen: 'world' });
    const base = s.bases.find((bb) => dist(bb, { x, y }) < 40 && (bb.factionId === s.playerFactionId || known(bb.regionId)));
    if (base) return store.set({ selection: { kind: 'base', id: base.id }, panelOpen: true, screen: base.factionId === s.playerFactionId ? 'bases' : 'world' });
    const idx = regionIndexAt(s, x, y);
    const reg = s.regions.find((r) => r.index === idx);
    if (reg) store.set({ selection: { kind: 'region', id: reg.id }, panelOpen: true, screen: 'world' });
  }

  update() {
    const s = store.state;
    if (!s) return;
    if (s.id !== this.campaignId) {
      this.scene.restart();
      return;
    }
    const f = store.ui.focus;
    if (f) {
      this.cameras.main.pan(f.x, f.y, 400, 'Sine.easeInOut');
      if (f.zoom) this.cameras.main.zoomTo(f.zoom, 400);
      store.ui.focus = null;
    }
    if (this.dirty) {
      this.dirty = false;
      this.redrawStatic(s);
    }
    this.drawDynamic(s);
  }
}
