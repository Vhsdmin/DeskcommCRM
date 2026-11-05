/**
 * Capacidades de CONFIGURAR O CRM — funis e seus campos, regras automáticas,
 * entradas automáticas de contatos, dados da empresa, agenda, equipe, produtos
 * e as leituras de gestão (desempenho, atividades, auditoria).
 *
 * ⚠️ TODAS SÃO OPERADAS POR PESSOA (`apenasHumano: true`) e exigem o escopo
 * `mcp:config`, que só um token emitido na tela de tokens carrega. O token
 * efêmero do agente de IA nasce com `mcp:read`/`mcp:write` e nunca com este
 * escopo; e a ponte do turno não monta capacidade `apenasHumano`
 * (`lib/ai/runtime/tools.ts`). É a mesma linha que `lib/operacao/regras-automaticas.ts`
 * já traçava: o agente liga e desliga o que uma pessoa escreveu; escrever a
 * regra, escolher para onde a empresa manda dados e mudar papel de alguém é
 * decisão de gente, agora alcançável por quem opera o CRM por fora da tela.
 *
 * ESTE ARQUIVO FALA COM O HUMANO (`rotulo`, `explicacao`, `oQueToca`). O texto
 * para o MODELO é a `description` do handler em `lib/mcp/tools/configuracao.ts`.
 */
import { declararTools } from "./tipos";

export const TOOLS_CONFIGURACAO = declararTools([
  {
    name: "crm_create_pipeline",
    category: "write",
    rotulo: "Criar um funil",
    explicacao:
      "Cria um funil novo já com as etapas iniciais, para separar jornadas diferentes, como inscrições e vendas.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_update_pipeline",
    category: "write",
    rotulo: "Renomear um funil ou torná-lo o padrão",
    explicacao:
      "Muda o nome ou a descrição de um funil, ou define qual funil é o padrão da empresa. Não apaga nada.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_pipeline_config",
    category: "read",
    rotulo: "Ver a configuração de um funil",
    explicacao:
      "Mostra as etapas, os campos de cada negócio, o vocabulário e os motivos de perda de um funil, para conferir o que está valendo.",
    oQueToca: "Funil de vendas",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_set_pipeline_fields",
    category: "write",
    rotulo: "Definir os campos de um funil",
    explicacao:
      "Define os campos que aparecem em cada negócio do funil, o vocabulário e os motivos de perda, de uma vez só e no lugar da lista anterior.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_automation_rule",
    category: "read",
    rotulo: "Ver uma regra automática por dentro",
    explicacao:
      "Mostra o gatilho, as condições e as ações de uma regra automática, sem revelar segredos, para conferir antes de ligar.",
    oQueToca: "Regras automáticas",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_create_automation_rule",
    category: "write",
    rotulo: "Criar uma regra automática",
    explicacao:
      "Cria uma regra que dispara sozinha quando algo acontece, com condições e ações, e já define se nasce ligada ou pausada.",
    oQueToca: "Regras automáticas",
    risco: "critico",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_update_automation_rule",
    category: "write",
    rotulo: "Alterar uma regra automática",
    explicacao:
      "Muda o nome, o gatilho, as condições ou as ações de uma regra automática. O que não for informado fica como está.",
    oQueToca: "Regras automáticas",
    risco: "critico",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_update_webhook_source",
    category: "write",
    rotulo: "Ajustar uma entrada automática de contatos",
    explicacao:
      "Muda o nome, o funil e a etapa de destino, o redirecionamento ou a assinatura de uma entrada automática de contatos.",
    oQueToca: "Entradas automáticas de contatos",
    risco: "critico",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_org_settings",
    category: "read",
    rotulo: "Ver os dados da empresa",
    explicacao:
      "Mostra os dados da empresa: nome, fuso horário, idioma, moeda, retenção de mídia, contato de privacidade e marcadores sugeridos.",
    oQueToca: "Dados da empresa",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_update_org_settings",
    category: "write",
    rotulo: "Alterar os dados da empresa",
    explicacao:
      "Altera os dados da empresa, como nome, fuso horário, idioma, moeda e retenção de mídia. Só o que for informado muda.",
    oQueToca: "Dados da empresa",
    risco: "critico",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_set_canonical_tags",
    category: "write",
    rotulo: "Definir os marcadores sugeridos",
    explicacao:
      "Define a lista de marcadores que o time vê como sugestão nas conversas, substituindo a lista anterior inteira.",
    oQueToca: "Organização da operação",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_create_event_type",
    category: "write",
    rotulo: "Criar um tipo de atendimento na agenda",
    explicacao:
      "Cria um tipo de compromisso na agenda, com duração, local, antecedência mínima e lembretes, para a equipe e os agentes agendarem.",
    oQueToca: "Agenda",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_set_member_role",
    category: "write",
    rotulo: "Mudar o papel de alguém da equipe",
    explicacao:
      "Muda o papel de uma pessoa da equipe entre leitura, atendimento, gestão e administração. O último administrador nunca é rebaixado.",
    oQueToca: "Equipe",
    risco: "critico",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_create_product",
    category: "write",
    rotulo: "Cadastrar um produto",
    explicacao:
      "Cadastra um produto no catálogo com código, nome, preço e estoque, na moeda da empresa, para aparecer nas ofertas.",
    oQueToca: "Catálogo de produtos",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_update_product",
    category: "write",
    rotulo: "Alterar um produto",
    explicacao:
      "Altera o preço, o estoque, a descrição ou a situação de um produto do catálogo. Só o que for informado muda.",
    oQueToca: "Catálogo de produtos",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_performance",
    category: "read",
    rotulo: "Ver o desempenho da equipe",
    explicacao:
      "Mostra, num período, quantos negócios cada atendente ganhou e perdeu, quantas conversas atendeu e quanto demorou a responder.",
    oQueToca: "Desempenho",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_list_activities",
    category: "read",
    rotulo: "Ver o relatório de atividades",
    explicacao:
      "Mostra o que aconteceu nos últimos dias: quem fez o quê, por tipo e por dia, separando pessoas, agentes e o automático.",
    oQueToca: "Atividades",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_list_audit",
    category: "read",
    rotulo: "Consultar o registro de auditoria",
    explicacao:
      "Lista as ações registradas na auditoria da empresa, com filtros por ação, recurso, pessoa e período, para rastrear quem mudou o quê.",
    oQueToca: "Auditoria",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
]);
