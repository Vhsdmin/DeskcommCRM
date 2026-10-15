/**
 * Meta Ads fica OCULTO no CRM da VendePay (decisão de 14/10/2026): a VendePay
 * não importa dados da conta de anúncios.
 *
 * As duas telas (`/app/ads/meta` e `/app/settings/meta-ads`) respondem 404 e
 * saíram do catálogo de navegação; o código e as APIs continuam no lugar. Para
 * reativar: troque para `true` e devolva as duas entradas a
 * `lib/navigation/catalogo.ts` (estão no histórico do git) — e tire as duas
 * rotas da `NAV_ALLOWLIST` de `tests/unit/navegacao-completude.test.ts`.
 */
export const META_ADS_VISIVEL = false;
