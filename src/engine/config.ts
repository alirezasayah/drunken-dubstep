// Static definitions (building_definitions, unit_definitions, technology_definitions).
// Kept separate from campaign state so balancing never rewrites saves.
import type { BuildingType, Doctrine, Resources, Terrain, UnitType } from './types';

export const SCHEMA_VERSION = 2;

export const WORLD = {
  width: 2000,
  height: 2000,
  cell: 20,
  regionGrid: 4, // 4x4 = 16 ownership regions
  aiFactions: 3,
  resourceSites: 20,
  mainBaseRadius: 230,
  forwardBaseRadius: 150,
  minBaseSeparation: 320,
  occupationSeconds: 45,
  aiDecisionInterval: 25,
  maxStepSeconds: 30,
  maxOfflineSeconds: 7 * 24 * 3600, // offline catch-up cap (7 game days)
};

export const MACRO_AREAS = ['Northern Reach', 'Eastern Steppe', 'Southern Basin', 'Western March'];
export const REGION_NAMES = [
  'Ardel', 'Brask', 'Corvin', 'Dunmere', 'Elsor', 'Faral', 'Gorran', 'Hesk',
  'Istra', 'Jorvik', 'Kael', 'Lomar', 'Mirev', 'Norsk', 'Ostra', 'Pell',
];

export const TERRAIN: Record<Terrain, { buildable: boolean; move: number; def: number; color: number }> = {
  grassland: { buildable: true, move: 1.0, def: 1.0, color: 0x6f7d4f },
  desert: { buildable: true, move: 0.85, def: 0.95, color: 0xb9a777 },
  forest: { buildable: true, move: 0.7, def: 1.25, color: 0x4a5e3a },
  rocky: { buildable: true, move: 0.75, def: 1.15, color: 0x857d6d },
  mountain: { buildable: false, move: 0.45, def: 1.4, color: 0x6b6460 },
  water: { buildable: false, move: 0.25, def: 1.0, color: 0x4f6f80 },
};
export const TERRAIN_CODES: Terrain[] = ['grassland', 'desert', 'forest', 'rocky', 'mountain', 'water'];

export const ZERO: Resources = { money: 0, oil: 0, iron: 0, gold: 0, energy: 0 };
export const RES_KEYS = ['money', 'oil', 'iron', 'gold', 'energy'] as const;

