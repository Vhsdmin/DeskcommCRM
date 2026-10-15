import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ role: vi.fn(), support: vi.fn(), db: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mock.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mock.support }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.db }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: mock.audit }));
import { POST } from "@/app/api/v1/contacts/[id]/timeline/route";
const id = "70b96720-17b5-44ba-9ab2-19750677f90e";
const input = {
  kind: "qbr",
  summary: "Reunião realizada",
  next_steps: "Retornar",
  performed_at: "2026-01-01T12:00:00Z",
};
const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/v1/contacts/" + id + "/timeline", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  mock.support.mockResolvedValue(null);
  mock.role.mockResolvedValue({ ok: true, org: { orgId: "active-org" }, user: { id: "actor" } });
  mock.audit.mockResolvedValue(undefined);
});
describe("registro de atividade do cliente", () => {
  it("bloqueia acompanhamento somente leitura antes de tocar no banco", async () => {
    mock.support.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await call(input)).status).toBe(403);
    expect(mock.db).not.toHaveBeenCalled();
  });
  it("exige papel agent e recusa identidade enviada no body", async () => {
    expect((await call({ ...input, organization_id: "foreign" })).status).toBe(422);
    expect(mock.role).toHaveBeenCalledWith("agent", expect.anything());
    expect(mock.db).not.toHaveBeenCalled();
  });
  it("não grava cliente inacessível ou anonimizado", async () => {
    for (const data of [null, { id, is_anonymized: true, is_merged_into: null }]) {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        insert: vi.fn(),
      };
      mock.db.mockResolvedValue({ from: () => query });
      const response = await call(input);
      expect(response.status).toBe(data ? 409 : 404);
      expect(query.eq).toHaveBeenCalledWith("organization_id", "active-org");
      expect(query.insert).not.toHaveBeenCalled();
    }
  });
  it("grava contato sem lead com organização e autor do servidor", async () => {
    const contacts = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({
          data: { id, is_anonymized: false, is_merged_into: null },
          error: null,
        }),
    };
    const activities = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "activity-id" }, error: null }),
    };
    mock.db.mockResolvedValue({
      from: (table: string) => (table === "contacts" ? contacts : activities),
    });
    expect((await call(input)).status).toBe(201);
    expect(activities.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "active-org",
        performed_by_user_id: "actor",
        contact_id: id,
        lead_id: null,
        type: "customer_qbr",
      }),
    );
    expect(mock.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: id,
        metadata: { activity_id: "activity-id", activity_type: "customer_qbr" },
      }),
    );
  });
});
