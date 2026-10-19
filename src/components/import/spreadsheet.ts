/**
 * Leitura de planilhas no navegador para o assistente de importação (Onda 1).
 *
 * - CSV: separador detectado (; , ou tab), aspas, UTF-8 com/sem BOM e, se o
 *   texto não for UTF-8 válido, Windows-1252 (Excel pt-BR antigo).
 * - XLSX: o arquivo é um ZIP de XMLs. Lido sem biblioteca externa: o índice
 *   do ZIP é percorrido aqui e cada parte é descompactada com o
 *   `DecompressionStream('deflate-raw')` nativo do navegador. Lê textos
 *   compartilhados, números, booleanos e datas (pelo formato da célula).
 *   Não lê .xls (formato binário antigo): a tela pede para salvar como .xlsx/.csv.
 */

export interface SheetData {
  name: string;
  rows: string[][];
}

export class SpreadsheetError extends Error {}

// ===================== CSV =====================

function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestCount = -1;
  for (const candidate of candidates) {
    // Conta fora de aspas
    let count = 0;
    let quoted = false;
    for (const char of firstLines) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((cell) => cell.trim()));
}

// ===================== ZIP =====================

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fim do diretório central: assinatura 0x06054b50 nos últimos ~64 KB
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetError('Arquivo .xlsx inválido ou corrompido.');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name.replace(/^\/+/, ''), { name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new SpreadsheetError('Este navegador não abre .xlsx. Atualize o navegador ou salve a planilha como .csv.');
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipFile(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localOffset;
  if (view.getUint32(local, true) !== 0x04034b50) throw new SpreadsheetError('Arquivo .xlsx corrompido.');
  const nameLength = view.getUint16(local + 26, true);
  const extraLength = view.getUint16(local + 28, true);
  const start = local + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  let data: Uint8Array;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) data = await inflateRaw(raw);
  else throw new SpreadsheetError('Compressão do .xlsx não suportada. Salve a planilha como .csv.');
  return new TextDecoder('utf-8').decode(data);
}

// ===================== XLSX =====================

const parseXml = (text: string): Document => new DOMParser().parseFromString(text, 'application/xml');
const byTag = (node: Document | Element, tag: string): Element[] => Array.from(node.getElementsByTagNameNS('*', tag));

/** Formatos internos do Excel que são data/hora. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Número de série do Excel (sistema 1900) → dd/mm/aaaa. */
export function excelSerialToDate(serial: number): string {
  const utc = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return String(serial);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

function resolvePath(target: string): string {
  const clean = target.replace(/^\/+/, '');
  return clean.startsWith('xl/') ? clean : `xl/${clean.replace(/^\.\//, '')}`;
}

async function readXlsx(buffer: ArrayBuffer): Promise<SheetData[]> {
  const bytes = new Uint8Array(buffer);
  const entries = readZipEntries(bytes);
  const read = async (path: string) => {
    const entry = entries.get(path);
    return entry ? readZipFile(bytes, entry) : null;
  };

  const workbookXml = await read('xl/workbook.xml');
  if (!workbookXml) throw new SpreadsheetError('Não encontramos as abas da planilha. Salve como .xlsx ou .csv.');

  // Textos compartilhados
  const shared: string[] = [];
  const sharedXml = await read('xl/sharedStrings.xml');
  if (sharedXml) {
    for (const si of byTag(parseXml(sharedXml), 'si')) {
      shared.push(byTag(si, 't').map((t) => t.textContent ?? '').join(''));
    }
  }

  // Estilos que são data
  const dateStyles = new Set<number>();
  const stylesXml = await read('xl/styles.xml');
  if (stylesXml) {
    const styles = parseXml(stylesXml);
    const customDate = new Set<number>();
    for (const fmt of byTag(styles, 'numFmt')) {
      const id = Number(fmt.getAttribute('numFmtId'));
      const code = (fmt.getAttribute('formatCode') ?? '').toLowerCase().replace(/"[^"]*"|\[[^\]]*\]/g, '');
      if (/[dy]/.test(code) || /m{1,4}.*[dy]|[dy].*m/.test(code)) customDate.add(id);
    }
    const cellXfs = byTag(styles, 'cellXfs')[0];
    if (cellXfs) {
      byTag(cellXfs, 'xf').forEach((xf, index) => {
        const id = Number(xf.getAttribute('numFmtId') ?? 0);
        if (BUILTIN_DATE_FORMATS.has(id) || customDate.has(id)) dateStyles.add(index);
      });
    }
  }

  // Abas → arquivo
  const rels = new Map<string, string>();
  const relsXml = await read('xl/_rels/workbook.xml.rels');
  if (relsXml) {
    for (const rel of byTag(parseXml(relsXml), 'Relationship')) {
      rels.set(rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '');
    }
  }
  const sheets: SheetData[] = [];
  const sheetNodes = byTag(parseXml(workbookXml), 'sheet');
  for (let i = 0; i < sheetNodes.length; i++) {
    const node = sheetNodes[i];
    const relId =
      node.getAttribute('r:id') ??
      node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ??
      '';
    const target = rels.get(relId);
    const path = target ? resolvePath(target) : `xl/worksheets/sheet${i + 1}.xml`;
    const xml = await read(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rowNode of byTag(parseXml(xml), 'row')) {
      const rowNumber = Number(rowNode.getAttribute('r')) || rows.length + 1;
      const values: string[] = [];
      let nextCol = 0;
      for (const cell of byTag(rowNode, 'c')) {
        const ref = cell.getAttribute('r');
        const col = ref ? columnIndex(ref) : nextCol;
        nextCol = col + 1;
        const type = cell.getAttribute('t');
        const style = Number(cell.getAttribute('s') ?? -1);
        const raw = byTag(cell, 'v')[0]?.textContent ?? '';
        let value = '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = byTag(cell, 't').map((t) => t.textContent ?? '').join('');
        else if (type === 'b') value = raw === '1' ? 'Sim' : 'Não';
        else if (type === 'str' || type === 'e') value = raw;
        else if (raw !== '') {
          const number = Number(raw);
          if (dateStyles.has(style) && Number.isFinite(number) && number > 0 && number < 2958466) value = excelSerialToDate(number);
          else if (Number.isFinite(number)) value = Number.isInteger(number) ? String(number) : String(Number(number.toFixed(10)));
          else value = raw;
        }
        values[col] = value.trim();
      }
      // Mantém a posição das linhas (linhas vazias no meio contam)
      while (rows.length < rowNumber - 1) rows.push([]);
      rows.push(Array.from(values, (v) => v ?? ''));
    }
    sheets.push({ name: node.getAttribute('name') ?? `Aba ${i + 1}`, rows });
  }
  if (sheets.length === 0) throw new SpreadsheetError('A planilha não tem abas com dados.');
  return sheets;
}

/** Lê .csv/.txt ou .xlsx e devolve as abas com as linhas como texto. */
export async function readSpreadsheet(file: File): Promise<SheetData[]> {
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.xls')) {
    throw new SpreadsheetError('Arquivos .xls (Excel antigo) não são lidos. Abra no Excel e salve como .xlsx ou .csv.');
  }
  const bytes = new Uint8Array(buffer.slice(0, 4));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (name.endsWith('.xlsx') || isZip) return readXlsx(buffer);
  return [{ name: file.name, rows: parseCsv(decodeText(buffer)) }];
}
