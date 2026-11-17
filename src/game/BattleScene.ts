import Phaser from 'phaser';
import { alive, TICK_RATE } from '../engine/battle';
import { playerSide } from '../engine/operations';
import type { Battle, CampaignState, Squad } from '../engine/types';
import { store } from '../store';

const TERRAIN_FILL: Record<string, number> = { g: 0x6f7d4f, f: 0x4a5e3a, r: 0x857d6d, d: 0xb9a777, m: 0x6b6460 };

export class BattleScene extends Phaser.Scene {
  private gBg!: Phaser.GameObjects.Graphics;
  private g!: Phaser.GameObjects.Graphics;
  private acc = 0;
  private lastSave = 0;
  private battleId = '';
  private down: { x: number; y: number; wx: number; wy: number; moved: boolean } | null = null;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private ended = false;

  constructor() {
    super('battle');
  }

  private battle(s: CampaignState | null): Battle | undefined {
    return s?.battles.find((b) => b.id === this.battleId);
  }

  create() {
    this.battleId = store.ui.battleId ?? '';
    const s = store.state;
    const b = this.battle(s);
    if (!s || !b) return;
    this.ended = b.status === 'resolved';
    this.gBg = this.add.graphics();
    this.g = this.add.graphics();
    const sim = b.sim;
    const cell = sim.width / sim.cols;
    for (let r = 0; r < sim.rows; r++)
      for (let c = 0; c < sim.cols; c++) {
        const code = sim.cells[r * sim.cols + c];
        const shade = (((c * 7919) ^ (r * 104729)) & 15) - 8;
        const base = TERRAIN_FILL[code] ?? 0x6f7d4f;
        const col = Phaser.Display.Color.IntegerToColor(base);
        this.gBg.fillStyle(Phaser.Display.Color.GetColor(col.red + shade, col.green + shade, col.blue + shade), 1);
        this.gBg.fillRect(c * cell, r * cell, cell + 1, cell + 1);
        if (code === 'f') { this.gBg.fillStyle(0x2e3d26, 0.7); this.gBg.fillCircle(c * cell + cell / 2, r * cell + cell / 2, cell * 0.3); }
        if (code === 'm') { this.gBg.fillStyle(0xd6d0c4, 0.35); this.gBg.fillTriangle(c * cell + cell / 2, r * cell + 6, c * cell + cell - 6, r * cell + cell - 6, c * cell + 6, r * cell + cell - 6); }
      }
    // deployment edges
    this.gBg.fillStyle(0x000000, 0.12);
    this.gBg.fillRect(0, 0, 30, sim.height);
    this.gBg.fillRect(sim.width - 30, 0, 30, sim.height);
    for (const f of sim.fortifications) {
      this.gBg.fillStyle(0x6a6658, 1);
      this.gBg.lineStyle(2, 0x2a2a20, 1);
      this.gBg.fillRect(f.x - 16, f.y - 10, 32, 20);
      this.gBg.strokeRect(f.x - 16, f.y - 10, 32, 20);
    }
    this.fit();
    this.scale.on('resize', this.fit, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.fit, this));

