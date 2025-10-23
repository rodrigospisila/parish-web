import api from './api';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export const authService = {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await api.post('/auth/login', credentials);
    const { accessToken, refreshToken, user } = response.data;

    localStorage.setItem('parish_token', accessToken);
    localStorage.setItem('parish_refreshToken', refreshToken);
    localStorage.setItem('parish_user', JSON.stringify(user));

    return response.data;
  },

  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    } finally {
      localStorage.removeItem('parish_token');
      localStorage.removeItem('parish_refreshToken');
      localStorage.removeItem('parish_user');
    }
  },

  getStoredUser(): User | null {
    const userJson = localStorage.getItem('parish_user');
    return userJson ? JSON.parse(userJson) : null;
  },

  getStoredToken(): string | null {
    return localStorage.getItem('parish_token');
  },
};

