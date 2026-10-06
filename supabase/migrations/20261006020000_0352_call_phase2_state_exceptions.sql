-- Fase 2 inicial e conclusão do item 3 da Fase 1:
-- espelho operacional e exceções escaladas a partir de eventos reais do Call.
create table if not exists public.call_service_operational_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  franchise_id integer not null,
  service_id bigint not null,
  status text not null,
  event_id text not null,
  event_code text,
  eta_minutes integer,
  eta_received_at timestamptz,
  unit text,
  unit_name text,
  vehicle_model text,
  plate text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (organization_id, service_id)
);
create index if not exists idx_call_service_operational_state_org_status
  on public.call_service_operational_state (organization_id, status, updated_at desc);
revoke all on public.call_service_operational_state from anon, authenticated;
grant select, insert, update on public.call_service_operational_state to service_role;

create table if not exists public.call_operational_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  franchise_id integer not null,
  service_id bigint not null,
  event_id text not null,
  category text not null,
  severity text not null default 'high',
  status text not null default 'open',
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  handoff_requested_at timestamptz,
  handoff_result jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, event_id),
  constraint call_operational_exceptions_category_check check (category in ('no_driver','dispatch_timeout','no_contact','driver_delay','critical_event','unknown_operational_failure')),
  constraint call_operational_exceptions_severity_check check (severity in ('medium','high','critical')),
  constraint call_operational_exceptions_status_check check (status in ('open','handoff_requested','resolved','ignored'))
);
create index if not exists idx_call_operational_exceptions_open
  on public.call_operational_exceptions (organization_id, status, severity, created_at desc);
revoke all on public.call_operational_exceptions from anon, authenticated;
grant select, insert, update on public.call_operational_exceptions to service_role;
