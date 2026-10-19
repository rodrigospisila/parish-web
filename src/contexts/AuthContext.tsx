import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import api, { adoptTokens, endServerSession, getErrorMessage, PROFILE_STALE_EVENT } from '../services/api';
import { notify } from '../services/notification.service';

/** Intervalo mínimo entre recargas do perfil ao voltar à aba (eng-acessos-26). */
const PROFILE_FOCUS_REFRESH_MS = 5 * 60_000;
/** Intervalo mínimo entre recargas pedidas por 403/ações que mudam papel. */
const PROFILE_STALE_REFRESH_MS = 15_000;

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: 'Administrador do Sistema',
  DIOCESAN_ADMIN: 'Administração Diocesana',
  PARISH_ADMIN: 'Administração Paroquial',
  COMMUNITY_COORDINATOR: 'Coordenação de Comunidade',
  PASTORAL_COORDINATOR: 'Coordenação de Pastoral',
  VOLUNTEER: 'Voluntário(a)',
  FAITHFUL: 'Fiel',
};

/**
 * Perfil do /users/me no MESMO formato do login (auth.service mapUserResponse):
 * inclui `scopeCommunityId` e `coordinatedPastoralIds`, que liberam menu e rotas.
 */
function mapProfile(fresh: any): User {
  return {
    id: fresh.id,
    email: fresh.email,
    name: fresh.name,
    phone: fresh.phone ?? undefined,
    role: fresh.role,
    dioceseId: fresh.dioceseId ?? undefined,
    parishId: fresh.parishId ?? undefined,
    communityId: fresh.communityId ?? undefined,
    ...(fresh.scopeCommunityId !== undefined ? { scopeCommunityId: fresh.scopeCommunityId ?? null } : {}),
    pastoralIds: Array.isArray(fresh.pastoralIds) ? fresh.pastoralIds : [],
    ...(Array.isArray(fresh.coordinatedPastoralIds) ? { coordinatedPastoralIds: fresh.coordinatedPastoralIds } : {}),
    pastorals: Array.isArray(fresh.pastorals)
      ? fresh.pastorals.map((p: any) => ({ id: p.id, name: p.name, communityId: p.communityId, role: p.role }))
      : [],
    forcePasswordChange: fresh.forcePasswordChange ?? false,
    twoFactorEnabled: fresh.twoFactorEnabled ?? false,
  };
}

/** Aviso curto quando o papel ou a coordenação mudaram desde a última leitura. */
function describeAccessChange(previous: User, next: User): string | null {
  if (previous.role !== next.role) {
    return `Seu acesso foi atualizado: agora você está como ${ROLE_LABELS[next.role] ?? next.role}.`;
  }
  const before = new Set(previous.coordinatedPastoralIds ?? []);
  const gained = (next.coordinatedPastoralIds ?? []).filter((id) => !before.has(id));
  if (Array.isArray(previous.coordinatedPastoralIds) && gained.length > 0) {
    const names = (next.pastorals ?? []).filter((p) => gained.includes(p.id)).map((p) => p.name);
    return names.length
      ? `Seu acesso foi atualizado: agora você coordena ${names.join(', ')}.`
      : 'Seu acesso foi atualizado: você passou a coordenar uma pastoral.';
  }
  const after = new Set(next.coordinatedPastoralIds ?? []);
  if (Array.isArray(next.coordinatedPastoralIds) && [...before].some((id) => !after.has(id))) {
    return 'Seu acesso foi atualizado: a coordenação de uma pastoral mudou.';
  }
  return null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: string;
  dioceseId?: string;
  parishId?: string;
  /**
   * Comunidade do usuário. No gestor sem comunidade de escopo (PARISH_ADMIN,
   * DIOCESAN_ADMIN...), o backend novo devolve aqui a comunidade de FÉ, só
   * para exibição — o escopo real vem em `scopeCommunityId`.
   */
  communityId?: string;
  /** Comunidade de ESCOPO gravada (backend novo); ausente no servidor antigo */
  scopeCommunityId?: string | null;
  /** Pastorais em que participa (participação não dá gestão) */
  pastoralIds?: string[];
  /** Pastorais que COORDENA (backend novo) — é isto que libera a gestão */
  coordinatedPastoralIds?: string[];
  pastorals?: {
    id: string;
    name: string;
    communityId: string;
    role?: string;
  }[];
  forcePasswordChange: boolean;
  /** Autenticação em duas etapas ativa (Governança de acesso — D4.7) */
  twoFactorEnabled?: boolean;
}

