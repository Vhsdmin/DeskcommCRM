# Webhook Gestão VendePay → CRM

Contrato para o time do Gestão implementar o envio de eventos de conta ao CRM. A fonte da verdade do formato é `lib/gestao/contrato.ts`.

## Endereço e segredo

No CRM, em **Canais › Webhooks › Receber dados**, quem tem papel de gestor cria a conexão. A tela mostra:

- o **endereço** `https://<domínio-do-crm>/api/v1/webhooks/gestao/<token>`;
- o **segredo de assinatura**, exibido uma única vez. Se for perdido, use **Trocar segredo**: o anterior deixa de valer na hora.

Cada ambiente (homologação, produção) tem a sua conexão, com endereço e segredo próprios.

## Requisição

- `POST`, `Content-Type: application/json`, um evento por requisição.
- Cabeçalho `X-VendePay-Signature`: HMAC SHA-256 do **corpo exato enviado**, com o segredo, em hexadecimal. O prefixo `sha256=` é opcional.

```json
{
  "event_id": "evt_01J9...",
  "event_type": "account.created",
  "occurred_at": "2026-10-14T12:00:00Z",
  "account": {
    "id": "UUID-do-usuario-no-Gestao",
    "name": "Loja Exemplo",
    "email": "contato@exemplo.com",
    "phone": "+5511999998888"
  }
}
```

| Campo | Regra |
|---|---|
| `event_id` | Único por evento. Reenviar o mesmo id não processa de novo. |
| `event_type` | `account.created` ou `account.updated`. |
| `occurred_at` | ISO-8601 com fuso. |
| `account.id` | ID do usuário no Gestão. É a chave do vínculo com o cliente no CRM. |
| `account.name` | Obrigatório. |
| `account.email`, `account.phone` | Opcionais. Telefone em E.164 ou formato brasileiro. |

O cliente é encontrado **somente** pelo `account.id`. E-mail e telefone nunca juntam contas.

## Respostas

| Status | Significado | Reenviar? |
|---|---|---|
| `200` `criado` / `atualizado` | Cliente criado (fase Entrada da jornada) ou atualizado. | Não |
| `200` `duplicado` | `event_id` já processado. | Não |
| `400` | JSON inválido ou fora do contrato (`details` diz o campo). | Depois de corrigir |
| `401` | Assinatura ausente ou inválida. | Depois de corrigir o segredo |
| `404` | Endereço desconhecido ou conexão pausada. | Não |
| `409` | E-mail ou telefone já pertence a outro cliente do CRM. Uma pessoa resolve na ficha. | Sim, depois de resolvido |
| `410` | O cliente vinculado foi anonimizado (LGPD). | Não |
| `429` | Mais de 120 envios por minuto no mesmo endereço. | Sim, após `Retry-After` |
| `500` / `503` | Falha do CRM. | Sim, com espera crescente |

Todo envio autenticado aparece em **Últimos envios**, com o resultado e o motivo da recusa.
