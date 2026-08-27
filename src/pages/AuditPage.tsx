import React, { useEffect, useState } from 'react';
import TitleIcon from '../components/TitleIcon';
import api, { getErrorMessage } from '../services/api';
import {
  actionLabel,
  entityLabel,
  roleLabel,
  compactJson,
  prettyJson,
  formatDateTime,
} from '../utils/auditLabels';
import './modules/ModulePages.css';
import './AuditPage.css';

interface AuditItem {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
}

interface AuditResponse {
  total: number;
  page: number;
  pageSize: number;
  items: AuditItem[];
}

interface Filters {
  entity: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { entity: '', action: '', from: '', to: '' };
const PAGE_SIZES = [10, 20, 50, 100];

// Datas do filtro cobrem o dia inteiro (00:00 → 23:59:59 no fuso local)
function dayStartIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

function dayEndIso(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

function summaryOf(item: AuditItem): string {
  return compactJson(item.metadata) || compactJson(item.after) || compactJson(item.before);
}

function hasDetail(item: AuditItem): boolean {
  return item.before != null || item.after != null || item.metadata != null;
}

/**
 * Auditoria escopada (Governança de acesso — Dízimo D4.7).
 * Coordenação de comunidade ou superior enxerga os registros do seu escopo.
 */
const AuditPage: React.FC = () => {
  const [form, setForm] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params: Record<string, string | number> = { page, pageSize };
        if (applied.entity.trim()) params.entity = applied.entity.trim();
        if (applied.action.trim()) params.action = applied.action.trim();
        if (applied.from) params.from = dayStartIso(applied.from);
        if (applied.to) params.to = dayEndIso(applied.to);
        const response = await api.get<AuditResponse>('/audit/scope', { params });
        if (!cancelled) {
          setData(response.data);
          setExpandedId(null);
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, 'Erro ao carregar a auditoria'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [applied, page, pageSize]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = data?.items ?? [];
  const filtersActive = Boolean(applied.entity || applied.action || applied.from || applied.to);

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.from && form.to && form.from > form.to) {
      setError('A data inicial não pode ser posterior à data final.');
      return;
    }
    setPage(1);
    setApplied({ ...form });
  };

  const handleClear = () => {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const goTo = (target: number) => setPage(Math.min(Math.max(1, target), totalPages));

  const updateForm = (field: keyof Filters, value: string) =>
    setForm((previous) => ({ ...previous, [field]: value }));

  return (
    <div className="module-page audit-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="documento" /> Auditoria
        </h1>
      </div>

      <p className="audit-intro">
        Registro de quem fez o quê no seu escopo (comunidade, paróquia ou diocese, conforme o
        seu papel). Clique em uma linha para ver os dados antes/depois.
      </p>

      <form className="filters audit-filters" onSubmit={handleFilter}>
        <input
          type="text"
          className="filter-input"
          placeholder="Entidade (ex.: FinanceEntry, User)"
          value={form.entity}
          onChange={(e) => updateForm('entity', e.target.value)}
          aria-label="Entidade"
        />
        <input
          type="text"
          className="filter-input"
          placeholder="Ação (ex.: CREATE, UPDATE, LOGIN)"
          value={form.action}
          onChange={(e) => updateForm('action', e.target.value)}
          aria-label="Ação"
        />
        <label className="audit-date-field">
          De
          <input
            type="date"
            className="filter-input"
            value={form.from}
            max={form.to || undefined}
            onChange={(e) => updateForm('from', e.target.value)}
          />
        </label>
        <label className="audit-date-field">
          Até
          <input
            type="date"
            className="filter-input"
            value={form.to}
            min={form.from || undefined}
            onChange={(e) => updateForm('to', e.target.value)}
          />
        </label>
        <select
          className="filter-select audit-page-size"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          aria-label="Registros por página"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} por página
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary" disabled={loading}>
          Filtrar
        </button>
        {filtersActive && (
          <button type="button" className="btn-secondary" onClick={handleClear} disabled={loading}>
            Limpar
          </button>
        )}
      </form>

      {error && <div className="audit-error">{error}</div>}

      <div className="table-container">
        <table className="data-table audit-table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>Ação</th>
              <th>Entidade / ID</th>
              <th>Resumo</th>
              <th aria-label="Detalhes" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  Carregando registros…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  {filtersActive
                    ? 'Nenhum registro encontrado com esses filtros.'
                    : 'Nenhum registro de auditoria no seu escopo ainda.'}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const expanded = expandedId === item.id;
                const expandable = hasDetail(item);
                const summary = summaryOf(item);
                return (
                  <React.Fragment key={item.id}>
                    <tr
                      className={`audit-row ${expandable ? 'expandable' : ''} ${expanded ? 'expanded' : ''}`}
                      onClick={() => expandable && setExpandedId(expanded ? null : item.id)}
                    >
                      <td className="audit-when">
                        <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                      </td>
                      <td>
                        <div className="audit-actor">
                          <span>{item.actorEmail || 'Sistema'}</span>
                          {item.actorRole && (
                            <span className="status-badge blue">{roleLabel(item.actorRole)}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="audit-action" title={item.action}>
                          {actionLabel(item.action)}
                        </span>
                      </td>
                      <td>
                        <span title={item.entity ?? ''}>{entityLabel(item.entity)}</span>
                        {item.entityId && (
                          <code className="audit-id" title={item.entityId}>
                            {item.entityId}
                          </code>
                        )}
                      </td>
                      <td>
                        {summary ? (
                          <code className="audit-meta" title={summary}>
                            {summary}
                          </code>
                        ) : (
                          <span className="security-muted">—</span>
                        )}
                      </td>
                      <td className="audit-toggle">
                        {expandable && (
                          <button
                            type="button"
                            className="btn-small"
                            aria-expanded={expanded}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(expanded ? null : item.id);
                            }}
                          >
                            {expanded ? 'Fechar' : 'Detalhes'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="audit-detail-row">
                        <td colSpan={6}>
                          <div className="audit-detail-grid">
                            {item.before != null && (
                              <div>
                                <h4>Antes</h4>
                                <pre>{prettyJson(item.before)}</pre>
                              </div>
                            )}
                            {item.after != null && (
                              <div>
                                <h4>Depois</h4>
                                <pre>{prettyJson(item.after)}</pre>
                              </div>
                            )}
                            {item.metadata != null && (
                              <div>
                                <h4>Metadados</h4>
                                <pre>{prettyJson(item.metadata)}</pre>
                              </div>
                            )}
                          </div>
                          <p className="audit-detail-footer">
                            Registro <code>{item.id}</code>
                            {item.actorUserId && (
                              <>
                                {' '}· usuário <code>{item.actorUserId}</code>
                              </>
                            )}
                          </p>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="audit-pagination">
        <span className="security-muted">
          {total > 0
            ? `Página ${page} de ${totalPages} · ${total} registro${total === 1 ? '' : 's'}`
            : 'Nenhum registro'}
        </span>
        <div className="audit-pagination-buttons">
          <button type="button" className="btn-small" onClick={() => goTo(1)} disabled={loading || page <= 1}>
            «
          </button>
          <button type="button" className="btn-small" onClick={() => goTo(page - 1)} disabled={loading || page <= 1}>
            ‹ Anterior
          </button>
          <button type="button" className="btn-small" onClick={() => goTo(page + 1)} disabled={loading || page >= totalPages}>
            Próxima ›
          </button>
          <button type="button" className="btn-small" onClick={() => goTo(totalPages)} disabled={loading || page >= totalPages}>
            »
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuditPage;
