import { describe, expect, it } from "vitest";

import {
  assinar,
  assinaturaConfere,
  camposDoCliente,
  eventoDoGestaoSchema,
} from "@/lib/gestao/contrato";

const SEGREDO = "a".repeat(64);
const EVENTO = {
  event_id: "evt_1",
  event_type: "account.created",
  occurred_at: "2026-10-14T12:00:00Z",
  account: { id: "conta-1", name: "Loja Exemplo", email: "contato@exemplo.com", phone: "(11) 99999-8888" },
};

describe("assinatura do webhook do Gestão", () => {
  const corpo = JSON.stringify(EVENTO);

  it("aceita o HMAC SHA-256 do corpo cru, com ou sem o prefixo sha256=", () => {
    const hex = assinar(corpo, SEGREDO);
    expect(assinaturaConfere(corpo, hex, SEGREDO)).toBe(true);
    expect(assinaturaConfere(corpo, `sha256=${hex}`, SEGREDO)).toBe(true);
    expect(assinaturaConfere(corpo, hex.toUpperCase(), SEGREDO)).toBe(true);
  });

  it("recusa sem cabeçalho, com segredo errado ou corpo alterado", () => {
    const hex = assinar(corpo, SEGREDO);
    expect(assinaturaConfere(corpo, null, SEGREDO)).toBe(false);
    expect(assinaturaConfere(corpo, assinar(corpo, "b".repeat(64)), SEGREDO)).toBe(false);
    expect(assinaturaConfere(`${corpo} `, hex, SEGREDO)).toBe(false);
    expect(assinaturaConfere(corpo, "abc", SEGREDO)).toBe(false);
  });
});

describe("contrato do evento", () => {
  it("aceita os dois tipos de conta e normaliza o telefone brasileiro", () => {
    const parsed = eventoDoGestaoSchema.parse(EVENTO);
    expect(camposDoCliente(parsed)).toEqual({
      name: "Loja Exemplo",
      email: "contato@exemplo.com",
      phone_number: "+5511999998888",
      telefoneRecusado: false,
    });
    expect(eventoDoGestaoSchema.safeParse({ ...EVENTO, event_type: "account.updated" }).success).toBe(true);
  });

  it("e-mail e telefone são opcionais; vazio vira ausência", () => {
    const parsed = eventoDoGestaoSchema.parse({
      ...EVENTO,
      account: { id: "conta-1", name: "Sem contato", email: "", phone: null },
    });
    expect(camposDoCliente(parsed)).toMatchObject({ email: null, phone_number: null, telefoneRecusado: false });
  });

  it("telefone que não normaliza é ignorado e sinalizado, sem derrubar o evento", () => {
    const parsed = eventoDoGestaoSchema.parse({ ...EVENTO, account: { ...EVENTO.account, phone: "123" } });
    expect(camposDoCliente(parsed)).toMatchObject({ phone_number: null, telefoneRecusado: true });
  });

  it("recusa tipo desconhecido, conta sem id, e-mail inválido e data sem fuso", () => {
    expect(eventoDoGestaoSchema.safeParse({ ...EVENTO, event_type: "sale.created" }).success).toBe(false);
    expect(eventoDoGestaoSchema.safeParse({ ...EVENTO, account: { ...EVENTO.account, id: " " } }).success).toBe(false);
    expect(
      eventoDoGestaoSchema.safeParse({ ...EVENTO, account: { ...EVENTO.account, email: "sem-arroba" } }).success,
    ).toBe(false);
    expect(eventoDoGestaoSchema.safeParse({ ...EVENTO, occurred_at: "2026-10-14 12:00" }).success).toBe(false);
  });
});
