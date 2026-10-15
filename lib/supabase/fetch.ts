/** Uma segunda tentativa apenas para leituras com falha de transporte.
 * Não repete login, refresh, RPCs POST nem gravações; não aceita sessão sem validação.
 * Leituras de sessão e dados são sempre frescas, sem cache de fetch do Next.
 */
export const supabaseFetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const read = method === "GET" || method === "HEAD";
  const signal = init?.signal ?? request?.signal;
  const options = read ? { ...init, cache: "no-store" as const } : init;
  try {
    return await fetch(input, options);
  } catch (error) {
    if (!read || signal?.aborted || !(error instanceof TypeError)) throw error;
    // fetch failed (ECONNRESET/erro de rede). A segunda falha segue para o SDK.
    return await fetch(input, options);
  }
};
