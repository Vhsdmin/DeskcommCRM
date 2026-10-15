import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
import { collectNpsForExport } from "@/lib/lgpd/export-collector";
it("exporta todas as páginas do titular sem hash e filtra organização e contato", async () => {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() };
  for (const key of ["select", "eq", "order"] as const) chain[key].mockReturnValue(chain);
  chain.range
    .mockResolvedValueOnce({
      data: Array.from({ length: 1000 }, (_, n) => ({ id: String(n), score: 0 })),
      error: null,
    })
    .mockResolvedValueOnce({ data: [{ id: "1000", score: 9 }], error: null });
  const from = vi.fn().mockReturnValue(chain);
  const rows = await collectNpsForExport({ from } as never, "org", "contact");
  expect(rows).toHaveLength(1001);
  expect(from).toHaveBeenCalledWith("customer_nps_surveys");
  expect(chain.eq).toHaveBeenCalledWith("organization_id", "org");
  expect(chain.eq).toHaveBeenCalledWith("contact_id", "contact");
  expect(chain.select.mock.calls[0]?.[0]).not.toContain("token_hash");
  expect(chain.range).toHaveBeenLastCalledWith(1000, 1999);
});
it("falha na coleta não entrega sucesso com pesquisa omitida", async () => {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() };
  for (const key of ["select", "eq", "order"] as const) chain[key].mockReturnValue(chain);
  chain.range.mockResolvedValue({ data: null, error: { message: "private" } });
  await expect(
    collectNpsForExport({ from: () => chain } as never, "org", "contact"),
  ).rejects.toThrow("Não foi possível coletar");
});
