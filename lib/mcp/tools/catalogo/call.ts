import { declararTools } from "./tipos";

export const TOOLS_CALL = declararTools([
  {
    name: "crm_call_lookup_client",
    category: "read",
    rotulo: "Consultar cliente da central de táxi",
    explicacao:
      "Consulta o cadastro e o histórico de solicitações pelo telefone no sistema operacional da central, sem alterar nenhum dado.",
    oQueToca: "Cadastro da central de táxi",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_lookup_company",
    category: "read",
    rotulo: "Consultar empresa da central de táxi",
    explicacao:
      "Consulta uma empresa e seus centros de custo pelo identificador da central, sem alterar dados operacionais.",
    oQueToca: "Empresas da central de táxi",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_lookup_service",
    category: "read",
    rotulo: "Consultar corrida da central de táxi",
    explicacao:
      "Consulta status, motorista, veículo, placa e localização disponíveis de uma corrida.",
    oQueToca: "Acompanhamento de corridas",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_lookup_operational_events",
    category: "read",
    rotulo: "Consultar eventos operacionais da corrida",
    explicacao:
      "Consulta eventos do webhook do Call, incluindo mensagem original e ETA normalizado.",
    oQueToca: "Acompanhamento operacional",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_lookup_operational_state",
    category: "read",
    rotulo: "Consultar estado operacional da corrida",
    explicacao:
      "Consulta o último estado normalizado, ETA, dados do veículo e exceções registradas para uma corrida.",
    oQueToca: "Estado e exceções de corridas",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_prepare_service",
    category: "write",
    rotulo: "Preparar solicitação de corrida",
    explicacao: "Guarda os dados coletados e produz o resumo antes da confirmação do passageiro.",
    oQueToca: "Coleta estruturada de corrida",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_confirm_service",
    category: "write",
    rotulo: "Confirmar criação da corrida",
    explicacao: "Cria a corrida somente a partir de um rascunho que aguarda confirmação explícita.",
    oQueToca: "Criação de corridas",
    risco: "critico",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_create_service",
    category: "write",
    rotulo: "Criar solicitação de corrida",
    explicacao: "Compatibilidade legada; novos atendimentos devem usar preparar e confirmar.",
    oQueToca: "Corridas e cadastro da central",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_cancel_service",
    category: "write",
    rotulo: "Cancelar solicitação de corrida",
    explicacao:
      "Cancela uma solicitação existente e libera a operação; a alteração não deve ser feita sem pedido explícito.",
    oQueToca: "Corridas da central de táxi",
    risco: "critico",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_request_return",
    category: "write",
    rotulo: "Solicitar retorno sobre corrida",
    explicacao:
      "Registra uma mensagem de retorno para a equipe ou unidade vinculada à solicitação de corrida.",
    oQueToca: "Retornos operacionais da central",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_call_request_reschedule",
    category: "write",
    rotulo: "Solicitar reagendamento de corrida",
    explicacao:
      "Encaminha data, horário, origem ou destino novos para a central; não afirma alteração automática.",
    oQueToca: "Reagendamento de corridas",
    risco: "critico",
    pacotes: ["atender"],
  },
  {
    name: "crm_consulta_tarifa",
    category: "read",
    rotulo: "Consultar preço estimado da corrida",
    explicacao:
      "Calcula uma estimativa a partir da origem, destino, rota, bandeira e adicionais configurados pelo administrador.",
    oQueToca: "Tarifas e estimativas de corridas",
    risco: "seguro",
    pacotes: ["atender"],
  },
]);
