"use client";
import Link from "next/link";
import { useT } from "@/hooks/i18n/useT";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { CaretDoubleLeft, CaretDoubleRight } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { toggleSidebar } from "@/app/actions/shell/toggleSidebar";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { VersionFooter } from "@/components/shell/VersionFooter";
import { LogotipoDoProduto, SimboloDoProduto } from "@/components/branding/MarcaDoProduto";
import { marcaEhADoProduto } from "@/lib/branding";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";
import { hubSections, sidebarItems } from "@/lib/navigation/registry";

interface SidebarContentProps {
  collapsed: boolean;
  showCollapseControl?: boolean;
  onNavigate?: () => void;
}

/** A mesma lista principal no desktop e na gaveta mobile. */
export function SidebarContent({
  collapsed,
  showCollapseControl = true,
  onNavigate,
}: SidebarContentProps) {
  // A barra lateral aparece em TODA tela — traduzi-la aqui é o que faz a
  // escolha de idioma virar algo visível no primeiro clique.
  const t = useT();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const { user, activeOrg } = useAuth();
  const items = sidebarItems(
    user.is_platform_admin && !user.support,
    activeOrg?.role ?? null,
    activeOrg?.interface_settings,
  );
  const settingsActive =
    pathname.startsWith("/app/settings") ||
    hubSections(
      "organizacao",
      user.is_platform_admin && !user.support,
      activeOrg?.role ?? null,
      activeOrg?.interface_settings,
    ).some(({ items: destinations }) =>
      destinations.some((d) => pathname === d.href || pathname.startsWith(`${d.href}/`)),
    );
  const brand = useMarcaDaInstalacao();
  /**
   * O CONSUMIDOR do nome por organização.
   *
   * Sem ele, `settings.branding.app_name` seria campo decorativo: medido, o nome
   * da org não aparece em lugar nenhum da casca para o cliente típico de um
   * revendedor — o único leitor é o `TenantSwitcher`, e ele devolve `null` com
   * uma organização só.
   *
   * A marca da INSTALAÇÃO continua embaixo: a organização que não definiu nome
   * vê exatamente o que via antes. O que mudou é POR ONDE ela chega — era
   * `branding()`, que no navegador lê `window.__PUBLIC_ENV__` e no servidor lê
   * `process.env`, e essas duas fontes passaram a divergir quando o layout raiz
   * começou a injetar a marca do BANCO. Divergência entre SSR e cliente aqui não
   * é detalhe: com logo no banco e `APP_LOGO_URL` vazio, o servidor desenhava o
   * `<span>` de baixo e o cliente desenhava o `<img>` — React #418 em toda tela.
   * Hoje a marca vem por PROP do servidor (`useMarcaDaInstalacao`), pela mesma
   * rota de `activeOrg`, e os dois lados leem o mesmo objeto por construção.
   */
  const nome = activeOrg?.marca?.nome ?? brand.name;
  /**
   * O mesmo desenho para o LOGO — e é este par de linhas que fecha o caminho do
   * `logo_url` gravado até a tela.
   *
   * `||` e não `??`: vazio é AUSÊNCIA de logo, não "logo em branco". É a regra
   * que `resolveBranding` e `primeiroDefinido` já aplicam nas camadas de baixo, e
   * com `??` um `""` vindo de cima apagaria o logo do revendedor em vez de
   * descer para ele — que é o contrário do que a precedência por campo promete.
   */
  const logo = activeOrg?.marca?.logoUrl || brand.logoUrl;
  // Só quando NINGUÉM — nem a instalação, nem a organização — pôs marca própria:
  // é a condição de `lib/branding.ts`, avaliada sobre o que a barra vai mostrar.
  const marcaDoProduto = marcaEhADoProduto({ name: nome, logoUrl: logo ?? null });

  return (
    <>
      <div
        className={cn(
          "flex h-24 shrink-0 items-center px-6",
          collapsed ? "justify-center" : "justify-start",
        )}
      >
        {logo && !collapsed ? (
          // A moldura clara vale SÓ para o logo enviado por quem hospeda. A arte
          // do produto (ramo `marcaDoProduto`, logo abaixo) já é desenhada para os
          // dois temas e não precisa dela — pôr a moldura ali seria dar o remédio
          // a quem não tem a doença.
          // Chip claro só no tema escuro: a arte enviada é de quem hospeda, sem
          // garantia de que tenha contraste contra `--color-surface` escuro
          // (`#1d1c17`). Sem isto, todo logo escuro/colorido — a maioria do que
          // se sobe pensando em fundo claro — some no tema escuro (issue: logo
          // da Dra. Mariana Nascimento, azul-marinho sobre quase-preto). O chip
          // é condicional ao TEMA, não à cor do logo (não dá pra inspecionar
          // pixel de uma URL externa em server component), então ele aparece
          // para qualquer logo — inclusive um já pensado pra fundo escuro, que
          // fica com uma moldura branca de sobra. Troca aceita: pior caso
          // "moldura desnecessária" é sempre melhor que pior caso "logo
          // invisível".
          <div className="rounded-md dark:bg-white dark:px-2 dark:py-1 dark:shadow-sm">
            {/* <img> em vez de next/image de propósito: a URL vem de quem hospeda
              (banco ou .env), e next/image exige allowlist de domínios fechada em
              build — a imagem pré-buildada rejeitaria o domínio do self-hoster.
              Altura fixa e largura livre porque a arte enviada tem proporção
              desconhecida; forçar as duas distorceria o logo de quem configurou. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt={nome} className="h-7 w-auto max-w-[10rem] object-contain" />
          </div>
        ) : marcaDoProduto ? (
          // O desenho do produto, inline (ver `components/branding/MarcaDoProduto.tsx`):
          // logotipo com a barra aberta, só o símbolo com ela recolhida.
          collapsed ? (
            <SimboloDoProduto nome={nome} className="h-8 w-8" />
          ) : (
            <LogotipoDoProduto nome={nome} className="h-7 w-auto" />
          )
        ) : (
          <span className={cn("font-semibold tracking-tight", collapsed && "sr-only")}>{nome}</span>
        )}
        {collapsed && !marcaDoProduto && (
          <span aria-hidden className="text-lg font-bold text-primary">
            {/* Spread e não `[0]`: nome começando com emoji ou acento composto
                quebraria no meio do code point. Mesma regra de `resolveBranding`
                — a inicial precisa acompanhar o nome que a barra mostra, senão
                recolher o menu troca a marca. */}
            {[...nome][0]?.toUpperCase() ?? brand.initial}
          </span>
        )}
      </div>
      <nav
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        aria-label={t("Navegação principal")}
      >
        <ul className="space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/app/settings"
                ? settingsActive
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={collapsed ? t(item.label) : undefined}
                  aria-current={isActive ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 text-[15px] leading-6 font-normal transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    isActive
                      ? "bg-white/60 text-accent dark:bg-white/10"
                      : "text-muted-foreground hover:bg-white/35 dark:hover:bg-white/5",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon size={20} weight="regular" className="shrink-0" aria-hidden />
                  {!collapsed && <span className="whitespace-nowrap">{t(item.label)}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="shrink-0 px-4 pb-3">
        <VersionFooter collapsed={collapsed} onNavigate={onNavigate} />
        {showCollapseControl && (
          <button
            type="button"
            onClick={() => startTransition(() => toggleSidebar(collapsed))}
            disabled={isPending}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent-soft hover:text-foreground",
              collapsed && "justify-center px-2",
            )}
            aria-label={collapsed ? t("Expandir sidebar") : t("Recolher sidebar")}
          >
            {collapsed ? (
              <CaretDoubleRight size={14} aria-hidden />
            ) : (
              <CaretDoubleLeft size={14} aria-hidden />
            )}
            {!collapsed && <span>{t("Recolher")}</span>}
          </button>
        )}
      </div>
    </>
  );
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        // ⚠️ `sticky`, e NUNCA `fixed`.
        //
        // Com `fixed` a barra sai do fluxo: ela não ocupa lugar nenhum na linha,
        // e quem afastava o conteúdo era um `md:ml-16`/`md:ml-60` do lado de lá.
        // Duas medidas para a mesma coisa, em componentes diferentes — e no dia
        // em que discordassem (largura de 60 com margem de 16), a barra passava
        // POR CIMA da lista de conversas, escondendo o começo de cada linha.
        //
        // Foi assim que apareceu numa instalação real: a barra expandida, com as
        // etiquetas legíveis, e a lista atrás dela cortada. Um F5 "consertava",
        // que é a assinatura de servidor e navegador terem pintado estados
        // diferentes — e `AppShell` e `Sidebar` são ambos `"use client"`.
        //
        // `sticky top-0 h-full` dá o mesmo efeito visual (a barra não rola com
        // a página) e ela VOLTA a ocupar lugar: sobra para o conteúdo exatamente
        // o que ela não usou, e não há segunda medida para discordar.
        //
        // `shrink-0` porque item de flex encolhe por padrão, e uma barra de 60
        // espremida para caber é o mesmo defeito por outro caminho.
        "sticky top-0 z-30 flex h-full shrink-0 flex-col bg-transparent transition-[width] duration-200",
        collapsed ? "w-20" : "w-72",
      )}
    >
      <SidebarContent collapsed={collapsed} />
    </aside>
  );
}
