import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mock.admin }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
import { collectExportData } from "@/lib/lgpd/export-collector";

type Row = Record<string, unknown>;
const ORG = "tenant-a",
  OTHER_ORG = "tenant-b",
  CONTACT = "contact-a",
  OTHER_CONTACT = "contact-b";
const request = {
  organizationId: ORG,
  requestId: "export-1",
  contactId: CONTACT,
  externalCustomerId: null,
};
let rows: Record<string, Row[]>;
let failure: { message: string; table: string; occurrence?: number } | null;
const reads: { table: string; columns: string; range: [number, number] }[] = [];

/** Execute the collector's filters and projection against mixed-owner fixtures. */
class ReadQuery {
  columns = "";
  filters: ((row: Row) => boolean)[] = [];
  page: [number, number] = [0, 1000];
  constructor(readonly table: string) {}
  select(columns: string) {
    this.columns = columns;
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }
  is(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }
  in(key: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[key]));
    return this;
  }
  order() {
    return this;
  }
  limit(limit: number) {
    this.page = [0, limit - 1];
    return this;
  }
  range(from: number, to: number) {
    this.page = [from, to];
    return this;
  }
  or() {
    return this;
  }
  async maybeSingle() {
    const result = await this.execute();
    return { ...result, data: result.data?.[0] ?? null };
  }
  then(resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) {
    return this.execute().then(resolve, reject);
  }
  async execute() {
    reads.push({ table: this.table, columns: this.columns, range: this.page });
    const tableReads = reads.filter((read) => read.table === this.table).length;
    if (
      failure?.table === this.table &&
      (failure.occurrence === undefined || failure.occurrence === tableReads)
    ) {
      return { data: null, error: failure };
    }
    const data = (rows[this.table] ?? [])
      .filter((row) => this.filters.every((filter) => filter(row)))
      .slice(this.page[0], this.page[1] + 1)
      .map((row) =>
        Object.fromEntries(
          this.columns
            .split(",")
            .map((column) => column.trim())
            .map((column) => [column, row[column]]),
        ),
      );
    return { data, error: null };
  }
}

function candidate(id: string, organization_id = ORG, contact_id: string | null = CONTACT): Row {
  return {
    id,
    organization_id,
    contact_id,
    campaign_id: "campaign-a",
    lead_id: "lead-a",
    conversation_id: "conversation-a",
    place_id: `maps-${id}`,
    phone: "+5511988880000",
    data: {
      name: "Contato de teste",
      address: "Rua Teste",
      emails: ["comercial@example.test"],
      socials: ["https://example.test/perfil"],
    },
    status: "sent",
    attempted_at: "2026-09-16T00:00:00Z",
    error: null,
    created_at: "2026-09-15T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
    service_boundary: { authorization: "PRIVATE-AUTHORIZATION" },
    suppression_salt: "PRIVATE-SALT",
    suppression_place: "PRIVATE-PLACE-TOKEN",
    suppression_phone: "PRIVATE-PHONE-TOKEN",
  };
}

beforeEach(() => {
  reads.length = 0;
  failure = null;
  rows = {
    organizations: [
      { id: ORG, legal_name: "Empresa Teste", display_name: "Teste", dpo_email: null },
    ],
    contacts: [
      {
        id: CONTACT,
        organization_id: ORG,
        name: "Contato de teste",
        phone_number: "+5511988880000",
        created_at: "2026-09-15T00:00:00Z",
      },
    ],
    conversations: [
      {
        id: "conversation-a",
        organization_id: ORG,
        contact_id: CONTACT,
        status: "open",
        channel: "whatsapp",
        last_inbound_at: null,
        last_message_at: "2026-09-16T00:00:00Z",
        is_group: false,
        created_at: "2026-09-15T00:00:00Z",
      },
    ],
    call_operational_exceptions: [
      {
        id: "exception-direct",
        organization_id: ORG,
        contact_id: CONTACT,
        conversation_id: null,
        event_id: "event-direct",
        franchise_id: 1,
        service_id: 123,
        category: "no_driver",
        severity: "high",
        status: "open",
        payload: { operational_note: "direct link" },
        handoff_requested_at: null,
        handoff_result: null,
        resolved_at: null,
        created_at: "2026-09-16T00:00:00Z",
        updated_at: "2026-09-16T00:00:00Z",
      },
      {
        id: "exception-conversation",
        organization_id: ORG,
        contact_id: null,
        conversation_id: "conversation-a",
        event_id: "event-conversation",
        franchise_id: 1,
        service_id: 124,
        category: "driver_delay",
        severity: "medium",
        status: "handoff_requested",
        payload: { operational_note: "conversation link" },
        handoff_requested_at: "2026-09-16T00:00:00Z",
        handoff_result: { status: "pending" },
        resolved_at: null,
        created_at: "2026-09-16T00:00:00Z",
        updated_at: "2026-09-16T00:00:00Z",
      },
    ],
    prospecting_candidates: [
      candidate("mine"),
      candidate("other-contact", ORG, OTHER_CONTACT),
      candidate("other-tenant", OTHER_ORG),
      candidate("unlinked", ORG, null),
    ],
  };
  mock.admin.mockReturnValue({ from: (table: string) => new ReadQuery(table) });
});

