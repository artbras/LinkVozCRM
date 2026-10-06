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
      "Consulta uma empresa e seus centros de custo pelo identificador do sistema da central, sem alterar nenhum dado.",
    oQueToca: "Empresas da central de táxi",
    risco: "seguro",
    pacotes: ["atender"],
  },
]);
