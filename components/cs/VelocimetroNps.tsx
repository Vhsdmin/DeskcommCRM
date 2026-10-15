"use client";
import { useT } from "@/hooks/i18n/useT";
function point(value: number, r: number) {
  const angle = Math.PI * (1 + value / 100);
  return { x: 160 + r * Math.cos(angle), y: 150 + r * Math.sin(angle) };
}
function arc(from: number, to: number) {
  const a = point(from, 116),
    b = point(to, 116);
  return `M ${a.x} ${a.y} A 116 116 0 0 1 ${b.x} ${b.y}`;
}
export function VelocimetroNps({ value }: { value: number | null }) {
  const t = useT();
  const tip = point(value ?? 50, 88);
  return (
    <div className="mx-auto max-w-sm">
      <svg
        viewBox="0 0 320 200"
        role="img"
        aria-label={
          value === null
            ? t("Sem respostas para calcular a média")
            : `${t("Nota média consolidada")}: ${value} / 100`
        }
        className="w-full"
      >
        <title>{t("Nota média consolidada")}</title>
        <path d={arc(0, 70)} fill="none" stroke="#dc2626" strokeWidth="19" />
        <path d={arc(70, 90)} fill="none" stroke="#d97706" strokeWidth="19" />
        <path d={arc(90, 100)} fill="none" stroke="#16a34a" strokeWidth="19" />
        {[0, 25, 50, 75, 100].map((n) => {
          const p = point(n, 140);
          return (
            <text
              key={n}
              x={p.x}
              y={p.y + 4}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {n}
            </text>
          );
        })}
        {value !== null && (
          <>
            <line
              data-testid="nps-needle"
              x1="160"
              y1="150"
              x2={tip.x}
              y2={tip.y}
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="160" cy="150" r="6" fill="currentColor" />
          </>
        )}
        <text
          x="160"
          y="185"
          textAnchor="middle"
          className="fill-foreground text-[23px] font-semibold"
        >
          {value === null
            ? "—"
            : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}
          <tspan className="text-[12px] font-normal"> / 100</tspan>
        </text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        <span>
          <span className="text-red-600">●</span> {t("Detrator")} 0–69
        </span>
        <span>
          <span className="text-amber-600">●</span> {t("Neutro")} 70–89
        </span>
        <span>
          <span className="text-green-600">●</span> {t("Promotor")} 90–100
        </span>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {t("Média das notas × 10. As faixas representam a média, não a classificação individual.")}
      </p>
    </div>
  );
}
