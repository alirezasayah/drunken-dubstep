// Core campaign state types. All timers are in GAME seconds (state.gameTime).
// Real-world time (ms epoch) is only used to compute elapsed time in advanceWorld.

export type ResourceKey = 'money' | 'oil' | 'iron' | 'gold' | 'energy';
export type Resources = Record<ResourceKey, number>;

export type Terrain = 'grassland' | 'desert' | 'mountain' | 'forest' | 'water' | 'rocky';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Personality = 'player' | 'industrial' | 'expansionist' | 'defensive';
export type UnitType = 'infantry' | 'tank' | 'artillery';
export type Doctrine = 'defensive' | 'offensive' | 'reconnaissance' | 'combined_arms';
export type BuildingType =
  | 'headquarters'
  | 'barracks'
  | 'drill_grounds'
  | 'supply_depot'
  | 'warehouse'
  | 'power_plant'
  | 'oil_refinery'
  | 'tank_base'
  | 'artillery_facility'
  | 'radar_station'
  | 'fortification';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Region {
  id: string;
  index: number;
  name: string;
  area: string; // macro map region
  seed: Vec2; // capture / command point
  terrain: Terrain; // dominant terrain
  ownerId: string | null;
  status: 'controlled' | 'neutral' | 'contested';
  occupation: null | { factionId: string; armyId: string; finishesAt: number };
}

export interface Faction {
  id: string;
  name: string;
  color: number;
  personality: Personality;
  isPlayer: boolean;
  hqBaseId: string | null;
  status: 'active' | 'defeated';
  resources: Resources;
  deficit: boolean; // maintenance unaffordable -> reduced efficiency
  lowEnergy: boolean;
}

export interface Base {
  id: string;
  factionId: string;
  regionId: string;
  name: string;
  type: 'main' | 'forward';
  x: number;
  y: number;
  radius: number; // construction radius
  createdAt: number;
}

export interface Building {
  id: string;
  baseId: string;
  type: BuildingType;
  level: number;
  x: number; // center
  y: number;
  rotation: 0 | 90;
  w: number;
  h: number;
  health: number; // 0..1
  status: 'constructing' | 'upgrading' | 'operational';
  opStartedAt: number | null;
  opFinishesAt: number | null;
  createdAt: number;
}

export interface ResourceSite {
  id: string;
  regionId: string;
  type: 'oil' | 'iron' | 'gold';
  x: number;
  y: number;
  quality: number; // 0.6 .. 1.4
  level: number;
  status: 'neutral' | 'occupying' | 'operational' | 'upgrading';
  opFinishesAt: number | null;
}

export interface UnitGroup {
  id: string;
  factionId: string;
  baseId: string | null; // garrison base when not in army
  armyId: string | null;
  type: UnitType;
  quantity: number;
  trainingLevel: 0 | 1 | 2; // basic, intermediate, advanced
  doctrine: Doctrine;
  health: number; // 0..1 average condition of the group
  readiness: number; // 0..1
  busyUntil: number | null; // training / retraining lock
  createdAt: number;
}

export interface QueueItem {
  id: string;
  factionId: string;
  baseId: string;
  buildingId: string;
  kind: 'recruit' | 'train' | 'doctrine';
  unitType: UnitType;
  quantity: number;
  unitId: string | null; // for train / doctrine
  targetTraining?: 0 | 1 | 2;
  targetDoctrine?: Doctrine;
  startedAt: number;
  finishesAt: number;
}

export interface Army {
  id: string;
  factionId: string;
  name: string;
  commander: string;
  homeBaseId: string;
  x: number;
  y: number;
  regionId: string;
  status: 'stationed' | 'moving' | 'occupying' | 'in_battle';
  missionId: string | null;
  doctrine: Doctrine;
  createdAt: number;
}

