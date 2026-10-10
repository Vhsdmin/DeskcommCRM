import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/types";
import { mensagemDeConfiguracaoDaAgenda } from "./erro-de-horarios";
describe("aviso de configuração da agenda", () => {
  it("mostra orientação de configuração recebida do servidor", () => {
    expect(
      mensagemDeConfiguracaoDaAgenda(
        new ApiError(
          422,
          "validation_failed",
          undefined,
          "req",
          "Configure em Equipe → Atendimento.",
        ),
      ),
    ).toBe("Configure em Equipe → Atendimento.");
  });
  it("não expõe falha interna do banco ou rede", () => {
    expect(
      mensagemDeConfiguracaoDaAgenda(
        new ApiError(500, "internal_error", undefined, "req", "SQL interno"),
      ),
    ).toBeUndefined();
    expect(mensagemDeConfiguracaoDaAgenda(new Error("rede"))).toBeUndefined();
  });
});
