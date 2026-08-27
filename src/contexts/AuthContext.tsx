import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import axios from 'axios';
import api, { adoptTokens, getErrorMessage } from '../services/api';

const API_URL = import.meta.env.VITE_API_URL;

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: string;
  dioceseId?: string;
  parishId?: string;
  communityId?: string;
  pastoralIds?: string[];
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
  logout: () => void;
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

  const logout = () => {
    // Revoga o refresh token no servidor (best-effort) antes de limpar o local
    if (localStorage.getItem('token')) {
      void api.post('/auth/logout').catch(() => undefined);
    }
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
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

  const refreshUser = async () => {
    const storedToken = localStorage.getItem('token');
    if (!storedToken) return;
    try {
      const response = await axios.get(`${API_URL}/users/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      const fresh = response.data;
      const mapped: User = {
        id: fresh.id,
        email: fresh.email,
        name: fresh.name,
        phone: fresh.phone ?? undefined,
        role: fresh.role,
        dioceseId: fresh.dioceseId ?? undefined,
        parishId: fresh.parishId ?? undefined,
        communityId: fresh.communityId ?? undefined,
        pastoralIds: fresh.pastoralIds ?? [],
        pastorals: fresh.pastorals ?? [],
        forcePasswordChange: fresh.forcePasswordChange ?? false,
        twoFactorEnabled: fresh.twoFactorEnabled ?? false,
      };
      setUser(mapped);
      localStorage.setItem('user', JSON.stringify(mapped));
    } catch {
      // Sessão inválida é tratada pelo interceptor de refresh
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, token, login, loginWithTwoFactor, logout, refreshUser, updateUser, adoptSession, loading }}
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
