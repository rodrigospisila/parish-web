import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TitleIcon from '../components/TitleIcon';
import SearchSelect from '../components/SearchSelect';
import api, { getErrorMessage } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { scopeCommunityIdOf } from '../utils/userScope';
import { isPagedResponse, useDebouncedValue } from '../utils/useDebouncedValue';
import { downloadCsv } from '../utils/csvExport';
import { formatPhoneDisplay } from '../utils/phone';
import { readSpreadsheet, SpreadsheetError, type SheetData } from '../components/import/spreadsheet';
import {
  MAX_FILE_BYTES,
  MAX_IMPORT_ROWS,
  detectHeaderRow,
  downloadTemplate,
  fieldsFor,
  prepareRows,
  readImportResponse,
  suggestMapping,
  type ImportKind,
  type ImportReport,
  type PreparedRow,
  type RowOutcome,
} from '../components/import/importSchema';
import './modules/ModulePages.css';
import './ImportPage.css';

/**
 * Assistente "Importar planilha" (Onda 1 — C5; saas-implantacao-09, ux-web-03).
 * Rota: /admin/importar
 *
 * 1) tipo e comunidade → 2) arquivo (.csv/.xlsx, lido no navegador) →
 * 3) mapeamento das colunas (sugestão pelo cabeçalho) → 4) prévia no servidor
 * (dryRun: erros e duplicados por linha) → confirmar → relatório.
 */

type Step = 1 | 2 | 3 | 4 | 5;

interface CommunityOption {
  id: string;
  name: string;
  parishName?: string;
}

const KIND_INFO: Record<ImportKind, { title: string; description: string }> = {
  MEMBERS: {
    title: 'Membros',
    description: 'Pessoas da comunidade: nome, celular, nascimento, endereço…',
  },
  TITHERS: {
    title: 'Dizimistas',
    description: 'Cria o cadastro da pessoa (se ainda não existir) e o registro de dizimista com o número do carnê.',
  },
};

const OUTCOME_LABEL: Record<RowOutcome | 'local', string> = {
  ok: 'Pronta',
  updated: 'Atualiza',
  duplicate: 'Duplicado provável',
  skipped: 'Ignorada',
  error: 'Erro',
  local: 'Erro',
};

const OUTCOME_TONE: Record<RowOutcome | 'local', string> = {
  ok: 'is-ok',
  updated: 'is-ok',
  duplicate: 'is-warn',
  skipped: 'is-muted',
  error: 'is-bad',
  local: 'is-bad',
};

const STEP_LABELS = ['Tipo', 'Arquivo', 'Colunas', 'Prévia', 'Relatório'];

const columnLetter = (index: number): string => {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    label = String.fromCharCode(65 + rest) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
};