    const cam = this.cameras.main;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const w = cam.getWorldPoint(p.x, p.y);
      this.down = { x: p.x, y: p.y, wx: w.x, wy: w.y, moved: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.down) return;
      if (Math.hypot(p.x - this.down.x, p.y - this.down.y) > 8) this.down.moved = true;
      if (this.down.moved && !p.wasTouch) {
        const w = cam.getWorldPoint(p.x, p.y);
        this.box = { x0: this.down.wx, y0: this.down.wy, x1: w.x, y1: w.y };
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const w = cam.getWorldPoint(p.x, p.y);
      if (this.box) this.boxSelect(p.event instanceof MouseEvent && p.event.shiftKey);
      else if (this.down && !this.down.moved) this.tap(w.x, w.y, p.event instanceof MouseEvent && p.event.shiftKey, p.rightButtonReleased());
      this.box = null;
      this.down = null;
    });
    this.input.mouse?.disableContextMenu();
  }

  private fit() {
    const s = store.state;
    const b = this.battle(s);
    if (!b) return;
    const cam = this.cameras.main;
    const W = this.scale.width, H = this.scale.height;
    const topPad = 64, bottomPad = W < 700 ? 150 : 96;
    const z = Math.min(W / b.sim.width, (H - topPad - bottomPad) / b.sim.height);
    cam.setZoom(z);
    cam.centerOn(b.sim.width / 2, b.sim.height / 2 + (bottomPad - topPad) / 2 / z);
    cam.setBackgroundColor('#141712');
  }

  private side(): 'A' | 'D' {
    const s = store.state!;
    return playerSide(s, this.battleId) ?? 'A';
  }

  private squadAt(sim: Battle['sim'], x: number, y: number, side?: 'A' | 'D'): Squad | undefined {
    const tol = 22 / this.cameras.main.zoom / 2 + 14;
    return sim.squads
      .filter((q) => alive(q) && (!side || q.side === side))
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
      .find((q) => Math.hypot(q.x - x, q.y - y) < tol);
  }

  private tap(x: number, y: number, shift: boolean, right: boolean) {
    const s = store.state;
    const b = this.battle(s);
    if (!b || b.status !== 'active') return;
    const side = this.side();
    const sel = store.ui.battle.selected;
    if (store.ui.battle.followMode) {
      const leader = this.squadAt(b.sim, x, y, side);
      if (leader) store.exec('submit_battle_command', { battleId: b.id, command: 'follow', squadIds: sel, followId: leader.id });
      store.setBattle({ followMode: false });
      return;
    }
    const own = this.squadAt(b.sim, x, y, side);
    if (own && !right) {
      const next = shift ? (sel.includes(own.id) ? sel.filter((i) => i !== own.id) : [...sel, own.id]) : [own.id];
      store.setBattle({ selected: next });
      return;
    }
    if (sel.length) store.exec('submit_battle_command', { battleId: b.id, command: 'move', squadIds: sel, x, y });
  }

  private boxSelect(shift: boolean) {
    const s = store.state;
    const b = this.battle(s);
    if (!b || !this.box) return;
    const { x0, y0, x1, y1 } = this.box;
    const side = this.side();
    const ids = b.sim.squads
      .filter((q) => q.side === side && alive(q) && q.x >= Math.min(x0, x1) && q.x <= Math.max(x0, x1) && q.y >= Math.min(y0, y1) && q.y <= Math.max(y0, y1))
      .map((q) => q.id);
    store.setBattle({ selected: shift ? [...new Set([...store.ui.battle.selected, ...ids])] : ids });
  }

  update(_t: number, delta: number) {
    const s = store.state;
    const b = this.battle(s);
    if (!s || !b) return;
    if (store.ui.battleId !== this.battleId) return;
    // drive the authoritative simulation
    if (b.status === 'active' && !store.ui.battle.paused) {
      this.acc += (Math.min(delta, 250) / 1000) * TICK_RATE * store.ui.battle.speed;
      const ticks = Math.floor(this.acc);
      if (ticks > 0) {
        this.acc -= ticks;
        const before = b.sim.log.length;
        store.exec('advance_battle', { battleId: b.id, ticks }, { persist: false, silent: true });
        const nb = this.battle(store.state);
        const major = nb && (nb.sim.log.length !== before || nb.status === 'resolved');
        if (Date.now() - this.lastSave > 3000 || major) {
          this.lastSave = Date.now();
          store.exec('save_battle_state', { battleId: b.id }, { silent: true });
        }
      }
    }
    if (b.status === 'resolved' && !this.ended) {
      this.ended = true;
      store.flush();
    }
    this.draw(b);
  }

  private draw(b: Battle) {
    const g = this.g;
    const sim = b.sim;
    g.clear();
    const side = this.side();
    // objective
    const obj = sim.objective;
    const pColor = obj.progress > 0 ? 0xe0533f : 0x7a8f3a;
    g.fillStyle(0xf0e6a0, 0.08);
    g.fillCircle(obj.x, obj.y, obj.r);
    g.lineStyle(3, 0xf0e6a0, 0.7);
    g.strokeCircle(obj.x, obj.y, obj.r);
    g.lineStyle(6, side === 'A' ? (obj.progress > -1 ? 0x7a8f3a : pColor) : 0xa3483f, 0.9);
    const frac = (obj.progress + 1) / 2;
    if (frac > 0.001) {
      g.beginPath();
      g.arc(obj.x, obj.y, obj.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      g.strokePath();
    }
    g.fillStyle(obj.owner === 'A' ? 0xa3483f : 0x3d4630, 1);
    g.fillRect(obj.x - 3, obj.y - 26, 4, 30);
    g.fillTriangle(obj.x + 1, obj.y - 26, obj.x + 20, obj.y - 20, obj.x + 1, obj.y - 14);

    const sel = new Set(store.ui.battle.selected);
    const byId = new Map(sim.squads.map((q) => [q.id, q]));
    // shots
    if (store.state?.settings.visual.effects !== false)
      for (const sh of sim.shots) {
        const age = sim.tick - sh.tick;
        if (age > 4) continue;
        const a = byId.get(sh.from), t = byId.get(sh.to);
        if (!a || !t) continue;
        g.lineStyle(a.type === 'artillery' ? 2 : 1, 0xffe9a8, 1 - age / 5);
        g.lineBetween(a.x, a.y, t.x, t.y);
        if (a.type === 'artillery') { g.fillStyle(0xffc070, 0.5 - age / 10); g.fillCircle(t.x, t.y, 14); }
      }
    for (const q of sim.squads) {
      if (q.state === 'withdrawn') continue;
      const mine = q.side === side;
      const color = q.state === 'destroyed' ? 0x2a2a26 : mine ? 0x7a8f3a : 0xa3483f;
      const alpha = q.state === 'destroyed' ? 0.5 : 1;
      if (mine && sel.has(q.id) && alive(q)) {
        g.lineStyle(1, 0xf0e6a0, 0.5);
        if (q.state === 'moving' && q.order !== 'follow') g.lineBetween(q.x, q.y, q.tx, q.ty);
        g.lineStyle(2, 0xf0e6a0, 1);
        g.strokeCircle(q.x, q.y, 20);
      }
      g.fillStyle(0x000000, 0.3 * alpha);
      g.fillCircle(q.x + 2, q.y + 3, 13);
      g.fillStyle(color, alpha);
      g.lineStyle(2, 0x1b1e19, alpha);
      if (q.type === 'infantry') { g.fillCircle(q.x, q.y, 12); g.strokeCircle(q.x, q.y, 12); }
      else if (q.type === 'tank') { g.fillRect(q.x - 14, q.y - 10, 28, 20); g.strokeRect(q.x - 14, q.y - 10, 28, 20); g.fillStyle(0x1b1e19, alpha); g.fillRect(q.x, q.y - 2, mine === (q.side === 'A') ? 16 : -16, 4); }
      else { g.fillTriangle(q.x, q.y - 14, q.x + 13, q.y + 10, q.x - 13, q.y + 10); g.strokeTriangle(q.x, q.y - 14, q.x + 13, q.y + 10, q.x - 13, q.y + 10); }
      if (!alive(q)) continue;
      // health bar
      const hpFrac = Math.max(0, q.hp / (q.startQty * q.hpPer));
      g.fillStyle(0x1b1e19, 0.9);
      g.fillRect(q.x - 14, q.y - 22, 28, 4);
      g.fillStyle(hpFrac > 0.5 ? 0x9ccf5a : hpFrac > 0.25 ? 0xe6c94f : 0xe0533f, 1);
      g.fillRect(q.x - 14, q.y - 22, 28 * hpFrac, 4);
      if (q.state === 'retreating') { g.lineStyle(2, 0xe6c94f, 1); g.strokeCircle(q.x, q.y, 16); }
      if (q.state === 'holding') { g.fillStyle(0xe8e6d9, 0.9); g.fillRect(q.x - 3, q.y + 14, 6, 3); }
    }
    if (this.box) {
      const { x0, y0, x1, y1 } = this.box;
      g.lineStyle(1, 0xf0e6a0, 1);
      g.fillStyle(0xf0e6a0, 0.1);
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
  }
}
