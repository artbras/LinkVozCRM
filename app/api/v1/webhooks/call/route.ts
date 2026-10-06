import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function autorizado(raw: string, recebido: string | null): boolean {
  const secret = process.env.CALL_AGENT_WEBHOOK_SECRET ?? "";
  if (!secret || !recebido) return false;
  const esperado = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(recebido.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<Response> {
  const raw = await req.text();
  if (!autorizado(raw, req.headers.get("x-call-signature"))) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const eventType = typeof body.event_type === "string" ? body.event_type.trim() : "";
  const data = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : null;
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
