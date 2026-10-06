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
    name: "crm_call_create_service",
    category: "write",
    rotulo: "Criar solicitação de corrida",
    explicacao:
      "Cria uma corrida e pode criar ou atualizar cadastro e endereço do passageiro no sistema operacional.",
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
]);
