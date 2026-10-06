-- Fase 1 CoopNorte: estado da entrega operacional e máquina de estados da coleta.
-- O webhook continua idempotente por event_id; estas colunas registram o processamento
-- e o envio proativo sem duplicar uma ocorrência aceita.
alter table public.call_webhook_events
  add column if not exists processed_at timestamptz,
  add column if not exists processing_error text,
  add column if not exists proactive_message_id uuid references public.messages(id) on delete set null;

create index if not exists idx_call_webhook_events_unprocessed
  on public.call_webhook_events (organization_id, processed_at, received_at desc);

create table if not exists public.call_service_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  franchise_id integer not null,
  service_payload jsonb not null,
  state text not null default 'collecting',
  confirmation_requested_at timestamptz,
  confirmed_at timestamptz,
  created_service_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_service_drafts_state_check check (state in ('collecting','awaiting_confirmation','confirmed','created','cancelled'))
);
create index if not exists idx_call_service_drafts_org_state
  on public.call_service_drafts (organization_id, state, updated_at desc);
revoke all on public.call_service_drafts from anon, authenticated;
grant select, insert, update on public.call_service_drafts to service_role;
