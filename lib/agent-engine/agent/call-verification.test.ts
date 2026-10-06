import { describe, expect, it } from "vitest";
import { requiredCallLookupTool } from "./call-verification";

describe("requiredCallLookupTool", () => {
  it("requires client lookup for cadastro questions", () => {
    expect(requiredCallLookupTool("Você consegue consultar se tenho cadastro?")).toBe(
      "crm_call_lookup_client",
    );
  });

  it("requires company lookup for company questions", () => {
    expect(requiredCallLookupTool("Consulte a empresa pelo CNPJ")).toBe("crm_call_lookup_company");
  });

  it("does not force Call for ordinary conversation", () => {
    expect(requiredCallLookupTool("Olá, tudo bem?")).toBeNull();
  });
});
