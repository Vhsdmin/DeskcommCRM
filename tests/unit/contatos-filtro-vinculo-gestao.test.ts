/**
 * `?vinculo=gestao` LISTA SÓ QUEM É CLIENTE DO GESTÃO.
 *
 * O selo "Cliente VendePay" da conversa olha `gestao_account_id`, e a busca do
 * "Vincular a cliente do Gestão" tem de usar a mesma régua: filtrar pela origem
 * (`source=gestao`) deixava de fora o contato criado à mão e depois ligado ao
 * Gestão, e oferecia o que veio de lá e perdeu o vínculo. Anonimizado não é
 * alvo de vínculo.
 */
import { describe, expect, it } from "vitest";

import { listContactsHandler } from "@/app/api/v1/contacts/_handler";

const ORG = "11111111-1111-4111-8111-111111111111";

function supabaseEspiao() {
  const chamadas: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    contains: () => chain,
    or: () => chain,
    eq: (col: string, v: unknown) => {
      chamadas.push(`eq:${col}=${String(v)}`);
      return chain;
    },
    is: (col: string, v: unknown) => {
      chamadas.push(`is:${col}=${String(v)}`);
      return chain;
    },
    not: (col: string, op: string, v: unknown) => {
      chamadas.push(`not:${col}.${op}=${String(v)}`);
      return chain;
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
  };
  return { client: { from: () => chain } as never, chamadas };
}

async function filtros(extra: Record<string, unknown>): Promise<string[]> {
  const { client, chamadas } = supabaseEspiao();
  await listContactsHandler(
    client,
    { organization_id: ORG, actor: { type: "user", id: "u-1" }, requestId: "req" },
    { limit: 10, ...extra },
  );
  return chamadas;
}

describe("listagem de contatos — vínculo com o Gestão", () => {
  it("com vinculo=gestao exige gestao_account_id e descarta anonimizado", async () => {
    const f = await filtros({ vinculo: "gestao" });
    expect(f).toEqual(
      expect.arrayContaining(["not:gestao_account_id.is=null", "eq:is_anonymized=false"]),
    );
    expect(f).not.toContain("eq:source=gestao");
  });

  it("sem o parâmetro, a listagem segue como era", async () => {
    const f = await filtros({});
    expect(f.some((c) => c.includes("gestao_account_id"))).toBe(false);
    expect(f).not.toContain("eq:is_anonymized=false");
  });
});
