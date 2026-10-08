export const CALL_LOOKUP_TOOLS = ["crm_call_lookup_client", "crm_call_lookup_company"] as const;

export type CallLookupToolName = (typeof CALL_LOOKUP_TOOLS)[number];
export type CallIntent =
  | "client_lookup"
  | "company_lookup"
  | "fare_quote"
  | "ride_status"
  | "ride_request"
  | "clarification"
  | "general";
export type CallConfidence = "high" | "medium" | "low";

export type CallActionToolName =
  | "crm_call_confirm_service"
  | "crm_call_request_reschedule";

export type RecentConversationMessage = {
  direction: "inbound" | "outbound";
  body: string;
};

export type CallIntentAnalysis = {
  intent: CallIntent;
  requiredTool: CallLookupToolName | null;
  confidence: CallConfidence;
  missingFields: string[];
  reason: string;
};

function normalize(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifica a intenção antes de decidir se uma consulta Call é obrigatória.
 * Termos genéricos como "corrida" e "consulta" nunca bastam para exigir
 * crm_call_lookup_client: o turno pode ser tarifa, estado operacional ou
 * simplesmente precisar de uma pergunta de esclarecimento.
 */
export function analyzeCallIntent(text: string | null | undefined): CallIntentAnalysis {
  const normalized = normalize(text);
  const missingFields: string[] = [];

  const asksFare =
    /\b(quanto fica|quanto custa|qual (?:e|é) o valor|preco|valor|tarifa|estimativa|estimado|custa|custaria|orcamento)\b/.test(
      normalized,
    );
  const hasOrigin = /\b(origem|saindo de|saindo da|partindo de|partindo da|\bde\b|\bda\b|\bdo\b)\b/.test(normalized);
  const hasDestination = /\b(destino|ate|para|chegando em|indo para)\b/.test(normalized);
  const asksStatus =
    /\b(quando sai|quando chega|a caminho|motorista|placa|eta|tempo de chegada|onde esta|onde está|localizacao|localização)\b/.test(
      normalized,
    );
  const asksClient =
    /\b(cadastro|cliente|meus dados|meu nome|meu telefone|historico|histórico|sou cadastrad[oa])\b/.test(
      normalized,
    );
  const asksCompany = /\b(empresa|centro de custo|cnpj|faturamento)\b/.test(normalized);
  const asksRide = /\b(pedir|solicitar|chamar|agendar)\b.*\b(taxi|táxi|corrida|carro)\b/.test(
    normalized,
  );

  // Intenções específicas têm precedência sobre a palavra genérica "corrida".
  if (asksFare) {
    if (!hasOrigin) missingFields.push("origem");
    if (!hasDestination) missingFields.push("destino");
    return {
      intent: "fare_quote",
      // A tarifa é escolhida pelo agente; não exigir lookup cadastral.
      requiredTool: null,
      confidence: missingFields.length === 0 ? "high" : "medium",
      missingFields,
      reason: "pedido de preço, tarifa ou estimativa",
    };
  }

  if (asksStatus) {
    return {
      intent: "ride_status",
      requiredTool: null,
      confidence: "high",
      missingFields: [],
      reason: "pedido de estado, previsão ou localização operacional",
    };
  }

  if (asksClient) {
    return {
      intent: "client_lookup",
      requiredTool: "crm_call_lookup_client",
      confidence: "high",
      missingFields: [],
      reason: "consulta explícita de cadastro ou dados do cliente",
    };
  }

  if (asksCompany) {
    return {
      intent: "company_lookup",
      requiredTool: "crm_call_lookup_company",
      confidence: "high",
      missingFields: [],
      reason: "consulta explícita de empresa, CNPJ ou centro de custo",
    };
  }

  if (asksRide) {
    return {
      intent: "ride_request",
      requiredTool: null,
      confidence: "medium",
      missingFields: [],
      reason: "pedido de criação ou agendamento de corrida",
    };
  }

  if (/\b(corrida|taxi|táxi|servico|serviço|consulta)\b/.test(normalized)) {
    return {
      intent: "clarification",
      requiredTool: null,
      confidence: "low",
      missingFields: ["objetivo da consulta"],
      reason: "mensagem contém contexto de táxi, mas não define a intenção",
    };
  }

  return {
    intent: "general",
    requiredTool: null,
    confidence: "high",
    missingFields: [],
    reason: "nenhuma dependência Call identificada",
  };
}

/** Compatibilidade com o runtime atual: só consultas explícitas exigem lookup cadastral. */
export function requiredCallLookupTool(text: string | null | undefined): CallLookupToolName | null {
  return analyzeCallIntent(text).requiredTool;
}

/**
 * Respostas curtas só são confirmação operacional quando respondem à pergunta
 * operacional imediatamente anterior. Isso evita que um "Sim" sobre promoção
 * seja consumido como confirmação de corrida — e impede uma resposta textual
 * de substituir a execução da ferramenta de escrita.
 */
export function requiredCallActionTool(
  currentInbound: string | null | undefined,
  messages: readonly RecentConversationMessage[],
): CallActionToolName | null {
  const normalized = normalize(currentInbound);
  if (!/^(sim|ok|isso|pode|confirmo|confirma|pode confirmar)$/.test(normalized)) return null;
  const previous = [...messages].reverse().find((message) => message.direction === "outbound");
  const question = normalize(previous?.body);
  if (!previous?.body.includes("?")) return null;
  if (question.includes("substitui") || question.includes("reagend")) {
    return "crm_call_request_reschedule";
  }
  if (question.includes("confirma") || question.includes("solicitacao") || question.includes("corrida")) {
    return "crm_call_confirm_service";
  }
  return null;
}
