// @vitest-environment node
import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/v1/webhooks/gestao/[token] — a ordem dos controles da fronteira:
 * sem segredo colado ou sem assinatura válida responde 503 (o core tenta de novo,
 * o que cobre a troca de segredo) e nada é gravado nem processado.
 */

const { processar, inserts, updates } = vi.hoisted(() => ({
  processar: vi.fn(),
  inserts: [] as Array<{ tabela: string; valores: unknown }>,
  updates: [] as Array<{ tabela: string; valores: unknown }>,
}));
const estado = vi.hoisted(() => ({
  conexao: null as Record<string, unknown> | null,
  // Simula o `event_id` já reservado por outro registro (23505) e esse registro.
  original: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: vi.fn(async (_a: unknown, v: string) => v) }));
vi.mock("@/lib/gestao/processar-evento", () => ({ processarEventoDoGestao: processar }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const cadeia: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) cadeia[m] = () => cadeia;
      cadeia.update = (valores: unknown) => {
        updates.push({ tabela, valores });
        return cadeia;
      };
      cadeia.maybeSingle = async () => ({
        data: tabela === "gestao_conexoes" ? estado.conexao : estado.original,
        error: null,
      });
      cadeia.insert = (valores: unknown) => {
        inserts.push({ tabela, valores });
        return cadeia;
      };
      cadeia.single = async () =>
        estado.original
          ? { data: null, error: { code: "23505", message: "uniq_webhook_events_gestao_event" } }
          : { data: { id: "log-1" }, error: null };
      cadeia.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return cadeia;
    },
  }),
}));

import { audit } from "@/lib/audit";
import { POST } from "@/app/api/v1/webhooks/gestao/[token]/route";

const TOKEN = "t".repeat(32);
const SEGREDO = "Zx8kQ2mV7pL1nR4tY6wB9cD3fG5hJ0aE-sU_iO8qW2e";
const CORPO = JSON.stringify({
  id: "crm:evt_1",
  type: "crm.user.updated",
  apiVersion: "2026-06-01",
  createdAt: "2026-11-17T12:00:00.000Z",
  data: { asOf: "2026-11-17T12:00:05.000Z", user: { id: "user-1", name: null, email: "a@b.com", phone: null } },
});

function assinaturaDoCore(segredo: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", segredo).update(`${t}.${CORPO}`).digest("hex")}`;
}

function enviar(assinatura: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (assinatura) headers["vendepay-signature"] = assinatura;
  const req = new NextRequest(`http://crm.test/api/v1/webhooks/gestao/${TOKEN}`, { method: "POST", body: CORPO, headers });
  return POST(req, { params: Promise.resolve({ token: TOKEN }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  updates.length = 0;
  estado.original = null;
  estado.conexao = { id: "c1", organization_id: "org-1", secret_encrypted: SEGREDO, is_active: true };
});

describe("POST /api/v1/webhooks/gestao/[token]", () => {
  it("sem segredo colado: 503 com Retry-After, sem gravar nem processar", async () => {
    estado.conexao = { ...estado.conexao, secret_encrypted: null };
    const res = await enviar(assinaturaDoCore(SEGREDO));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("300");
    expect(inserts).toEqual([]);
    expect(processar).not.toHaveBeenCalled();
  });

  it("assinatura de outro segredo (troca em andamento), fora da janela ou ausente: 503 sem gravar nem processar", async () => {
    for (const assinatura of [
      assinaturaDoCore("outro-segredo"),
      assinaturaDoCore(SEGREDO, Math.floor(Date.now() / 1000) - 3600),
      null,
    ]) {
      const res = await enviar(assinatura);
      expect(res.status).toBe(503);
    }
    expect(inserts).toEqual([]);
    expect(processar).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(3);
  });

  it("conexão pausada: 404", async () => {
    estado.conexao = { ...estado.conexao, is_active: false };
    expect((await enviar(assinaturaDoCore(SEGREDO))).status).toBe(404);
    expect(processar).not.toHaveBeenCalled();
  });

  it("mesmo id ainda em processamento: 503; preso há mais de 2 minutos, libera o id", async () => {
    estado.original = { id: "log-0", status: "received", received_at: new Date().toISOString() };
    expect((await enviar(assinaturaDoCore(SEGREDO))).status).toBe(503);
    expect(updates.filter((u) => u.tabela === "webhook_events_log")).toEqual([]);

    estado.original = { id: "log-0", status: "received", received_at: new Date(Date.now() - 180_000).toISOString() };
    expect((await enviar(assinaturaDoCore(SEGREDO))).status).toBe(503);
    expect(updates).toContainEqual({
      tabela: "webhook_events_log",
      valores: { status: "error", error_message: "processamento interrompido", external_id: null },
    });
    expect(processar).not.toHaveBeenCalled();
  });

  it("mesmo id já terminado: 200 duplicado sem reprocessar", async () => {
    estado.original = { id: "log-0", status: "processed", received_at: new Date().toISOString() };
    const res = await enviar(assinaturaDoCore(SEGREDO));
    expect(res.status).toBe(200);
    expect(processar).not.toHaveBeenCalled();
  });

  it("assinatura do core: registra o envio e processa o cliente da organização da conexão", async () => {
    processar.mockResolvedValue({ status: "criado", contactId: "contato-1", telefoneRecusado: false });
    const res = await enviar(assinaturaDoCore(SEGREDO));
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tabela: "webhook_events_log",
      valores: { organization_id: "org-1", provider: "gestao", event_type: "crm.user.updated", external_id: "crm:evt_1" },
    });
    expect(processar).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.objectContaining({ id: "crm:evt_1", data: expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }) }),
    );
  });
});
