import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  TOLERANCIA_DA_ASSINATURA_SEGUNDOS,
  assinar,
  assinaturaConfere,
  camposDoCliente,
  eventoDoGestaoSchema,
} from "@/lib/gestao/contrato";

const SEGREDO = "Zx8kQ2mV7pL1nR4tY6wB9cD3fG5hJ0aE-sU_iO8qW2e"; // formato do core: 32 bytes em base64url
const AGORA = 1_795_000_000;

// O corpo exatamente como o core monta (`CrmUserUpdatedV1Schema`), com os blocos que o CRM ignora.
const EVENTO = {
  id: "crm:evt_1",
  type: "crm.user.updated",
  apiVersion: "2026-06-01",
  createdAt: "2026-11-17T12:00:00.000Z",
  data: {
    asOf: "2026-11-17T12:00:05.000Z",
    user: { id: "user-1", name: "Loja Exemplo", email: "contato@exemplo.com", phone: "(11) 99999-8888" },
    onboarding: {
      badge: "in_review",
      steps: { profile: "done", identity: "in_review", bank: "pending" },
      operations: { sales: "blocked", payouts: "blocked" },
      blockedBy: { sales: "stripe", payouts: "seller" },
      nextStep: { owner: "stripe", code: "wait_review" },
    },
    verification: { kycStatus: "pending_verification", observedAt: null, currentDeadline: null },
  },
};

/** Assinatura calculada como `signWebhook` do core, sem passar pelo código do CRM. */
function assinaturaDoCore(corpo: string, segredo: string, t: number): string {
  return `t=${t},v1=${createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex")}`;
}

describe("assinatura do webhook do core", () => {
  const corpo = JSON.stringify(EVENTO);

  it("aceita a assinatura t=,v1= que o core gera", () => {
    expect(assinaturaConfere(corpo, assinaturaDoCore(corpo, SEGREDO, AGORA), SEGREDO, AGORA)).toBe(true);
    expect(assinar(corpo, SEGREDO, AGORA)).toBe(assinaturaDoCore(corpo, SEGREDO, AGORA));
  });

  it("aceita dentro da janela e recusa fora dela", () => {
    const t = AGORA - TOLERANCIA_DA_ASSINATURA_SEGUNDOS;
    expect(assinaturaConfere(corpo, assinaturaDoCore(corpo, SEGREDO, t), SEGREDO, AGORA)).toBe(true);
    expect(assinaturaConfere(corpo, assinaturaDoCore(corpo, SEGREDO, t - 1), SEGREDO, AGORA)).toBe(false);
    const futuro = AGORA + TOLERANCIA_DA_ASSINATURA_SEGUNDOS + 1;
    expect(assinaturaConfere(corpo, assinaturaDoCore(corpo, SEGREDO, futuro), SEGREDO, AGORA)).toBe(false);
  });

  it("aceita se qualquer v1 bater (troca de segredo com duas assinaturas)", () => {
    const boa = assinaturaDoCore(corpo, SEGREDO, AGORA).split(",")[1];
    expect(assinaturaConfere(corpo, `t=${AGORA},v1=${"0".repeat(64)},${boa}`, SEGREDO, AGORA)).toBe(true);
  });

  it("recusa sem cabeçalho, sem t, segredo errado, corpo alterado ou t trocado", () => {
    const certa = assinaturaDoCore(corpo, SEGREDO, AGORA);
    expect(assinaturaConfere(corpo, null, SEGREDO, AGORA)).toBe(false);
    expect(assinaturaConfere(corpo, assinaturaDoCore(corpo, "", AGORA), "", AGORA)).toBe(false);
    expect(assinaturaConfere(corpo, `t=${AGORA},v1=abc`, SEGREDO, AGORA)).toBe(false);
    expect(assinaturaConfere(corpo, certa.split(",")[1] ?? null, SEGREDO, AGORA)).toBe(false);
    expect(assinaturaConfere(corpo, assinaturaDoCore(corpo, "outro-segredo", AGORA), SEGREDO, AGORA)).toBe(false);
    expect(assinaturaConfere(`${corpo} `, certa, SEGREDO, AGORA)).toBe(false);
    expect(assinaturaConfere(corpo, certa.replace(`t=${AGORA}`, `t=${AGORA - 1}`), SEGREDO, AGORA)).toBe(false);
    // O formato antigo (hex do corpo, sem t) não vale mais.
    const hexAntigo = createHmac("sha256", SEGREDO).update(corpo).digest("hex");
    expect(assinaturaConfere(corpo, `sha256=${hexAntigo}`, SEGREDO, AGORA)).toBe(false);
  });
});

describe("contrato do evento", () => {
  it("aceita o corpo do core, ignora onboarding/KYC e normaliza o telefone", () => {
    const parsed = eventoDoGestaoSchema.parse(EVENTO);
    expect(parsed.data).not.toHaveProperty("onboarding");
    expect(camposDoCliente(parsed)).toEqual({
      name: "Loja Exemplo",
      email: "contato@exemplo.com",
      phone_number: "+5511999998888",
      telefoneRecusado: false,
    });
  });

  it("sem nome, o e-mail vira o nome", () => {
    for (const name of [null, "", "   "]) {
      const parsed = eventoDoGestaoSchema.parse({ ...EVENTO, data: { ...EVENTO.data, user: { ...EVENTO.data.user, name } } });
      expect(camposDoCliente(parsed).name).toBe("contato@exemplo.com");
    }
  });

  it("nome longo é cortado, não recusa o envio", () => {
    const parsed = eventoDoGestaoSchema.parse({
      ...EVENTO,
      data: { ...EVENTO.data, user: { ...EVENTO.data.user, name: "x".repeat(1000) } },
    });
    expect(camposDoCliente(parsed).name).toHaveLength(200);
  });

  it("telefone ausente vira ausência; o que não normaliza é ignorado e sinalizado", () => {
    const comTelefone = (phone: string | null) =>
      camposDoCliente(eventoDoGestaoSchema.parse({ ...EVENTO, data: { ...EVENTO.data, user: { ...EVENTO.data.user, phone } } }));
    expect(comTelefone(null)).toMatchObject({ phone_number: null, telefoneRecusado: false });
    expect(comTelefone("123")).toMatchObject({ phone_number: null, telefoneRecusado: true });
  });

  it("recusa o contrato antigo, outro tipo ou versão, usuário sem id, e-mail inválido e data sem fuso", () => {
    const comUser = (user: object) => ({ ...EVENTO, data: { ...EVENTO.data, user: { ...EVENTO.data.user, ...user } } });
    expect(
      eventoDoGestaoSchema.safeParse({
        event_id: "evt_1",
        event_type: "account.created",
        occurred_at: "2026-10-14T12:00:00Z",
        account: { id: "conta-1", name: "Loja" },
      }).success,
    ).toBe(false);
    expect(eventoDoGestaoSchema.safeParse({ ...EVENTO, type: "crm.user.deleted" }).success).toBe(false);
    expect(eventoDoGestaoSchema.safeParse({ ...EVENTO, apiVersion: "2027-01-01" }).success).toBe(false);
    expect(eventoDoGestaoSchema.safeParse(comUser({ id: " " })).success).toBe(false);
    expect(eventoDoGestaoSchema.safeParse(comUser({ email: "sem-arroba" })).success).toBe(false);
    expect(eventoDoGestaoSchema.safeParse({ ...EVENTO, data: { ...EVENTO.data, asOf: "2026-11-17 12:00" } }).success).toBe(
      false,
    );
  });
});
