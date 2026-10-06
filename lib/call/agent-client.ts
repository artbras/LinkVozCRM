import { logger } from "@/lib/logger";

export interface CallAgentConfig {
  baseUrl: string;
  franchiseId: number;
}

export interface CallApiSuccess<T> {
  ok: true;
  data: T;
}

export interface CallApiFailure {
  ok: false;
  code: string;
}

export type CallApiResult<T> = CallApiSuccess<T> | CallApiFailure;

const REQUEST_TIMEOUT_MS = 5_000;

function telefoneNormalizado(phone: string): string {
  return phone.replace(/\D/g, "");
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/internal/agent`;
}

async function postCall<T>(
  baseUrl: string,
  payload: Record<string, unknown>,
): Promise<CallApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as {
      success?: unknown;
      data?: T;
      error?: unknown;
    } | null;

    if (response.ok && body?.success === true && body.data !== undefined) {
      return { ok: true, data: body.data };
    }

    const code = typeof body?.error === "string" ? body.error : `HTTP_${response.status}`;
    return { ok: false, code };
  } catch (error) {
    logger.warn("falha ao consultar a API interna do Call", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return {
      ok: false,
      code:
        error instanceof DOMException && error.name === "AbortError" ? "TIMEOUT" : "UNAVAILABLE",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function consultarCliente(input: {
  baseUrl: string;
  franchiseId: number;
  phone: string;
}): Promise<CallApiResult<Record<string, unknown>>> {
  const phone = telefoneNormalizado(input.phone);
  if (!Number.isSafeInteger(input.franchiseId) || input.franchiseId <= 0)
    return { ok: false, code: "INVALID_FRANCHISE_ID" };
  if (phone.length < 10 || phone.length > 15) return { ok: false, code: "INVALID_PHONE" };
  return postCall<Record<string, unknown>>(input.baseUrl, {
    acao: "cliente",
    idf: input.franchiseId,
    telefone: phone,
  });
}

export async function consultarEmpresa(input: {
  baseUrl: string;
  franchiseId: number;
  companyId: number;
}): Promise<CallApiResult<Record<string, unknown>>> {
  if (!Number.isSafeInteger(input.franchiseId) || input.franchiseId <= 0)
    return { ok: false, code: "INVALID_FRANCHISE_ID" };
  if (!Number.isSafeInteger(input.companyId) || input.companyId <= 0)
    return { ok: false, code: "INVALID_COMPANY_ID" };
  return postCall<Record<string, unknown>>(input.baseUrl, {
    acao: "empresa",
    idf: input.franchiseId,
    empresa_id: input.companyId,
  });
}

export interface SolicitarServicoCallInput {
  baseUrl: string;
  franchiseId: number;
  nomePassageiro: string;
  telefone: string;
  endereco: string;
  numero?: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  telefoneRetorno?: string;
  destino?: string;
  alerta?: string;
  pagamento?: string;
  valorServico?: number;
  desconto?: number;
  exigencias?: string[];
  dataServico?: string;
  tempoChamada?: number;
  empresaId?: number;
  centroId?: number;
  clienteId?: number;
  latitude?: number;
  longitude?: number;
  documento?: string;
}

export async function criarServico(input: SolicitarServicoCallInput) {
  const phone = telefoneNormalizado(input.telefone);
  if (!Number.isSafeInteger(input.franchiseId) || input.franchiseId <= 0)
    return { ok: false as const, code: "INVALID_FRANCHISE_ID" };
  if (phone.length < 10 || phone.length > 15) return { ok: false as const, code: "INVALID_PHONE" };
  return postCall<Record<string, unknown>>(input.baseUrl, {
    acao: "add_service",
    idf: input.franchiseId,
    nome_passageiro: input.nomePassageiro,
    telefone: phone,
    ...(input.telefoneRetorno
      ? { telefone_retorno: telefoneNormalizado(input.telefoneRetorno) }
      : {}),
    endereco: input.endereco,
    ...(input.numero ? { numero: input.numero } : {}),
    ...(input.complemento ? { complemento: input.complemento } : {}),
    bairro: input.bairro,
    cidade: input.cidade,
    ...(input.destino ? { destino: input.destino } : {}),
    ...(input.alerta ? { alerta: input.alerta } : {}),
    ...(input.pagamento ? { pagamento: input.pagamento } : {}),
    ...(input.valorServico !== undefined ? { valor_servico: input.valorServico } : {}),
    ...(input.desconto !== undefined ? { desconto: input.desconto } : {}),
    ...(input.exigencias ? { exigencias: input.exigencias } : {}),
    ...(input.dataServico ? { data_servico: input.dataServico } : {}),
    ...(input.tempoChamada !== undefined ? { tempo_chamada: input.tempoChamada } : {}),
    ...(input.empresaId !== undefined ? { empresa_id: input.empresaId } : {}),
    ...(input.centroId !== undefined ? { centro_id: input.centroId } : {}),
    ...(input.clienteId !== undefined ? { cliente_id: input.clienteId } : {}),
    ...(input.latitude !== undefined ? { lat: input.latitude } : {}),
    ...(input.longitude !== undefined ? { lng: input.longitude } : {}),
    ...(input.documento ? { nr_documento: input.documento } : {}),
  });
}

export async function cancelarServico(input: {
  baseUrl: string;
  franchiseId: number;
  serviceId: number;
}) {
  if (!Number.isSafeInteger(input.franchiseId) || input.franchiseId <= 0)
    return { ok: false as const, code: "INVALID_FRANCHISE_ID" };
  if (!Number.isSafeInteger(input.serviceId) || input.serviceId <= 0)
    return { ok: false as const, code: "INVALID_SERVICE_ID" };
  return postCall<Record<string, unknown>>(input.baseUrl, {
    acao: "cancel_service",
    idf: input.franchiseId,
    id_servico: input.serviceId,
  });
}

export async function solicitarRetorno(input: {
  baseUrl: string;
  franchiseId: number;
  serviceId: number;
  message: string;
}) {
  if (!Number.isSafeInteger(input.franchiseId) || input.franchiseId <= 0)
    return { ok: false as const, code: "INVALID_FRANCHISE_ID" };
  if (!Number.isSafeInteger(input.serviceId) || input.serviceId <= 0)
    return { ok: false as const, code: "INVALID_SERVICE_ID" };
  return postCall<Record<string, unknown>>(input.baseUrl, {
    acao: "return_service",
    idf: input.franchiseId,
    id_servico: input.serviceId,
    mensagem: input.message,
  });
}
