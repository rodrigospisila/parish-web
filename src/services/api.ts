import axios from 'axios';

/**
 * Cliente HTTP compartilhado das páginas de módulos (Fases 3–4).
 * Anexa o token automaticamente; as páginas legadas seguem usando axios direto.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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

function attachRefreshInterceptor(instance: { interceptors: any }) {
  instance.interceptors.response.use(
    (response: any) => response,
    async (error: any) => {
      const original = error.config;
      const status = error.response?.status;
      const url: string = original?.url || '';
      const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/refresh');
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
