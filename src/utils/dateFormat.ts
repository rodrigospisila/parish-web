/**
 * Utilitário para formatação de datas no padrão brasileiro
 * Formato: dd/MM/yyyy HH:mm (sem AM/PM)
 */

/**
 * Formata data e hora no padrão brasileiro
 * @param date - String ISO ou objeto Date
 * @returns String no formato "dd/MM/yyyy às HH:mm"
 */
export const formatDateTime = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '-';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  return `${day}/${month}/${year} às ${hours}:${minutes}`;
};

/**
 * Formata apenas a data no padrão brasileiro
 * @param date - String ISO ou objeto Date
 * @returns String no formato "dd/MM/yyyy"
 */
export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '-';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  
  return `${day}/${month}/${year}`;
};

/**
 * Formata apenas a hora no padrão brasileiro
 * @param date - String ISO ou objeto Date
 * @returns String no formato "HH:mm"
 */
export const formatTime = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '-';
  
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  return `${hours}:${minutes}`;
};

/**
 * Converte data no formato brasileiro para ISO (para enviar ao backend)
 * @param dateStr - String no formato "dd/MM/yyyy" ou "dd/MM/yyyy HH:mm"
 * @returns String ISO ou null se inválido
 */
export const parseBrazilianDate = (dateStr: string): string | null => {
  if (!dateStr) return null;
  
  // Formato: dd/MM/yyyy HH:mm
  const dateTimeMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (dateTimeMatch) {
    const [, day, month, year, hours, minutes] = dateTimeMatch;
    return `${year}-${month}-${day}T${hours}:${minutes}:00`;
  }
  
  // Formato: dd/MM/yyyy
  const dateMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    return `${year}-${month}-${day}T00:00:00`;
  }
  
  return null;
};

/**
 * Formata input datetime-local para exibição brasileira
 * @param isoString - String no formato "yyyy-MM-ddTHH:mm"
 * @returns String no formato "dd/MM/yyyy HH:mm"
 */
export const formatInputDateTime = (isoString: string): string => {
  if (!isoString) return '';
  
  const [datePart, timePart] = isoString.split('T');
  const [year, month, day] = datePart.split('-');
  
  if (timePart) {
    return `${day}/${month}/${year} ${timePart}`;
  }
  
  return `${day}/${month}/${year}`;
};

/**
 * Converte data brasileira para formato datetime-local input
 * @param brazilianDate - String no formato "dd/MM/yyyy HH:mm"
 * @returns String no formato "yyyy-MM-ddTHH:mm"
 */
export const toBrazilianInputFormat = (brazilianDate: string): string => {
  const parsed = parseBrazilianDate(brazilianDate);
  if (!parsed) return '';
  
  // Remove segundos e timezone
  return parsed.substring(0, 16);
};

/**
 * Datas CIVIS (só dia: nascimento, aniversário, data de sacramento, validade).
 *
 * Formatos que o backend devolve (mesma regra do formatCivilDate do backend,
 * src/modules/catechesis/civil-date.ts):
 * - meia-noite UTC exata ('1990-05-10T00:00:00.000Z'): gravação legada / data
 *   enviada pelo painel — o dia certo está em UTC;
 * - meio-dia de Brasília ('…T15:00:00.000Z'): AAAA-MM-DD gravado pelo backend;
 * - 03:00 UTC exato (meia-noite de Brasília, registros antigos);
 * - instante real (`new Date()` de uma celebração sem data informada).
 * Fora a meia-noite UTC, o dia é lido no fuso America/Sao_Paulo — 22h30 de
 * Brasília (01h30 UTC do dia seguinte) continua sendo o dia de Brasília.
 * Nunca pelo fuso do navegador (getDate / toLocaleDateString sem timeZone).
 */
const CIVIL_TZ = 'America/Sao_Paulo';

let civilDayFormatter: Intl.DateTimeFormat | null | undefined;
/** Dia (AAAA-MM-DD) do instante no fuso de Brasília; null se o Intl não tiver o fuso. */
const saoPauloDay = (d: Date): string | null => {
  if (civilDayFormatter === undefined) {
    try {
      civilDayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: CIVIL_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      civilDayFormatter = null;
    }
  }
  if (!civilDayFormatter) return null;
  const parts = civilDayFormatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

/** Extrai o dia civil de uma data (string 'AAAA-MM-DD', string ISO ou Date). */
export const civilDateParts = (
  date: string | Date | null | undefined,
): { year: number; month: number; day: number } | null => {
  if (!date) return null;
  if (typeof date === 'string') {
    // Só o dia, ou data-hora sem fuso ('AAAA-MM-DDTHH:mm'): a parte da data vale
    const plain = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+)?$/);
    if (plain) return { year: Number(plain[1]), month: Number(plain[2]), day: Number(plain[3]) };
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  const h = d.getUTCHours();
  const exactHour = d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  // Meia-noite UTC (legado/painel) e 03:00 UTC (meia-noite de Brasília): o dia
  // certo está em UTC. O 03:00 vai explícito porque, antes de 1914, o fuso de
  // São Paulo era −03:06 e jogaria esse horário para a véspera.
  if (exactHour && (h === 0 || h === 3)) {
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  const day = saoPauloDay(d);
  const match = day?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  // Sem Intl com fuso: Brasília é −03:00 fixo desde 2019
  const shifted = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
};

/** Data civil para o input de data ('AAAA-MM-DD'); vazio se ausente. */
export const civilDateInputValue = (date: string | Date | null | undefined): string => {
  const parts = civilDateParts(date);
  if (!parts) return '';
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

/**
 * Formata data civil como dd/mm/aaaa sem deslocar o dia pelo fuso.
 * @param fallback - texto quando não há data (padrão '-')
 */
export const formatCivilDate = (date: string | Date | null | undefined, fallback = '-'): string => {
  const parts = civilDateParts(date);
  if (!parts) return fallback;
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
};

/** Ano 1900 (ou antes) = aniversário importado sem ano: só dia/mês são conhecidos. */
export const isYearlessBirthDate = (date: string | Date | null | undefined): boolean => {
  const parts = civilDateParts(date);
  return !!parts && parts.year <= 1900;
};

/**
 * Data de nascimento: dd/mm/aaaa, ou só dd/mm quando o ano não é conhecido
 * (ano 1900). Com `withNote`, acrescenta "(ano não informado)".
 */
export const formatBirthDate = (
  date: string | Date | null | undefined,
  options: { withNote?: boolean; fallback?: string } = {},
): string => {
  const parts = civilDateParts(date);
  if (!parts) return options.fallback ?? '-';
  if (parts.year <= 1900) {
    const dayMonth = `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}`;
    return options.withNote ? `${dayMonth} (ano não informado)` : dayMonth;
  }
  return formatCivilDate(date);
};

/**
 * Data civil do formulário ('AAAA-MM-DD') no formato aceito pelo backend:
 * meia-noite UTC daquele dia, sem passar pelo fuso do navegador.
 */
export const civilDateToIso = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
};
