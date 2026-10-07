import { describe, expect, it } from "vitest";
import { analyzeCallIntent, requiredCallLookupTool } from "./call-verification";

describe("analyzeCallIntent", () => {
  it("requires client lookup for cadastro questions", () => {
    expect(analyzeCallIntent("Você consegue consultar se tenho cadastro?")).toMatchObject({
      intent: "client_lookup",
      requiredTool: "crm_call_lookup_client",
      confidence: "high",
    });
  });

  it("requires company lookup for company questions", () => {
    expect(analyzeCallIntent("Consulte a empresa pelo CNPJ")).toMatchObject({
      intent: "company_lookup",
      requiredTool: "crm_call_lookup_company",
      confidence: "high",
    });
  });

  it("does not force client lookup for fare questions", () => {
    expect(analyzeCallIntent("Quanto fica uma corrida da Tijuca até Botafogo?")).toMatchObject({
      intent: "fare_quote",
      requiredTool: null,
      confidence: "high",
    });
  });

  it("does not force client lookup for operational status questions", () => {
    expect(analyzeCallIntent("Quando sai a corrida da Rua A até a Rua B?")).toMatchObject({
      intent: "ride_status",
      requiredTool: null,
      confidence: "high",
    });
  });

  it("leaves ambiguous requests available for clarification", () => {
    expect(analyzeCallIntent("Quero saber sobre a corrida")).toMatchObject({
      intent: "clarification",
      requiredTool: null,
      confidence: "low",
    });
  });

  it("requires fields before forcing a fare tool", () => {
    expect(analyzeCallIntent("Quanto fica uma corrida saindo da Tijuca?")).toMatchObject({
      intent: "fare_quote",
      requiredTool: null,
      confidence: "medium",
      missingFields: ["destino"],
    });
  });
});

describe("requiredCallLookupTool", () => {
  it("keeps the legacy client lookup contract", () => {
    expect(requiredCallLookupTool("Você consegue consultar se tenho cadastro?")).toBe(
      "crm_call_lookup_client",
    );
  });

  it("does not force Call for ordinary conversation", () => {
    expect(requiredCallLookupTool("Olá, tudo bem?")).toBeNull();
  });
});
