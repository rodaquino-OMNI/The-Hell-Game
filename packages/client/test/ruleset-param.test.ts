// `?ruleset=` só com `?debug=1` (como os ganchos da D-33): sem depuração o cliente usa o padrão dos dados (v1 desde o
// marco MJ-B); as ferramentas de teste e captura (tools/visual, tools/a11y, tools/audio) abrem com os dois parâmetros.
import { describe, expect, it } from "vitest";
import { balance, cfg, rulesetOverride } from "../src/data.ts";

describe("rulesetOverride (packages/client/src/data.ts)", () => {
  it("sem debug=1 o parâmetro é ignorado", () => {
    expect(rulesetOverride("?ruleset=prototype")).toBeUndefined();
    expect(rulesetOverride("?ruleset=v1")).toBeUndefined();
    expect(rulesetOverride("?debug=0&ruleset=prototype")).toBeUndefined();
    expect(rulesetOverride("?debug=1&ruleset=prototype", false)).toBeUndefined();
  });
  it("com debug=1 o parâmetro é aplicado; valor desconhecido ou ausente = padrão dos dados", () => {
    expect(rulesetOverride("?debug=1&ruleset=prototype")).toBe("prototype");
    expect(rulesetOverride("?ruleset=v1&debug=1")).toBe("v1");
    expect(rulesetOverride("?ruleset=prototype", true)).toBe("prototype");
    expect(rulesetOverride("?debug=1&ruleset=qualquer")).toBeUndefined();
    expect(rulesetOverride("?debug=1")).toBeUndefined();
  });
  it("fora do navegador vale o padrão dos dados", () => {
    expect(cfg.v1).toBe(balance.ruleset === "v1");
  });
});
