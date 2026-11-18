-- FRONTLINE MVP schema (spec §18 + implementation contract C).
-- Not yet wired: the prototype runs the same authoritative engine against local storage
-- (src/engine/server.ts StorageAdapter). This migration is the target for the Supabase backend.

create extension if not exists "pgcrypto";

-- ---------- Static definitions (balancing without rewriting saves) ----------
create table building_definitions (
  building_type text primary key,
  name text not null,
  category text not null,
  width numeric not null,
  height numeric not null,
  cost jsonb not null,
  build_seconds numeric not null,
  upkeep jsonb not null default '{}',
  produces jsonb not null default '{}',
  storage numeric,
  supply numeric,
  requires_tech text,
  forward_allowed boolean not null default false,
  max_per_base integer
);

create table unit_definitions (
  unit_type text primary key,
  name text not null,
  facility text not null references building_definitions(building_type),
  hp numeric not null, attack numeric not null, defense numeric not null,
  range numeric not null, speed numeric not null, mobility numeric not null,
  supply numeric not null, cost jsonb not null, upkeep jsonb not null, seconds_per_unit numeric not null
);

create table technology_definitions (
  technology_key text primary key,
  name text not null,
  branch text not null,
  max_level integer not null,
  cost jsonb not null,
  seconds numeric not null,
  prerequisites jsonb not null default '[]',
  effect text not null,
  value_per_level numeric not null
);

-- ---------- Players & campaigns ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references profiles(id) on delete cascade,
  campaign_name text not null,
  difficulty text not null check (difficulty in ('easy','normal','hard')),
  world_seed bigint not null,
  current_game_time numeric not null default 0,      -- game seconds
  last_simulated_at timestamptz not null default now(),
  campaign_status text not null default 'active',
  schema_version integer not null default 2,
  state_version bigint not null default 0,           -- optimistic concurrency
  created_at timestamptz not null default now()
);
create index on campaigns(player_id);

create table game_settings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references campaigns(id) on delete cascade,
  game_speed numeric not null default 1,
  difficulty_settings jsonb not null default '{}',
  audio_settings jsonb not null default '{}',
  visual_settings jsonb not null default '{}'
);

create table factions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  faction_name text not null,
  faction_type text not null,
  personality text not null,
  headquarters_id uuid,
  is_player boolean not null default false,
  faction_status text not null default 'active',
  deficit boolean not null default false,
  low_energy boolean not null default false
);
create index on factions(campaign_id);

create table world_regions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  region_index integer not null,
  region_name text not null,
  macro_area text not null,
  terrain_type text not null,
  ownership_type text not null,
  owner_faction_id uuid references factions(id),
  control_status text not null default 'neutral',
  occupation jsonb,
  map_data jsonb not null,
  unique (campaign_id, region_index)
);
create index on world_regions(campaign_id);

create table bases (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  faction_id uuid not null references factions(id),
  region_id uuid not null references world_regions(id),
  base_name text not null,
  base_type text not null check (base_type in ('main','forward')),
  position_x numeric not null, position_y numeric not null,
  construction_radius numeric not null,
  command_level integer not null default 1,
  health numeric not null default 1,
  supply_status text not null default 'supplied',
  created_at timestamptz not null default now()
);
create index on bases(campaign_id); create index on bases(faction_id);
alter table factions add constraint factions_hq_fk foreign key (headquarters_id) references bases(id) deferrable initially deferred;

create table buildings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  base_id uuid not null references bases(id) on delete cascade,
  building_type text not null references building_definitions(building_type),
  level integer not null default 1 check (level between 1 and 10),
  position_x numeric not null, position_y numeric not null,
  rotation numeric not null default 0,
  width numeric not null, height numeric not null,
  health numeric not null default 1,
  operational_status text not null,
  construction_started_at numeric, construction_finishes_at numeric,  -- game seconds
  created_at timestamptz not null default now()
);
create index on buildings(campaign_id); create index on buildings(base_id);

create table construction_queues (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  operation_type text not null,
  started_at numeric not null, finishes_at numeric not null,
  status text not null default 'active'
);
create index on construction_queues(campaign_id, finishes_at);

