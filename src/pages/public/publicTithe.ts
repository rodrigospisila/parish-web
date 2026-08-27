import axios from 'axios';
import { useEffect, useRef, useState } from 'react';

/**
 * Doação pública (Dízimo D4.6) — contrato do backend, cliente HTTP sem token e
 * utilitários compartilhados pelas páginas /doar/:parishId e /doar/recibo/:token.
 */

export type PaymentMethod = 'PIX' | 'CARD' | 'BOLETO';
export type GiftStatus = 'CREATED' | 'DECLARED' | 'CONFIRMED' | 'CANCELLED';
export type GiftMethod = 'PIX_STATIC' | 'GATEWAY';
export type CampaignKind = 'CAMPAIGN' | 'FUND';

export interface PublicCampaign {
  id: string;
  name: string;
  description: string | null;
  goalAmount: number | null;
  endsAt: string | null;
  suggestedAmounts: number[];
  kind: CampaignKind;
}

export interface DonatePageData {
  parish: { id: string; name: string; city: string | null; logoUrl: string | null; message: string | null };
  available: boolean;
  gateway: { available: boolean; provider: string | null; methods: PaymentMethod[]; needsCpfForAuto: boolean };
  campaigns: PublicCampaign[];
  suggestedAmounts: number[];
  recipient: { merchantName: string | null; pixKey: string | null } | null;
}

export interface Gift {
  token: string;
  status: GiftStatus;
  amount: number;
  amountPaid: number | null;
  name: string;
  campaign: { id: string; name: string } | null;
  method: GiftMethod;
  paymentMethod: PaymentMethod;
  txid: string;
  brCode: string | null;
  qrDataUrl: string | null;
  paymentUrl: string | null;
  boletoUrl: string | null;
  boletoLine: string | null;
  qrExpiresAt: string | null;
  declaredAt: string | null;
  confirmedAt: string | null;
  receiptSentAt: string | null;
  createdAt: string;
  note: string | null;
}

export interface CreateGiftPayload {
  name: string;
  email: string;
  cpf?: string;
  amount: number;
  campaignId?: string;
  message?: string;
  paymentMethod?: PaymentMethod;
  /** Honeypot: campo invisível — pessoas nunca preenchem. */
  website: string;
}

export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 50000;

const API_BASE = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Instância própria: sem Authorization e sem o interceptor de refresh/redirect do `api`. */
const publicApi = axios.create({ baseURL: API_BASE, timeout: 30_000 });

export async function fetchDonatePage(parishId: string): Promise<DonatePageData> {
  const { data } = await publicApi.get<DonatePageData>(`/public/tithe/${encodeURIComponent(parishId)}`);
  return data;
}

export async function createGift(parishId: string, payload: CreateGiftPayload): Promise<Gift> {
  const { data } = await publicApi.post<Gift>(`/public/tithe/${encodeURIComponent(parishId)}/gifts`, payload);
  return data;
}

export async function fetchGift(token: string): Promise<Gift> {
  const { data } = await publicApi.get<Gift>(`/public/tithe/gifts/${encodeURIComponent(token)}`);
  return data;
}

export async function declareGift(token: string): Promise<Gift> {
  const { data } = await publicApi.post<Gift>(`/public/tithe/gifts/${encodeURIComponent(token)}/declare`);
  return data;
}

export function receiptPdfUrl(token: string): string {
  return `${API_BASE}/public/tithe/gifts/${encodeURIComponent(token)}/receipt.pdf`;
}