const ImportPage: React.FC = () => {
  const { user } = useAuth();
  const wideScope = user?.role === 'SYSTEM_ADMIN' || user?.role === 'DIOCESAN_ADMIN';
  const fixedCommunityId = user?.role === 'COMMUNITY_COORDINATOR' ? scopeCommunityIdOf(user) : undefined;

  const [step, setStep] = useState<Step>(1);
  const [kind, setKind] = useState<ImportKind>('MEMBERS');
  const [communityId, setCommunityId] = useState(fixedCommunityId ?? '');
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const [communitySearch, setCommunitySearch] = useState('');
  const debouncedCommunitySearch = useDebouncedValue(communitySearch.trim(), 350);
  const [communityName, setCommunityName] = useState('');

  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState('');

  const [prepared, setPrepared] = useState<PreparedRow[]>([]);
  const [sent, setSent] = useState<PreparedRow[]>([]);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [reportRows, setReportRows] = useState<PreparedRow[]>([]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // Comunidades onde a pessoa pode importar
  useEffect(() => {
    if (fixedCommunityId) return;
    let cancelled = false;
    const params = wideScope
      ? { page: 1, pageSize: 30, search: debouncedCommunitySearch || undefined }
      : user?.parishId
        ? { parishId: user.parishId }
        : undefined;
    api
      .get('/communities', { params })
      .then(({ data }) => {
        if (cancelled) return;
        const rows: any[] = isPagedResponse<any>(data) ? data.items : Array.isArray(data) ? data : [];
        setCommunities(
          rows.map((c) => ({ id: c.id, name: c.name, parishName: c.parish?.name })).sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((error) => {
        if (!cancelled) setStepError(getErrorMessage(error, 'Não foi possível carregar as comunidades'));
      });
    return () => {
      cancelled = true;
    };
  }, [fixedCommunityId, wideScope, debouncedCommunitySearch, user?.parishId]);

  // Nome da comunidade fixa (coordenação de comunidade)
  useEffect(() => {
    if (!fixedCommunityId) return;
    api
      .get(`/communities/${fixedCommunityId}`)
      .then(({ data }) => setCommunityName(data?.name ?? ''))
      .catch(() => undefined);
  }, [fixedCommunityId]);

  const sheet = sheets[sheetIndex];
  const headers = useMemo(() => (sheet ? sheet.rows[headerIndex] ?? [] : []), [sheet, headerIndex]);
  const columnCount = useMemo(
    () => (sheet ? Math.max(headers.length, ...sheet.rows.slice(headerIndex, headerIndex + 20).map((r) => r.length)) : 0),
    [sheet, headers, headerIndex],
  );
  const dataRowCount = useMemo(
    () => (sheet ? sheet.rows.slice(headerIndex + 1).filter((r) => r.some((c) => c && c.trim())).length : 0),
    [sheet, headerIndex],
  );

  const communityOptions = communities.map((c) => ({ value: c.id, label: c.name, sublabel: c.parishName }));
  const selectedCommunityName = communityName || communities.find((c) => c.id === communityId)?.name || '';

  const resetFile = () => {
    setSheets([]);
    setFileName('');
    setMapping({});
    setPreview(null);
    setPrepared([]);
    setSent([]);
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pickSheet = (index: number, list = sheets) => {
    const rows = list[index]?.rows ?? [];
    const header = detectHeaderRow(rows);
    setSheetIndex(index);
    setHeaderIndex(header);
    setMapping(suggestMapping(rows[header] ?? [], kind));
  };

  const onFile = async (file: File | undefined) => {
    setFileError('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError('Arquivo grande demais (máximo de 10 MB). Divida a planilha em partes.');
      return;
    }
    setReading(true);
    try {
      const list = (await readSpreadsheet(file)).filter((s) => s.rows.some((r) => r.some((c) => c && c.trim())));
      if (list.length === 0) {
        setFileError('A planilha está vazia.');
        return;
      }
      setSheets(list);
      setFileName(file.name);
      pickSheet(0, list);
    } catch (error) {
      setFileError(
        error instanceof SpreadsheetError ? error.message : 'Não foi possível ler o arquivo. Salve como .xlsx ou .csv e tente de novo.',
      );
    } finally {
      setReading(false);
    }
  };

  const goToPreview = async () => {
    setStepError('');
    if (mapping.fullName === undefined) {
      setStepError('Indique qual coluna tem o nome da pessoa.');
      return;
    }
    const rows = prepareRows(sheet.rows, headerIndex, mapping, kind);
    if (rows.length === 0) {
      setStepError('Nenhuma linha com dados abaixo do cabeçalho.');
      return;
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      setStepError(
        `A planilha tem ${rows.length} linhas; o limite por importação é ${MAX_IMPORT_ROWS}. Divida em partes e importe uma de cada vez.`,
      );
      return;
    }
    const valid = rows.filter((row) => row.errors.length === 0);
    setPrepared(rows);
    setSent(valid);
    setPreview(null);
    setStep(4);
    if (valid.length === 0) return;
    setBusy(true);
    try {
      const { data } = await api.post('/members/import', {
        kind,
        communityId,
        rows: valid.map((row) => row.data),
        dryRun: true,
      });
      setPreview(readImportResponse(data, valid.length));
    } catch (error) {
      setStepError(getErrorMessage(error, 'Não foi possível conferir a planilha no servidor'));
    } finally {
      setBusy(false);
    }
  };

  /** Resultado do servidor (prévia) para a linha enviada na posição `index`. */
  const previewByIndex = useMemo(() => {
    const map = new Map<number, ImportReport['rows'][number]>();
    preview?.rows.forEach((row) => map.set(row.index, row));
    return map;
  }, [preview]);

  const toImport = useMemo(
    () =>
      sent.filter((_, index) => {
        const outcome = previewByIndex.get(index)?.status ?? 'ok';
        if (outcome === 'error' || outcome === 'skipped') return false;
        if (outcome === 'duplicate' && skipDuplicates) return false;
        return true;
      }),
    [sent, previewByIndex, skipDuplicates],
  );

  const confirmImport = async () => {
    if (toImport.length === 0 || busy) return;
    setBusy(true);
    setStepError('');
    try {
      const { data } = await api.post('/members/import', {
        kind,
        communityId,
        rows: toImport.map((row) => row.data),
      });
      setReport(readImportResponse(data, toImport.length));
      setReportRows(toImport);
      setStep(5);
    } catch (error) {
      setStepError(getErrorMessage(error, 'A importação falhou. Nada foi confirmado — confira a conexão e tente de novo.'));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    resetFile();
    setReport(null);
    setReportRows([]);
    setStepError('');
    setStep(1);
  };

  const downloadIssues = () => {
    const lines: (string | number)[][] = [];
    prepared.forEach((row) => {
      if (row.errors.length || row.warnings.length) {
        lines.push([row.line, row.data.fullName ?? '', 'Navegador', [...row.errors, ...row.warnings].join(' | ')]);
      }
    });
    sent.forEach((row, index) => {
      const result = previewByIndex.get(index);
      if (result && result.status !== 'ok') {
        lines.push([
          row.line,
          row.data.fullName ?? '',
          OUTCOME_LABEL[result.status],
          [result.duplicateOf ? `Parecido com ${result.duplicateOf}` : '', ...result.messages].filter(Boolean).join(' | '),
        ]);
      }
    });
    downloadCsv('importacao-pendencias', ['Linha', 'Nome', 'Situação', 'Detalhe'], lines);
  };

  const fields = fieldsFor(kind);
  const localErrors = prepared.filter((row) => row.errors.length > 0).length;
  const warningsCount = prepared.filter((row) => row.warnings.length > 0).length;

  return (
    <div className="module-page import-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}>
          <TitleIcon name="membros" /> Importar planilha
        </h1>
        <div className="header-actions">
          <Link to="/admin/members" className="btn-small" style={{ textDecoration: 'none', padding: '0.6rem 1rem' }}>
            Voltar para Membros
          </Link>
        </div>
      </div>

      <ol className="import-steps" aria-label="Etapas da importação">
        {STEP_LABELS.map((label, index) => {
          const number = (index + 1) as Step;
          return (
            <li
              key={label}
              className={`import-steps__item${number === step ? ' is-current' : ''}${number < step ? ' is-done' : ''}`}
              aria-current={number === step ? 'step' : undefined}
            >
              <span className="import-steps__number" aria-hidden="true">
                {number < step ? '✓' : number}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      <section className="import-card">
        {stepError && (
          <div className="import-alert is-error" role="alert">
            {stepError}
          </div>
        )}

        {/* ---------- 1. Tipo e comunidade ---------- */}
        {step === 1 && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              O que você vai importar?
            </h2>
            <fieldset className="import-kinds">
              <legend className="sr-only">Tipo de importação</legend>
              {(Object.keys(KIND_INFO) as ImportKind[]).map((key) => (
                <label key={key} className={`import-kind${kind === key ? ' is-active' : ''}`}>
                  <input type="radio" name="import-kind" value={key} checked={kind === key} onChange={() => {
                      setKind(key);
                      if (sheet) setMapping(suggestMapping(headers, key));
                    }}
                  />
                  <span>
                    <strong>{KIND_INFO[key].title}</strong>
                    <br />
                    <span className="import-muted">{KIND_INFO[key].description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="import-field">
              <span className="import-label" id="import-community-label">
                Comunidade de destino *
              </span>
              {fixedCommunityId ? (
                <p style={{ margin: 0 }}>
                  <strong>{selectedCommunityName || 'Sua comunidade'}</strong>
                </p>
              ) : (
                <div aria-labelledby="import-community-label">
                  <SearchSelect
                    options={communityOptions}
                    value={communityId}
                    onChange={setCommunityId}
                    placeholder="Selecione a comunidade"
                    searchPlaceholder="Buscar comunidade..."
                    onSearchChange={wideScope ? setCommunitySearch : undefined}
                  />
                </div>
              )}
              <span className="import-muted">Todas as pessoas da planilha entram nesta comunidade.</span>
            </div>

            <div className="import-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={!communityId}
                onClick={() => {
                  setStepError('');
                  setStep(2);
                }}
              >
                Continuar
              </button>
            </div>
          </>
        )}

        {/* ---------- 2. Arquivo ---------- */}
        {step === 2 && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              Envie a planilha de {KIND_INFO[kind].title.toLowerCase()}
            </h2>
            <p className="import-muted">
              Aceita <strong>.xlsx</strong> (Excel) e <strong>.csv</strong>. O arquivo é lido aqui no seu navegador; só as
              linhas confirmadas vão para o Parish. Até {MAX_IMPORT_ROWS} linhas por vez.
            </p>
            <div className="import-actions is-left">
              <button type="button" className="btn-small" onClick={() => downloadTemplate(kind)}>
                Baixar modelo (.csv)
              </button>
            </div>

            <div className="import-field">
              <label className="import-label" htmlFor="import-file">
                Arquivo
              </label>
              <input
                id="import-file"
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => void onFile(e.target.files?.[0])}
                disabled={reading}
              />
              {reading && (
                <span className="import-muted" role="status">
                  Lendo a planilha…
                </span>
              )}
            </div>
            {fileError && (
              <div className="import-alert is-error" role="alert">
                {fileError}
              </div>
            )}

            {sheet && (
              <>
                <div className="import-alert is-ok" role="status">
                  <strong>{fileName}</strong>: {dataRowCount} linha(s) com dados
                  {sheets.length > 1 ? ` na aba "${sheet.name}"` : ''}.
                </div>
                <div className="import-grid">
                  {sheets.length > 1 && (
                    <div className="import-field">
                      <label className="import-label" htmlFor="import-sheet">
                        Aba
                      </label>
                      <select id="import-sheet" value={sheetIndex} onChange={(e) => pickSheet(Number(e.target.value))}>
                        {sheets.map((s, index) => (
                          <option key={`${s.name}-${index}`} value={index}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="import-field">
                    <label className="import-label" htmlFor="import-header">
                      Linha do cabeçalho
                    </label>
                    <select
                      id="import-header"
                      value={headerIndex}
                      onChange={(e) => {
                        const index = Number(e.target.value);
                        setHeaderIndex(index);
                        setMapping(suggestMapping(sheet.rows[index] ?? [], kind));
                      }}
                    >
                      {sheet.rows.slice(0, 10).map((row, index) => (
                        <option key={index} value={index}>
                          Linha {index + 1}: {row.filter(Boolean).slice(0, 3).join(' · ').slice(0, 60) || '(vazia)'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            <div className="import-actions">
              <button type="button" className="btn-small" onClick={() => setStep(1)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!sheet || dataRowCount === 0}
                onClick={() => {
                  setStepError('');
                  setStep(3);
                }}
              >
                Continuar
              </button>
            </div>
          </>
        )}

        {/* ---------- 3. Mapeamento ---------- */}
        {step === 3 && sheet && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              Qual coluna é cada informação?
            </h2>
            <p className="import-muted">
              Já sugerimos pelo nome do cabeçalho. Confira e ajuste; o que ficar em “Não importar” é ignorado.
            </p>
            <div className="import-mapping">
              {fields.map((field) => {
                const index = mapping[field.key];
                const samples =
                  index !== undefined
                    ? sheet.rows
                        .slice(headerIndex + 1)
                        .map((r) => r[index])
                        .filter((v) => v && v.trim())
                        .slice(0, 3)
                    : [];
                return (
                  <div key={field.key} className="import-mapping__row">
                    <label htmlFor={`map-${field.key}`} className="import-label">
                      {field.label}
                      {field.required ? ' *' : ''}
                    </label>
                    <select
                      id={`map-${field.key}`}
                      value={index ?? ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        setMapping((current) => {
                          const next = { ...current };
                          if (value === '') delete next[field.key];
                          else next[field.key] = Number(value);
                          return next;
                        });
                      }}
                    >
                      <option value="">Não importar</option>
                      {Array.from({ length: columnCount }, (_, col) => (
                        <option key={col} value={col}>
                          Coluna {columnLetter(col)}
                          {headers[col] ? ` — ${headers[col]}` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="import-muted import-mapping__sample">
                      {samples.length ? `Ex.: ${samples.join(' · ')}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="import-actions">
              <button type="button" className="btn-small" onClick={() => setStep(2)}>
                Voltar
              </button>
              <button type="button" className="btn-primary" onClick={() => void goToPreview()} disabled={busy}>
                Conferir as linhas
              </button>
            </div>
          </>
        )}

        {/* ---------- 4. Prévia ---------- */}
        {step === 4 && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              Prévia da importação
            </h2>
            {busy && !preview && (
              <p className="import-muted" role="status">
                Conferindo {sent.length} linha(s) no servidor (nada é gravado nesta etapa)…
              </p>
            )}
            <div className="import-counters" aria-live="polite">
              <span>
                <strong>{prepared.length}</strong> linha(s) lidas
              </span>
              {preview && (
                <span className="is-ok">
                  <strong>{preview.created + preview.updated}</strong> pronta(s)
                </span>
              )}
              {preview && preview.duplicates > 0 && (
                <span className="is-warn">
                  <strong>{preview.duplicates}</strong> duplicado(s) provável(is)
                </span>
              )}
              {(localErrors > 0 || (preview && preview.errors > 0)) && (
                <span className="is-bad">
                  <strong>{localErrors + (preview?.errors ?? 0)}</strong> com erro
                </span>
              )}
              {warningsCount > 0 && (
                <span className="is-muted">
                  <strong>{warningsCount}</strong> com aviso
                </span>
              )}
            </div>

            {preview && preview.duplicates > 0 && (
              <label className="import-check">
                <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
                Não importar as linhas com duplicado provável (recomendado — confira depois em Membros)
              </label>
            )}

            <div className="import-table-wrap">
              <table className="import-table">
                <caption className="sr-only">Situação de cada linha da planilha</caption>
                <thead>
                  <tr>
                    <th scope="col">Linha</th>
                    <th scope="col">Nome</th>
                    <th scope="col">Celular</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {prepared.slice(0, 500).map((row) => {
                    const sentIndex = sent.indexOf(row);
                    const result = sentIndex >= 0 ? previewByIndex.get(sentIndex) : undefined;
                    const outcome: RowOutcome | 'local' = row.errors.length ? 'local' : result?.status ?? 'ok';
                    const details = [
                      ...row.errors,
                      ...(result?.duplicateOf ? [`Parecido com: ${result.duplicateOf}`] : []),
                      ...(result?.messages ?? []),
                      ...row.warnings,
                    ];
                    return (
                      <tr key={row.line}>
                        <td>{row.line}</td>
                        <td>{row.data.fullName || '—'}</td>
                        <td>{formatPhoneDisplay(row.data.phone) || '—'}</td>
                        <td>
                          <span className={`import-pill ${OUTCOME_TONE[outcome]}`}>
                            {preview || outcome === 'local' ? OUTCOME_LABEL[outcome] : '…'}
                          </span>
                        </td>
                        <td className="import-muted">{details.join(' · ') || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {prepared.length > 500 && (
                <p className="import-muted">Mostrando as 500 primeiras linhas. O relatório completo está no botão abaixo.</p>
              )}
            </div>

            <div className="import-actions">
              <button type="button" className="btn-small" onClick={() => setStep(3)} disabled={busy}>
                Voltar
              </button>
              <button type="button" className="btn-small" onClick={downloadIssues}>
                Baixar pendências (.csv)
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void confirmImport()}
                disabled={busy || !preview || toImport.length === 0}
                aria-busy={busy}
              >
                {busy && preview ? 'Importando…' : `Importar ${toImport.length} linha(s) em ${selectedCommunityName || 'comunidade'}`}
              </button>
            </div>
          </>
        )}

        {/* ---------- 5. Relatório ---------- */}
        {step === 5 && report && (
          <>
            <h2 ref={headingRef} tabIndex={-1}>
              Importação concluída
            </h2>
            <div className="import-counters">
              <span className="is-ok">
                <strong>{report.created}</strong> criado(s)
              </span>
              {report.updated > 0 && (
                <span className="is-ok">
                  <strong>{report.updated}</strong> atualizado(s)
                </span>
              )}
              {report.skipped + report.duplicates > 0 && (
                <span className="is-muted">
                  <strong>{report.skipped + report.duplicates}</strong> ignorado(s)
                </span>
              )}
              {report.errors > 0 && (
                <span className="is-bad">
                  <strong>{report.errors}</strong> com erro
                </span>
              )}
            </div>
            {report.rows.filter((row) => row.status === 'error').length > 0 && (
              <div className="import-table-wrap">
                <table className="import-table">
                  <caption className="sr-only">Linhas que não entraram</caption>
                  <thead>
                    <tr>
                      <th scope="col">Linha</th>
                      <th scope="col">Nome</th>
                      <th scope="col">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows
                      .filter((row) => row.status === 'error')
                      .map((row) => {
                        const source = reportRows[row.index];
                        return (
                          <tr key={`${row.index}-${row.messages.join()}`}>
                            <td>{source?.line ?? row.index + 1}</td>
                            <td>{source?.data.fullName ?? '—'}</td>
                            <td className="import-muted">{row.messages.join(' · ') || 'Erro'}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="import-muted">
              As pessoas importadas ainda não têm acesso ao app. Para chamar alguém da equipe, use “Convidar para o app” na
              ficha do membro.
            </p>
            <div className="import-actions">
              <button type="button" className="btn-small" onClick={restart}>
                Importar outra planilha
              </button>
              <Link to="/admin/members" className="btn-primary" style={{ textDecoration: 'none' }}>
                Ver membros
              </Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default ImportPage;