create table resources (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  faction_id uuid not null unique references factions(id) on delete cascade,
  money numeric not null default 0 check (money >= 0),
  oil numeric not null default 0 check (oil >= 0),
  iron numeric not null default 0 check (iron >= 0),
  gold numeric not null default 0 check (gold >= 0),
  energy numeric not null default 0 check (energy >= 0),
  updated_at timestamptz not null default now()
);

create table resource_sites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  region_id uuid not null references world_regions(id),
  resource_type text not null check (resource_type in ('oil','iron','gold')),
  position_x numeric not null, position_y numeric not null,
  deposit_quality numeric not null,
  production_rate numeric not null,
  owner_faction_id uuid references factions(id),
  facility_level integer not null default 1,
  operational_status text not null,
  status_finishes_at numeric,
  storage_capacity numeric not null default 0,
  stored_amount numeric not null default 0
);
create index on resource_sites(campaign_id);

create table resource_transactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  faction_id uuid not null references factions(id),
  resource_type text not null,
  amount numeric not null,
  transaction_type text not null,
  reference_id text,
  game_time numeric not null,
  created_at timestamptz not null default now()
);
create index on resource_transactions(campaign_id, faction_id);

create table units (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  faction_id uuid not null references factions(id),
  base_id uuid references bases(id),
  unit_type text not null references unit_definitions(unit_type),
  quantity integer not null check (quantity > 0),
  level integer not null default 1,
  training_level integer not null default 0 check (training_level between 0 and 2),
  doctrine text not null,
  health numeric not null default 1,
  readiness numeric not null default 1,
  busy_until numeric,
  created_at timestamptz not null default now()
);
create index on units(campaign_id); create index on units(faction_id); create index on units(base_id);

create table armies (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  faction_id uuid not null references factions(id),
  army_name text not null,
  commander_name text not null,
  home_base_id uuid references bases(id),
  doctrine text not null,
  position_x numeric not null, position_y numeric not null,
  current_region_id uuid references world_regions(id),
  current_mission text,
  supply_status text not null default 'supplied',
  readiness numeric not null default 1,
  status text not null
);
create index on armies(campaign_id); create index on armies(faction_id);

create table army_units (
  id uuid primary key default gen_random_uuid(),
  army_id uuid not null references armies(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  quantity_assigned integer not null check (quantity_assigned > 0)
);
create index on army_units(army_id);

create table missions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  army_id uuid not null references armies(id) on delete cascade,
  origin jsonb not null, destination jsonb not null,
  destination_region_id uuid references world_regions(id),
  destination_base_id uuid references bases(id),
  mission_type text not null,
  status text not null,
  started_at numeric not null, estimated_completion_at numeric not null, completed_at numeric
);
create index on missions(campaign_id, estimated_completion_at); create index on missions(army_id);

create table research (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  faction_id uuid not null references factions(id),
  technology_key text not null references technology_definitions(technology_key),
  technology_level integer not null default 0,
  research_started_at numeric, research_finishes_at numeric,
  status text not null default 'idle',
  unique (faction_id, technology_key)
);

create table battles (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  attacker_faction_id uuid not null references factions(id),
  defender_faction_id uuid not null references factions(id),
  region_id uuid not null references world_regions(id),
  attacker_army_id uuid references armies(id),
  defender_army_id uuid references armies(id),
  battle_status text not null,
  result text,
  started_at numeric not null, ended_at numeric,
  battlefield_state jsonb not null   -- deterministic sim state incl. tick + rng seed
);
create index on battles(campaign_id);

