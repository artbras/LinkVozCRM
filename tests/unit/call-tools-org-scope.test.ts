import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/call/agent-client", () => ({
  cancelarServico: vi.fn(),
  consultarCliente: vi.fn(),
  consultarEmpresa: vi.fn(),
  consultarServico: vi.fn(),
  criarServico: vi.fn(),
  solicitarRetorno: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  env: {
    CALL_AGENT_API_BASE_URL: "https://call.invalid/internal/agent",
    CALL_AGENT_FRANCHISE_ID: 1,
  },
}));

import { criarServico } from "@/lib/call/agent-client";
import type { McpContext } from "@/lib/mcp/types";
import {
  crmCallConfirmService,
  crmCallLookupOperationalEvents,
  crmCallLookupOperationalState,
  crmCallPrepareService,
} from "@/lib/mcp/tools/call";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = 83401;
const DRAFT_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DRAFT_ID_NEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Row = Record<string, unknown>;
type FakeQuery = {
  select: (...args: unknown[]) => FakeQuery;
  eq: (column: string, value: unknown) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  limit: (limit: number) => Promise<{ data: Row[]; error: null }>;
  maybeSingle: () => Promise<{ data: Row | null; error: { message: string } | null }>;
  insert: (values: Row) => FakeQuery;
  single: () => Promise<{ data: Row | null; error: { message: string } | null }>;
};

function fakeSupabase(tables: Record<string, Row[]> = {}) {
  const inserts: Array<{ table: string; values: Row }> = [];

  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    const matches = () => (tables[table] ?? []).filter((row) =>
      filters.every(([column, value]) => row[column] === value),
    );
    const query: FakeQuery = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      order: () => query,
      limit: async (limit: number) => ({ data: matches().slice(0, limit), error: null }),
      maybeSingle: async () => {
        const rows = matches();
        if (rows.length > 1) return { data: null, error: { message: "multiple rows" } };
        return { data: rows[0] ?? null, error: null };
      },
      insert: (values: Row) => {
        inserts.push({ table, values });
        return query;
      },
      single: async () => {
        const inserted = inserts.at(-1);
        if (!inserted) return { data: null, error: { message: "no inserted row" } };
        return {
          data: {
            id: DRAFT_ID_NEW,
            state: "awaiting_confirmation",
            service_payload: inserted.values.service_payload,
            confirmation_requested_at: "2026-10-09T00:00:00.000Z",
          },
          error: null,
        };
      },
    };
    return query;
  }

  return { from, inserts };
}

function contexto(supabase: unknown, organizationId = ORG_A): McpContext {
  return {
    organizationId,
    role: "ai_operator" as McpContext["role"],
    actor: { agent_id: "33333333-3333-4333-8333-333333333333" } as McpContext["actor"],
    apiTokenId: "token-test",
    requestId: "request-test",
    supabase: supabase as McpContext["supabase"],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("as ferramentas Call limitam dados ao tenant do contexto", () => {
  it("consulta eventos da corrida apenas na organização autenticada", async () => {
    const supabase = fakeSupabase({
      call_webhook_events: [
        {
          organization_id: ORG_A,
          service_id: SERVICE_ID,
          event_id: "evento-org-a",
          event_type: "service.updated",
          payload: { mensagem: "PORTA" },
          received_at: "2026-10-09T10:00:00.000Z",
          processed_at: "2026-10-09T10:00:01.000Z",
        },
        {
          organization_id: ORG_B,
          service_id: SERVICE_ID,
          event_id: "evento-org-b",
          event_type: "service.updated",
          payload: { mensagem: "SEM CONTATO" },
          received_at: "2026-10-09T10:00:00.000Z",
          processed_at: "2026-10-09T10:00:01.000Z",
        },
      ],
    });

    const resultado = await crmCallLookupOperationalEvents.handler(
      { servico_id: SERVICE_ID },
      contexto(supabase),
    ) as { eventos: Array<{ event_id: string }> };

    expect(resultado.eventos.map((evento) => evento.event_id)).toEqual(["evento-org-a"]);
  });

  it("consulta estado e exceções apenas na organização autenticada", async () => {
    const supabase = fakeSupabase({
      call_service_operational_state: [
        {
          organization_id: ORG_A,
          service_id: SERVICE_ID,
          status: "on_the_way",
          event_id: "estado-org-a",
          event_code: "PORTA",
          eta_minutes: 5,
          eta_received_at: "2026-10-09T10:00:00.000Z",
          unit: 1,
          unit_name: "Unidade A",
          vehicle_model: "Sedan",
          plate: "AAA1A11",
          payload: { motorista: "Motorista A", step: "driver_arriving" },
          updated_at: "2026-10-09T10:00:00.000Z",
        },
        {
          organization_id: ORG_B,
          service_id: SERVICE_ID,
          status: "cancelled",
          event_id: "estado-org-b",
          event_code: "CANCELADO",
          eta_minutes: null,
          eta_received_at: null,
          unit: 2,
          unit_name: "Unidade B",
          vehicle_model: "Hatch",
          plate: "BBB2B22",
          payload: { motorista: "Motorista B" },
          updated_at: "2026-10-09T10:00:00.000Z",
        },
      ],
      call_operational_exceptions: [
        { organization_id: ORG_A, service_id: SERVICE_ID, event_id: "excecao-org-a" },
        { organization_id: ORG_B, service_id: SERVICE_ID, event_id: "excecao-org-b" },
      ],
    });

    const resultado = await crmCallLookupOperationalState.handler(
      { servico_id: SERVICE_ID },
      contexto(supabase),
    ) as { estado: { status: string }; excecoes: Array<{ event_id: string }> };

    expect(resultado.estado.status).toBe("on_the_way");
    expect(resultado.excecoes.map((excecao) => excecao.event_id)).toEqual(["excecao-org-a"]);
  });

  it("grava o rascunho de corrida na organização do contexto", async () => {
    const supabase = fakeSupabase();
    const resultado = await crmCallPrepareService.handler(
      {
        nome_passageiro: "Maria Silva",
        telefone: "5511999999999",
        endereco: "Rua das Flores",
        bairro: "Centro",
        cidade: "Campinas",
        modalidade: "imediata",
      },
      contexto(supabase),
    ) as { rascunho_id: string };

    expect(resultado.rascunho_id).toBe(DRAFT_ID_NEW);
    expect(supabase.inserts).toHaveLength(1);
    expect(supabase.inserts[0]?.table).toBe("call_service_drafts");
    expect(supabase.inserts[0]?.values.organization_id).toBe(ORG_A);
  });

  it("recusa confirmar rascunho de outra organização antes de chamar o Call", async () => {
    const supabase = fakeSupabase({
      call_service_drafts: [
        {
          id: DRAFT_ID_B,
          organization_id: ORG_B,
          state: "awaiting_confirmation",
          franchise_id: 1,
          service_payload: {
            nome_passageiro: "Passageiro B",
            telefone: "5511888888888",
            endereco: "Rua B",
            bairro: "Centro",
            cidade: "Campinas",
          },
        },
      ],
    });

    const resultado = await crmCallConfirmService.handler(
      { rascunho_id: DRAFT_ID_B, confirmado: true },
      contexto(supabase, ORG_A),
    );

    expect(resultado).toMatchObject({ erro: "rascunho_nao_encontrado" });
    expect(vi.mocked(criarServico)).not.toHaveBeenCalled();
  });
});
