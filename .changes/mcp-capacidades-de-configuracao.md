---
impacto: capacidade_nova
secao: adicionado
titulo: Configurar o CRM por fora da tela, pela MCP, com um token marcado como "configurar"
---

Quem opera o CRM por um assistente (Claude Code, um script de implantação) passa a
criar e ajustar funis e seus campos, criar e alterar regras automáticas com condições,
ajustar entradas automáticas de contatos, alterar os dados da empresa e os marcadores
sugeridos, criar tipos de atendimento, mudar o papel de alguém da equipe, cadastrar e
alterar produtos, e ler desempenho, atividades e auditoria. São dezoito capacidades
novas, todas operadas por pessoa: exigem um token emitido em Configurações › API Tokens
com o escopo "configurar", e o agente de IA nunca as recebe nem as liga por pacote.

No caminho, três comportamentos foram corrigidos: alterar uma regra automática sem
reenviar as condições apagava as condições (o interruptor "Ativa" da tela fazia isso);
alterar um produto só pelo preço zerava o estoque e reativava o produto; e a auditoria
das chamadas da MCP gravava assinaturas e segredos em texto. Reenviar as ações de uma
regra sem o segredo passa a preservar a assinatura já guardada.

Destino: quem administra a organização. Nenhuma variável nova; nenhuma migração.
