-- Serializa turnos de inbound pela conversa, inclusive quando o mesmo contato
-- possui conversas distintas. O índice antigo por contato permanece como cinto
-- adicional para jobs legados sem conversation_id.
create unique index if not exists uniq_job_queue_one_running_per_conversation
  on public.job_queue (organization_id, (payload->>'conversation_id'))
  where status = 'running'
    and kind = 'inbound_turn'
    and payload ? 'conversation_id';
