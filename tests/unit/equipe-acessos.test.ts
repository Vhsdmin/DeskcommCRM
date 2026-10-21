import { describe, expect, it } from "vitest";
import {
  acessosValidos,
  cadastroUsuarioSchema,
  podeAcessarRota,
  CONVITES_DE_EQUIPE_ATIVOS,
} from "@/lib/auth/acessos";
describe("acessos por área", () => {
  it("mantém convites em standby", () => expect(CONVITES_DE_EQUIPE_ATIVOS).toBe(false));
  it("distingue submódulos e recusa rotas não classificadas", () => {
    const acessos = ["/app/tasks"];
    expect(podeAcessarRota(acessos, "agent", "/app/tasks")).toBe(true);
    expect(podeAcessarRota(acessos, "agent", "/api/v1/tasks/123")).toBe(true);
    expect(podeAcessarRota(acessos, "agent", "/app/contacts")).toBe(false);
    expect(podeAcessarRota(acessos, "agent", "/api/v1/contacts")).toBe(false);
    expect(podeAcessarRota(acessos, "agent", "/api/v1/tasks-privilegiadas")).toBe(false);
    expect(podeAcessarRota(acessos, "agent", "/app/area-futura")).toBe(false);
  });
  it("não confunde prefixos de submódulos de IA", () => {
    expect(podeAcessarRota(["/app/ai/agents"], "manager", "/api/v1/ai/credentials")).toBe(false);
    expect(podeAcessarRota(["/app/ai/agents"], "manager", "/api/v1/ai/agents/123")).toBe(true);
  });
  it("mantém áreas pessoais, os legados e o administrador", () => {
    expect(podeAcessarRota([], "agent", "/app/settings/security")).toBe(true);
    expect(podeAcessarRota([], "agent", "/api/v1/auth/interface")).toBe(true);
    expect(podeAcessarRota(null, "agent", "/app/contacts")).toBe(true);
    expect(podeAcessarRota([], "admin", "/app/team")).toBe(true);
  });
  it("não permite escolher área acima do papel", () => {
    expect(acessosValidos(["/app/settings/api-tokens"], "agent")).toBe(false);
    expect(acessosValidos(["/app/tasks"], "agent")).toBe(true);
  });
  it("valida senha e rejeita parâmetros de tenant e plataforma", () => {
    const input = {
      nome: "Teste QA",
      email: "qa@example.test",
      senha: "UmaSenhaInicial123!",
      role: "agent",
      acessos: ["/app/tasks"],
    };
    expect(cadastroUsuarioSchema.safeParse(input).success).toBe(true);
    expect(cadastroUsuarioSchema.safeParse({ ...input, senha: "curta" }).success).toBe(false);
    expect(cadastroUsuarioSchema.safeParse({ ...input, organization_id: "outro" }).success).toBe(
      false,
    );
    expect(cadastroUsuarioSchema.safeParse({ ...input, is_platform_admin: true }).success).toBe(
      false,
    );
  });
});

it("não oferece o passo de convite no onboarding com o recurso desligado", async () => {
  const { passosVisiveis } = await import("@/lib/onboarding/passos");
  expect(passosVisiveis({ lojaLigada: false }).some((p) => p.segmento === "invite-team")).toBe(
    false,
  );
});


it("permite a dependência de equipe da carteira sem liberar a administração de usuários", () => {
  expect(podeAcessarRota(["/app/carteira"], "manager", "/api/v1/team")).toBe(true);
  expect(podeAcessarRota(["/app/carteira"], "manager", "/api/v1/team/users")).toBe(false);
});
