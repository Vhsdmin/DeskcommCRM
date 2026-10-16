import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PLAYBOOK_SUGERIDO, TIPOS_COM_PLAYBOOK, novaChave, playbookSchema } from "@/lib/cs/playbooks";

const passo = {
  chave: "whatsapp",
  titulo: "Contato pelo WhatsApp",
  descricao: "",
  dias: 0,
  prioridade: "medium",
  severidade_minima: "media",
  responsavel_user_id: null,
};

describe("playbooks de CS", () => {
  it("os tipos com playbook são exatamente os do CHECK da migration 0275", () => {
    const sql = readFileSync("supabase/migrations/20261017120000_0275_playbooks_de_cs.sql", "utf8");
    const inicio = sql.indexOf("constraint cs_playbooks_tipo_check");
    const bloco = sql.slice(inicio, sql.indexOf("),", inicio));
    const doBanco = [...bloco.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(doBanco.sort()).toEqual([...TIPOS_COM_PLAYBOOK].sort());
    expect(TIPOS_COM_PLAYBOOK).not.toContain("tarefa_vencida");
  });

  it("toda sugestão passa na mesma validação da rota", () => {
    for (const tipo of TIPOS_COM_PLAYBOOK) {
      expect(playbookSchema.safeParse({ ativo: true, passos: PLAYBOOK_SUGERIDO[tipo] }).success, tipo).toBe(true);
    }
  });

  it("sem vender sobe em escada: média, alta, crítica", () => {
    expect(PLAYBOOK_SUGERIDO.sem_venda.map((p) => p.severidade_minima)).toEqual(["media", "alta", "critica"]);
  });

  it("descrição vazia vira ausência; prazo fora de 0–90 e chave repetida são recusados", () => {
    const ok = playbookSchema.parse({ ativo: true, passos: [passo] });
    expect(ok.passos[0]?.descricao).toBeNull();
    expect(playbookSchema.safeParse({ ativo: true, passos: [{ ...passo, dias: 91 }] }).success).toBe(false);
    expect(playbookSchema.safeParse({ ativo: true, passos: [{ ...passo, titulo: " " }] }).success).toBe(false);
    expect(playbookSchema.safeParse({ ativo: true, passos: [passo, { ...passo }] }).success).toBe(false);
    expect(playbookSchema.safeParse({ ativo: true, passos: Array.from({ length: 11 }, (_, i) => ({ ...passo, chave: `p${i}` })) }).success).toBe(false);
  });

  it("chave nova é válida e não se repete", () => {
    const chaves = new Set(Array.from({ length: 50 }, () => novaChave()));
    expect(chaves.size).toBe(50);
    for (const chave of chaves) expect(chave).toMatch(/^[a-z0-9_-]{1,40}$/);
  });
});