export interface BuildingDef {
  type: BuildingType;
  name: string;
  category: 'command' | 'ground' | 'logistics' | 'economy' | 'defense';
  w: number;
  h: number;
  cost: Partial<Resources>;
  buildTime: number; // game seconds at level 1
  upkeep: Partial<Resources>; // per game second at level 1
  produces?: Partial<Resources>; // per game second at level 1
  storage?: number; // per level
  supply?: number; // supply capacity per level
  vision?: number;
  requiresTech?: string;
  forwardAllowed: boolean;
  buildable: boolean;
  maxPerBase?: number;
  describe: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  headquarters: {
    type: 'headquarters', name: 'Headquarters', category: 'command', w: 60, h: 60,
    cost: {}, buildTime: 0, upkeep: { energy: 0.2 }, produces: { money: 3.0, energy: 0.7 }, storage: 1500, supply: 40,
    vision: 520, forwardAllowed: false, buildable: false, maxPerBase: 1,
    describe: 'Command and administrative center. Generates money, unlocks construction capacity.',
  },
  barracks: {
    type: 'barracks', name: 'Barracks', category: 'ground', w: 44, h: 30,
    cost: { money: 250, iron: 60 }, buildTime: 30, upkeep: { money: 0.15, energy: 0.1 },
    forwardAllowed: true, buildable: true, maxPerBase: 3,
    describe: 'Recruits infantry. Higher levels recruit faster and queue more.',
  },
  drill_grounds: {
    type: 'drill_grounds', name: 'Drill Grounds', category: 'ground', w: 56, h: 40,
    cost: { money: 200, iron: 30 }, buildTime: 30, upkeep: { money: 0.1 },
    forwardAllowed: false, buildable: true, maxPerBase: 2,
    describe: 'Trains infantry to higher levels and retrains doctrines.',
  },
  supply_depot: {
    type: 'supply_depot', name: 'Supply Depot', category: 'logistics', w: 34, h: 34,
    cost: { money: 180, iron: 40 }, buildTime: 25, upkeep: { money: 0.08 }, storage: 600, supply: 40,
    forwardAllowed: true, buildable: true,
    describe: 'Increases supply capacity, storage and the supply radius of the base.',
  },
  warehouse: {
    type: 'warehouse', name: 'Warehouse', category: 'logistics', w: 40, h: 28,
    cost: { money: 150, iron: 50 }, buildTime: 25, upkeep: { money: 0.05 }, storage: 1500,
    forwardAllowed: true, buildable: true,
    describe: 'Stores oil, iron, gold and energy.',
  },
  power_plant: {
    type: 'power_plant', name: 'Power Plant', category: 'economy', w: 38, h: 38,
    cost: { money: 220, iron: 80 }, buildTime: 35, upkeep: { money: 0.1, oil: 0.05 }, produces: { energy: 1.4 },
    forwardAllowed: true, buildable: true,
    describe: 'Generates energy for building operation. Burns a little oil.',
  },
  oil_refinery: {
    type: 'oil_refinery', name: 'Oil Refinery', category: 'economy', w: 46, h: 34,
    cost: { money: 300, iron: 120 }, buildTime: 45, upkeep: { oil: 0.4, energy: 0.2 }, produces: { money: 2.2 },
    forwardAllowed: false, buildable: true, maxPerBase: 2,
    describe: 'Processes oil into money.',
  },
  tank_base: {
    type: 'tank_base', name: 'Tank Base', category: 'ground', w: 60, h: 44,
    cost: { money: 500, iron: 220, oil: 60 }, buildTime: 60, upkeep: { money: 0.25, oil: 0.05, energy: 0.2 },
    requiresTech: 'mechanized_warfare', forwardAllowed: false, buildable: true, maxPerBase: 1,
    describe: 'Produces and maintains armored units.',
  },
  artillery_facility: {
    type: 'artillery_facility', name: 'Artillery Facility', category: 'ground', w: 50, h: 40,
    cost: { money: 420, iron: 180 }, buildTime: 55, upkeep: { money: 0.2, energy: 0.15 },
    requiresTech: 'field_artillery', forwardAllowed: false, buildable: true, maxPerBase: 1,
    describe: 'Produces artillery support units.',
  },
  radar_station: {
    type: 'radar_station', name: 'Radar Station', category: 'command', w: 26, h: 26,
    cost: { money: 200, iron: 40, gold: 10 }, buildTime: 30, upkeep: { money: 0.06, energy: 0.25 }, vision: 260,
    forwardAllowed: true, buildable: true, maxPerBase: 1,
    describe: 'Extends information coverage around the base.',
  },
  fortification: {
    type: 'fortification', name: 'Fortification', category: 'defense', w: 30, h: 30,
    cost: { money: 160, iron: 90 }, buildTime: 30, upkeep: { money: 0.05 },
    forwardAllowed: true, buildable: true, maxPerBase: 4,
    describe: 'Defensive works. Defending troops near it take less damage in battle.',
  },
};

export const MAX_LEVEL = 10;
export const levelCostMult = (level: number) => Math.pow(1.6, level - 1);
export const levelTimeMult = (level: number) => Math.pow(1.35, level - 1);
export const levelOutputMult = (level: number) => 1 + 0.35 * (level - 1);

export interface AdjacencyRule {
  type: BuildingType;
  near: BuildingType;
  radius: number;
  bonus: number; // per neighbor
  max: number;
  label: string;
}

export const ADJACENCY: AdjacencyRule[] = [
  { type: 'barracks', near: 'drill_grounds', radius: 110, bonus: 0.15, max: 0.3, label: 'Recruit speed (Drill Grounds nearby)' },
  { type: 'drill_grounds', near: 'barracks', radius: 110, bonus: 0.15, max: 0.3, label: 'Training speed (Barracks nearby)' },
  { type: 'tank_base', near: 'supply_depot', radius: 120, bonus: 0.15, max: 0.3, label: 'Production speed (Supply Depot nearby)' },
  { type: 'oil_refinery', near: 'power_plant', radius: 120, bonus: 0.12, max: 0.24, label: 'Output (Power Plant nearby)' },
  { type: 'power_plant', near: 'warehouse', radius: 100, bonus: 0.1, max: 0.2, label: 'Output (Warehouse nearby)' },
  { type: 'radar_station', near: 'headquarters', radius: 150, bonus: 0.25, max: 0.25, label: 'Coverage (HQ nearby)' },
  { type: 'fortification', near: 'fortification', radius: 90, bonus: 0.1, max: 0.2, label: 'Defense (interlocking works)' },
];

