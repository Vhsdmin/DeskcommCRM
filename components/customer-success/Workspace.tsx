"use client";

import { randomId } from "@/lib/random-id";
import { useT } from "@/hooks/i18n/useT";
import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Plus, Search, X, Check, Users, Activity as Pulse } from "lucide-react";
import {
  ACTIVITY_KINDS,
  DEMO_ACCOUNTS,
  OWNERS,
  parseActivities,
  portfolioOwner,
  disputeFeeUsdCents,
  type Activity,
  type ActivityKind,
  type Owner,
} from "@/lib/customer-success/model";
import styles from "./workspace.module.css";

const STORAGE_KEY = "vendepay-cs-demo-v1";
const money = (cents: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
const dateLabel = (date: string) => date.split("-").reverse().join("/");
const today = () => new Date().toLocaleDateString("en-CA");

export function CustomerSuccessWorkspace() {
  const t = useT();
  const [selected, setSelected] = useState(DEMO_ACCOUNTS[0]!.id);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [tab, setTab] = useState("Conta 360");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const account = DEMO_ACCOUNTS.find((a) => a.id === selected)!;
  const accountOwner = portfolioOwner(account.lifetimeGmvCents);
  const filtered = DEMO_ACCOUNTS.filter(
    (a) =>
      a.name.toLowerCase().includes(query.toLowerCase()) &&
      (!owner || portfolioOwner(a.lifetimeGmvCents) === owner),
  );
  const history = activities
    .filter((a) => a.accountId === selected)
    .sort((a, b) => b.date.localeCompare(a.date));
  const tasks = activities.filter((a) => a.kind === "Tarefa" && !a.done);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setActivities(parseActivities(raw));
      } catch {
        setMessage("Não foi possível recuperar o histórico local desta demonstração.");
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function save(next: Activity[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setMessage("Registro salvo neste navegador.");
    } catch {
      setMessage("Armazenamento indisponível. Registro mantido apenas nesta sessão.");
    }
    setActivities(next);
  }
  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const summary = String(data.get("summary") ?? "").trim();
    if (!summary) return;
    const kind = String(data.get("kind")) as ActivityKind;
    save([
      ...activities,
      {
        id: randomId(),
        accountId: selected,
        kind,
        owner: String(data.get("owner")) as Owner,
        date: String(data.get("date")),
        summary,
        done: kind !== "Tarefa",
      },
    ]);
    setOpen(false);
    setTab("Histórico");
  }
  const views = ["Conta 360", "Histórico", "Tarefas", "Desempenho"];
  return (
    <main className={styles.workspace}>
      <div className={styles.demo}>
        <strong>{t("Ambiente de demonstração")}</strong>
        <span>
          {t(
            "Contas fictícias · registros salvos somente neste navegador · sem conexão com a VendePay",
          )}
        </span>
      </div>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("VENDEPAY / RELACIONAMENTO")}</p>
          <h1>{t("Sucesso do cliente")}</h1>
          <p>{t("Acompanhe cada conta. Dê continuidade a cada conversa.")}</p>
        </div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button className={styles.primary} disabled={!ready}>
              <Plus size={18} /> {t("Registrar atividade")}
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className={styles.overlay} />
            <Dialog.Content className={`${styles.workspace} ${styles.modal}`}>
              <Dialog.Title>{t("Registrar atividade")}</Dialog.Title>
              <Dialog.Description>
                {account.name} {t("· jornada do cliente")}
              </Dialog.Description>
              <Dialog.Close className={styles.close} aria-label={t("Fechar")}>
                <X size={20} />
              </Dialog.Close>
              <form onSubmit={register}>
                <label>
                  {t("Tipo")}
                  <select name="kind">
                    {ACTIVITY_KINDS.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Responsável")}
                  <select name="owner" defaultValue={accountOwner}>
                    {OWNERS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Data da atividade ou prazo da tarefa")}
                  <input name="date" type="date" defaultValue={today()} required />
                </label>
                <label>
                  {t("Resumo e próximos passos")}
                  <textarea
                    name="summary"
                    maxLength={2000}
                    required
                    rows={4}
                    placeholder={t("O que foi tratado e qual é o próximo passo?")}
                  />
                </label>
                <p>{t("Use apenas informações fictícias nesta demonstração.")}</p>
                <button className={styles.primary} type="submit">
                  {t("Salvar registro")}
                </button>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </header>
      <section className={styles.summary} aria-label={t("Resumo da carteira")}>
        <div>
          <Users size={20} />
          <span>
            {t("Contas demonstrativas")}
            <strong>{DEMO_ACCOUNTS.length}</strong>
          </span>
        </div>
        <div>
          <Pulse size={20} />
          <span>
            {t("Atividades registradas")}
            <strong>{activities.filter((a) => a.kind !== "Tarefa").length}</strong>
          </span>
        </div>
        <div>
          <Check size={20} />
          <span>
            {t("Tarefas em aberto")}
            <strong>{tasks.length}</strong>
          </span>
        </div>
        <div>
          <span>
            {t("Saúde da conta")}
            <strong className={styles.small}>{t("Critérios a definir")}</strong>
          </span>
        </div>
      </section>
      <div className={styles.grid}>
        <aside className={styles.portfolio}>
          <h2>
            {t("Carteira de clientes")}
            <span>{filtered.length}</span>
          </h2>
          <label className={styles.search}>
            <Search size={17} />
            <input
              aria-label={t("Buscar cliente")}
              placeholder={t("Buscar cliente")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            {t("Responsável")}
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t("Toda a carteira")}</option>
              {OWNERS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <div className={styles.accounts}>
            {filtered.map((a) => (
              <button
                key={a.id}
                className={a.id === selected ? styles.selected : ""}
                onClick={() => {
                  setSelected(a.id);
                  setTab("Conta 360");
                }}
                aria-pressed={a.id === selected}
              >
                <span className={styles.avatar}>{a.name.slice(0, 1)}</span>
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {portfolioOwner(a.lifetimeGmvCents)} · {a.person}
                  </small>
                  <b>{money(a.lifetimeGmvCents)}</b>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
            {!filtered.length && <p>{t("Nenhuma conta encontrada. Ajuste os filtros.")}</p>}
          </div>
          <p className={styles.note}>
            {t("Carteiras definidas pelo GMV acumulado desde o cadastro.")}
          </p>
        </aside>
        <section className={styles.detail}>
          <div className={styles.accountHeader}>
            <div>
              <p className={styles.eyebrow}>
                {account.person} · {account.id}
              </p>
              <h2>{account.name}</h2>
              <p>
                {t("Cliente desde")}
                {dateLabel(account.since)} {t("· Responsável:")} <strong>{accountOwner}</strong>
              </p>
            </div>
            <span className={styles.badge}>{t("Dados fictícios")}</span>
          </div>
          <nav className={styles.tabs} aria-label={t("Visões da conta")}>
            {views.map((view) => (
              <button
                key={view}
                aria-current={tab === view ? "page" : undefined}
                onClick={() => setTab(view)}
              >
                {t(view)}
              </button>
            ))}
          </nav>
          {tab === "Conta 360" && (
            <>
              <div className={styles.sectionHeading}>
                <h3>{t("Panorama financeiro")}</h3>
                <span>{t("Desde o cadastro")}</span>
              </div>
              <div className={styles.metrics}>
                {[
                  [t("GMV acumulado"), money(account.lifetimeGmvCents)],
                  [t("Reembolsos"), money(account.refundsCents)],
                  [t("Chargebacks"), money(account.chargebacksCents)],
                  [t("Taxas de disputa"), money(disputeFeeUsdCents(account.disputeIds), "USD")],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className={styles.note}>
                {t(
                  "US$ 27 por disputa, independentemente do resultado. Valores em USD não são somados ao GMV em BRL.",
                )}
              </p>
              <div className={styles.split}>
                <section>
                  <h3>{t("Produtos cadastrados")}</h3>
                  {account.products.length ? (
                    account.products.map((p) => (
                      <p className={styles.product} key={p}>
                        {p}
                        <span>{t("Exemplo")}</span>
                      </p>
                    ))
                  ) : (
                    <p>{t("Nenhum produto neste exemplo.")}</p>
                  )}
                </section>
                <section>
                  <h3>{t("Acompanhamento")}</h3>
                  <p>
                    {history.length
                      ? `${history.length} registro(s) na jornada desta conta.`
                      : t("Esta conta ainda não tem registros de relacionamento.")}
                  </p>
                  <p>
                    {t(
                      "Indicadores de risco, histórico de vendas e NPS serão conectados nas próximas etapas.",
                    )}
                  </p>
                </section>
              </div>
            </>
          )}
          {tab === "Histórico" && (
            <section className={styles.content}>
              <h3>{t("Jornada da conta")}</h3>
              {!history.length && (
                <p>{t("Comece registrando um atendimento, reunião ou tarefa.")}</p>
              )}
              {history.map((a) => (
                <article className={styles.record} key={a.id}>
                  <div>
                    <span className={styles.badge}>{a.kind}</span>
                    <small>
                      {dateLabel(a.date)} · {a.owner}
                    </small>
                  </div>
                  <p>{a.summary}</p>
                  {a.kind === "Tarefa" && <small>{a.done ? t("Concluída") : t("Em aberto")}</small>}
                </article>
              ))}
            </section>
          )}
          {tab === "Tarefas" && (
            <section className={styles.content}>
              <h3>{t("Próximos passos desta conta")}</h3>
              {!history.some((a) => a.kind === "Tarefa") && (
                <p>{t("Nenhuma tarefa registrada.")}</p>
              )}
              {history
                .filter((a) => a.kind === "Tarefa")
                .map((a) => (
                  <article className={styles.record} key={a.id}>
                    <div>
                      <strong>{a.done ? t("Concluída") : t("Em aberto")}</strong>
                      <small>
                        {t("Prazo")}
                        {dateLabel(a.date)} · {a.owner}
                      </small>
                    </div>
                    <p>{a.summary}</p>
                    <button
                      onClick={() =>
                        save(
                          activities.map((item) =>
                            item.id === a.id ? { ...item, done: !item.done } : item,
                          ),
                        )
                      }
                    >
                      {a.done ? t("Reabrir tarefa") : t("Concluir tarefa")}
                    </button>
                  </article>
                ))}
            </section>
          )}
          {tab === "Desempenho" && (
            <section className={styles.content}>
              <h3>{t("Atuação do time · todos os registros locais")}</h3>
              <p>{t("Contagem por responsável do registro. Reuniões incluem EBR e QBR.")}</p>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>{t("Responsável")}</th>
                      <th>{t("Contatos")}</th>
                      <th>{t("Reuniões")}</th>
                      <th>{t("Tarefas abertas")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OWNERS.map((o) => (
                      <tr key={o}>
                        <th>{o}</th>
                        <td>
                          {
                            activities.filter((a) => a.owner === o && a.kind === "Atendimento")
                              .length
                          }
                        </td>
                        <td>
                          {
                            activities.filter(
                              (a) => a.owner === o && ["Reunião", "EBR", "QBR"].includes(a.kind),
                            ).length
                          }
                        </td>
                        <td>{tasks.filter((a) => a.owner === o).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      </div>
      <p role="status" className={styles.status}>
        {message}
      </p>
    </main>
  );
}
