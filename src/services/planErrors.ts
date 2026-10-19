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

/** Tela "Meu plano" (planos, faturas e contratação da paróquia). */
export const MY_PLAN_PATH = '/admin/meu-plano';

/** Quem abre o "Meu plano" e, por isso, recebe o atalho no aviso (saas-implantacao-07 / eng-acessos-24). */
const PLAN_MANAGER_ROLES = ['PARISH_ADMIN', 'DIOCESAN_ADMIN', 'SYSTEM_ADMIN'];

/** Mensagens para quem NÃO administra o plano (coordenação, voluntários...). */
export const PLAN_MESSAGES: Record<PlanErrorCode, string> = {
  PLAN_REQUIRED:
    'Este recurso faz parte do plano da comunidade, que ainda não está ativo. Calendário, mapa e liturgia continuam liberados; para ativar, fale com a coordenação da sua paróquia.',
  PLAN_SCOPE: 'Esta comunidade está fora do seu acesso.',
  PLAN_MEMBER_LIMIT:
    'A comunidade atingiu o limite de membros ativos da faixa do plano (conta também quem entrou pelo app). Para mudar de faixa, fale com a coordenação da sua paróquia.',
};

/** Mensagens para a administração da paróquia: o caminho é o "Meu plano". */
export const PLAN_MESSAGES_FOR_MANAGERS: Record<PlanErrorCode, string> = {
  PLAN_REQUIRED:
    'Este recurso faz parte do plano da comunidade, que ainda não está ativo. Calendário, mapa e liturgia continuam liberados. Veja as opções de teste e contratação em "Meu plano".',
  PLAN_SCOPE: PLAN_MESSAGES.PLAN_SCOPE,
  PLAN_MEMBER_LIMIT:
    'A comunidade atingiu o limite de membros ativos da faixa do plano (conta também quem entrou pelo app). Você pode mudar de faixa em "Meu plano".',
};

/** Papel de quem está logado (do usuário guardado; ilegível = sem papel). */
function storedRole(): string {
  try {
    const stored = JSON.parse(localStorage.getItem('user') || 'null');
    return typeof stored?.role === 'string' ? stored.role : '';
  } catch {
    return '';
  }
}

/** A pessoa logada administra o plano (vê o "Meu plano")? */
export function managesPlan(role: string = storedRole()): boolean {
  return PLAN_MANAGER_ROLES.includes(role);
}

/** Mensagem do aviso conforme o papel de quem está logado. */
export function planMessageFor(code: PlanErrorCode, role: string = storedRole()): string {
  return (managesPlan(role) ? PLAN_MESSAGES_FOR_MANAGERS : PLAN_MESSAGES)[code];
}

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
  /** Atalho para o "Meu plano" (só para quem administra o plano) */
  action?: { label: string; href: string } | null;
}

let installed = false;
/** Erros já tratados: a mesma falha pode passar pelas duas cadeias (api → refresh → axios). */
const handled = new WeakSet<object>();

function onPlanError(error: any) {
  const code = planErrorCode(error);
  if (!code || handled.has(error)) return;
  handled.add(error);
  const data = error.response.data as { message?: unknown; feature?: unknown; friendly?: boolean };
  const role = storedRole();
  const message = planMessageFor(code, role);
  if (!data.friendly) {
    data.message = message;
    data.friendly = true;
  }
  const action = code !== 'PLAN_SCOPE' && managesPlan(role) ? { label: 'Ver meu plano', href: MY_PLAN_PATH } : null;
  window.dispatchEvent(
    new CustomEvent<PlanRequiredDetail>(PLAN_REQUIRED_EVENT, {
      detail: { code, feature: typeof data.feature === 'string' ? data.feature : null, message, action },
    }),
  );
}

/**
 * Instala uma vez (idempotente) na instância `api` E no axios global — as
 * telas legadas (Escalas, Pastorais, Membros...) ainda chamam o axios direto
 * (eng-qualidade-01 / ux-web-07). Chamado no main.tsx (e pelo AdminLayout,
 * por garantia).
 */
export function installPlanErrorHandler(): void {
  if (installed) return;
  installed = true;
  for (const instance of [api, axios]) {
    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        onPlanError(error);
        return Promise.reject(error);
      },
    );
  }
}
