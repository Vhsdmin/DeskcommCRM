import { DIMENSOES, LOGO_PARA_FUNDO_CLARO, LOGO_PARA_FUNDO_ESCURO, SIMBOLO_VENDEPAY } from "@/lib/branding/arte-vendepay";
import { cn } from "@/lib/utils";

/**
 * A marca do PRODUTO — o que a tela mostra quando ninguém configurou marca
 * própria (`marcaEhADoProduto`, em `lib/branding.ts`). Desde a adaptação
 * VendePay, é o logo VendePay seguido de "| CRM", como o "| MANAGE" do Gestão.
 *
 * A arte vem embutida (`lib/branding/arte-vendepay.ts`) e é desenhada dentro de
 * um `<svg>` com `<image>`, não com `<img>`:
 *  - o logo tem duas versões, uma por TEMA (nome em grafite no claro, em branco
 *    no escuro), e só a do tema em vigor aparece;
 *  - nada em `public/`: a arte só aparece onde a marca em vigor é a padrão;
 *  - a barra lateral usa `<img>` para o logo CONFIGURADO, e o e2e
 *    `marca-logo.spec.ts` mede "barra sem `<img>`" como "sem logo do
 *    revendedor". Um `<img>` do produto ali faria a spec medir a coisa errada.
 *
 * O texto alternativo é o `nome` que a tela já resolveu — nunca uma string
 * fixa, para que a catraca de marca (`tests/unit/branding.test.ts`) continue
 * contando ZERO ocorrências fora de `lib/branding.ts`.
 */

type Props = {
  readonly nome: string;
  readonly className?: string;
  /** `true` quando o texto ao lado já nomeia a marca — evita ler duas vezes. */
  readonly decorativo?: boolean;
};

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);
}

/** O símbolo sozinho — para a barra recolhida, avatar e cantos apertados. */
export function SimboloDoProduto({ nome, className, decorativo = false }: Props) {
  const { width, height } = DIMENSOES.simbolo;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <image href={SIMBOLO_VENDEPAY} width={width} height={height} />
    </svg>
  );
}

/** Logo + "| CRM" — para a barra aberta e a fachada de entrada. */
export function LogotipoDoProduto({ nome, className, decorativo = false }: Props) {
  const claro = DIMENSOES.logoClaro;
  const escuro = DIMENSOES.logoEscuro;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-3", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <svg viewBox={`0 0 ${claro.width} ${claro.height}`} aria-hidden className="h-full w-auto dark:hidden">
        <image href={LOGO_PARA_FUNDO_CLARO} width={claro.width} height={claro.height} />
      </svg>
      <svg
        viewBox={`0 0 ${escuro.width} ${escuro.height}`}
        aria-hidden
        className="hidden h-full w-auto dark:block"
      >
        <image href={LOGO_PARA_FUNDO_ESCURO} width={escuro.width} height={escuro.height} />
      </svg>
      <span
        aria-hidden
        className="border-l border-border-strong pl-3 text-xs font-semibold tracking-[0.18em] text-text-muted"
      >
        CRM
      </span>
    </span>
  );
}