export interface Mission {
  id: string;
  armyId: string;
  factionId: string;
  type: 'capture' | 'reinforce' | 'return' | 'move';
  from: Vec2;
  to: Vec2;
  targetRegionId: string;
  targetBaseId: string | null;
  startedAt: number;
  arrivesAt: number;
  status: 'active' | 'arrived' | 'cancelled';
}

export interface Research {
  key: string;
  level: number;
  status: 'idle' | 'researching';
  startedAt: number | null;
  finishesAt: number | null;
}

export interface Notification {
  id: string;
  at: number; // game time
  kind: 'info' | 'success' | 'warning' | 'danger' | 'battle';
  title: string;
  body: string;
  ref?: { kind: string; id: string };
  read: boolean;
}

export interface Transaction {
  id: string;
  at: number;
  factionId: string;
  resource: ResourceKey;
  amount: number;
  type: string;
  ref: string | null;
}

export interface IntelRecord {
  regionId: string;
  discovered: boolean;
  lastSeenAt: number | null;
  ownerId: string | null;
  estStrength: number | null; // approximate defensive strength at last sighting
}

export interface AiState {
  factionId: string;
  nextDecisionAt: number;
  focus: string;
  lastAction: string;
}

// ---------- Tactical battle ----------

export type SquadState = 'idle' | 'moving' | 'holding' | 'retreating' | 'recovering' | 'destroyed' | 'withdrawn';
export type Formation = 'line' | 'column' | 'wedge';
export type Side = 'A' | 'D';

export interface Squad {
  id: string;
  side: Side;
  type: UnitType;
  sourceUnitId: string;
  qty: number;
  startQty: number;
  hpPer: number;
  hp: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: SquadState;
  order: 'none' | 'move' | 'hold' | 'retreat' | 'defend' | 'follow' | 'regroup';
  followId: string | null;
  formation: Formation;
  atk: number;
  def: number;
  range: number;
  speed: number;
  cooldown: number;
  targetId: string | null;
}

export interface BattleShot {
  from: string;
  to: string;
  tick: number;
}

export interface BattleSim {
  tick: number;
  rng: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  cells: string; // terrain code per cell: g f r d m
  objective: { x: number; y: number; r: number; progress: number; owner: Side };
  fortifications: { x: number; y: number; level: number }[];
  squads: Squad[];
  shots: BattleShot[];
  log: { tick: number; text: string }[];
  timeLimit: number;
  ended: boolean;
  result: null | 'attacker' | 'defender';
}

export interface Battle {
  id: string;
  regionId: string;
  attackerFactionId: string;
  defenderFactionId: string;
  attackerArmyId: string;
  defenderUnitIds: string[];
  status: 'pending' | 'active' | 'resolved';
  result: null | 'attacker' | 'defender';
  createdAt: number;
  endedAt: number | null;
  sim: BattleSim;
  commands: { tick: number; squadIds: string[]; command: string; x?: number; y?: number }[];
}

export interface CampaignSettings {
  speed: number;
  audio: { enabled: boolean; volume: number };
  visual: { labels: boolean; effects: boolean };
}

export interface CampaignState {
  schemaVersion: number;
  id: string;
  name: string;
  difficulty: Difficulty;
  seed: number;
  createdAt: number; // real ms
  lastSimulatedAt: number; // real ms
  gameTime: number; // game seconds
  status: 'active' | 'victory' | 'defeat';
  idCounter: number;
  playerFactionId: string;
  settings: CampaignSettings;
  world: { width: number; height: number; cell: number; cols: number; rows: number; terrain: string; regionMap: string };
  regions: Region[];
  factions: Faction[];
  bases: Base[];
  buildings: Building[];
  sites: ResourceSite[];
  units: UnitGroup[];
  queues: QueueItem[];
  armies: Army[];
  missions: Mission[];
  research: Record<string, Research[]>; // factionId -> research rows
  battles: Battle[];
  notifications: Notification[];
  ledger: Transaction[];
  intel: IntelRecord[];
  ai: AiState[];
  processedRequests: string[];
}

export type OpResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
