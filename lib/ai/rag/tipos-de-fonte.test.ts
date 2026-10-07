import { describe, expect, it } from "vitest";
import { canonizarTipoDeFonte, TIPO_DE_FONTE_POR_ID } from "./tipos-de-fonte";

describe("tipo de material Promoções", () => {
  it("é oferecido e canonizado como tipo próprio", () => {
    expect(TIPO_DE_FONTE_POR_ID.get("promocoes")?.rotulo).toBe("Promoções");
    expect(canonizarTipoDeFonte("promocoes")).toBe("promocoes");
  });
});
