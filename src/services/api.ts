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
 * Renovação automática de sessão: ao receber 401 (token expirado), tenta o
 * refresh token UMA vez (com fila única) e reexecuta a requisição original.
 * Registrado na instância `api` e no axios global (páginas legadas usam axios
 * direto com headers manuais). Sem refresh válido → volta ao login.
 */
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const stored = localStorage.getItem('refreshToken');
  if (!stored) return null;
  try {
    const response = await axios.post(
      `${import.meta.env.VITE_API_URL}/auth/refresh`,
      { refreshToken: stored },
      // Instância "crua" sem interceptors não é necessária: a rota é excluída abaixo
    );
    const { accessToken, refreshToken } = response.data || {};
    if (!accessToken) return null;
    localStorage.setItem('token', accessToken);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
    return accessToken;
  } catch {
    return null;
  }
}

// Rotas de autenticação: um 401 aqui é "credencial/código inválido", não sessão expirada
const AUTH_ROUTES = ['/auth/login', '/auth/2fa/login', '/auth/refresh'];

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

      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;

      if (!newToken) {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
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
