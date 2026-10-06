import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";

export const dynamic = "force-dynamic";

function mensagemOperacional(body: Record<string, unknown>): string | null {
  const raw = typeof body.mensagem === "string" ? body.mensagem.trim().toUpperCase() : "";
  const eta = /^TEMPO=(5|10|15|20)$/.exec(raw)?.[1];
  if (eta) return `O motorista está chegando em aproximadamente ${eta} minutos.`;
  if (raw === "TEMPO=QTR") return "O motorista está previsto para chegar no horário combinado.";
  if (raw === "+10 MINS" || raw === "MAIS 10MIN") return "O motorista informou um atraso aproximado de 10 minutos.";
  if (raw === "PORTA") return "O motorista informou que está na porta do cliente.";
  if (raw === "SEM CONTATO") return "O motorista informou que não conseguiu contato com você. Verifique se está no local indicado e mantenha o telefone disponível.";
  if (raw === "TRIPULADO") return "A corrida foi iniciada.";
  if (raw === "FINALIZADO") return "A corrida foi finalizada.";
  return null;
}

type OperationalException = { category: string; severity: "medium" | "high" | "critical"; automaticHandoff: boolean };

function normalizarCodigo(raw: string): string {
  return raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
}

function excecaoOperacional(body: Record<string, unknown>): OperationalException | null {
  const raw = normalizarCodigo(typeof body.mensagem === "string" ? body.mensagem.trim() : "");
  if (!raw) return null;
  if (raw.includes("ACIDENTE") || raw.includes("EMERGENCIA") || raw.includes("RISCO"))
    return { category: "critical_event", severity: "critical", automaticHandoff: true };
  if (raw === "SEM CONTATO" || raw.includes("NAO LOCALIZADO"))
    return { category: "no_contact", severity: "high", automaticHandoff: true };
  if (raw.includes("SEM MOTORISTA") || raw.includes("SEM VEICULO") || raw.includes("NENHUM MOTORISTA") || raw.includes("SEM ACEITE"))
    return { category: "no_driver", severity: "high", automaticHandoff: true };
  if (raw.includes("TIMEOUT") || raw.includes("DESPACHO ESGOT") || raw.includes("TENTATIVA ESGOT"))
    return { category: "dispatch_timeout", severity: "high", automaticHandoff: true };
  if (raw.includes("FALHA") || raw.includes("ERRO OPERACIONAL"))
    return { category: "unknown_operational_failure", severity: "high", automaticHandoff: true };
  if (raw === "+10 MINS" || raw === "MAIS 10MIN")
    return { category: "driver_delay", severity: "medium", automaticHandoff: false };
  return null;
}

function estadoOperacional(body: Record<string, unknown>) {
  const raw = normalizarCodigo(typeof body.mensagem === "string" ? body.mensagem.trim() : "");
  const eta = /^TEMPO=(5|10|15|20)$/.exec(raw)?.[1];
  const status = eta ? "motorista_a_caminho"
    : raw === "TEMPO=QTR" ? "horario_marcado"
      : raw === "+10 MINS" || raw === "MAIS 10MIN" ? "atrasada"
        : raw === "PORTA" ? "motorista_na_porta"
          : raw === "SEM CONTATO" ? "sem_contato"
            : raw === "TRIPULADO" ? "em_andamento"
              : raw === "FINALIZADO" ? "finalizada"
                : "evento_recebido";
  return { status, event_code: raw || null, eta_minutes: eta ? Number(eta) : null };
}

