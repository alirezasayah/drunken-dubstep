// Low-fidelity silhouettes for buildings and markers.
import Phaser from 'phaser';
import type { BuildingType } from '../engine/types';

export const COLORS = {
  player: 0x7a8f3a,
  neutral: 0x8a8a84,
  contested: 0xd1b450,
  ink: 0x1b1e19,
  light: 0xe8e6d9,
  valid: 0x6fcf5a,
  invalid: 0xe0533f,
};

const FILL: Record<BuildingType, number> = {
  headquarters: 0x3d4630,
  barracks: 0x5c5a45,
  drill_grounds: 0x8c835e,
  supply_depot: 0x6e5d3f,
  warehouse: 0x5f605c,
  power_plant: 0x4d5560,
  oil_refinery: 0x3e3b38,
  tank_base: 0x4b5240,
  artillery_facility: 0x564a3e,
  radar_station: 0x55605d,
  fortification: 0x6a6658,
};

export function drawBuilding(g: Phaser.GameObjects.Graphics, type: BuildingType, x: number, y: number, w: number, h: number, outline: number, alpha = 1) {
  const l = x - w / 2, t = y - h / 2;
  g.fillStyle(FILL[type], alpha);
  g.lineStyle(2, outline, alpha);
  switch (type) {
    case 'headquarters':
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.fillStyle(outline, alpha);
      g.fillRect(x - 4, t + 8, 8, h - 16);
      g.fillRect(l + 8, y - 4, w - 16, 8);
      break;
    case 'barracks':
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.lineStyle(1, 0x2a2a20, alpha);
      for (let i = 1; i < 4; i++) g.lineBetween(l + (w / 4) * i, t + 3, l + (w / 4) * i, t + h - 3);
      break;
    case 'drill_grounds':
      g.fillStyle(0x8c835e, alpha * 0.7);
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.lineStyle(1, 0xe8e6d9, alpha * 0.6);
      g.strokeEllipse(x, y, w * 0.7, h * 0.6);
      break;
    case 'supply_depot':
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.fillStyle(0xb39a63, alpha);
      g.fillRect(l + 5, t + 5, w / 2 - 7, h / 2 - 7);
      g.fillRect(x + 2, y + 2, w / 2 - 7, h / 2 - 7);
      break;
    case 'warehouse':
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.lineStyle(1, 0x2a2a20, alpha);
      g.lineBetween(l, y, l + w, y);
      break;
    case 'power_plant':
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.fillStyle(0xe6c94f, alpha);
      g.fillTriangle(x + 3, t + 6, x - 7, y + 2, x + 1, y + 2);
      g.fillTriangle(x - 1, y - 2, x + 7, y - 2, x - 3, t + h - 6);
      break;
    case 'oil_refinery':
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.fillStyle(0x9a9a92, alpha);
      g.fillCircle(l + w * 0.3, y, Math.min(w, h) * 0.22);
      g.fillCircle(l + w * 0.72, y, Math.min(w, h) * 0.22);
      break;
    case 'tank_base':
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.fillStyle(0x2f3528, alpha);
      g.fillRoundedRect(x - 12, y - 7, 24, 14, 3);
      g.fillRect(x, y - 2, 16, 4);
      break;
    case 'artillery_facility':
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.fillStyle(0x2f3528, alpha);
      g.fillTriangle(x - 10, y + 8, x + 10, y + 8, x, y - 8);
      break;
    case 'radar_station':
      g.fillCircle(x, y, w / 2);
      g.strokeCircle(x, y, w / 2);
      g.lineStyle(2, 0xe8e6d9, alpha);
      g.beginPath();
      g.arc(x, y, w / 3, -2.4, -0.7);
      g.strokePath();
      break;
    case 'fortification':
      g.fillStyle(FILL.fortification, alpha);
      g.fillRect(l, t, w, h);
      g.strokeRect(l, t, w, h);
      g.fillStyle(outline, alpha);
      for (let i = 0; i < 3; i++) g.fillRect(l + 3 + i * (w / 3), t - 3, w / 6, 5);
      break;
  }
}

export function drawSite(g: Phaser.GameObjects.Graphics, type: 'oil' | 'iron' | 'gold', x: number, y: number, ring: number, alpha = 1) {
  const fill = type === 'oil' ? 0x23211f : type === 'iron' ? 0x7d8a96 : 0xd9b23f;
  g.fillStyle(0x1b1e19, 0.35 * alpha);
  g.fillCircle(x + 2, y + 3, 17);
  g.fillStyle(fill, alpha);
  g.lineStyle(3, ring, alpha);
  g.beginPath();
  g.moveTo(x, y - 16);
  g.lineTo(x + 16, y);
  g.lineTo(x, y + 16);
  g.lineTo(x - 16, y);
  g.closePath();
  g.fillPath();
  g.strokePath();
  if (type === 'oil') {
    g.fillStyle(0x9a9a92, alpha);
    g.fillRect(x - 2, y - 9, 4, 14);
  }
}
