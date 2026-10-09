-- Marca exceções redigidas para que atualizações futuras não reintroduzam dados pessoais.
alter table public.call_operational_exceptions
  add column if not exists pii_redacted_at timestamptz;

create or replace function public.fn_guard_call_operational_exception_redaction()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contact_anonymized boolean := false;
  v_conversation_anonymized boolean := false;
  v_conversation_contact_id uuid;
  v_redacted_at timestamptz;
begin
  v_redacted_at := new.pii_redacted_at;
  if tg_op = 'UPDATE' then
    v_redacted_at := coalesce(v_redacted_at, old.pii_redacted_at);
  end if;

  -- A row update already locks the exception before this trigger runs. Do not
  -- wait for a contact row here: anonymization locks that row before redacting
  -- the exception, so FOR SHARE would form a lock cycle. The nonblocking,
  -- contact-scoped advisory lock makes a concurrent redaction fail closed.
  if new.contact_id is not null then
    if not pg_try_advisory_xact_lock(hashtextextended(
      'call-operational-exception-redaction:' || new.organization_id::text || ':' || new.contact_id::text,
      4200420
    )) then
      v_contact_anonymized := true;
    else
      select c.is_anonymized into v_contact_anonymized
        from public.contacts as c
       where c.organization_id = new.organization_id
         and c.id = new.contact_id;
    end if;
  end if;

  if new.conversation_id is not null then
    select conv.contact_id into v_conversation_contact_id
      from public.conversations as conv
     where conv.organization_id = new.organization_id
       and conv.id = new.conversation_id;
    if v_conversation_contact_id is not null then
      if not pg_try_advisory_xact_lock(hashtextextended(
        'call-operational-exception-redaction:' || new.organization_id::text || ':' || v_conversation_contact_id::text,
        4200420
      )) then
        v_conversation_anonymized := true;
      else
        select c.is_anonymized into v_conversation_anonymized
          from public.contacts as c
         where c.organization_id = new.organization_id
           and c.id = v_conversation_contact_id;
      end if;
    end if;
  end if;

  if coalesce(v_contact_anonymized, false)
     or coalesce(v_conversation_anonymized, false)
     or v_redacted_at is not null then
    new.contact_id := null;
    new.conversation_id := null;
    new.payload := '{}'::jsonb;
    new.handoff_result := null;
    new.pii_redacted_at := coalesce(v_redacted_at, now());
    new.updated_at := now();
  end if;

  return new;
end;
$$;

alter function public.fn_guard_call_operational_exception_redaction() owner to postgres;
revoke all on function public.fn_guard_call_operational_exception_redaction() from public;
revoke execute on function public.fn_guard_call_operational_exception_redaction() from anon, authenticated, service_role;

drop trigger if exists trg_guard_call_operational_exception_redaction on public.call_operational_exceptions;
create trigger trg_guard_call_operational_exception_redaction
before insert or update on public.call_operational_exceptions
for each row
execute function public.fn_guard_call_operational_exception_redaction();

-- Serialize contact anonymization with exception writes before the AFTER redaction trigger.
create or replace function public.fn_lock_call_operational_exception_redaction_on_contact()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_anonymized is true and old.is_anonymized is distinct from new.is_anonymized then
    perform pg_advisory_xact_lock(hashtextextended(
      'call-operational-exception-redaction:' || new.organization_id::text || ':' || new.id::text,
      4200420
    ));
  end if;
  return new;
end;
$$;

alter function public.fn_lock_call_operational_exception_redaction_on_contact() owner to postgres;
revoke all on function public.fn_lock_call_operational_exception_redaction_on_contact() from public;
revoke execute on function public.fn_lock_call_operational_exception_redaction_on_contact() from anon, authenticated, service_role;

drop trigger if exists trg_lock_call_operational_exception_redaction on public.contacts;
create trigger trg_lock_call_operational_exception_redaction
before update of is_anonymized on public.contacts
for each row
when (new.is_anonymized is true and old.is_anonymized is distinct from new.is_anonymized)
execute function public.fn_lock_call_operational_exception_redaction_on_contact();

-- Redige dados livres da exceção quando o contato é anonimizado, preservando o fato operacional.
create or replace function public.fn_redigir_call_operational_exceptions_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.call_operational_exceptions
     set contact_id = null,
         conversation_id = null,
         payload = '{}'::jsonb,
         handoff_result = null,
         pii_redacted_at = coalesce(pii_redacted_at, now()),
         updated_at = now()
   where organization_id = new.organization_id
     and (
       contact_id = new.id
       or conversation_id in (
         select id
           from public.conversations
          where organization_id = new.organization_id
            and contact_id = new.id
       )
     );
  return new;
end;
$$;

alter function public.fn_redigir_call_operational_exceptions_ao_anonimizar() owner to postgres;
revoke all on function public.fn_redigir_call_operational_exceptions_ao_anonimizar() from public;
revoke execute on function public.fn_redigir_call_operational_exceptions_ao_anonimizar() from anon, authenticated, service_role;

drop trigger if exists trg_lgpd_call_operational_exceptions on public.contacts;
create trigger trg_lgpd_call_operational_exceptions
after update of is_anonymized on public.contacts
for each row
when (new.is_anonymized is true and old.is_anonymized is distinct from new.is_anonymized)
execute function public.fn_redigir_call_operational_exceptions_ao_anonimizar();

-- Corrige exceções legadas de contatos já anonimizados antes desta mudança.
update public.call_operational_exceptions as e
   set contact_id = null,
       conversation_id = null,
       payload = '{}'::jsonb,
       handoff_result = null,
       pii_redacted_at = coalesce(e.pii_redacted_at, now()),
       updated_at = now()
  from public.contacts as c
 where e.organization_id = c.organization_id
   and (
     e.contact_id = c.id
     or e.conversation_id in (
       select conv.id
         from public.conversations as conv
        where conv.organization_id = c.organization_id
          and conv.contact_id = c.id
     )
   )
   and c.is_anonymized is true;
