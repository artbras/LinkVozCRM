import { z } from "zod";

import { env } from "@/lib/env";
import { tarifaConfigSchema, consultarTarifa } from "@/lib/tarifa/consulta";
import type { McpToolDefinition } from "../types";

const shape = {
  origem: z
    .string()
    .trim()
    .min(5)
    .max(250)
    .describe("Endereço completo de origem, preferencialmente com cidade e estado."),
  destino: z
    .string()
    .trim()
    .min(5)
    .max(250)
    .describe("Endereço completo de destino, preferencialmente com cidade e estado."),
  data_hora: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe("Data e hora pretendidas em ISO 8601; se omitidas, usa o momento atual."),
  tipo_veiculo: z.string().trim().max(50).optional(),
  bagagem: z.boolean().optional(),
  aeroporto: z.boolean().optional(),
  pedagio: z.number().nonnegative().optional(),
  retorno: z.boolean().optional(),
  outros: z.number().nonnegative().optional(),
  tempo_parada_minutos: z.number().nonnegative().max(1440).optional(),
  regiao: z.string().trim().max(80).optional(),
};

export const crmConsultaTarifa: McpToolDefinition<typeof shape> = {
  name: "crm_consulta_tarifa",
  description:
    "Consulta preço estimado de corrida por origem e destino. Use somente para intenções de preço, tarifa, valor ou quanto custa uma corrida. " +
    "Geocodifica os endereços, calcula a rota de carro no OpenRouteService, aplica a tabela tarifária configurada no ambiente do agente, " +
    "seleciona a bandeira e soma adicionais. Nunca invente preço: se geocoding, rota, API ou tabela não estiverem disponíveis, informe o erro de forma segura. " +
    "O resultado é uma estimativa e não preço final cobrado.",
  inputSchema: shape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: (args) => ({ ...args, origem: "[redacted]", destino: "[redacted]" }),
  motivoDoVazio: (resultado) => {
    if (!resultado || typeof resultado !== "object") return null;
    const value = resultado as { erro?: string };
    return value.erro ?? null;
  },
  handler: async (input, ctx) => {
    if (!env.OPENROUTESERVICE_API_KEY)
      return {
        erro: "tarifa_nao_configurada",
        mensagem: "a consulta de tarifa ainda não foi configurada pelo administrador.",
      };
    const actorAgentId =
      typeof ctx.actor === "object" &&
      "agent_id" in ctx.actor &&
      typeof ctx.actor.agent_id === "string"
        ? ctx.actor.agent_id
        : ctx.actor.id;
    const { data, error } = await ctx.supabase
      .from("ai_agents")
      .select("config")
      .eq("id", actorAgentId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (error || !data)
      return {
        erro: "configuracao_tarifa_indisponivel",
        mensagem: "não consegui carregar a tabela tarifária deste agente.",
      };
    const raw =
      data.config && typeof data.config === "object"
        ? (data.config as Record<string, unknown>).tarifa
        : null;
    const parsed = tarifaConfigSchema.safeParse(raw);
    if (!parsed.success)
      return {
        erro: "tabela_tarifaria_invalida",
        mensagem: "a tabela tarifária deste agente está incompleta ou inválida.",
      };
    return consultarTarifa({
      ...input,
      config: parsed.data,
      orsApiKey: env.OPENROUTESERVICE_API_KEY,
    });
  },
};
