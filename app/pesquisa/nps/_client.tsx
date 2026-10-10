"use client";
import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}
export function NpsPublico() {
  const token = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => "",
  );
  return <NpsForm key={token} token={token} />;
}
function NpsForm({ token }: { token: string }) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["public-nps", token],
    queryFn: async () => {
      if (!/^[a-f0-9]{64}$/.test(token)) return "unavailable";
      const r = await apiClient.post<{ data: { status: string } }>("/api/v1/public/nps", {
        action: "status",
        token,
      });
      return r.data.status;
    },
    retry: false,
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (score === null) return;
    setBusy(true);
    setError("");
    try {
      const r = await apiClient.post<{ data: { status: string } }>("/api/v1/public/nps", {
        action: "answer",
        token,
        score,
        comment,
      });
      if (r.data.status === "saved" || r.data.status === "answered") setSent(true);
      else
        setError(
          "Este link não está mais disponível. Solicite uma nova pesquisa ao seu contato na VendePay.",
        );
    } catch (e) {
      setError(
        e instanceof ApiError && e.status < 500
          ? e.message
          : "Não foi possível enviar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center p-4">
      <Card className="w-full space-y-5 p-6">
        <h1 className="text-2xl font-semibold">Pesquisa NPS VendePay</h1>
        {sent || query.data === "answered" ? (
          <div role="status">
            <h2 className="font-semibold">Obrigado pela sua resposta!</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sua avaliação foi registrada e ajudará a melhorar nossa experiência.
            </p>
          </div>
        ) : query.isPending ? (
          <p>Carregando pesquisa…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>Não foi possível carregar a pesquisa.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : query.data !== "ready" ? (
          <p role="alert">
            Este link não está mais disponível. Solicite uma nova pesquisa ao seu contato na
            VendePay.
          </p>
        ) : (
          <form className="space-y-5" onSubmit={submit}>
            <fieldset disabled={busy}>
              <legend className="mb-3 font-medium">
                De 0 a 10, qual a probabilidade de você recomendar a VendePay a um amigo ou colega?
              </legend>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 11 }, (_, n) => (
                  <label
                    key={n}
                    className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border has-[:focus-visible]:ring-2 ${score === n ? "bg-primary text-primary-foreground" : "bg-background"}`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name="score"
                      value={n}
                      checked={score === n}
                      onChange={() => setScore(n)}
                      required
                      aria-label={`Nota ${n}`}
                    />
                    <span>{n}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>Nada provável</span>
                <span>Extremamente provável</span>
              </div>
            </fieldset>
            <label className="block text-sm">
              O que motivou sua nota? (opcional)
              <textarea
                className="mt-2 w-full rounded-md border bg-background p-3"
                maxLength={2000}
                rows={4}
                value={comment}
                disabled={busy}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              A resposta será vinculada à sua conta para acompanhamento pela equipe VendePay. Evite
              incluir senhas ou dados de pagamento no comentário.
            </p>
            {error && (
              <p role="alert" className="text-sm text-error-fg">
                {error}
              </p>
            )}
            <Button disabled={score === null || busy} type="submit">
              {busy ? "Enviando…" : "Enviar resposta"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
