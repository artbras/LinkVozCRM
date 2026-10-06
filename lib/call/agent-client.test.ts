import { afterEach, describe, expect, it, vi } from "vitest";

import { consultarCliente, consultarEmpresa } from "./agent-client";

describe("cliente HTTP do sistema Call", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("envia consulta de cliente ao contrato interno e devolve os dados", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { id_cliente: 7, nm_cliente: "Maria", telefone: "5521999999999" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await consultarCliente({
      baseUrl: "http://call.test:3011",
      franchiseId: 12,
      phone: "+55 (21) 99999-9999",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://call.test:3011/internal/agent",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ acao: "cliente", idf: 12, telefone: "5521999999999" }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { id_cliente: 7, nm_cliente: "Maria", telefone: "5521999999999" },
    });
  });

  it("não transforma erro funcional do Call em sucesso", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "CLIENT_NOT_FOUND" }), { status: 404 }),
    );

    const result = await consultarCliente({
      baseUrl: "http://call.test:3011",
      franchiseId: 12,
      phone: "5521999999999",
    });

    expect(result).toEqual({ ok: false, code: "CLIENT_NOT_FOUND" });
  });

  it("consulta empresa somente com id inteiro positivo", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { id_empresa: 4 } }), { status: 200 }),
      );

    const result = await consultarEmpresa({
      baseUrl: "http://call.test:3011",
      franchiseId: 12,
      companyId: 4,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://call.test:3011/internal/agent",
      expect.objectContaining({
        body: JSON.stringify({ acao: "empresa", idf: 12, empresa_id: 4 }),
      }),
    );
    expect(result).toEqual({ ok: true, data: { id_empresa: 4 } });
  });
});
