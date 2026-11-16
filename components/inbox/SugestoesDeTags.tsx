"use client";

/** Quantas sugestões cabem na coluna sem empurrar o resto do painel. */
const MAXIMO_DE_SUGESTOES = 8;

/**
 * As etiquetas que já existem, oferecidas por clique — e filtradas pelo que a
 * pessoa está digitando, para a etiqueta certa aparecer mesmo quando o
 * vocabulário tem muito mais que oito.
 *
 * Comparação sem caixa: o editor grava em minúsculas, mas cliente importado pode
 * ter "VIP"; oferecer "VIP" para quem já tem "vip" seria sugerir a mesma etiqueta.
 */
export function filtrarSugestoes(vocabulario: string[], atuais: string[], rascunho: string): string[] {
  const jaTem = new Set(atuais.map((t) => t.toLowerCase()));
  const busca = rascunho.trim().toLowerCase();
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const tag of vocabulario) {
    const chave = tag.toLowerCase();
    if (jaTem.has(chave) || vistas.has(chave)) continue;
    if (busca && !chave.includes(busca)) continue;
    vistas.add(chave);
    saida.push(tag);
    if (saida.length >= MAXIMO_DE_SUGESTOES) break;
  }
  return saida;
}

export function SugestoesDeTags({
  vocabulario,
  atuais,
  rascunho,
  desabilitado,
  onEscolher,
}: {
  vocabulario: string[];
  atuais: string[];
  rascunho: string;
  desabilitado: boolean;
  onEscolher: (tag: string) => void;
}) {
  const sugestoes = filtrarSugestoes(vocabulario, atuais, rascunho);
  if (sugestoes.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1" data-testid="sugestoes-de-tags">
      {sugestoes.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onEscolher(tag)}
          disabled={desabilitado}
          className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
        >
          + {tag}
        </button>
      ))}
    </div>
  );
}
