/**
 * Peças do "Meu plano": tipos do contrato C3 (GET /billing/me), máscaras e
 * validação de CNPJ/CPF e CEP, rótulos de status.
 */

export type CommunityPlanStatus = 'FREE' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
export type BillingCycle = 'MONTHLY' | 'YEARLY';
export type BillingAccountStatus = 'NONE' | 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface BillingTier {
  key: string;
  name: string;
  maxMembers: number | null;
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
}

export interface BillingCommunity {
  id: string;
  name: string;
  plan: {
    status: CommunityPlanStatus;
    tierKey: string | null;
    tierName: string | null;
    maxMembers: number | null;
    activeMembers: number | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    priceCents: number | null;
    billingAccountId: string | null;
    billingCycle?: BillingCycle | null;
    graceEndsAt?: string | null;
    paidAccess?: boolean;
    /** Piloto: acesso total sem prazo — não entra na cobrança */
    pilot?: boolean;
  } | null;
}

export interface BillingAccount {
  id: string;
  legalName: string;
  document: string;
  email: string;
  phone?: string | null;
  responsibleName?: string | null;
  municipalRegistration?: string | null;
  zipCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  status?: BillingAccountStatus | null;
  billingCycle?: BillingCycle | null;
  valueCents?: number | null;
  nextDueDate?: string | null;
}

export interface PlatformPayment {
  id: string;
  status: string;
  billingType?: string | null;
  valueCents: number;
  dueDate?: string | null;
  paidAt?: string | null;
  invoiceUrl?: string | null;
  nfseUrl?: string | null;
  createdAt?: string | null;
}

export interface BillingMe {
  parish: { id: string; name: string; city?: string | null; state?: string | null; cnpj?: string | null } | null;
  enforcement?: string;
  trialDays: number;
  checkoutAvailable: boolean;
  billingAccount: BillingAccount | null;
  communities: BillingCommunity[];
  tiers: BillingTier[];
  payments: PlatformPayment[];
}

/** Saneia a resposta (campos ausentes não quebram a tela). */
export function parseBillingMe(data: unknown): BillingMe | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, any>;
  return {
    parish: d.parish && typeof d.parish === 'object' ? d.parish : null,
    enforcement: typeof d.enforcement === 'string' ? d.enforcement : undefined,
    trialDays: typeof d.trialDays === 'number' ? d.trialDays : 30,
    checkoutAvailable: d.checkoutAvailable !== false,
    billingAccount: d.billingAccount && typeof d.billingAccount === 'object' ? d.billingAccount : null,
    communities: Array.isArray(d.communities) ? d.communities.filter((c: any) => c && typeof c.id === 'string') : [],
    tiers: Array.isArray(d.tiers) ? d.tiers.filter((t: any) => t && typeof t.key === 'string') : [],
    payments: Array.isArray(d.payments) ? d.payments.filter((p: any) => p && typeof p.id === 'string') : [],
  };
}

/** Piloto (ACTIVE sem prazo): acesso total, não entra em cobrança (o backend manda `pilot`). */
export function isPilot(c: BillingCommunity): boolean {
  const p = c.plan;
  if (!p) return false;
  if (typeof p.pilot === 'boolean') return p.pilot;
  return p.status === 'ACTIVE' && !p.currentPeriodEnd;
}

/** Preço da faixa no ciclo (anual sem preço próprio = 10 mensalidades). */
export function tierPrice(tier: BillingTier | undefined, cycle: BillingCycle): number | null {
  if (!tier) return null;
  if (cycle === 'MONTHLY') return tier.monthlyPriceCents;
  if (typeof tier.yearlyPriceCents === 'number') return tier.yearlyPriceCents;
  return typeof tier.monthlyPriceCents === 'number' ? tier.monthlyPriceCents * 10 : null;
}

/** Menor faixa que comporta os membros ativos (sem limite = cabe tudo). */
export function suggestTier(tiers: BillingTier[], activeMembers: number | null | undefined, current?: string | null): string {
  if (current && tiers.some((t) => t.key === current)) return current;
  const ordered = [...tiers].sort((a, b) => (a.monthlyPriceCents ?? 0) - (b.monthlyPriceCents ?? 0));
  const n = activeMembers ?? 0;
  const fit = ordered.find((t) => t.maxMembers === null || t.maxMembers === undefined || t.maxMembers >= n);
  return (fit ?? ordered[ordered.length - 1])?.key ?? '';
}

// ---------------------------------------------------------------------------
// Documento (CNPJ/CPF) e CEP
// ---------------------------------------------------------------------------

export const onlyDigits = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

/** Máscara de digitação: até 11 dígitos = CPF; acima = CNPJ. */
export function maskDocument(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export const isValidDocument = (value: string) => {
  const d = onlyDigits(value);
  return d.length === 11 ? isValidCpf(d) : d.length === 14 ? isValidCnpj(d) : false;
};

export function maskCep(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const ACCOUNT_STATUS_LABEL: Record<BillingAccountStatus, string> = {
  NONE: 'Sem assinatura',
  PENDING: 'Aguardando o 1º pagamento',
  ACTIVE: 'Em dia',
  PAST_DUE: 'Pagamento em atraso',
  CANCELED: 'Cancelada',
};

export const ACCOUNT_STATUS_TONE: Record<BillingAccountStatus, string> = {
  NONE: 'gray',
  PENDING: 'blue',
  ACTIVE: 'green',
  PAST_DUE: 'yellow',
  CANCELED: 'gray',
};

/** Status das cobranças do Asaas em linguagem de gente. */
export function paymentStatusLabel(status: string): { label: string; tone: string } {
  switch (String(status).toUpperCase()) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return { label: 'Paga', tone: 'green' };
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
      return { label: 'Em aberto', tone: 'blue' };
    case 'OVERDUE':
    case 'DUNNING_REQUESTED':
      return { label: 'Vencida', tone: 'yellow' };
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
      return { label: 'Estornada', tone: 'gray' };
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return { label: 'Contestada', tone: 'red' };
    case 'DELETED':
    case 'CANCELED':
      return { label: 'Cancelada', tone: 'gray' };
    default:
      return { label: status || '—', tone: 'gray' };
  }
}

export const BILLING_TYPE_LABEL: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão',
  UNDEFINED: 'Pix, boleto ou cartão',
};
