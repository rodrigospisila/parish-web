import { phoneForApi } from '../../utils/phone';

/**
 * Campos do assistente de importação (Onda 1 — C5) e a conversão de cada
 * linha da planilha para o corpo do POST /members/import.
 *
 * Chaves enviadas em `rows[]`: fullName, phone, email, cpf, birthDate
 * (AAAA-MM-DD; só dia/mês vira 1900-MM-DD, convenção do cadastro), gender
 * (MALE/FEMALE/OTHER), zipCode, street, number, complement, neighborhood,
 * city, state, notes e, para dizimistas, registrationNumber.
 */

export type ImportKind = 'MEMBERS' | 'TITHERS';

/** Igual ao limite do backend por envio (POST /members/import). */
export const MAX_IMPORT_ROWS = 2000;
/** Arquivo maior que isso nem é lido (planilhas reais têm poucas centenas de KB). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Só para este tipo de importação */
  kinds?: ImportKind[];
  /** Cabeçalhos reconhecidos (sem acento, minúsculas) */
  aliases: string[];
  example: string;
}

export const IMPORT_FIELDS: ImportField[] = [
  {
    key: 'fullName',
    label: 'Nome completo',
    required: true,
    aliases: ['nome', 'nome completo', 'nome do membro', 'nome do dizimista', 'membro', 'dizimista', 'pessoa', 'full name', 'name', 'fullname'],
    example: 'Maria Aparecida da Silva',
  },
  {
    key: 'phone',
    label: 'Celular / telefone',
    aliases: ['telefone', 'celular', 'fone', 'whatsapp', 'whats', 'contato', 'tel', 'telefone celular', 'phone', 'mobile'],
    example: '(42) 99999-8888',
  },
  { key: 'email', label: 'E-mail', aliases: ['email', 'e-mail', 'e mail', 'correio eletronico'], example: 'maria@email.com' },
  { key: 'cpf', label: 'CPF', aliases: ['cpf', 'documento', 'cpf do dizimista'], example: '123.456.789-09' },
  {
    key: 'birthDate',
    label: 'Nascimento (dd/mm/aaaa ou dd/mm)',
    aliases: ['nascimento', 'data de nascimento', 'data nascimento', 'aniversario', 'dt nascimento', 'dt nasc', 'nasc', 'birthdate', 'birth date', 'data de aniversario'],
    example: '15/08/1975',
  },
  { key: 'gender', label: 'Sexo', aliases: ['sexo', 'genero', 'gender'], example: 'F' },
  { key: 'zipCode', label: 'CEP', aliases: ['cep', 'zipcode', 'zip'], example: '84430-000' },
  { key: 'street', label: 'Rua / endereço', aliases: ['rua', 'endereco', 'logradouro', 'street', 'address'], example: 'Rua XV de Novembro' },
  { key: 'number', label: 'Número', aliases: ['numero', 'nro', 'number', 'numero da casa', 'n da casa'], example: '123' },
  { key: 'complement', label: 'Complemento', aliases: ['complemento', 'apto', 'apartamento'], example: 'Apto 2' },
  { key: 'neighborhood', label: 'Bairro', aliases: ['bairro', 'neighborhood'], example: 'Centro' },
  { key: 'city', label: 'Cidade', aliases: ['cidade', 'municipio', 'city'], example: 'Imbituva' },
  { key: 'state', label: 'UF', aliases: ['uf', 'estado', 'state'], example: 'PR' },
  {
    key: 'registrationNumber',
    label: 'Nº do dizimista / envelope',
    kinds: ['TITHERS'],
    aliases: ['numero do dizimista', 'n do dizimista', 'registro', 'matricula', 'envelope', 'carne', 'codigo', 'cod', 'inscricao', 'n dizimista'],
    example: '0153',
  },
  {
    key: 'notes',
    label: 'Observações',
    aliases: ['observacoes', 'observacao', 'obs', 'anotacoes', 'notas', 'notes', 'camiseta', 'tamanho camiseta'],
    example: '',
  },
];

export const fieldsFor = (kind: ImportKind): ImportField[] =>
  IMPORT_FIELDS.filter((field) => !field.kinds || field.kinds.includes(kind));

export const normalizeHeader = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[º°ª.#:_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Sugere a coluna de cada campo pelo nome do cabeçalho. Devolve campo → índice da coluna. */
export function suggestMapping(headers: string[], kind: ImportKind): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const mapping: Record<string, number> = {};
  const used = new Set<number>();
  const fields = fieldsFor(kind);
  // 1ª passada: igual; 2ª: começa com / contém o apelido
  for (const exact of [true, false]) {
    for (const field of fields) {
      if (mapping[field.key] !== undefined) continue;
      const index = normalized.findIndex(
        (header, i) =>
          !used.has(i) &&
          header !== '' &&
          field.aliases.some((alias) => (exact ? header === alias : alias.length >= 3 && (header.startsWith(`${alias} `) || header.includes(alias)))),
      );
      if (index >= 0) {
        mapping[field.key] = index;
        used.add(index);
      }
    }
  }
  return mapping;
}

