import { describe, expect, it } from "vitest";
import { isDuplicateMessageBody } from "./duplicate-message";

describe("isDuplicateMessageBody", () => {
  it("blocks the same body twice in one turn", () => {
    const seen = new Set<string>();
    expect(isDuplicateMessageBody(seen, "Consultei o cadastro.")).toBe(false);
    expect(isDuplicateMessageBody(seen, "  consultei   o cadastro. ")).toBe(true);
  });

  it("allows different messages in the same turn", () => {
    const seen = new Set<string>();
    expect(isDuplicateMessageBody(seen, "Olá.")).toBe(false);
    expect(isDuplicateMessageBody(seen, "Posso ajudar?")).toBe(false);
  });
});