describe("LGPD: dados da prospecção no pedido de acesso", () => {
  it("entrega a pesquisa do titular sem dados de outros contatos/tenants nem material interno", async () => {
    const payload = await collectExportData(request);
    expect(payload.prospecting_candidates).toEqual([
      expect.objectContaining({
        id: "mine",
        campaign_id: "campaign-a",
        phone: "+5511988880000",
        place_id: "maps-mine",
        status: "sent",
        data: {
          name: "Contato de teste",
          address: "Rua Teste",
          emails: ["comercial@example.test"],
          socials: ["https://example.test/perfil"],
        },
      }),
    ]);
    expect(JSON.stringify(payload.prospecting_candidates)).not.toMatch(
      /PRIVATE|suppression_|service_boundary|other-contact|other-tenant|unlinked/,
    );
    expect(reads.filter((read) => read.table === "prospecting_candidates")).toHaveLength(1);
  });

  it("pagina para entregar registros além dos primeiros 500", async () => {
    rows.prospecting_candidates = Array.from({ length: 501 }, (_, index) =>
      candidate(`mine-${index}`),
    );
    const payload = await collectExportData(request);
    expect(payload.prospecting_candidates).toHaveLength(501);
    expect(payload.prospecting_candidates.at(-1)?.id).toBe("mine-500");
    expect(
      reads.filter((read) => read.table === "prospecting_candidates").map((read) => read.range),
    ).toEqual([
      [0, 499],
      [500, 999],
    ]);
  });

  it("sem titular mantém a seção vazia e não consulta registros pessoais", async () => {
    const payload = await collectExportData({ ...request, contactId: null });
    expect(payload.prospecting_candidates).toEqual([]);
    expect(reads.map((read) => read.table)).toEqual(["organizations"]);
  });

  it("inclui exceções ligadas ao contato e às conversas no JSON exportável", async () => {
    const payload = await collectExportData(request);

    expect(payload.call_operational_exceptions).toEqual([
      expect.objectContaining({ id: "exception-direct", event_id: "event-direct", service_id: 123 }),
      expect.objectContaining({
        id: "exception-conversation",
        event_id: "event-conversation",
        service_id: 124,
      }),
    ]);
    const json = JSON.parse(JSON.stringify(payload)) as typeof payload;
    expect(json.call_operational_exceptions).toEqual(payload.call_operational_exceptions);
    expect(JSON.stringify(json)).toContain('"event-conversation"');
  });

  it("não conclui o export quando a projeção de conversas falha", async () => {
    failure = { table: "conversations", occurrence: 1, message: "database unavailable" };
    await expect(collectExportData(request)).rejects.toEqual(failure);
  });

  it("não conclui o export quando a paginação das conversas falha", async () => {
    failure = { table: "conversations", occurrence: 2, message: "database unavailable" };
    await expect(collectExportData(request)).rejects.toEqual(failure);
  });

  it("não conclui o export quando a consulta de exceções pelo contato falha", async () => {
    failure = { table: "call_operational_exceptions", occurrence: 1, message: "database unavailable" };
    await expect(collectExportData(request)).rejects.toEqual(failure);
  });

  it("não conclui o export quando a consulta de exceções pela conversa falha", async () => {
    failure = { table: "call_operational_exceptions", occurrence: 2, message: "database unavailable" };
    await expect(collectExportData(request)).rejects.toEqual(failure);
  });

  it("não entrega export aparentemente completo quando a coleta de prospecção falha", async () => {
    failure = { table: "prospecting_candidates", message: "database unavailable" };
    await expect(collectExportData(request)).rejects.toEqual(failure);
  });
});
