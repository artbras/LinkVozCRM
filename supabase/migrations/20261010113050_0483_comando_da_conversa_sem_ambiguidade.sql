-- 0483 — elimina a ambiguidade entre as assinaturas de seis e sete argumentos
-- de `fn_comando_da_conversa` e mantém o campo calculado da Inbox consciente de
-- grupos. A produção tem as duas assinaturas, mas a de sete argumentos declara
-- `DEFAULT false`; por isso uma chamada de seis argumentos não tem candidato
-- único. O Postgres não permite retirar esse default com CREATE OR REPLACE.
--
-- Se houver default, DROP + CREATE apenas da assinatura de sete argumentos e
-- sem CASCADE: a assinatura legada de seis continua disponível, e a nova recebe
-- `is_group` explicitamente. O catálogo do PostgreSQL não permite remover um
-- default por CREATE OR REPLACE. `pg_depend` foi consultado no schema publicado:
-- nenhum objeto catalogado depende da função de sete argumentos. Nas reaplicações
-- seguintes do baseline, `pronargdefaults` já será zero e o OID/ACL será preservado.
-- ═══════════════════════════════════════════════════════════════════════════

do $retirar_default$
declare
  assinatura oid := to_regprocedure(
    'public.fn_comando_da_conversa(text,uuid,timestamptz,boolean,boolean,timestamptz,boolean)'
  )::oid;
begin
  if assinatura is not null and exists (
    select 1 from pg_proc p where p.oid = assinatura and p.pronargdefaults > 0
  ) then
    execute 'drop function public.fn_comando_da_conversa(text,uuid,timestamptz,boolean,boolean,timestamptz,boolean)';
  end if;
end
$retirar_default$;

create or replace function public.fn_comando_da_conversa(
  p_status                text,
  p_assigned_to_user_id   uuid,
  p_bot_silenced_until    timestamptz,
  p_force_human           boolean,
  p_is_blocked            boolean,
  p_agora                 timestamptz,
  p_is_group              boolean
) returns text
language sql
immutable
set search_path = public
as $fn_comando$
  select case
    -- A ordem é o contrato: dono primeiro, encerrada depois, então as travas.
    when p_assigned_to_user_id is not null then 'humano'
    when p_status in ('closed', 'archived', 'resolved') then 'encerrada'
    when p_is_group is true
      or p_force_human is true
      or p_is_blocked is true
      or (p_bot_silenced_until is not null and p_bot_silenced_until > p_agora) then 'aguardando'
    else 'automatico'
  end;
$fn_comando$;

comment on function public.fn_comando_da_conversa(
  text, uuid, timestamptz, boolean, boolean, timestamptz, boolean
) is 'Quem manda na conversa. Espelho SQL de comandoDaConversa() (lib/inbox/comando-da-conversa.ts); grupo sem dono fica aguardando. A assinatura de sete argumentos não tem default para coexistir sem ambiguidade com a assinatura legada de seis.';

revoke execute on function public.fn_comando_da_conversa(
  text, uuid, timestamptz, boolean, boolean, timestamptz, boolean
) from public, anon;
grant execute on function public.fn_comando_da_conversa(
  text, uuid, timestamptz, boolean, boolean, timestamptz, boolean
) to authenticated, service_role;

-- Mesmo campo calculado PostgREST; agora encaminha explicitamente o indicador
-- de grupo à regra SQL, sem mudar o parâmetro composto anônimo nem o limite RLS.
create or replace function public.comando_da_conversa(public.conversations)
returns text
language sql
stable
security definer
set search_path = public
as $comando$
  select public.fn_comando_da_conversa(
    $1.status,
    $1.assigned_to_user_id,
    $1.bot_silenced_until,
    coalesce((select ct.force_human from public.contacts ct where ct.id = $1.contact_id and ct.organization_id = $1.organization_id), false),
    coalesce((select ct.is_blocked  from public.contacts ct where ct.id = $1.contact_id and ct.organization_id = $1.organization_id), false),
    now(),
    coalesce($1.is_group, false)
  );
$comando$;

comment on function public.comando_da_conversa(public.conversations)
  is 'Campo calculado exposto pelo PostgREST: ?select=comando_da_conversa e ?comando_da_conversa=in.(...). Resolve force_human/is_blocked apenas do contato da mesma organização, carimba now() e encaminha is_group à regra. SECURITY DEFINER desde a 0404; parâmetro sem nome para não expor a função como RPC.';

revoke execute on function public.comando_da_conversa(public.conversations) from public, anon;
grant execute on function public.comando_da_conversa(public.conversations) to authenticated, service_role;

notify pgrst, 'reload schema';
