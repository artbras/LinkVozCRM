import { describe, expect, it } from "vitest";

import { cidadePadraoDoConfig } from "./call";

describe("cidade padrão do atendimento Call", () => {
  it("usa a cidade da configuração tarifária quando o endereço não informa cidade", () => {
    expect(cidadePadraoDoConfig({ tarifa: { cidade: "Rio de Janeiro" } })).toBe("Rio de Janeiro");
  });

  it("não inventa cidade quando a configuração não possui cidade válida", () => {
    expect(cidadePadraoDoConfig({ tarifa: { cidade: "" } })).toBeNull();
    expect(cidadePadraoDoConfig({})).toBeNull();
  });
});