async function processarEventoOperacional(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  eventId: string,
  franchiseId: number,
  serviceId: number,
  body: Record<string, unknown>,
): Promise<{ exception: string | null; handoff: boolean }> {
  const estado = estadoOperacional(body);
  await admin.from("call_service_operational_state").upsert({
    organization_id: organizationId,
    franchise_id: franchiseId,
    service_id: serviceId,
    status: estado.status,
    event_id: eventId,
    event_code: estado.event_code,
    eta_minutes: estado.eta_minutes,
    eta_received_at: estado.eta_minutes === null ? null : new Date().toISOString(),
    unit: body.unidade ?? null,
    unit_name: body.nm_unidade ?? null,
    vehicle_model: body.modelo ?? null,
    plate: body.placa ?? null,
    payload: body,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,service_id" });

  const excecao = excecaoOperacional(body);
  if (!excecao) return { exception: null, handoff: false };
  const telefone = typeof body.ps_tel === "string" ? body.ps_tel.replace(/\D/g, "") : "";
  const { data: contact } = telefone.length >= 10
    ? await admin.from("contacts").select("id").eq("organization_id", organizationId).eq("phone_number", telefone).maybeSingle()
    : { data: null };
  const { data: conversation } = contact
    ? await admin.from("conversations").select("id").eq("organization_id", organizationId).eq("contact_id", contact.id).eq("channel", "whatsapp").order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    : { data: null };
  const { data: inserted, error } = await admin.from("call_operational_exceptions").insert({
    organization_id: organizationId,
    franchise_id: franchiseId,
    service_id: serviceId,
    event_id: eventId,
    category: excecao.category,
    severity: excecao.severity,
    status: "open",
    contact_id: contact?.id ?? null,
    conversation_id: conversation?.id ?? null,
    payload: body,
  }).select("id").maybeSingle();
  if (error?.code === "23505") return { exception: excecao.category, handoff: false };
  if (error || !inserted || !excecao.automaticHandoff || !conversation) return { exception: excecao.category, handoff: false };

  try {
    const result = await triggerHandoff({
      conversationId: conversation.id,
      organizationId,
      reason: "critical_stage",
      origem: "mcp_externo",
      motivoTexto: `evento Call: ${excecao.category}`,
      declarado: { tentativas: [{ o_que: "processar evento operacional do Call", desfecho: excecao.category }] },
      metadata: { source: "call_webhook", event_id: eventId, service_id: serviceId, category: excecao.category },
    });
    await admin.from("call_operational_exceptions").update({
      status: result.triggered ? "handoff_requested" : "open",
      handoff_requested_at: result.triggered ? new Date().toISOString() : null,
      handoff_result: result,
      updated_at: new Date().toISOString(),
    }).eq("id", inserted.id).eq("organization_id", organizationId);
    return { exception: excecao.category, handoff: result.triggered };
  } catch (error) {
    await admin.from("call_operational_exceptions").update({
      status: "open",
      handoff_result: { error: error instanceof Error ? error.message.slice(0, 300) : "handoff_failed" },
      updated_at: new Date().toISOString(),
    }).eq("id", inserted.id).eq("organization_id", organizationId);
    return { exception: excecao.category, handoff: false };
  }
}

async function enviarAtualizacaoProativa(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  eventRowId: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<{ sent: boolean; reason?: string }> {
  const texto = mensagemOperacional(body);
  const phone = typeof body.ps_tel === "string" ? body.ps_tel.replace(/\D/g, "") : "";
  if (!texto || phone.length < 10) return { sent: false, reason: "unsupported_or_missing_phone" };
  const { data: contact } = await admin.from("contacts").select("id").eq("organization_id", organizationId).eq("phone_number", phone).maybeSingle();
  if (!contact) return { sent: false, reason: "contact_not_found" };
  const { data: conversation } = await admin.from("conversations")
    .select("id").eq("organization_id", organizationId).eq("contact_id", contact.id).eq("channel", "whatsapp")
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (!conversation) return { sent: false, reason: "conversation_not_found" };
  try {
    const message = await sendMessageHandler(
      admin,
      {
        organization_id: organizationId,
        actor: { type: "ai_agent", id: "call-webhook", role: "manager" },
        requestId: eventId,
      },
      {
        conversation_id: conversation.id,
        type: "text",
        body: texto,
        metadata: { idempotency_key: `call-webhook:${eventId}` },
      },
    );
    await admin.from("call_webhook_events").update({ processed_at: new Date().toISOString(), proactive_message_id: message.id, processing_error: null }).eq("id", eventRowId);
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "send_failed";
    await admin.from("call_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: reason }).eq("id", eventRowId);
    return { sent: false, reason };
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const raw = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const newData = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : null;
  const legacyServiceId = Number(body.id_servico);
  const legacy = Number.isSafeInteger(legacyServiceId) && legacyServiceId > 0 && typeof body.mensagem === "string";
  const legacyFingerprint = legacy
    ? createHash("sha256")
        .update(JSON.stringify([body.id_servico, body.step, body.mensagem, body.unidade, body.placa]))
        .digest("hex")
        .slice(0, 24)
    : "";
  const eventId =
    typeof body.event_id === "string" && body.event_id.trim()
      ? body.event_id.trim()
      : legacy
        ? `call:legacy:${legacyServiceId}:${legacyFingerprint}`
        : "";
  const eventType =
    typeof body.event_type === "string" && body.event_type.trim()
      ? body.event_type.trim()
      : legacy
        ? "call.legacy_agent_return"
        : "";
  const data = newData ?? (legacy ? { franchise_id: process.env.CALL_AGENT_FRANCHISE_ID, service_id: legacyServiceId } : null);
  const franchiseId = Number(data?.franchise_id);
  const serviceId = Number(data?.service_id);
  if (!eventId || !eventType || !Number.isSafeInteger(franchiseId) || franchiseId <= 0) {
    return Response.json({ error: "invalid_event" }, { status: 422 });
  }

  const admin = createAdminClient();
  const organizationId = process.env.CALL_AGENT_ORGANIZATION_ID || null;
  const { data: inserted, error } = await admin
    .from("call_webhook_events")
    .insert({
      event_id: eventId,
      event_type: eventType,
      franchise_id: franchiseId,
      service_id: Number.isSafeInteger(serviceId) && serviceId > 0 ? serviceId : null,
      organization_id: organizationId,
      payload: body,
    })
    .select("id,event_id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return Response.json({ accepted: true, duplicate: true });
    return Response.json({ error: "persistence_failed" }, { status: 503 });
  }
  const operational = organizationId && inserted && Number.isSafeInteger(serviceId) && serviceId > 0
    ? await processarEventoOperacional(admin, organizationId, eventId, franchiseId, serviceId, body)
    : { exception: null, handoff: false };
  const proactive = organizationId && inserted
    ? await enviarAtualizacaoProativa(admin, organizationId, inserted.id, eventId, body)
    : { sent: false, reason: "organization_not_configured" };
  if (!proactive.sent && inserted) {
    await admin.from("call_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: proactive.reason ?? "not_sent" }).eq("id", inserted.id);
  }
  return Response.json({ accepted: true, duplicate: false, id: inserted?.id ?? null, operational, proactive });
}