export interface UnitDef {
  type: UnitType;
  name: string;
  facility: BuildingType;
  hp: number;
  atk: number;
  def: number;
  range: number;
  speed: number; // tactical units/sec
  mobility: number; // strategic world units/sec
  supply: number; // supply points per unit
  cost: Partial<Resources>;
  upkeep: Partial<Resources>; // per unit per game second
  time: number; // seconds per unit
  vs: Partial<Record<UnitType, number>>;
}

export const UNITS: Record<UnitType, UnitDef> = {
  infantry: {
    type: 'infantry', name: 'Infantry', facility: 'barracks', hp: 10, atk: 1.6, def: 1, range: 70, speed: 26, mobility: 6,
    supply: 1, cost: { money: 18 }, upkeep: { money: 0.012 }, time: 1.5, vs: { tank: 0.5, artillery: 1.3 },
  },
  tank: {
    type: 'tank', name: 'Tank', facility: 'tank_base', hp: 70, atk: 9, def: 5, range: 100, speed: 34, mobility: 9,
    supply: 5, cost: { money: 140, iron: 45, oil: 20 }, upkeep: { money: 0.06, oil: 0.015 }, time: 8, vs: { infantry: 1.3, tank: 1.0 },
  },
  artillery: {
    type: 'artillery', name: 'Artillery', facility: 'artillery_facility', hp: 22, atk: 10, def: 1, range: 240, speed: 16, mobility: 5,
    supply: 3, cost: { money: 110, iron: 40 }, upkeep: { money: 0.04 }, time: 7, vs: { infantry: 1.3, tank: 0.8 },
  },
};

export const TRAINING_LEVELS = ['Basic', 'Intermediate', 'Advanced'];
export const TRAINING_MULT = [1.0, 1.18, 1.38];
export const TRAINING_COST = (unitType: UnitType, qty: number, target: number): Partial<Resources> => ({
  money: Math.round((unitType === 'infantry' ? 8 : 30) * qty * target),
  iron: unitType === 'infantry' ? 0 : Math.round(6 * qty * target),
});
export const TRAINING_TIME = (qty: number, target: number) => Math.round(20 + qty * 0.8 * target);

export const DOCTRINES: Record<Doctrine, { name: string; atk: number; def: number; speed: number; holdDef: number; vision: number; describe: string }> = {
  defensive: { name: 'Defensive', atk: 0.95, def: 1.15, speed: 0.95, holdDef: 1.15, vision: 1, describe: '+15% defense, +15% more when holding; slower.' },
  offensive: { name: 'Offensive', atk: 1.18, def: 0.95, speed: 1.05, holdDef: 1, vision: 1, describe: '+18% attack, -5% defense.' },
  reconnaissance: { name: 'Reconnaissance', atk: 0.95, def: 1, speed: 1.2, holdDef: 1, vision: 1.5, describe: '+20% speed, +50% vision on the world map.' },
  combined_arms: { name: 'Combined Arms', atk: 1.05, def: 1.05, speed: 1, holdDef: 1, vision: 1, describe: '+5% attack/defense; +10% more when the army mixes unit classes.' },
};
export const DOCTRINE_RETRAIN = { money: 6, time: 25 }; // money per unit, base seconds

export interface TechDef {
  key: string;
  name: string;
  branch: 'industrial' | 'military' | 'defense' | 'logistics';
  maxLevel: number;
  cost: Partial<Resources>;
  time: number;
  requires: { key: string; level: number }[];
  effect: string;
  value: number; // per level
}