/** Índice da primeira linha que parece cabeçalho (com texto em 2+ colunas) entre as 10 primeiras. */
export function detectHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const filled = rows[i].filter((cell) => cell && cell.trim() !== '').length;
    if (filled >= 2) return i;
  }
  return 0;
}

// ===================== Normalização das células =====================

const pad = (value: number) => String(value).padStart(2, '0');

/** dd/mm/aaaa, dd-mm-aa, aaaa-mm-dd ou dd/mm → AAAA-MM-DD (só dia/mês → ano 1900). */
export function normalizeBirthDate(value: string): { value?: string; error?: string; note?: string } {
  const text = value.trim();
  if (!text) return {};
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let day: number;
  let month: number;
  let year: number;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
    if (!match) return { error: `Data "${text}" não reconhecida (use dd/mm/aaaa)` };
    day = Number(match[1]);
    month = Number(match[2]);
    if (match[3]) {
      year = Number(match[3]);
      if (match[3].length === 2) {
        const current = new Date().getFullYear() % 100;
        year += year > current ? 1900 : 2000;
      }
    } else {
      year = 1900;
    }
  }
  // Coluna "aniversário" de planilha costuma vir com o ano corrente (ou futuro):
  // vale só o dia/mês (convenção do cadastro: ano 1900 = idade desconhecida)
  let note: string | undefined;
  if (year >= new Date().getFullYear() - 1) {
    note = `Ano de "${text}" ignorado: parece só o aniversário (dia/mês)`;
    year = 1900;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // 29/02 sem ano não existe em 1900: a linha avisa em vez de inventar outra data
  if (month < 1 || month > 12 || date.getUTCDate() !== day || year < 1900) {
    return { error: `Data "${text}" inválida` };
  }
  return { value: `${year}-${pad(month)}-${pad(day)}`, note };
}

export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calc = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

function normalizeGender(value: string): string | undefined {
  const text = normalizeHeader(value);
  if (!text) return undefined;
  if (['f', 'fem', 'feminino', 'mulher', 'female'].includes(text)) return 'FEMALE';
  if (['m', 'masc', 'masculino', 'homem', 'male'].includes(text)) return 'MALE';
  return 'OTHER';
}

export interface PreparedRow {
  /** Linha na planilha (1 = primeira linha do arquivo) */
  line: number;
  data: Record<string, string>;
  /** Problemas detectados no navegador (a linha não é enviada) */
  errors: string[];
  /** Avisos (a linha vai, com o campo ajustado/descartado) */
  warnings: string[];
}

/** Converte as linhas mapeadas no corpo do import (e valida o que dá para validar aqui). */
export function prepareRows(
  rows: string[][],
  headerIndex: number,
  mapping: Record<string, number>,
  kind: ImportKind,
): PreparedRow[] {
  const fields = fieldsFor(kind);
  // "TAMANHO CAMISETA" → observação "Camiseta: G" (o valor solto não diria nada)
  const notesHeader = mapping.notes !== undefined ? normalizeHeader(rows[headerIndex]?.[mapping.notes] ?? '') : '';
  const notesPrefix = notesHeader.includes('camiseta') ? 'Camiseta: ' : '';
  const prepared: PreparedRow[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const source = rows[i] ?? [];
    if (source.every((cell) => !cell || !cell.trim())) continue;
    const data: Record<string, string> = {};
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const field of fields) {
      const index = mapping[field.key];
      if (index === undefined || index < 0) continue;
      const raw = (source[index] ?? '').trim();
      if (!raw) continue;
      switch (field.key) {
        case 'fullName':
          data.fullName = raw.replace(/\s+/g, ' ');
          break;
        case 'phone': {
          const phone = phoneForApi(raw);
          if (/^\+55\d{10,11}$/.test(phone)) {
            data.phone = phone;
          } else {
            warnings.push(`Telefone "${raw}" fora do padrão (DDD + número) — vai como está`);
            data.phone = raw;
          }
          break;
        }
        case 'email':
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) data.email = raw.toLowerCase();
          else warnings.push(`E-mail "${raw}" inválido — não será gravado`);
          break;
        case 'cpf':
          if (isValidCpf(raw)) data.cpf = raw.replace(/\D/g, '');
          else warnings.push(`CPF "${raw}" inválido — não será gravado`);
          break;
        case 'birthDate': {
          const result = normalizeBirthDate(raw);
          if (result.value) data.birthDate = result.value;
          else if (result.error) warnings.push(`${result.error} — não será gravada`);
          if (result.note) warnings.push(result.note);
          break;
        }
        case 'gender': {
          const gender = normalizeGender(raw);
          if (gender) data.gender = gender;
          break;
        }
        case 'state':
          data.state = raw.toUpperCase().slice(0, 2);
          break;
        case 'zipCode':
          data.zipCode = raw.replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2') || raw;
          break;
        case 'notes':
          data.notes = `${notesPrefix}${raw}`;
          break;
        default:
          data[field.key] = raw;
      }
    }
    // Linha só com a numeração (ou colunas não importadas): ficha em branco, ignora
    if (Object.keys(data).length === 0) continue;
    if (!data.fullName) errors.push('Sem nome');
    prepared.push({ line: i + 1, data, errors, warnings });
  }
  return prepared;
}

