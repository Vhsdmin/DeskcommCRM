---
impacto: capacidade_nova
secao: adicionado
titulo: Assistente interno dos CSMs, com documentos e consulta ao CRM
---
Agente de IA › Agentes passa a configurar assistentes internos dos CSMs: nome, descrição, instruções, documentos (PDF, Markdown ou TXT, enviados direto da tela) e empresa/modelo/chave de IA. O resto do editor de atendente de WhatsApp fica oculto atrás de `ASSISTENTE_CS` (`lib/ai/agents/assistente-cs.ts`). A nova tela Assistente (`/app/assistente`) deixa o CSM perguntar sobre produto, processos, empresa e clientes: o assistente busca nos documentos marcados e consulta clientes, atividades, tarefas e NPS do CRM, somente leitura e com as permissões de quem pergunta, citando as fontes. Crédito: @filipefagundes.
