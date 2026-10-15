import { ApiError } from "@/lib/api/types";

/** Só recusas de configuração são exibidas; erros internos mantêm o aviso genérico. */
export function mensagemDeConfiguracaoDaAgenda(error: unknown): string | undefined {
  return error instanceof ApiError && error.status === 422 ? error.message : undefined;
}
