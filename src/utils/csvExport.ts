/**
 * Exportação CSV que abre direito no Excel em português.
 *
 * - separador ';' (o Excel pt-BR usa a vírgula como decimal);
 * - BOM UTF-8 no início (sem ele os acentos viram "JosÃ©");
 * - aspas dobradas dentro do texto e quebras de linha preservadas na célula;
 * - célula que começa com = + - @ (ou tab/CR) ganha um apóstrofo na frente —
 *   evita injeção de fórmula ao abrir a planilha;
 * - datas em dd/mm/aaaa e rótulos dos enums em português (veja os mapas abaixo).
 */
import { formatCivilDate } from './dateFormat';

export type CsvCell = string | number | boolean | null | undefined | Date;

const FORMULA_START = /^[=+\-@\t\r]/;

/** Converte um valor em célula CSV já escapada. */
export const csvCell = (value: CsvCell): string => {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (value instanceof Date) text = isNaN(value.getTime()) ? '' : formatCivilDate(value, '');
  else if (typeof value === 'boolean') text = value ? 'Sim' : 'Não';
  // Número negativo é número, não fórmula: só texto passa pela neutralização
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value).replace('.', ',') : '';
  else {
    text = String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
};

/** Monta o conteúdo CSV (com BOM) a partir de cabeçalhos e linhas. */
export const buildCsv = (headers: string[], rows: CsvCell[][]): string => {
  const lines = [headers.map(csvCell).join(';'), ...rows.map((row) => row.map(csvCell).join(';'))];
  return `\uFEFF${lines.join('\r\n')}`;
};

/** Gera e baixa o arquivo CSV. `filename` sem extensão recebe a data de hoje + .csv. */
export const downloadCsv = (filename: string, headers: string[], rows: CsvCell[][]): void => {
  const blob = new Blob([buildCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}_${todayStamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Alguns navegadores ainda leem o blob depois do click
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Data de hoje (fuso do navegador) como AAAA-MM-DD, para nome de arquivo. */
export const todayStamp = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Data/hora (instante) como dd/mm/aaaa no fuso de Brasília. */
export const csvInstantDate = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/** Rótulo em português de um enum; sem mapa conhecido devolve o valor cru. */
export const enumLabel = (labels: Record<string, string>, value: string | null | undefined): string =>
  value ? labels[value] ?? value : '';

// ===== Rótulos dos enums usados nas exportações =====

export const MEMBER_STATUS_CSV: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  DECEASED: 'Falecido',
  ANONYMIZED: 'Anonimizado',
  AWAY: 'Afastado',
  IN_FORMATION: 'Em formação',
  TRANSFERRED: 'Transferido',
  DISENGAGED: 'Desligado',
};

export const MEMBER_TYPE_CSV: Record<string, string> = {
  MEMBER: 'Membro',
  AGENT: 'Agente de pastoral',
  COORDINATOR: 'Coordenador',
  CATECHIST: 'Catequista',
  MINISTER: 'Ministro',
  VOLUNTEER: 'Voluntário',
  FAMILY_RESPONSIBLE: 'Responsável familiar',
  CANDIDATE: 'Candidato/formando',
};

export const USER_ROLE_CSV: Record<string, string> = {
  SYSTEM_ADMIN: 'Administrador do Sistema',
  DIOCESAN_ADMIN: 'Administrador Diocesano',
  PARISH_ADMIN: 'Administrador Paroquial',
  COMMUNITY_COORDINATOR: 'Coordenador de Comunidade',
  PASTORAL_COORDINATOR: 'Coordenador de Pastoral',
  VOLUNTEER: 'Voluntário',
  FAITHFUL: 'Fiel',
};

export const GENDER_CSV: Record<string, string> = {
  MALE: 'Masculino',
  FEMALE: 'Feminino',
  OTHER: 'Outro',
};

export const MARITAL_STATUS_CSV: Record<string, string> = {
  SINGLE: 'Solteiro(a)',
  MARRIED: 'Casado(a)',
  DIVORCED: 'Divorciado(a)',
  WIDOWED: 'Viúvo(a)',
  COMMON_LAW_MARRIAGE: 'União estável',
};
