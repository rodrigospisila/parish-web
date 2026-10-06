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
/**
 * Prazo do POST /auth/refresh: sem ele, uma conexão pendurada prendia a
 * trava entre abas (e todas as requisições na fila) indefinidamente. Vencido,
 * conta como falha temporária (a sessão fica).
 */
const REFRESH_TIMEOUT_MS = 15_000;
/** Sem Web Locks: quanto esperar, na recusa, até outra aba gravar o par novo. */
const NO_LOCK_RECHECK_MS = 1_000;
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

/**
 * Várias abas compartilham o localStorage, mas cada uma tem a sua fila de
 * refresh (B38). O Web Locks serializa a renovação entre as abas; sem ele
 * (navegador antigo) a renovação segue sem trava e a releitura abaixo cobre.
 */
function hasWebLocks(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as any).locks?.request === 'function';
}

async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } }).locks;
  if (!locks?.request) return task();
  try {
    return await locks.request('parish-refresh', task);
  } catch {
    return task();
  }
}

/**
 * `sentToken`: o access token que a requisição recusada levou. Se outra aba
 * já renovou (o token guardado mudou), usa o novo em vez de renovar de novo —
 * mandar o mesmo refresh duas vezes faria a segunda receber 401 e deslogar
 * todas as abas.
 */
async function refreshAccessToken(sentToken: string | null): Promise<RefreshOutcome> {
  return withRefreshLock(async () => {
    const current = localStorage.getItem('token');
    if (current && sentToken && current !== sentToken) return { kind: 'ok', token: current };
    return doRefresh();
  });
}

async function doRefresh(): Promise<RefreshOutcome> {
  const stored = localStorage.getItem('refreshToken');
  if (!stored) return { kind: 'rejected' };
  try {
    const response = await axios.post(
      `${import.meta.env.VITE_API_URL}/auth/refresh`,
      { refreshToken: stored },
      // Instância "crua" sem interceptors não é necessária: a rota é excluída abaixo
      { timeout: REFRESH_TIMEOUT_MS },
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
    if (status === 401 || status === 403) {
      // Outra aba trocou o refresh token enquanto este pedido ia: a sessão segue com o dela
      const rotatedElsewhere = () => {
        const latestRefresh = localStorage.getItem('refreshToken');
        const latestAccess = localStorage.getItem('token');
        return latestRefresh && latestRefresh !== stored && latestAccess ? latestAccess : null;
      };
      const adopted = rotatedElsewhere();
      if (adopted) return { kind: 'ok', token: adopted };
      // Sem Web Locks (Safari < 15.4): a aba que ganhou a corrida pode ainda
      // não ter gravado o par novo — espera um pouco e relê antes de deslogar
      // todas as abas
      if (!hasWebLocks()) {
        await new Promise((resolve) => setTimeout(resolve, NO_LOCK_RECHECK_MS));
        const late = rotatedElsewhere();
        if (late) return { kind: 'ok', token: late };
      }
      // Refresh recusado de verdade (expirado, revogado, de outro aparelho): sessão acabou
      return { kind: 'rejected' };
    }
    // 429, 5xx, rede ou qualquer outra resposta: falha temporária — mantém a sessão
    const retryAfterMs = getRetryAfterMs(error) ?? TEMPORARY_REFRESH_BACKOFF_MS;
    refreshBlockedUntil = Date.now() + retryAfterMs;
    return { kind: 'temporary', retryAfterMs };
  }
}

// Rotas de autenticação: um 401 aqui é "credencial/código inválido", não sessão expirada
const AUTH_ROUTES = ['/auth/login', '/auth/2fa/login', '/auth/refresh', '/auth/logout/refresh'];

/**
 * Encerra NO SERVIDOR a sessão deste navegador (best-effort, nunca lança).
 * Instância sem interceptors: o local já foi limpo e um 401 aqui não pode
 * disparar refresh nem redirecionar. Com o access token vencido o POST
 * /auth/logout é recusado (401) antes de encerrar a sessão — então o refresh
 * token encerra a sessão por POST /auth/logout/refresh (servidor antigo, sem
 * a rota: 404 ignorado; a sessão vence sozinha).
 */
export async function endServerSession(accessToken: string | null, refreshToken: string | null): Promise<void> {
  const bare = axios.create({ baseURL: API_BASE, timeout: REFRESH_TIMEOUT_MS });
  if (accessToken) {
    try {
      await bare.post('/auth/logout', refreshToken ? { refreshToken } : {}, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status !== 401 || !refreshToken) return;
    }
  }
  if (!refreshToken) return;
  try {
    await bare.post('/auth/logout/refresh', { refreshToken });
  } catch {
    // best-effort
  }
}

/** Código do 403 quando a conta precisa trocar a senha antes de qualquer outra coisa (M18). */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';
export const CHANGE_PASSWORD_PATH = '/trocar-senha';

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
      // Troca de senha obrigatória ligada no servidor: leva à tela de troca
      if (status === 403 && error.response?.data?.code === PASSWORD_CHANGE_REQUIRED) {
        try {
          const stored = JSON.parse(localStorage.getItem('user') || 'null');
          if (stored) localStorage.setItem('user', JSON.stringify({ ...stored, forcePasswordChange: true }));
        } catch {
          // usuário guardado ilegível: só redireciona
        }
        if (!window.location.pathname.startsWith(CHANGE_PASSWORD_PATH)) window.location.href = CHANGE_PASSWORD_PATH;
        return Promise.reject(error);
      }
      if (status !== 401 || isAuthRoute || !original || original._retried) {
        return Promise.reject(error);
      }
      original._retried = true;

      // Falha temporária recente no refresh: não martela o servidor; a próxima
      // requisição depois da espera tenta renovar de novo (sessão preservada)
      if (Date.now() < refreshBlockedUntil) {
        return Promise.reject(error);
      }

      const headers = original.headers;
      const sentAuth = String((typeof headers?.get === 'function' ? headers.get('Authorization') : headers?.Authorization) ?? '');
      const sentToken = sentAuth.startsWith('Bearer ') ? sentAuth.slice(7) : null;
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken(sentToken).finally(() => {
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
