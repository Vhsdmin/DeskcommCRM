"use client";
import { useState } from "react";
import { presetDates } from "@/lib/cs/dashboard";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export interface Periodo {
  from: string;
  to: string;
}
export function PeriodoDashboard({
  value,
  onChange,
  performance = false,
}: {
  value: Periodo;
  onChange: (p: Periodo) => void;
  performance?: boolean;
}) {
  const t = useT();
  const [selected, setSelected] = useState("30");
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const options: [string, string][] = performance
    ? [
        ["1", "Dia"],
        ["7", "Semana"],
        ["30", "Mês"],
        ["365", "Ano"],
        ["custom", "Personalizado"],
      ]
    : [
        ["30", "30 dias"],
        ["60", "60 dias"],
        ["90", "90 dias"],
        ["custom", "Personalizado"],
      ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("Período")}>
        {options.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={selected === id ? "default" : "outline"}
            aria-pressed={selected === id}
            onClick={() => {
              setSelected(id);
              setInvalid(false);
              if (id !== "custom") {
                const p = presetDates(Number(id));
                setDraft(p);
                onChange(p);
              }
            }}
          >
            {t(label)}
          </Button>
        ))}
      </div>
      {selected === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            {t("De")}
            <Input
              type="date"
              aria-label={t("Data inicial")}
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-sm">
            {t("Até")}
            <Input
              type="date"
              aria-label={t("Data final")}
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </label>
          <Button
            size="sm"
            onClick={() => {
              const valid =
                draft.from &&
                draft.to &&
                draft.from <= draft.to &&
                (Date.parse(draft.to) - Date.parse(draft.from)) / 86400000 < 732;
              setInvalid(!valid);
              if (valid) onChange(draft);
            }}
          >
            {t("Aplicar período")}
          </Button>
          {invalid && (
            <p role="alert" className="text-sm text-destructive">
              {t("Escolha datas válidas, em ordem, com no máximo 2 anos.")}
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {value.from.split("-").reverse().join("/")} — {value.to.split("-").reverse().join("/")} ·{" "}
        {t("Datas inclusivas · America/Sao_Paulo")}
        {performance && ` · ${t("Janelas móveis incluindo hoje")}`}
      </p>
    </div>
  );
}
export function PaginacaoDashboard({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (n: number) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
      <span>
        {total === 0
          ? t("Nenhum registro")
          : `${offset + 1}–${Math.min(offset + 25, total)} / ${total}`}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - 25))}
        >
          {t("Anterior")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(offset + 25)}
          disabled={offset + 25 >= total}
        >
          {t("Próxima")}
        </Button>
      </div>
    </div>
  );
}
