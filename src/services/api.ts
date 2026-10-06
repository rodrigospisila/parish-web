import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getDeviceId, getDeviceName } from './device';

const API_BASE = String(import.meta.env.VITE_API_URL ?? '');

/**
 * Cliente HTTP compartilhado das páginas de módulos (Fases 3–4).
 * Anexa o token automaticamente; as páginas legadas seguem usando axios direto.
 */
export const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Governança de acesso (D4.7): identifica o dispositivo em TODAS as requisições
 * à API Parish (`X-Device-Id` / `X-Device-Name`). Registrado na instância `api`
 * e no axios global (páginas legadas), mas nunca em chamadas a outros hosts —
 * headers customizados forçariam preflight CORS em serviços de terceiros.
 */
function targetsParishApi(config: InternalAxiosRequestConfig): boolean {
  const url = config.url ?? '';
  if (/^https?:\/\//i.test(url)) {
    return API_BASE !== '' && url.startsWith(API_BASE);
  }
  // URL relativa: usa o baseURL da instância (`api`) ou a mesma origem
  const base = config.baseURL ?? '';
  return base === '' || base === API_BASE;
}

function attachDeviceInterceptor(instance: AxiosInstance) {
  instance.interceptors.request.use((config) => {
    if (targetsParishApi(config)) {
      config.headers['X-Device-Id'] = getDeviceId();
      config.headers['X-Device-Name'] = getDeviceName();
    }
    return config;
  });
}

attachDeviceInterceptor(api);
attachDeviceInterceptor(axios);

/**
 * Troca a sessão pelos tokens devolvidos por uma ação que encerra as demais
 * (ativar 2FA, esquecer outro aparelho). Devolve false quando a resposta não
 * trouxe tokens (servidor antigo) — nesse caso a sessão atual segue como está.
 */
export function adoptTokens(tokens: { accessToken?: string; refreshToken?: string } | null | undefined): boolean {
  if (!tokens?.accessToken) return false;
  localStorage.setItem('token', tokens.accessToken);
  if (tokens.refreshToken) localStorage.setItem('refreshToken', tokens.refreshToken);
  axios.defaults.headers.common['Authorization'] = `Bearer ${tokens.accessToken}`;
  return true;
}

/**
 * Renovação automática de sessão: ao receber 401 (token expirado), tenta o
 * refresh token UMA vez (com fila única) e reexecuta a requisição original.
 * Registrado na instância `api` e no axios global (páginas legadas usam axios
 * direto com headers manuais).
 *
 * Só desloga quando o SERVIDOR recusa o refresh (401/403) ou não há refresh
 * token. Limite (429), servidor fora do ar (5xx) ou falha de rede são falhas
 * TEMPORÁRIAS: os tokens ficam, a requisição falha agora e a renovação é
 * tentada de novo depois (respeitando o Retry-After quando o navegador o expõe).
 */
type RefreshOutcome =
  | { kind: 'ok'; token: string }
  | { kind: 'temporary'; retryAfterMs: number }
  | { kind: 'rejected' };

/** Espera padrão antes de tentar renovar de novo após falha temporária sem Retry-After */
const TEMPORARY_REFRESH_BACKOFF_MS = 15_000;
/** Até quando não vale a pena tentar o refresh de novo (falha temporária recente) */
let refreshBlockedUntil = 0;
let refreshPromise: Promise<RefreshOutcome> | null = null;

/**
 * Lê o cabeçalho Retry-After (segundos ou data HTTP) de um erro do axios.
 * Devolve null quando não veio — ou quando o navegador não o expõe (CORS).
 */
export function getRetryAfterMs(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  const headers: any = error.response?.headers;
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
  if (raw === undefined || raw === null || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function refreshAccessToken(): Promise<RefreshOutcome> {
  const stored = localStorage.getItem('refreshToken');
  if (!stored) return { kind: 'rejected' };
  try {
    const response = await axios.post(
      `${import.meta.env.VITE_API_URL}/auth/refresh`,
      { refreshToken: stored },
      // Instância "crua" sem interceptors não é necessária: a rota é excluída abaixo
    );
    const { accessToken, refreshToken } = response.data || {};
    if (!accessToken) return { kind: 'rejected' };
    localStorage.setItem('token', accessToken);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
    refreshBlockedUntil = 0;
    return { kind: 'ok', token: accessToken };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    // Refresh recusado de verdade (expirado, revogado, de outro aparelho): sessão acabou
    if (status === 401 || status === 403) return { kind: 'rejected' };
    // 429, 5xx, rede ou qualquer outra resposta: falha temporária — mantém a sessão
    const retryAfterMs = getRetryAfterMs(error) ?? TEMPORARY_REFRESH_BACKOFF_MS;
    refreshBlockedUntil = Date.now() + retryAfterMs;
    return { kind: 'temporary', retryAfterMs };
  }
}

// Rotas de autenticação: um 401 aqui é "credencial/código inválido", não sessão expirada
const AUTH_ROUTES = ['/auth/login', '/auth/2fa/login', '/auth/refresh'];

function endSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

function attachRefreshInterceptor(instance: { interceptors: any }) {
  instance.interceptors.response.use(
    (response: any) => response,
    async (error: any) => {
      const original = error.config;
      const status = error.response?.status;
      const url: string = original?.url || '';
      const isAuthRoute = AUTH_ROUTES.some((route) => url.includes(route));
      if (status !== 401 || isAuthRoute || !original || original._retried) {
        return Promise.reject(error);
      }
      original._retried = true;

      // Falha temporária recente no refresh: não martela o servidor; a próxima
      // requisição depois da espera tenta renovar de novo (sessão preservada)
      if (Date.now() < refreshBlockedUntil) {
        return Promise.reject(error);
      }

      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const outcome = await refreshPromise;

      if (outcome.kind === 'rejected') {
        endSession();
        return Promise.reject(error);
      }
      if (outcome.kind === 'temporary') {
        return Promise.reject(error);
      }

      original.headers = { ...(original.headers || {}), Authorization: `Bearer ${outcome.token}` };
      return axios.request(original);
    },
  );
}

attachRefreshInterceptor(api);
attachRefreshInterceptor(axios);

export function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export default api;
