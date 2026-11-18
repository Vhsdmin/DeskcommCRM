# Webhook do core da VendePay → CRM

O CRM recebe do core da VendePay a fotografia de cada vendedor, no formato que o core já envia (`crm.user.updated`). O CRM se adapta ao core, não o contrário. A fonte da verdade do formato aceito é `lib/gestao/contrato.ts`.

## Endereço e segredo

O endereço é do CRM; o segredo é do core.

1. No CRM, em **Canais › Webhooks › Receber dados**, quem tem papel de gestor cria a conexão. A tela mostra o **endereço** `https://<domínio-do-crm>/api/v1/webhooks/gestao/<token>`.
2. Na Gestão, um superadministrador informa esse endereço em **Integração CRM**. O core gera o **segredo de assinatura** e o exibe uma única vez.
3. No CRM, cole o segredo na mesma tela. Ele fica guardado cifrado e nunca volta ao navegador.

Enquanto o segredo não é colado, o CRM responde `503` e o core tenta de novo mais tarde, sem perder o envio. Para trocar o segredo, informe o endereço de novo na Gestão (o core gera outro) e cole o novo no CRM.

Cada ambiente (homologação, produção) tem a sua conexão, com endereço e segredo próprios.

## Requisição

- `POST`, `Content-Type: application/json`, um evento por requisição.
- Cabeçalho `vendepay-signature`: `t=<unix>,v1=<hex>`, com `<hex>` = HMAC SHA-256 de `"<unix>.<corpo exato enviado>"`, usando o segredo. O `t` precisa estar a até 5 minutos do relógio do CRM; o core assina de novo a cada tentativa.

```json
{
  "id": "crm:…",
  "type": "crm.user.updated",
  "apiVersion": "2026-06-01",
  "createdAt": "2026-11-17T12:00:00.000Z",
  "data": {
    "asOf": "2026-11-17T12:00:05.000Z",
    "user": {
      "id": "ID-do-usuario-no-Gestao",
      "name": "Loja Exemplo",
      "email": "contato@exemplo.com",
      "phone": "+5511999998888"
    },
    "onboarding": { "…": "…" },
    "verification": { "…": "…" }
  }
}
```

| Campo | Regra |
|---|---|
| `id` | Único por entrega. Reenviar o mesmo id não processa de novo. |
| `type` | Só `crm.user.updated`. |
| `apiVersion` | Só `2026-06-01`. |
| `data.asOf` | ISO-8601 com fuso: quando a fotografia foi tirada. Fotografia mais antiga que a última aplicada ao cliente é ignorada. |
| `data.user.id` | ID do usuário no Gestão. É a chave do vínculo com o cliente no CRM. |
| `data.user.email` | Obrigatório. Também é o nome do cliente quando `name` vem vazio. |
| `data.user.name`, `data.user.phone` | Opcionais. Telefone em E.164 ou formato brasileiro. |
| `data.onboarding`, `data.verification` | Aceitos e ignorados: por ora o CRM guarda só o contato. |

O cliente é encontrado **somente** pelo `data.user.id`. E-mail e telefone nunca juntam contas.

## Respostas

O core trata `2xx` como entregue; `408`, `425`, `429` e `5xx` como temporários (tenta de novo, até 8 vezes, com espera crescente); os demais `3xx`/`4xx` como definitivos (reenvio manual pela Gestão).

| Status | Significado | O core |
|---|---|---|
| `200` `criado` / `atualizado` | Cliente criado (fase Entrada da jornada) ou atualizado. | Entregue |
| `200` `duplicado` | `id` já processado. | Entregue |
| `200` `ignorado` | Fotografia mais antiga que a última aplicada a este cliente (entrega fora de ordem). | Entregue |
| `400` | JSON inválido ou fora do contrato (`details` diz o campo). | Desiste |
| `401` | Assinatura ausente, inválida ou fora da janela de 5 minutos. | Desiste |
| `404` | Endereço desconhecido ou conexão pausada. | Desiste |
| `409` | E-mail ou telefone já pertence a outro cliente do CRM (resolve-se na ficha; depois, reenvio manual). | Desiste |
| `410` | O cliente vinculado foi anonimizado (LGPD). | Desiste |
| `429` | Mais de 120 envios por minuto no mesmo endereço. | Tenta de novo |
| `503` | Segredo ainda não colado, o mesmo `id` ainda em processamento ou chave de cifra indisponível. | Tenta de novo |
| `500` | Falha do CRM. | Tenta de novo |

Todo envio autenticado aparece em **Últimos envios**, com o resultado e o motivo da recusa.