create table battle_units (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references battles(id) on delete cascade,
  source_unit_id uuid references units(id),
  side text not null check (side in ('A','D')),
  unit_type text not null, quantity integer not null, start_quantity integer not null,
  hp numeric not null, position_x numeric not null, position_y numeric not null,
  state text not null, current_order text not null, formation text not null
);
create table battle_commands (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references battles(id) on delete cascade,
  tick integer not null, command text not null, squad_ids text[] not null, payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table battle_objectives (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references battles(id) on delete cascade,
  objective_type text not null, position_x numeric not null, position_y numeric not null,
  radius numeric not null, owner_side text not null, progress numeric not null
);
create table battle_events (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references battles(id) on delete cascade,
  event_type text not null, event_data jsonb not null, game_tick integer not null
);
create index on battle_events(battle_id);

create table faction_ai_state (
  faction_id uuid primary key references factions(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  next_decision_at numeric not null,
  focus text, last_action text
);

create table roads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  from_base_id uuid not null references bases(id) on delete cascade,
  to_base_id uuid not null references bases(id) on delete cascade,
  level integer not null default 1
);
create table base_connections (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  supplier_base_id uuid not null references bases(id) on delete cascade,
  supplied_base_id uuid not null references bases(id) on delete cascade,
  capacity numeric not null
);
create table building_effects (
  id uuid primary key default gen_random_uuid(),
  building_type text not null references building_definitions(building_type),
  near_type text references building_definitions(building_type),
  technology_key text references technology_definitions(technology_key),
  radius numeric, bonus numeric not null, max_bonus numeric not null, label text not null
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  kind text not null, title text not null, body text not null, ref jsonb,
  game_time numeric not null, read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications(campaign_id, created_at desc);

create table game_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null,
  scheduled_at numeric not null,
  processed_at timestamptz,
  status text not null default 'pending' check (status in ('pending','processed','cancelled'))
);
create index on game_events(campaign_id, scheduled_at) where status = 'pending';

-- Idempotent operation log (request ids)
create table processed_requests (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  request_id text not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, request_id)
);

-- ---------- Atomic spending ----------
-- Row lock + check constraints make double spending impossible under concurrent requests.
create or replace function spend_resources(p_campaign uuid, p_faction uuid, p_cost jsonb, p_type text, p_ref text, p_game_time numeric)
returns boolean language plpgsql security definer as $$
declare r resources%rowtype; k text;
begin
  select * into r from resources where campaign_id = p_campaign and faction_id = p_faction for update;
  if not found then return false; end if;
  if r.money < coalesce((p_cost->>'money')::numeric,0) or r.oil < coalesce((p_cost->>'oil')::numeric,0)
     or r.iron < coalesce((p_cost->>'iron')::numeric,0) or r.gold < coalesce((p_cost->>'gold')::numeric,0)
     or r.energy < coalesce((p_cost->>'energy')::numeric,0) then
    return false;
  end if;
  update resources set
    money = money - coalesce((p_cost->>'money')::numeric,0), oil = oil - coalesce((p_cost->>'oil')::numeric,0),
    iron = iron - coalesce((p_cost->>'iron')::numeric,0), gold = gold - coalesce((p_cost->>'gold')::numeric,0),
    energy = energy - coalesce((p_cost->>'energy')::numeric,0), updated_at = now()
  where id = r.id;
  for k in select jsonb_object_keys(p_cost) loop
    if (p_cost->>k)::numeric <> 0 then
      insert into resource_transactions(campaign_id, faction_id, resource_type, amount, transaction_type, reference_id, game_time)
      values (p_campaign, p_faction, k, -(p_cost->>k)::numeric, p_type, p_ref, p_game_time);
    end if;
  end loop;
  return true;
end $$;

-- ---------- Row level security: every campaign is isolated to its owner ----------
create or replace function owns_campaign(c uuid) returns boolean language sql stable as $$
  select exists (select 1 from campaigns where id = c and player_id = auth.uid())
$$;

alter table profiles enable row level security;
create policy own_profile on profiles for all using (id = auth.uid()) with check (id = auth.uid());
alter table campaigns enable row level security;
create policy own_campaigns on campaigns for all using (player_id = auth.uid()) with check (player_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['game_settings','factions','world_regions','bases','buildings','construction_queues','resources','resource_sites',
    'resource_transactions','units','armies','missions','research','battles','faction_ai_state','roads','base_connections','notifications',
    'game_events','processed_requests']
  loop
    execute format('alter table %I enable row level security', t);
    -- clients read; all writes go through server-side functions (service role)
    execute format('create policy read_own on %I for select using (owns_campaign(campaign_id))', t);
  end loop;
end $$;
