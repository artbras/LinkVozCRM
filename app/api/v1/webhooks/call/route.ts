import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";

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
  const proactive = organizationId && inserted
    ? await enviarAtualizacaoProativa(admin, organizationId, inserted.id, eventId, body)
    : { sent: false, reason: "organization_not_configured" };
  if (!proactive.sent && inserted) {
    await admin.from("call_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: proactive.reason ?? "not_sent" }).eq("id", inserted.id);
  }
  return Response.json({ accepted: true, duplicate: false, id: inserted?.id ?? null, proactive });
}
