import axios from 'axios';
import api from './api';

/**
 * Erros do plano da comunidade (backend: PlanFeatureGuard / MemberLimitGuard).
 *
 * - PLAN_REQUIRED: recurso pago e a comunidade não tem plano ativo;
 * - PLAN_SCOPE: id de comunidade/paróquia fora do escopo do usuário;
 * - PLAN_MEMBER_LIMIT: a comunidade atingiu o limite de membros da faixa.
 *
 * O interceptor troca a mensagem técnica por um aviso amigável (as telas que
 * mostram `getErrorMessage` já exibem o texto novo) e avisa o AdminLayout pelo
 * evento `PLAN_REQUIRED_EVENT`, que mostra a faixa explicativa — inclusive nas
 * telas que engolem o 403 em silêncio.
 */
export const PLAN_REQUIRED_EVENT = 'parish:plan-required';

export type PlanErrorCode = 'PLAN_REQUIRED' | 'PLAN_SCOPE' | 'PLAN_MEMBER_LIMIT';

export const PLAN_MESSAGES: Record<PlanErrorCode, string> = {
  PLAN_REQUIRED:
    'Este recurso não faz parte do plano desta comunidade. Calendário, mapa e liturgia continuam liberados; para ativar, fale com a administração da paróquia.',
  PLAN_SCOPE: 'Esta comunidade está fora do seu acesso.',
  PLAN_MEMBER_LIMIT:
    'A comunidade atingiu o limite de membros da faixa do plano. Fale com a administração da paróquia para mudar de faixa.',
};

export function planErrorCode(error: unknown): PlanErrorCode | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) return null;
  const code = (error.response.data as { code?: unknown } | undefined)?.code;
  return code === 'PLAN_REQUIRED' || code === 'PLAN_SCOPE' || code === 'PLAN_MEMBER_LIMIT' ? code : null;
}

export const isPlanRequiredError = (error: unknown) => planErrorCode(error) === 'PLAN_REQUIRED';

export interface PlanRequiredDetail {
  code: PlanErrorCode;
  feature: string | null;
  message: string;
}

let installed = false;

/** Instala uma vez (idempotente). Chamado pelo AdminLayout. */
export function installPlanErrorHandler(): void {
  if (installed) return;
  installed = true;
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      const code = planErrorCode(error);
      if (code) {
        const data = error.response.data as { message?: unknown; feature?: unknown; friendly?: boolean };
        if (!data.friendly) {
          data.message = PLAN_MESSAGES[code];
          data.friendly = true;
        }
        window.dispatchEvent(
          new CustomEvent<PlanRequiredDetail>(PLAN_REQUIRED_EVENT, {
            detail: { code, feature: typeof data.feature === 'string' ? data.feature : null, message: PLAN_MESSAGES[code] },
          }),
        );
      }
      return Promise.reject(error);
    },
  );
}
