import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { CONVITES_DE_EQUIPE_ATIVOS } from "../../lib/auth/acessos";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
}

test("cadastro direto, login imediato e alteração de áreas pela tela", async ({
  page,
  browser,
}, info) => {
  test.skip(CONVITES_DE_EQUIPE_ATIVOS, "O modo ativo nesta versão é o convite legado.");
  test.setTimeout(180_000);
  const credentials = credenciaisSupabaseDeTeste();
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(credentials.url).hostname))
    throw new Error("Este cenário cria contas descartáveis e exige Supabase local.");
  const db = createClient(credentials.url, credentials.serviceRole, {
    auth: { persistSession: false },
  });
  const suffix = randomUUID().slice(0, 8);
  const password = `Senha-QA-${randomUUID()}!`;
  const email = `equipe-novo-${suffix}@invariant.test`;
  const userIds: string[] = [];
  let orgId: string | undefined;
  const memberContext = await browser.newContext();
  try {
    const admin = await db.auth.admin.createUser({
      email: `equipe-admin-${suffix}@invariant.test`,
      password,
      email_confirm: true,
    });
    if (admin.error || !admin.data.user) throw admin.error ?? new Error("Sem usuário QA");
    userIds.push(admin.data.user.id);
    const org = await db
      .from("organizations")
      .insert({
        slug: `equipe-direto-${suffix}`,
        legal_name: "Equipe QA",
        display_name: "Equipe QA",
        onboarded_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (org.error) throw org.error;
    orgId = org.data.id;
    const membership = await db
      .from("user_organizations")
      .insert({
        organization_id: orgId,
        user_id: admin.data.user.id,
        role: "admin",
        accepted_at: new Date().toISOString(),
      });
    if (membership.error) throw membership.error;
    await login(page, admin.data.user.email!, password);
    await page.goto("/app/team");
    await expect(page.getByRole("link", { name: "Convidar membros" })).toHaveCount(0);
    await page.getByRole("button", { name: "Novo usuário", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome", { exact: true }).fill("Atendente de teste");
    await dialog.getByLabel("E-mail", { exact: true }).fill(email);
    await dialog.getByLabel("Senha inicial", { exact: true }).fill(password);
    await dialog.getByLabel("Confirmar senha", { exact: true }).fill(password);
    await dialog.getByRole("checkbox", { name: "Tarefas", exact: true }).check();
    await page.screenshot({ path: info.outputPath("cadastro.png"), fullPage: false });
    await dialog.getByRole("button", { name: "Criar usuário", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row.getByText("Ativo", { exact: true })).toBeVisible();
    const saved = await db
      .from("user_organizations")
      .select("user_id,module_access")
      .eq("organization_id", orgId)
      .neq("user_id", admin.data.user.id)
      .single();
    if (saved.error) throw saved.error;
    userIds.push(saved.data.user_id);
    expect(saved.data.module_access).toEqual(["/app/tasks"]);
    const member = await memberContext.newPage();
    await login(member, email, password);
    await member.waitForURL(/\/app\/tasks$/);
    await expect(
      member
        .getByRole("navigation", { name: "Navegação principal" })
        .getByRole("link", { name: "Clientes", exact: true }),
    ).toHaveCount(0);
    await member.goto("/app/contacts");
    await expect(member).toHaveURL(/\/403$/);
    expect(
      (
        await member.request.post("/api/v1/team/users", {
          data: {
            nome: "Não permitido",
            email: `proibido-${suffix}@invariant.test`,
            senha: password,
            role: "admin",
            acessos: [],
          },
        })
      ).status(),
    ).toBe(403);
    await row.getByRole("button", { name: "Permissões", exact: true }).click();
    const permissions = page.getByRole("dialog");
    await permissions.getByRole("checkbox", { name: "Tarefas", exact: true }).uncheck();
    await permissions.getByRole("checkbox", { name: "Clientes", exact: true }).check();
    await permissions.getByRole("button", { name: "Salvar permissões", exact: true }).click();
    await expect(permissions).toHaveCount(0);
    await member.goto("/app/contacts");
    await expect(member.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
    await member.goto("/app/tasks");
    await expect(member).toHaveURL(/\/403$/);
  } finally {
    await memberContext.close();
    if (orgId) {
      const members = await db
        .from("user_organizations")
        .select("user_id")
        .eq("organization_id", orgId);
      for (const m of members.data ?? []) if (!userIds.includes(m.user_id)) userIds.push(m.user_id);
      await db.from("organizations").delete().eq("id", orgId);
    }
    for (const userId of userIds) await db.auth.admin.deleteUser(userId);
  }
});