export function isNotFoundError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/** Mensagem amigável: `message` do backend (pt-BR), 429 e falha de rede. */
export function publicErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) {
      return 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.';
    }
    const body: unknown = error.response?.data;
    const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
    if (Array.isArray(message)) return message.map(String).join('; ');
    if (typeof message === 'string' && message.trim()) return message;
    if (!error.response) {
      return 'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.';
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function money(value: number | null | undefined): string {
  return brl.format(Number(value ?? 0));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Aceita "50", "50,00", "1.250,50", "R$ 50", "1.250" → número em reais; inválido → null. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    // vírgula decimal: pontos são separador de milhar
    s = s.replace(/\./g, '').replace(/,(?=[^,]*$)/, '.').replace(/,/g, '');
  } else {
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function amountToInput(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

export function maskCpf(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  let out = d.slice(0, 3);
  if (d.length > 3) out += `.${d.slice(3, 6)}`;
  if (d.length > 6) out += `.${d.slice(6, 9)}`;
  if (d.length > 9) out += `-${d.slice(9, 11)}`;
  return out;
}

export function isValidCpf(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export type StatusTone = 'waiting' | 'declared' | 'ok' | 'off';

export const STATUS_INFO: Record<GiftStatus, { label: string; tone: StatusTone; description: string }> = {
  CREATED: {
    label: 'Aguardando pagamento',
    tone: 'waiting',
    description: 'Assim que o pagamento for identificado, sua oferta será confirmada.',
  },
  DECLARED: {
    label: 'Aviso recebido — aguardando confirmação',
    tone: 'declared',
    description: 'Você avisou que já fez o Pix. A tesouraria vai conferir e o comprovante chega no seu e-mail.',
  },
  CONFIRMED: {
    label: 'Oferta confirmada',
    tone: 'ok',
    description: 'Deus lhe pague pela generosidade! Seu comprovante está disponível abaixo.',
  },
  CANCELLED: {
    label: 'Oferta cancelada',
    tone: 'off',
    description: 'Esta oferta não foi concluída. Se quiser, faça uma nova oferta pela página da paróquia.',
  },
};

export const METHOD_LABEL: Record<PaymentMethod, string> = { PIX: 'Pix', CARD: 'Cartão', BOLETO: 'Boleto' };
export const KIND_LABEL: Record<CampaignKind, string> = { CAMPAIGN: 'Campanha', FUND: 'Fundo' };

export const isGiftOpen = (status: GiftStatus): boolean => status === 'CREATED' || status === 'DECLARED';

/** Lê nome (campo 59) e cidade (60) do recebedor no BR Code Pix (EMV TLV). */
export function pixRecipientFromBrCode(brCode: string | null | undefined): { merchantName: string | null; merchantCity: string | null } {
  const out: { merchantName: string | null; merchantCity: string | null } = { merchantName: null, merchantCity: null };
  if (!brCode) return out;
  let i = 0;
  while (i + 4 <= brCode.length) {
    const id = brCode.slice(i, i + 2);
    const len = Number(brCode.slice(i + 2, i + 4));
    if (!Number.isFinite(len)) break;
    const value = brCode.slice(i + 4, i + 4 + len);
    if (id === '59') out.merchantName = value;
    else if (id === '60') out.merchantCity = value;
    i += 4 + len;
  }
  return out;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // sem permissão de clipboard: tenta o fallback abaixo
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Token da oferta no navegador (reabrir o Pix sem gerar outra cobrança)
// ---------------------------------------------------------------------------

export const giftStorageKey = (parishId: string): string => `parish-gift-${parishId}`;

/** Oferta lembrada só por algumas horas: num computador compartilhado, o próximo visitante não vê a oferta anterior. */
const GIFT_MEMORY_MS = 6 * 60 * 60 * 1000;

export function readStoredGiftToken(parishId: string): string | null {
  try {
    const raw = localStorage.getItem(giftStorageKey(parishId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; at?: number };
    if (!parsed?.token || typeof parsed.at !== 'number' || Date.now() - parsed.at > GIFT_MEMORY_MS) {
      localStorage.removeItem(giftStorageKey(parishId));
      return null;
    }
    return parsed.token;
  } catch {
    // formato antigo (token cru) ou storage bloqueado: esquece
    try {
      localStorage.removeItem(giftStorageKey(parishId));
    } catch {
      // idem
    }
    return null;
  }
}

export function storeGiftToken(parishId: string, token: string): void {
  try {
    localStorage.setItem(giftStorageKey(parishId), JSON.stringify({ token, at: Date.now() }));
  } catch {
    // navegação privada / storage bloqueado: segue sem lembrar
  }
}

export function clearStoredGiftToken(parishId: string): void {
  try {
    localStorage.removeItem(giftStorageKey(parishId));
  } catch {
    // idem
  }
}

// ---------------------------------------------------------------------------
// Polling enquanto a oferta está em aberto
// ---------------------------------------------------------------------------

/**
 * Consulta a oferta a cada `intervalMs` enquanto estiver CREATED/DECLARED,
 * por no máximo `maxMs` (padrão: 10 s / 10 min). Também atualiza ao voltar à aba.
 */
export function useGiftPolling(
  gift: Gift | null,
  onUpdate: (fresh: Gift) => void,
  options: { intervalMs?: number; maxMs?: number } = {},
): { polling: boolean; exhausted: boolean } {
  const { intervalMs = 10_000, maxMs = 10 * 60_000 } = options;
  const [exhausted, setExhausted] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const token = gift?.token ?? null;
  const open = gift ? isGiftOpen(gift.status) : false;

  useEffect(() => {
    setExhausted(false);
    if (!token || !open) return undefined;
    let cancelled = false;
    let inFlight = false;
    let timer = 0;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (Date.now() - startedAt >= maxMs) {
        window.clearInterval(timer);
        setExhausted(true);
        return;
      }
      inFlight = true;
      try {
        const fresh = await fetchGift(token);
        if (!cancelled) onUpdateRef.current(fresh);
      } catch {
        // rede/provedor indisponível: mantém o estado atual e tenta no próximo ciclo
      } finally {
        inFlight = false;
      }
    };

    timer = window.setInterval(() => {
      void tick();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, open, intervalMs, maxMs]);

  return { polling: Boolean(token && open && !exhausted), exhausted };
}
