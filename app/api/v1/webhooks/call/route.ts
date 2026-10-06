import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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
    .select("id")
    .maybeSingle();

  if (error) {
    // Postgres unique violation means the Call retried a delivery already accepted.
    if (error.code === "23505") return Response.json({ accepted: true, duplicate: true });
    return Response.json({ error: "persistence_failed" }, { status: 503 });
  }
  return Response.json({ accepted: true, duplicate: false, id: inserted?.id ?? null });
}
