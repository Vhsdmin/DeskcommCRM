"use client";
import { NAV_CATALOG, NAV_GROUPS } from "@/lib/navigation/catalogo";
import { DESTINOS_PESSOAIS } from "@/lib/auth/acessos";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { useT } from "@/hooks/i18n/useT";

export function AccessEditor({
  value,
  onChange,
  role,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  role: Role;
  disabled?: boolean;
}) {
  const t = useT();
  if (role === "admin")
    return (
      <p className="rounded-md bg-muted p-3 text-sm">
        {t("Administradores têm acesso completo à organização, incluindo a gestão da equipe.")}
      </p>
    );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "Selecione os módulos e submódulos permitidos. Perfil, segurança e notificações pessoais permanecem disponíveis.",
        )}
      </p>
      {NAV_GROUPS.map((group) => {
        const items = NAV_CATALOG.filter(
          (d) =>
            d.group === group.id &&
            !DESTINOS_PESSOAIS.includes(d.href) &&
            ROLE_RANK[role] >= ROLE_RANK[(d as { minRole?: Role }).minRole ?? "viewer"],
        );
        if (!items.length) return null;
        const all = items.every((d) => value.includes(d.href));
        return (
          <fieldset key={group.id} disabled={disabled} className="rounded-lg border p-4">
            <legend className="px-1 font-medium">{t(group.label)}</legend>
            <label className="mb-3 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={all}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...new Set([...value, ...items.map((d) => d.href)])]
                      : value.filter((v) => !items.some((d) => d.href === v)),
                  )
                }
              />
              {t("Selecionar todo o módulo")}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((d) => (
                <label key={d.href} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={value.includes(d.href)}
                    onChange={(e) =>
                      onChange(
                        e.target.checked ? [...value, d.href] : value.filter((v) => v !== d.href),
                      )
                    }
                  />
                  <span>{t(d.label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