/** CSV-modelo (Excel pt-BR: ';' e BOM) gerado no próprio navegador. */
export function downloadTemplate(kind: ImportKind): void {
  const fields = fieldsFor(kind);
  const headers = fields.map((field) => field.label.replace(/ \(.*\)$/, ''));
  const example = fields.map((field) => field.example);
  const escape = (cell: string) => (/[;"\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const content = `﻿${[headers, example].map((row) => row.map(escape).join(';')).join('\r\n')}\r\n`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = kind === 'TITHERS' ? 'modelo-dizimistas.csv' : 'modelo-membros.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===================== Resposta do servidor =====================

export type RowOutcome = 'ok' | 'error' | 'duplicate' | 'skipped' | 'updated';

export interface PreviewRow {
  /** Índice (0-based) no array `rows` enviado */
  index: number;
  status: RowOutcome;
  messages: string[];
  duplicateOf?: string | null;
}

export interface ImportReport {
  rows: PreviewRow[];
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  duplicates: number;
}

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * Lê a resposta do import (prévia ou gravação) de forma tolerante: aceita
 * `rows`/`preview`/`items` por linha (com `index` 0-based ou `line` 1-based
 * relativo ao array enviado) e os totais `created|imported`, `updated`,
 * `skipped`, `errors` (número ou lista `{ line, reason }`).
 */
export function readImportResponse(data: any, sentCount: number): ImportReport {
  const perRow = asArray(data?.rows ?? data?.preview ?? data?.items ?? data?.results);
  const rows: PreviewRow[] = perRow.map((row: any, position: number) => {
    const index =
      asNumber(row?.index) ?? (asNumber(row?.line) !== undefined ? (row.line as number) - 1 : undefined) ?? (asNumber(row?.row) !== undefined ? (row.row as number) - 1 : position);
    const rawStatus = String(row?.status ?? row?.result ?? (row?.ok === false ? 'error' : 'ok')).toLowerCase();
    let status: RowOutcome = 'ok';
    if (/dup/.test(rawStatus) || row?.duplicate || row?.duplicateOf || row?.possibleDuplicate) status = 'duplicate';
    if (/err|invalid|fail/.test(rawStatus) || (asArray(row?.errors).length > 0 && !/dup/.test(rawStatus))) status = 'error';
    if (/skip|ignor/.test(rawStatus)) status = 'skipped';
    if (/updat|merg/.test(rawStatus)) status = 'updated';
    const messages = [
      ...asArray(row?.errors).map((e: any) => (typeof e === 'string' ? e : e?.message ?? e?.reason ?? '')),
      ...asArray(row?.warnings).map((e: any) => (typeof e === 'string' ? e : e?.message ?? '')),
      ...(typeof row?.reason === 'string' ? [row.reason] : []),
      ...(typeof row?.message === 'string' ? [row.message] : []),
    ].filter(Boolean);
    const dup = row?.duplicateOf ?? row?.duplicate ?? row?.possibleDuplicate;
    const duplicateOf =
      typeof dup === 'string' ? dup : dup && typeof dup === 'object' ? dup.fullName ?? dup.name ?? null : null;
    return { index: Math.max(0, Math.min(index, Math.max(sentCount - 1, 0))), status, messages, duplicateOf };
  });

  // Formato antigo: errors = [{ line, reason }]
  const errorList = asArray(data?.errors);
  if (rows.length === 0 && errorList.length > 0) {
    errorList.forEach((err: any) => {
      const line = asNumber(err?.line);
      rows.push({
        index: line !== undefined ? line - 1 : 0,
        status: 'error',
        messages: [String(err?.reason ?? err?.message ?? 'Erro')],
      });
    });
  }

  const count = (status: RowOutcome) => rows.filter((row) => row.status === status).length;
  const summary = data?.summary ?? data?.totals ?? data ?? {};
  return {
    rows,
    created: asNumber(summary.created) ?? asNumber(summary.imported) ?? asNumber(summary.ok) ?? count('ok'),
    updated: asNumber(summary.updated) ?? count('updated'),
    skipped: asNumber(summary.skipped) ?? count('skipped'),
    errors: asNumber(summary.errors) ?? (Array.isArray(summary.errors) ? summary.errors.length : count('error')),
    duplicates: asNumber(summary.duplicates) ?? count('duplicate'),
  };
}
