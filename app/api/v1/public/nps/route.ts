import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { ok, fail } from "@/lib/api/wrappers";
const token = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), token }).strict(),
  z
    .object({
      action: z.literal("answer"),
      token,
      score: z.number().int().min(0).max(10),
      comment: z.string().trim().max(2000).default(""),
    })
    .strict(),
]);
export async function POST(req: Request) {
  const requestId = randomUUID();
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return fail("validation_failed", "Confira a nota de 0 a 10 e o comentário.", 422, {
      requestId,
    });
  if (await authRateLimited("public_nps", body.data.token, { ip: 60, id: 30, windowSec: 60 }))
    return fail("rate_limited", "Aguarde um pouco e tente novamente.", 429, { requestId });
  // Entrada por link: hash é a credencial. A RPC resolve org/contato internamente e não expõe cadastros.
  const r = await createAdminClient().rpc("fn_public_customer_nps", {
    p_hash: createHash("sha256").update(body.data.token).digest("hex"),
    p_score: body.data.action === "answer" ? body.data.score : null,
    p_comment: body.data.action === "answer" ? body.data.comment : null,
  });
  if (r.error)
    return fail("internal_error", "Não foi possível carregar a pesquisa. Tente novamente.", 500, {
      requestId,
    });
  const response = ok({ status: r.data?.status ?? "unavailable" }, { requestId });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
