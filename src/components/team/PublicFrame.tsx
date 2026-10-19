import React from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import '../../pages/public/DonatePage.css';
import './team.css';

const API_BASE = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/**
 * Cliente das páginas públicas de convite e reivindicação: sem o interceptor
 * de refresh/redirect do `api` (um 401 aqui não pode mandar a pessoa para o
 * /login). Quem já está logado manda o Bearer quando o contrato aproveita a
 * conta (reivindicação grava o userId; convite aplica o papel na conta).
 */
export const publicApi = axios.create({ baseURL: API_BASE, timeout: 30_000 });

/** Cabeçalho Authorization da sessão deste navegador, se houver. */
export function sessionAuthHeader(): Record<string, string> {
  try {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Conta conectada neste navegador (o `user` gravado no login), para avisar em nome de quem o pedido vai. */
export function sessionAccount(): { name: string; email: string; phone: string; role: string } | null {
  if (!sessionAuthHeader().Authorization) return null;
  try {
    const raw = JSON.parse(localStorage.getItem('user') ?? 'null');
    if (!raw || typeof raw !== 'object') return { name: '', email: '', phone: '', role: '' };
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    // E-mail técnico (conta só com celular, convite C2) não diz nada à pessoa
    const email = text(raw.email).toLowerCase().endsWith('.parish.invalid') ? '' : text(raw.email);
    return { name: text(raw.name), email, phone: text(raw.phone), role: text(raw.role) };
  } catch {
    return { name: '', email: '', phone: '', role: '' };
  }
}

/** "Maria Silva (maria@…)" — o que der para mostrar da conta conectada. */
export function sessionAccountLabel(account: ReturnType<typeof sessionAccount>): string {
  if (!account) return '';
  const contact = account.email || account.phone;
  if (account.name && contact) return `${account.name} (${contact})`;
  return account.name || contact || 'a conta conectada neste navegador';
}

/**
 * POST com a sessão (se houver); token vencido (401) não bloqueia o pedido
 * público: repete sem o Bearer.
 */
export async function postWithOptionalSession<T>(url: string, body: unknown): Promise<T> {
  const headers = sessionAuthHeader();
  try {
    const { data } = await publicApi.post<T>(url, body, { headers });
    return data;
  } catch (error) {
    if (headers.Authorization && axios.isAxiosError(error) && error.response?.status === 401) {
      const { data } = await publicApi.post<T>(url, body);
      return data;
    }
    throw error;
  }
}

/** Mensagem de erro de uma chamada pública (sem código interno). */
export function publicMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    const status = error.response.status;
    if (status === 429) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.';
    const message = error.response.data?.message;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string' && message.trim() && status < 500) return message;
  }
  return fallback;
}

interface Props {
  kicker?: string;
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
}

/** Moldura das páginas públicas da equipe (mesmo visual da doação pública). */
const PublicFrame: React.FC<Props> = ({ kicker, title, subtitle, children }) => {
  const initial = title.trim().charAt(0).toUpperCase() || 'P';
  return (
    <div className="donate-page">
      <header className="donate-hero">
        <div className="donate-hero-inner">
          <div className="donate-logo donate-logo-fallback" aria-hidden="true">
            {initial}
          </div>
          <div className="donate-hero-text">
            {kicker && <div className="donate-hero-kicker">{kicker}</div>}
            <h1 className="donate-hero-title">{title}</h1>
            {subtitle && <div className="donate-hero-subtitle">{subtitle}</div>}
          </div>
        </div>
      </header>
      <main className="donate-main">{children}</main>
      <footer className="donate-footer">
        <img src="/brand/parish-logo-horizontal-cor.svg" alt="Parish" />
        <div>
          Gestão paroquial · <Link to="/termos">Termos de uso</Link> · <Link to="/privacidade">Privacidade</Link>
        </div>
      </footer>
    </div>
  );
};

export default PublicFrame;
