/**
 * Os agentes do CRM da VendePay são ASSISTENTES INTERNOS dos CSMs (decisão de
 * 15/10/2026): respondem dúvidas sobre produto, processo, empresa e clientes,
 * consultando os documentos do agente e os dados do CRM. Não atendem WhatsApp.
 *
 * Com `true`, o editor de agente mostra só nome, descrição, instruções,
 * documentos e modelo/chave; o resto (número, funis, freios, estilo,
 * capacidades, gatilho, passagem para humano, follow-up, papéis e publicação)
 * fica oculto, com o código preservado. A conversa mora em `/app/assistente`.
 */
export const ASSISTENTE_CS = true;
