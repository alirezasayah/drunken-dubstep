# FRONTLINE — first playable build

Persistent single-player military strategy prototype (spec MVP 1.0, §22 vertical slice).
React + TypeScript + Phaser 3 + Tailwind. Desktop and mobile browser.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests (offline progression, double-spend, placement, battle resume, old saves)
npm run build
```

## What works

The full slice loop with real persisted state, no stubbed buttons:

1. Open a persistent world map (2000×2000, 16 regions, 4 macro areas, 6 terrain types, 3 AI factions, 6 AI bases, 20 resource sites, fog of war).
2. Free placement of buildings inside a base's construction radius with green/red preview, rotation, overlap / terrain / territory validation.
3. Construction + upgrades (levels 1–10) on timers, construction crews, HQ-gated level caps, adjacency bonuses.
4. Economy: money/oil/iron/gold/energy, production by facility, storage caps, maintenance, deficit and low-energy penalties with early warnings, transaction ledger.
5. Recruitment (infantry; tanks/artillery after research), training levels, doctrines.
6. Army groups, travel missions with terrain-based travel time, supply status with explanations.
7. Capture neutral regions (occupation period → sites operational → income).
8. Forward bases in captured territory.
9. Tactical battles: separate battlefield, 10 ticks/s deterministic seeded sim, move/hold/retreat/defend objective/follow/regroup/formation/return, pause and 0.5–4× speed, command-point objective, battle reports. Battles pause when you leave or close the game and never resolve while you are away.
10. AI factions (industrial / expansionist / defensive) using the exact same operations and economy as the player.
11. Research tree (4 branches, 13 techs, unlocks Tank Base / Artillery Facility).
12. Offline progression: world time advances from stored timestamps in bounded, event-aligned steps (7-day cap).
13. Autosave after every action, 5 manual save slots, export/import, multiple campaigns, schema migration for old saves.

## Architecture

```
src/engine/   authoritative game logic (pure TS, no DOM)
  config.ts       building/unit/tech definitions (separate from campaign state)
  worldgen.ts     create_campaign
  operations.ts   place_building, upgrade_building, start_recruitment, start_training, start_research,
                  create_army, launch_mission, establish_base, start_battle, submit_battle_command, ...
  simulation.ts   advance_world
  battle.ts       tactical simulation
  ai.ts           AI factions
  server.ts       GameServer: load → advance → validate → mutate → save, idempotent request ids,
                  optimistic versioning, save slots; pluggable StorageAdapter
src/game/     Phaser scenes (world map, battlefield)
src/ui/       React screens (world, bases, building details, military, research, reports, economy, settings)
supabase/migrations/0001_frontline_schema.sql   target Postgres schema (+ RLS, atomic spend function)
```

The client never decides outcomes: every UI action is an explicit operation on `GameServer`, which re-derives
time from stored timestamps and validates ownership, prerequisites and costs.

### Backend status

No Supabase project/credentials were available, so `GameServer` currently persists to `localStorage`
(in-memory in tests). The engine is storage-agnostic: moving it server-side means running `src/engine`
in a Supabase Edge Function behind the same operation names and implementing `StorageAdapter`
against the provided schema. Auth is not wired yet for the same reason.
