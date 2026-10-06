export type RecurrenceType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export interface RecurrenceConfig {
  type: RecurrenceType;
  interval: number;
  days?: number[]; // Dias da semana (0-6) para CUSTOM
  endDate?: string; // Data de término (ISO string)
}

/**
 * Gera array de datas baseado na configuração de recorrência
 * @param startDate Data inicial (ISO string ou Date)
 * @param config Configuração de recorrência
 * @param maxOccurrences Número máximo de ocorrências (padrão: 52)
 * @returns Array de strings ISO de datas
 */
export function generateRecurrenceDates(
  startDate: string | Date,
  config: RecurrenceConfig,
  maxOccurrences: number = 52
): string[] {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const dates: string[] = [formatToLocalISO(start)];
  let currentDate = new Date(start);
  let occurrences = 1;

  const endDate = config.endDate ? endOfLocalDay(config.endDate) : null;

  while (occurrences < maxOccurrences) {
    let nextDate: Date | null = null;

    switch (config.type) {
      case 'DAILY':
        nextDate = new Date(currentDate);
        nextDate.setDate(currentDate.getDate() + config.interval);
        break;

      case 'WEEKLY':
        nextDate = new Date(currentDate);
        nextDate.setDate(currentDate.getDate() + 7 * config.interval);
        break;

      case 'MONTHLY':
        nextDate = new Date(currentDate);
        nextDate.setMonth(currentDate.getMonth() + config.interval);
        break;

      case 'CUSTOM':
        if (!config.days || config.days.length === 0) {
          return dates;
        }

        nextDate = new Date(currentDate);
        nextDate.setDate(currentDate.getDate() + 1);

        // Procura o próximo dia que está na lista de dias permitidos
        let attempts = 0;
        while (!config.days.includes(nextDate.getDay()) && attempts < 7) {
          nextDate.setDate(nextDate.getDate() + 1);
          attempts++;
        }

        if (attempts >= 7) {
          return dates; // Não encontrou nenhum dia válido
        }
        break;

      default:
        return dates;
    }

    if (!nextDate) {
      break;
    }

    // Verifica se ultrapassou a data de término
    if (endDate && nextDate > endDate) {
      break;
    }

    dates.push(formatToLocalISO(nextDate));
    currentDate = nextDate;
    occurrences++;
  }

  return dates;
}

/**
 * Fim (23:59:59.999 local) do dia de término — o último dia ENTRA na série.
 * 'AAAA-MM-DD' (o DateInput) é dia civil: new Date('2026-10-10') é meia-noite
 * UTC = 21:00 do dia 09 em Brasília, e a ocorrência das 19:00 do dia 10 ficava
 * de fora (R3#54). Com hora, vale o dia local daquele instante.
 */
export function endOfLocalDay(value: string): Date | null {
  const raw = String(value).trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 23, 59, 59, 999);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999);
}

/** 'AAAA-MM-DD' (ou instante) → 'dd/mm/aaaa' do dia de término, sem voltar um dia. */
export function formatEndDateBR(value: string): string {
  const end = endOfLocalDay(value);
  return end ? end.toLocaleDateString('pt-BR') : '';
}

/**
 * Formata Date para string ISO local (sem timezone)
 * @param date Data a formatar
 * @returns String no formato "YYYY-MM-DDTHH:mm"
 */
function formatToLocalISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Calcula a duração entre duas datas em milissegundos
 * @param startDate Data de início
 * @param endDate Data de término
 * @returns Duração em milissegundos
 */
export function getEventDuration(startDate: string, endDate?: string): number {
  if (!endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  return end.getTime() - start.getTime();
}

/**
 * Aplica uma duração a uma data de início para calcular data de término
 * @param startDate Data de início (ISO string)
 * @param duration Duração em milissegundos
 * @returns Data de término (ISO string) ou undefined se duration = 0
 */
export function applyDuration(startDate: string, duration: number): string | undefined {
  if (duration === 0) return undefined;
  const start = new Date(startDate);
  const end = new Date(start.getTime() + duration);
  return formatToLocalISO(end);
}