/** Usuário resumido devolvido no desafio 2FA (ainda sem tokens). */
export interface TwoFactorChallengeUser {
  id: string;
  email: string;
  name: string;
}

export type LoginResult =
  | { requiresTwoFactor: true; challengeToken: string; user: TwoFactorChallengeUser }
  | { requiresTwoFactor: false; newDevice: boolean };

/** Erro de autenticação com o status HTTP (distingue código inválido de desafio expirado). */
export class AuthError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

interface LoginResponse {
  requiresTwoFactor?: boolean;
  challengeToken?: string;
  accessToken?: string;
  refreshToken?: string;
  newDevice?: boolean;
  user: User;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  /** Etapa 1: e-mail + senha. Pode devolver um desafio 2FA em vez de sessão. */
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Etapa 2: código do autenticador (ou de recuperação) para concluir o desafio. */
  loginWithTwoFactor: (challengeToken: string, code: string) => Promise<LoginResult>;
  /** Sai DESTE navegador (os outros aparelhos seguem logados) */
  logout: () => void;
  /** Encerra as sessões em todos os aparelhos (inclusive este) */
  logoutAllDevices: () => Promise<void>;
  /** Troca a senha da própria conta (Segurança / troca obrigatória) */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Recarrega o perfil do servidor (vínculos/pastorais novos sem relogin) */
  refreshUser: () => Promise<void>;
  /** Atualiza campos do usuário em memória/localStorage (ex.: twoFactorEnabled) */
  updateUser: (patch: Partial<User>) => void;
  /** Troca a sessão pelos tokens novos devolvidos por ações que encerram as demais (2FA, aparelhos) */
  adoptSession: (tokens: { accessToken?: string; refreshToken?: string } | null | undefined) => boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toAuthError(error: unknown, fallback: string): AuthError {
  if (error instanceof AuthError) return error;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return new AuthError(getErrorMessage(error, fallback), status);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
    }
    setLoading(false);
  }, []);

  /** Interpreta a resposta de /auth/login ou /auth/2fa/login e abre a sessão quando há tokens. */
  const applyLoginResponse = (data: LoginResponse): LoginResult => {
    if (data.requiresTwoFactor) {
      if (!data.challengeToken) {
        throw new AuthError('Resposta inválida do servidor ao iniciar a verificação em duas etapas');
      }
      const { id, email, name } = data.user;
      return { requiresTwoFactor: true, challengeToken: data.challengeToken, user: { id, email, name } };
    }

    const { accessToken, refreshToken, user: userData } = data;
    if (!accessToken) {
      throw new AuthError('Resposta inválida do servidor ao fazer login');
    }

    setToken(accessToken);
    setUser(userData);

    localStorage.setItem('token', accessToken);
    if (refreshToken) {
      localStorage.setItem('refreshToken', refreshToken);
    }
    localStorage.setItem('user', JSON.stringify(userData));

    axios.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
    return { requiresTwoFactor: false, newDevice: Boolean(data.newDevice) };
  };

  const login = async (email: string, password: string): Promise<LoginResult> => {
    try {
      const response = await api.post<LoginResponse>('/auth/login', { email, password });
      return applyLoginResponse(response.data);
    } catch (error) {
      throw toAuthError(error, 'Erro ao fazer login');
    }
  };

  const loginWithTwoFactor = async (challengeToken: string, code: string): Promise<LoginResult> => {
    try {
      const response = await api.post<LoginResponse>('/auth/2fa/login', { challengeToken, code });
      return applyLoginResponse(response.data);
    } catch (error) {
      throw toAuthError(error, 'Código inválido');
    }
  };

  /** Limpa a sessão local (tokens, usuário e cabeçalho padrão). */
  const clearLocalSession = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
  };

  const logout = () => {
    // Encerra no servidor SÓ a sessão deste navegador (best-effort). Token e
    // refresh vão explícitos (o local é limpo logo abaixo); com o access
    // token vencido, a sessão é encerrada pelo refresh token
    const currentToken = localStorage.getItem('token');
    const currentRefresh = localStorage.getItem('refreshToken');
    if (currentToken || currentRefresh) {
      void endServerSession(currentToken, currentRefresh);
    }
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
  };

  const logoutAllDevices = async () => {
    try {
      await api.post('/auth/logout-all');
    } finally {
      clearLocalSession();
    }
  };

  /**
   * Troca a senha. O servidor derruba as sessões dos outros aparelhos e o
   * access token atual; o refresh deste navegador continua valendo, então a
   * próxima requisição renova sozinha (interceptor) sem pedir login.
   */
  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!user) throw new AuthError('Sessão expirada. Entre novamente.');
    try {
      await api.post(`/users/${user.id}/change-password`, { currentPassword, newPassword });
    } catch (error) {
      throw toAuthError(error, 'Não foi possível trocar a senha');
    }
    updateUser({ forcePasswordChange: false });
  };

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((previous) => {
      if (!previous) return previous;
      const next = { ...previous, ...patch };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const adoptSession = useCallback((tokens: { accessToken?: string; refreshToken?: string } | null | undefined) => {
    if (!adoptTokens(tokens)) return false;
    setToken(tokens?.accessToken ?? null);
    return true;
  }, []);

  /**
   * Recarrega o perfil do servidor (eng-acessos-26 / ux-acesso-15): no boot,
   * ao voltar à aba (no máximo a cada 5 min) e quando a API indica que o
   * acesso pode ter mudado. O menu e as rotas acompanham o papel novo sem
   * sair e entrar.
   */
  const lastProfileRefresh = useRef(0);
  const profileInFlight = useRef<Promise<void> | null>(null);
  const userRef = useRef<User | null>(user);
  userRef.current = user;

  const refreshUser = useCallback(async () => {
    if (profileInFlight.current) return profileInFlight.current;
    if (!localStorage.getItem('token')) return;
    // Troca de senha pendente: a API só libera a troca (o perfil volta depois)
    if (userRef.current?.forcePasswordChange) return;
    try {
      if (JSON.parse(localStorage.getItem('user') || 'null')?.forcePasswordChange) return;
    } catch {
      // usuário guardado ilegível: segue e relê do servidor
    }
    const run = (async () => {
      try {
        const response = await api.get('/users/me');
        // Saiu enquanto a resposta vinha: ignora
        if (!localStorage.getItem('token')) return;
        const mapped = mapProfile(response.data ?? {});
        if (!mapped.id) return;
        lastProfileRefresh.current = Date.now();
        const previous = userRef.current;
        if (previous && previous.id !== mapped.id) return;
        // Campos que o /users/me não traz ficam como estavam
        const next: User = previous ? { ...previous, ...mapped } : mapped;
        if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
        localStorage.setItem('user', JSON.stringify(next));
        userRef.current = next;
        setUser(next);
        const change = previous ? describeAccessChange(previous, next) : null;
        if (change) notify.info(change, { autoClose: 6000 });
      } catch {
        // Sessão inválida é tratada pelo interceptor de refresh; falha de rede: tenta depois
      }
    })();
    profileInFlight.current = run.finally(() => {
      profileInFlight.current = null;
    });
    return profileInFlight.current;
  }, []);

  // Boot: o perfil guardado no login pode estar velho (promoção, nova pastoral)
  const hasSession = !!token;
  useEffect(() => {
    if (hasSession) void refreshUser();
  }, [hasSession, refreshUser]);

  // Volta à aba/janela: recarrega se passaram 5 min desde a última leitura
  useEffect(() => {
    if (!hasSession) return;
    const maybeRefresh = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastProfileRefresh.current < PROFILE_FOCUS_REFRESH_MS) return;
      void refreshUser();
    };
    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', maybeRefresh);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', maybeRefresh);
    };
  }, [hasSession, refreshUser]);

  // 403 de permissão ou ação que muda papel/coordenação: relê (com freio)
  useEffect(() => {
    if (!hasSession) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onStale = () => {
      if (timer) return;
      const wait = Math.max(0, PROFILE_STALE_REFRESH_MS - (Date.now() - lastProfileRefresh.current));
      timer = setTimeout(() => {
        timer = null;
        void refreshUser();
      }, Math.max(wait, 500));
    };
    window.addEventListener(PROFILE_STALE_EVENT, onStale);
    return () => {
      window.removeEventListener(PROFILE_STALE_EVENT, onStale);
      if (timer) clearTimeout(timer);
    };
  }, [hasSession, refreshUser]);

  return (
    <AuthContext.Provider
      value={{ user, token, login, loginWithTwoFactor, logout, logoutAllDevices, changePassword, refreshUser, updateUser, adoptSession, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
