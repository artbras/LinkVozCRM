export const CALL_LOOKUP_TOOLS = ["crm_call_lookup_client", "crm_call_lookup_company"] as const;

export type CallLookupToolName = (typeof CALL_LOOKUP_TOOLS)[number];

/**
 * Detecta pedidos em que uma resposta factual depende do sistema Call.
 * O detector é conservador de propósito: na dúvida, exige consulta em vez de
 * permitir que o modelo transforme contexto incompleto em fato.
 */
export function requiredCallLookupTool(text: string | null | undefined): CallLookupToolName | null {
  const normalized = (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const asksAboutClient =
    /\b(cadastro|cliente|meus dados|meu nome|meu telefone|historico|corrida|solicitacao|sou cadastrad[oa])\b/.test(
      normalized,
    ) || /\b(consultar|consulta|verificar|confirma|confirmar|localiza|encontra)\b/.test(normalized);

  if (asksAboutClient) return "crm_call_lookup_client";

  if (/\b(empresa|centro de custo|cnpj)\b/.test(normalized)) {
    return "crm_call_lookup_company";
  }

  return null;
}
