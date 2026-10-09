import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelarServico,
  consultarCliente,
  consultarEmpresa,
  criarServico,
  consultarServico,
  solicitarRetorno,
} from "./agent-client";

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

  it("consulta corrida enviando somente a acao e o ID e preserva o retorno completo", async () => {
    const corridaCompleta = {
      id: 9182,
      status: "EM_ANDAMENTO",
      nm_cliente: "Passageiro de teste",
      telefone: "21999999999",
      destino: "Aeroporto",
      dados_unidade: { unidade: "12", placa: "ABC1D23" },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: corridaCompleta }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await consultarServico({
      baseUrl: "http://call.test:3011",
      franchiseId: 1,
      serviceId: 9182,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://call.test:3011/internal/agent",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ acao: "servico", id: 9182 }),
      }),
    );
    expect(result).toEqual({ ok: true, data: corridaCompleta });
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

  it("expõe as escritas Call com payloads explícitos", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { id_servico: 88 } }), { status: 200 }),
      );

    await criarServico({
      baseUrl: "http://call.test:3011",
      franchiseId: 12,
      nomePassageiro: "Maria",
      telefone: "+55 (21) 99999-9999",
      endereco: "Rua das Flores",
      numero: "15",
      bairro: "Centro",
      cidade: "Niterói",
      destino: "Aeroporto",
    });
    await cancelarServico({ baseUrl: "http://call.test:3011", franchiseId: 12, serviceId: 88 });
    await solicitarRetorno({
      baseUrl: "http://call.test:3011",
      franchiseId: 12,
      serviceId: 88,
      message: "Retornar ao cliente",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://call.test:3011/internal/agent",
      expect.objectContaining({
        body: JSON.stringify({
          acao: "add_service",
          idf: 12,
          nome_passageiro: "Maria",
          telefone: "5521999999999",
          endereco: "Rua das Flores",
          numero: "15",
          bairro: "Centro",
          cidade: "Niterói",
          destino: "Aeroporto",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://call.test:3011/internal/agent",
      expect.objectContaining({
        body: JSON.stringify({ acao: "cancel_service", idf: 12, id_servico: 88 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://call.test:3011/internal/agent",
      expect.objectContaining({
        body: JSON.stringify({
          acao: "return_service",
          idf: 12,
          id_servico: 88,
          mensagem: "Retornar ao cliente",
        }),
      }),
    );
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
