import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { HandlerCtx } from "@/lib/api/handlers/types";
const auditSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/audit", () => ({
  audit: auditSpy,
  isServiceRoleConfigured: () => false,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
const ORG = "c05e7a00-0000-4000-8000-000000000001";
const CONTATO = "c05e7a00-0000-4000-8000-0000000000c1";
const ctx: HandlerCtx = {
  organization_id: ORG,
  actor: { type: "user", id: ORG },
  requestId: "req-1",
};
function cliente(
  error: { code: string; message: string } | null = null,
  data: string | null = CONTATO,
) {
  return {
    rpc: vi.fn((name: string) =>
      Promise.resolve(name === "fn_delete_contact" ? { data, error } : { error: null }),
    ),
  };
}
describe("exclusão atômica de cliente", () => {
  beforeEach(() => auditSpy.mockClear());
  it("usa uma única transação com organização confiável e publica a exclusão", async () => {
    const { deleteContactHandler } = await import("@/app/api/v1/contacts/_handler");
    const sb = cliente();
    expect(await deleteContactHandler(sb as never, ctx, CONTATO)).toEqual({ id: CONTATO });
    expect(sb.rpc).toHaveBeenNthCalledWith(1, "fn_delete_contact", {
      p_org: ORG,
      p_contact: CONTATO,
    });
    expect(sb.rpc).toHaveBeenNthCalledWith(
      2,
      "emit_event",
      expect.objectContaining({ p_event_type: "contact.deleted", p_organization_id: ORG }),
    );
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: "contact.deleted" }));
  });
  it.each([
    ["23503", 409, "state_conflict"],
    ["23001", 409, "state_conflict"],
    ["42501", 403, "forbidden"],
    ["23514", 500, "internal_error"],
  ])("erro %s preserva histórico e não publica sucesso", async (dbCode, status, code) => {
    const { deleteContactHandler } = await import("@/app/api/v1/contacts/_handler");
    const sb = cliente({ code: String(dbCode), message: "detalhe privado do banco" });
    await expect(deleteContactHandler(sb as never, ctx, CONTATO)).rejects.toMatchObject({
      status,
      code,
    });
    expect(sb.rpc).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contact.delete_blocked",
        metadata: expect.objectContaining({ apagados: [], db_code: dbCode }),
      }),
    );
  });
  it("404 para ficha inexistente ou fora do escopo, sem evento", async () => {
    const { deleteContactHandler } = await import("@/app/api/v1/contacts/_handler");
    const sb = cliente(null, null);
    await expect(deleteContactHandler(sb as never, ctx, CONTATO)).rejects.toMatchObject({
      status: 404,
    });
    expect(sb.rpc).toHaveBeenCalledTimes(1);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

it("DELETE com ID inválido responde 400 sem consultar o banco", async () => {
  const { DELETE } = await import("@/app/api/v1/contacts/[id]/route");
  const { createClient } = await import("@/lib/supabase/server");
  const response = await DELETE(
    new NextRequest("http://localhost/api/v1/contacts/invalido", { method: "DELETE" }),
    { params: Promise.resolve({ id: "invalido" }) },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
  expect(createClient).not.toHaveBeenCalled();
});