export const TECHS: TechDef[] = [
  { key: 'resource_extraction', name: 'Resource Extraction', branch: 'industrial', maxLevel: 3, cost: { money: 300, iron: 50 }, time: 60, requires: [], effect: '+12% resource site output per level', value: 0.12 },
  { key: 'construction_methods', name: 'Construction Methods', branch: 'industrial', maxLevel: 3, cost: { money: 350, iron: 80 }, time: 70, requires: [], effect: '-12% construction time per level', value: 0.12 },
  { key: 'bulk_storage', name: 'Bulk Storage', branch: 'industrial', maxLevel: 2, cost: { money: 250, iron: 100 }, time: 60, requires: [{ key: 'resource_extraction', level: 1 }], effect: '+20% storage per level', value: 0.2 },
  { key: 'maintenance_efficiency', name: 'Maintenance Efficiency', branch: 'industrial', maxLevel: 2, cost: { money: 400, gold: 20 }, time: 90, requires: [{ key: 'construction_methods', level: 1 }], effect: '-10% upkeep per level', value: 0.1 },
  { key: 'unit_readiness', name: 'Unit Readiness', branch: 'military', maxLevel: 3, cost: { money: 300, oil: 40 }, time: 60, requires: [], effect: '+30% readiness recovery per level', value: 0.3 },
  { key: 'recruitment_drill', name: 'Recruitment Drill', branch: 'military', maxLevel: 3, cost: { money: 300 }, time: 60, requires: [], effect: '-12% recruitment time per level', value: 0.12 },
  { key: 'mechanized_warfare', name: 'Mechanized Warfare', branch: 'military', maxLevel: 1, cost: { money: 600, iron: 200, oil: 80 }, time: 120, requires: [{ key: 'recruitment_drill', level: 1 }], effect: 'Unlocks Tank Base', value: 1 },
  { key: 'field_artillery', name: 'Field Artillery', branch: 'military', maxLevel: 1, cost: { money: 500, iron: 160 }, time: 110, requires: [{ key: 'recruitment_drill', level: 1 }], effect: 'Unlocks Artillery Facility', value: 1 },
  { key: 'fortification_engineering', name: 'Fortification Engineering', branch: 'defense', maxLevel: 3, cost: { money: 300, iron: 120 }, time: 70, requires: [], effect: '+10% defender defense per level', value: 0.1 },
  { key: 'surveillance', name: 'Surveillance', branch: 'defense', maxLevel: 2, cost: { money: 280, gold: 15 }, time: 60, requires: [], effect: '+20% vision per level', value: 0.2 },
  { key: 'supply_lines', name: 'Supply Lines', branch: 'logistics', maxLevel: 3, cost: { money: 280, oil: 40 }, time: 60, requires: [], effect: '+20% supply radius and capacity per level', value: 0.2 },
  { key: 'transport_efficiency', name: 'Transport Efficiency', branch: 'logistics', maxLevel: 3, cost: { money: 320, oil: 60 }, time: 70, requires: [{ key: 'supply_lines', level: 1 }], effect: '+12% army travel speed per level', value: 0.12 },
  { key: 'forward_logistics', name: 'Forward Logistics', branch: 'logistics', maxLevel: 2, cost: { money: 350, iron: 80 }, time: 80, requires: [{ key: 'supply_lines', level: 1 }], effect: '-25% forward base cost, +1 forward base per level', value: 0.25 },
];
export const TECH_BY_KEY = Object.fromEntries(TECHS.map((t) => [t.key, t])) as Record<string, TechDef>;
export const MAX_CONCURRENT_RESEARCH = 1;
export const techCost = (def: TechDef, level: number): Partial<Resources> => {
  const m = Math.pow(1.7, level - 1);
  const out: Partial<Resources> = {};
  for (const [k, v] of Object.entries(def.cost)) out[k as keyof Resources] = Math.round((v as number) * m);
  return out;
};

export const FORWARD_BASE_COST: Partial<Resources> = { money: 600, iron: 150 };
export const BASE_LIMIT = 2; // forward bases before research

export const SUPPLY = { baseRadius: 520, forwardRadius: 380 };

export const SITE_OUTPUT: Record<'oil' | 'iron' | 'gold', number> = { oil: 1.2, iron: 1.1, gold: 0.25 };
export const SITE_UPGRADE_COST = (level: number): Partial<Resources> => ({ money: Math.round(200 * levelCostMult(level + 1)), iron: Math.round(60 * levelCostMult(level + 1)) });
export const SITE_UPGRADE_TIME = (level: number) => Math.round(40 * levelTimeMult(level + 1));

export const FACTION_COLORS = { player: 0x7a8f3a, ai: [0xa3483f, 0xb0703a, 0x8a4f7d] };
export const AI_NAMES: { name: string; personality: 'industrial' | 'expansionist' | 'defensive' }[] = [
  { name: 'Kessel Combine', personality: 'industrial' },
  { name: 'Varn Directorate', personality: 'expansionist' },
  { name: 'Osk Bastion League', personality: 'defensive' },
];

export const DIFFICULTY = {
  easy: { aiIncome: 0.8, aiAggressionAfter: Infinity, startMoney: 2000 },
  normal: { aiIncome: 1.0, aiAggressionAfter: 60 * 60, startMoney: 1500 },
  hard: { aiIncome: 1.25, aiAggressionAfter: 25 * 60, startMoney: 1200 },
};

export const COMMANDER_NAMES = ['Hale', 'Moreau', 'Kader', 'Lind', 'Sorel', 'Brandt', 'Ivers', 'Okafor', 'Reyes', 'Tamm', 'Vos', 'Quill'];
