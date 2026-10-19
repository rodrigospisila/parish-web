/**
 * Canais de suporte do Parish (saas-implantacao-06). O domínio e o WhatsApp
 * próprios ainda não existem: tudo vem do ambiente (VITE_SUPPORT_EMAIL /
 * VITE_SUPPORT_WHATSAPP) e, sem env, fica o e-mail de sempre.
 */

const DEFAULT_SUPPORT_EMAIL = 'suporte@parish.app';

const envText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const SUPPORT_EMAIL = envText(import.meta.env.VITE_SUPPORT_EMAIL) || DEFAULT_SUPPORT_EMAIL;

/** Só dígitos, com o 55 do país (wa.me/55DDNÚMERO). Vazio = sem WhatsApp de suporte. */
export const SUPPORT_WHATSAPP = (() => {
  const digits = envText(import.meta.env.VITE_SUPPORT_WHATSAPP).replace(/\D/g, '');
  if (!digits) return '';
  // Número nacional (DDD + número) ganha o país; com o país já vem completo
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
})();

/** "(42) 99999-8888" para exibir o WhatsApp de suporte. */
export const SUPPORT_WHATSAPP_LABEL = (() => {
  const national = SUPPORT_WHATSAPP.startsWith('55') ? SUPPORT_WHATSAPP.slice(2) : SUPPORT_WHATSAPP;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return SUPPORT_WHATSAPP;
})();

/** Link do WhatsApp de suporte (com texto inicial opcional) ou null quando não configurado. */
export function supportWhatsappUrl(text?: string): string | null {
  if (!SUPPORT_WHATSAPP) return null;
  return `https://wa.me/${SUPPORT_WHATSAPP}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** mailto do suporte com assunto opcional. */
export function supportMailto(subject?: string): string {
  return `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
}
