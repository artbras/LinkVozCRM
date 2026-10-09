-- Eventos operacionais do sistema Call recebidos pelo CRM.
-- O event_id é a chave de idempotência do produtor; o payload cru fica limitado
-- ao necessário para reprocessamento e auditoria operacional.
create table if not exists public.call_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  franchise_id integer not null,
  service_id bigint,
  organization_id uuid references public.organizations(id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists idx_call_webhook_events_service on public.call_webhook_events (franchise_id, service_id, received_at desc);
create index if not exists idx_call_webhook_events_pending on public.call_webhook_events (processed_at, received_at);
alter table public.call_webhook_events enable row level security;
revoke all on public.call_webhook_events from anon, authenticated;
grant select, insert, update on public.call_webhook_events to service_role;
