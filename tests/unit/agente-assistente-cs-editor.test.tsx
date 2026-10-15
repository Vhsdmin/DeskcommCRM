/**
 * O editor de agente no modo ASSISTENTE DOS CSMs (lib/ai/agents/assistente-cs.ts):
 * só nome, descrição, instruções, documentos e modelo/chave aparecem; o que é
 * do atendente de WhatsApp fica oculto, e não há publicação — o assistente usa
 * a última versão salva.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const ORG = "33333333-3333-4333-8333-333333333333";
const AGENTE = "44444444-4444-4444-8444-444444444444";

const acoes = vi.hoisted(() => ({ salvar: vi.fn(), publicar: vi.fn(), criar: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/app/ai/agents/${AGENTE}`,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/app/app/ai/agents/[id]/_actions", () => ({
  saveAgentDraftAction: acoes.salvar,
  publishAgentAction: acoes.publicar,
  createMcpAgentAction: acoes.criar,
}));

import { AgentForm } from "@/app/app/ai/agents/[id]/_components/AgentForm";

const AGENTE_ROW = {
  id: AGENTE,
  organization_id: ORG,
  name: "Sofia",
  description: "assistente do consultório",
  priority: 0,
  model: "claude-sonnet-5",
  system_prompt: "x",
  is_active: true,
  is_default: false,
  config: {},
  guardrails: [],
  active_kb_version_id: null,
  kind: "mcp_agent",
  published_version_id: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/**
 * O rascunho de quem ainda não tem número: `channel_session_id` nulo e
 * `credential_id` nulo (= a chave da instalação). É o estado que o produto
 * produz numa instalação fresca, e o que esta suíte existe para exercitar.
 */
const RASCUNHO = {
  id: "v1",
  organization_id: ORG,
  agent_id: AGENTE,
  version_number: 1,
  status: "draft",
  system_prompt: "Você é a Sofia, assistente do consultório. Atenda com acolhimento.",
  provider: "anthropic",
  model: "claude-sonnet-5",
  credential_id: null,
  tool_ids: [],
  channel_session_id: null,
  max_steps: 10,
  token_budget: 50000,
  cost_budget_cents: 50,
  history_message_window: 20,
  history_token_window: 8000,
  handoff_keywords: [],
  handoff_tool_enabled: true,
  cases_enabled: false,
  split_messages: false,
  split_max_chars: 600,
  followup: { enabled: false, flow_pointer_ids: [] },
  operator_enabled: false,
  operator_model: null,
  operator_tool_ids: [],
  pipeline_ids: [],
  knowledge_source_ids: [],
  trigger_config: null,
  published_at: null,
  superseded_at: null,
  created_at: "2026-01-01T00:00:00Z",
  created_by: null,
};

function abrirEditor(
  opcoes: { canais?: Array<Record<string, unknown>>; versao?: Record<string, unknown> } = {},
) {
  const versao = opcoes.versao ?? RASCUNHO;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <AgentForm
        mode="edit"
        agent={AGENTE_ROW as never}
        // Instalação fresca: NENHUMA credencial cadastrada na tela de IA, e a
        // chave da Anthropic vindo do ambiente.
        credentials={[] as never}
        provedoresDaInstalacao={["anthropic"]}
        channelSessions={(opcoes.canais ?? []) as never}
        draft={versao as never}
        published={null}
        base={versao as never}
        draftObsoleto={null}
      />
    </QueryClientProvider>,
  );
  const botaoSalvar = () => screen.getByRole("button", { name: /salvar rascunho/i });
  const botaoPublicar = () => screen.getByRole("button", { name: /publicar/i });
  return { botaoSalvar, botaoPublicar, container };
}

describe("editor do agente no modo assistente dos CSMs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acoes.salvar.mockResolvedValue({ ok: true, data: { version_id: "v1", version_number: 1 } });
  });

  it("mostra só nome, descrição, instruções, documentos e modelo/chave", () => {
    abrirEditor();
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toBeInTheDocument();
    expect(screen.getByDisplayValue(RASCUNHO.system_prompt)).toBeInTheDocument();
    expect(screen.getByText("A inteligência que ele usa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar documento/i })).toBeInTheDocument();
  });

  it("esconde o que é do atendente de WhatsApp", () => {
    abrirEditor();
    for (const texto of [
      "Por qual número ele atende",
      "Freios de segurança",
      "Estilo de resposta",
      "O que o agente pode fazer",
      "Quando ele entra em ação",
      "Passar para uma pessoa",
      "Follow-up",
      "Ordem de preferência (0 a 1000)",
    ]) {
      expect(screen.queryByText(texto)).toBeNull();
    }
    expect(screen.queryByRole("tab", { name: /organiza o sistema/i })).toBeNull();
  });

  it("salva sem publicar: o botão é Salvar e Publicar não existe", async () => {
    abrirEditor();
    expect(screen.queryByRole("button", { name: /publicar/i })).toBeNull();
    fireEvent.change(screen.getByDisplayValue(RASCUNHO.system_prompt), {
      target: { value: "Responda dúvidas de produto citando o documento de origem." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^salvar$/i }));
    await waitFor(() => expect(acoes.salvar).toHaveBeenCalled());
  });
});
