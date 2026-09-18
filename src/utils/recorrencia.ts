/**
 * Recorrência do horário fixo de missa.
 *
 * O modelo sabe três formas: toda semana, enésimo dia da semana do mês
 * ("1º e 3º sábado") e data fixa do mês ("todo dia 13"). No interior do Norte e
 * do Nordeste a mensal é a regra, não a exceção — a comunidade recebe o padre
 * uma vez por mês.
 */

export type MassRecurrence = 'WEEKLY' | 'MONTHLY_NTH' | 'MONTHLY_DAY';

export interface Recorrencia {
  recurrence?: MassRecurrence | null;
  dayOfWeek?: number | null;
  weeksOfMonth?: number[] | null;
  dayOfMonth?: number | null;
}

export const DIAS_DA_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const NOMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Domingo e sábado são masculinos; os dias úteis, femininos ("1ª sexta-feira"). */
const feminino = (dayOfWeek: number) => dayOfWeek >= 1 && dayOfWeek <= 5;

export const SEMANAS_DO_MES: Array<{ valor: number; rotulo: string }> = [
  { valor: 1, rotulo: '1ª' },
  { valor: 2, rotulo: '2ª' },
  { valor: 3, rotulo: '3ª' },
  { valor: 4, rotulo: '4ª' },
  { valor: 5, rotulo: '5ª' },
  { valor: -1, rotulo: 'Última' },
];

/** Frase curta para a lista: "1º e 3º sábado do mês", "todo dia 13 do mês". */
export function descreverRecorrencia(r: Recorrencia): string {
  const dia = r.dayOfWeek;
  if (r.recurrence === 'MONTHLY_DAY') {
    return r.dayOfMonth ? `Todo dia ${r.dayOfMonth} do mês` : 'Data fixa do mês';
  }
  if (r.recurrence === 'MONTHLY_NTH' && typeof dia === 'number') {
    const fem = feminino(dia);
    const rotulo = (n: number) => (n === -1 ? (fem ? 'última' : 'último') : `${n}${fem ? 'ª' : 'º'}`);
    const partes = (r.weeksOfMonth ?? []).map(rotulo);
    if (partes.length === 0) return DIAS_DA_SEMANA[dia];
    const lista =
      partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0];
    const texto = `${lista} ${NOMES[dia]} do mês`;
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
  return typeof dia === 'number' ? DIAS_DA_SEMANA[dia] : '—';
}

/** É mensal? Serve para destacar na lista e mudar o texto de ajuda. */
export const ehMensal = (r: Recorrencia) => r.recurrence === 'MONTHLY_NTH' || r.recurrence === 'MONTHLY_DAY';

/**
 * Próxima data (AAAA-MM-DD) em que o horário acontece, a partir de hoje.
 * Usada para sugerir a data ao gerar uma escala — com recorrência mensal, o
 * "próximo sábado" quase sempre é a resposta errada.
 */
export function proximaOcorrencia(r: Recorrencia, apartirDe = new Date()): string {
  const base = new Date(apartirDe.getFullYear(), apartirDe.getMonth(), apartirDe.getDate());
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (r.recurrence === 'MONTHLY_DAY' && r.dayOfMonth) {
    // Procura nos próximos 14 meses: fevereiro não tem dia 30, e o mês é pulado
    for (let i = 0; i < 14; i += 1) {
      const mes = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const diasNoMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
      if (r.dayOfMonth > diasNoMes) continue;
      const data = new Date(mes.getFullYear(), mes.getMonth(), r.dayOfMonth);
      if (data >= base) return iso(data);
    }
    return iso(base);
  }

  const dia = r.dayOfWeek;
  if (typeof dia !== 'number') return iso(base);

  if (r.recurrence === 'MONTHLY_NTH' && (r.weeksOfMonth ?? []).length > 0) {
    const semanas = r.weeksOfMonth as number[];
    for (let i = 0; i < 14; i += 1) {
      const mes = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const diasNoMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
      const doDia: Date[] = [];
      for (let d = 1; d <= diasNoMes; d += 1) {
        const data = new Date(mes.getFullYear(), mes.getMonth(), d);
        if (data.getDay() === dia) doDia.push(data);
      }
      const candidatas = semanas
        .map((s) => (s === -1 ? doDia[doDia.length - 1] : doDia[s - 1]))
        .filter((d): d is Date => Boolean(d) && d >= base)
        .sort((a, b) => a.getTime() - b.getTime());
      if (candidatas.length) return iso(candidatas[0]);
    }
    return iso(base);
  }

  const data = new Date(base);
  data.setDate(data.getDate() + ((dia - data.getDay() + 7) % 7));
  return iso(data);
}
