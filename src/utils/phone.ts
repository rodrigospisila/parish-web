/**
 * Telefone brasileiro nos formulários do painel.
 *
 * O login e o "esqueci a senha" procuram o celular no formato E.164
 * (+5542999998888). O painel mostra a máscara "(42) 99999-8888" enquanto a
 * pessoa digita e envia +55DDNÚMERO — o backend normaliza de novo
 * (normalizeBrazilianPhone), então número fora do padrão segue como digitado
 * para a validação do servidor responder.
 */

/** Dígitos do número nacional (DDD + número), sem o 55 do país — sem cortar o excesso. */
const nationalDigits = (value: string | null | undefined): string => {
  const digits = String(value ?? '').replace(/\D/g, '');
  // +55 / 55 na frente de um número completo (12–13 dígitos): tira o país
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
};

/** Só os dígitos do número nacional (DDD + número), no máximo 11 — para a máscara. */
export const brPhoneDigits = (value: string | null | undefined): string => nationalDigits(value).slice(0, 11);

/** Máscara de digitação: (DD) 9XXXX-XXXX (celular) ou (DD) XXXX-XXXX (fixo). */
export const maskBrPhone = (value: string | null | undefined): string => {
  const digits = brPhoneDigits(value);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  // 9 dígitos depois do DDD = celular (5+4); até 8 = fixo (4+4)
  const split = rest.length > 8 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
};

/**
 * Valor a enviar à API: +55DDNÚMERO quando o número tem 10 ou 11 dígitos;
 * vazio continua vazio; qualquer outra coisa vai como digitada (o backend
 * decide se aceita).
 */
export const phoneForApi = (value: string | null | undefined): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const digits = nationalDigits(raw);
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return raw;
};

/** Número para link do WhatsApp (wa.me/55DDNÚMERO); null se não der para montar. */
export const whatsappNumber = (value: string | null | undefined): string | null => {
  const digits = nationalDigits(value);
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : null;
};

/** Exibição em listas: com máscara quando é um número brasileiro válido; senão como gravado. */
export const formatPhoneDisplay = (value: string | null | undefined): string => {
  if (!value) return '';
  return whatsappNumber(value) ? maskBrPhone(value) : value;
};
