import api, { getErrorMessage } from '../../../services/api';
import { notify } from '../../../services/notification.service';

/** Helpers compartilhados pelas abas do Financeiro (FinancePage e CampaignsTab). */

export const formatBRL = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const THROTTLE_MESSAGE = 'Muitas tentativas — aguarde um minuto e tente de novo';
export const THROTTLE_PATTERN = /ThrottlerException|Too Many Requests/i;

export const httpStatus = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null ? (error as { response?: { status?: number } }).response?.status : undefined;

/** Mensagem de erro amigável: 429/throttler vira um aviso claro em vez do texto técnico do Nest */
export const friendlyError = (error: unknown, fallback: string): string => {
  const message = getErrorMessage(error, fallback);
  if (httpStatus(error) === 429 || THROTTLE_PATTERN.test(message)) return THROTTLE_MESSAGE;
  return message;
};

export const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Baixa um arquivo (PDF/CSV) da API; erros que vêm como Blob JSON são traduzidos para o toast */
export const downloadBlob = async (path: string, filename: string, params?: Record<string, string>) => {
  try {
    const res = await api.get(path, { responseType: 'blob', params });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error: unknown) {
    let message = 'Erro ao gerar o arquivo';
    try {
      const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
      if (data instanceof Blob) {
        const parsed = JSON.parse(await data.text());
        if (parsed?.message) message = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
      }
    } catch {
      // genérico
    }
    if (httpStatus(error) === 429 || THROTTLE_PATTERN.test(message)) message = THROTTLE_MESSAGE;
    notify.error(message);
  }
};

// Situação no provedor (Asaas/Mercado Pago), traduzida para a tesouraria — usada no Dízimo online e em Visitantes
export const PROVIDER_STATUS_LABEL: Record<string, string> = {
  pending: 'aguardando pagamento',
  confirmed: 'pago no provedor',
  received: 'pago no provedor',
  paid: 'pago no provedor',
  overdue: 'vencido no provedor (ainda pagável)',
  refunded: 'estornado',
  cancelled: 'cancelado no provedor',
  mismatch: 'divergência de valor — conciliar',
  in_review: 'cartão em análise',
  disputed: 'estorno/chargeback em disputa',
};
export const providerStatusLabel = (status: string | null | undefined): string | null =>
  status ? PROVIDER_STATUS_LABEL[status.toLowerCase()] ?? status : null;
