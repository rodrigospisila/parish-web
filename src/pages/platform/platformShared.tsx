import React from 'react';
import axios from 'axios';
import { getErrorMessage } from '../../services/api';

/**
 * Peças comuns das páginas da seção "Plataforma" (SYSTEM_ADMIN): rótulos do
 * plano, formatação de dinheiro/data e a mensagem de erro que distingue
 * "rota ainda não publicada" de "registro não encontrado".
 */

export type PlanStatus = 'FREE' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';

export const PLAN_STATUSES: PlanStatus[] = ['FREE', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'];

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  FREE: 'Grátis',
  TRIAL: 'Teste',
  ACTIVE: 'Pago',
  PAST_DUE: 'Em atraso',
  SUSPENDED: 'Suspenso',
  CANCELED: 'Cancelado',
};

/** Cor do selo (classes .status-badge do ModulePages.css). */
const PLAN_STATUS_TONE: Record<PlanStatus, string> = {
  FREE: 'gray',
  TRIAL: 'blue',
  ACTIVE: 'green',
  PAST_DUE: 'yellow',
  SUSPENDED: 'red',
  CANCELED: 'gray',
};

/** Plano nulo = a comunidade nunca teve plano: está no grátis. */
export const PlanBadge: React.FC<{ status?: string | null }> = ({ status }) => {
  const s = (status && status in PLAN_STATUS_LABEL ? status : 'FREE') as PlanStatus;
  return <span className={`status-badge ${PLAN_STATUS_TONE[s]} pf-plan-${s.toLowerCase()}`}>{PLAN_STATUS_LABEL[s]}</span>;
};

export const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

/** O que o plano libera — texto fixo, igual nas telas de planos e crescimento. */
export const O_QUE_O_PLANO_LIBERA =
  'Pastorais, escalas e trocas, catequese, formação, salas, visitas e documentos. Calendário, eventos, mapa e liturgia continuam grátis; o fiel nunca paga.';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');

/** Centavos (como a API manda) → "R$ 1.234,56". */
export const brl = (cents: number | null | undefined) =>
  typeof cents === 'number' && Number.isFinite(cents) ? moeda.format(cents / 100) : '—';

export const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? inteiro.format(v) : '—');

/** Centavos → "49,90" para o campo de edição. */
export const centavosParaCampo = (cents: number | null | undefined) =>
  typeof cents === 'number' && Number.isFinite(cents) ? (cents / 100).toFixed(2).replace('.', ',') : '';

/** "R$ 1.234,56" / "49,9" / "49.90" → centavos. Vazio ou inválido → null. */
export const campoParaCentavos = (texto: string): number | null => {
  let t = texto.replace(/R\$\s*/i, '').replace(/\s/g, '').trim();
  if (!t) return null;
  // Com vírgula, o ponto é separador de milhar; sem vírgula, o ponto só é
  // decimal se não tiver cara de milhar ("1.990" = mil novecentos e noventa)
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

const parseData = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const dataBR = (iso: string | null | undefined) => parseData(iso)?.toLocaleDateString('pt-BR') ?? '—';

export const dataHoraBR = (iso: string | null | undefined) => {
  const d = parseData(iso);
  return d ? `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '—';
};

/** "hoje", "ontem", "há 3 dias", "há 2 meses". */
export const haQuanto = (iso: string | null | undefined) => {
  const d = parseData(iso);
  if (!d) return '';
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
};

/** Dias até a data (negativo = já passou). */
export const diasAte = (iso: string | null | undefined) => {
  const d = parseData(iso);
  return d ? Math.ceil((d.getTime() - Date.now()) / 86_400_000) : null;
};

/** Data de hoje + n dias no formato do <input type="date">. */
export const hojeMais = (dias: number) => {
  const d = new Date(Date.now() + dias * 86_400_000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/**
 * Mensagem de erro em linguagem de gente. O 404 de ROTA (o Nest responde
 * "Cannot GET /api/v1/...") significa que o backend ainda não tem a função —
 * diferente do 404 de um registro que não existe, que traz a própria mensagem.
 */
export function mensagemDeErro(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    const { status, data } = error.response;
    const msg = typeof data?.message === 'string' ? data.message : '';
    if (status === 404 && (!msg || /^Cannot (GET|POST|PUT|PATCH|DELETE) /i.test(msg))) {
      return 'Esta função ainda não está no ar no servidor (404). Quando o backend for publicado, a tela passa a funcionar.';
    }
    if (status === 403) return 'Sem permissão: esta tela é só do administrador do sistema.';
    if (status >= 500) return `${fallback} O servidor respondeu com erro (${status}); tente de novo em instantes.`;
  }
  return getErrorMessage(error, fallback);
}
