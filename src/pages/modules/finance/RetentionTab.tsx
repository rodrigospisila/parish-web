import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../services/api';
import { notify } from '../../../services/notification.service';
import { downloadBlob, formatBRL, friendlyError, plural } from './financeShared';

/**
 * Aba "Retenção" do Financeiro (Dízimo D4.4): em que estágio está cada dizimista
 * (novo, em dia, esfriando, afastado, inativo, nunca contribuiu), a tendência dos
 * últimos 12 meses e as ações pastorais sugeridas e registradas (agradecer,
 * mensagem, ligação, visita, anotação). É cuidado com o fiel, não cobrança — o dado
 * individual é restrito à coordenação (LGPD). A coordenação de comunidade só vê a
 * própria comunidade (o backend filtra); a administração vê a paróquia com filtro
 * por comunidade.
 */

export type RetentionStage = 'NEW' | 'ACTIVE' | 'COOLING' | 'LAPSED' | 'INACTIVE' | 'NEVER';
export type RetentionTrend = 'UP' | 'DOWN' | 'FLAT' | 'NEW';
export type RetentionActionType = 'THANKS' | 'MESSAGE' | 'CALL' | 'VISIT' | 'NOTE';

export interface SuggestedAction {
  type: RetentionActionType;
  label: string;
  hint: string;
}

export interface RetentionAction {
  id: string;
  type: RetentionActionType;
  note: string | null;
  at: string;
  by: string | null;
}

export interface RetentionRow {
  memberId: string;
  fullName: string;
  community: { id: string; name: string } | null;
  registrationNumber: string | null;
  phoneMasked: string | null;
  stage: RetentionStage;
  stageLabel: string;
  /** 'AAAA-MM' da última contribuição; null = nunca contribuiu */
  lastMonth: string | null;
  /** Meses desde a última contribuição; null = nunca contribuiu */
  monthsSince: number | null;
  monthsContributing: number;
  lastAmount: number | null;
  /** Média dos últimos 6 meses com contribuição */
  avgAmount: number | null;
  trend: RetentionTrend;
  suggestedAction: SuggestedAction;
  lastAction: Omit<RetentionAction, 'id'> | null;
}

export interface RetentionSummary {
  total: number;
  stages: Array<{ stage: RetentionStage; label: string; count: number; suggestedAction: SuggestedAction }>;
  /** Esfriando + afastados */
  needingAttention: number;
  /** 12 meses, do mais antigo ao atual (em andamento) */
  monthly: Array<{ month: string; total: number; contributors: number }>;
  trend: { last3: number; prev3: number; deltaPercent: number | null };
}

export interface RetentionCommunity {
  id: string;
  name: string;
  parishId?: string;
}

interface RetentionTabProps {
  communities: RetentionCommunity[];
  /** Paróquia escolhida no seletor (admins sem paróquia própria); trocar zera filtros, busca e modal */
  parishIdParam: string;
  /** false = admin diocesano/sistema ainda não escolheu a paróquia */
  parishReady: boolean;
  /** Admin diocesano/sistema: o backend devolve todas as paróquias do escopo — o seletor de paróquia só restringe a lista de comunidades */
  wideScope: boolean;
  userRole: string;
  userCommunityId?: string;
}

/** Filtro de estágio: '' = todos; 'ATTENTION' = esfriando + afastados (recorte só na tela) */
type StageFilter = '' | RetentionStage | 'ATTENTION';

/** Mesmo critério de PARISH_ADMIN+ do restante do Financeiro (canConfigureTithe) */
const PARISH_ADMIN_ROLES = ['PARISH_ADMIN', 'DIOCESAN_ADMIN', 'SYSTEM_ADMIN'];
const SEARCH_DEBOUNCE_MS = 300;
/** O backend corta a busca em 60 caracteres */
const SEARCH_MAX = 60;
/** O backend corta a observação em 500 caracteres */
const NOTE_MAX = 500;
/** A lista vem com no máximo 1000 dizimistas */
const LIST_CAP = 1000;
const CHART_BAR_MAX = 130;
const TZ = 'America/Sao_Paulo';

const ACTION_TYPES: RetentionActionType[] = ['THANKS', 'MESSAGE', 'CALL', 'VISIT', 'NOTE'];
const ACTION_LABELS: Record<RetentionActionType, string> = {
  THANKS: 'Agradecer',
  MESSAGE: 'Mensagem',
  CALL: 'Ligação',
  VISIT: 'Visita',
  NOTE: 'Anotação',
};
const actionLabel = (type: string): string => ACTION_LABELS[type as RetentionActionType] ?? type;
const isActionType = (type: string | undefined): type is RetentionActionType => !!type && (ACTION_TYPES as string[]).includes(type);

/** Cor por estágio: em dia/novo verdes, esfriando âmbar, afastado laranja, inativo/nunca cinza */
interface StageStyle {
  /** Classe de .status-badge já existente ('' = só o estilo inline) */
  badge: string;
  badgeStyle?: React.CSSProperties;
  accent: string;
  soft: string;
}
const STAGE_STYLE: Record<RetentionStage, StageStyle> = {
  NEW: { badge: 'green', accent: '#198754', soft: '#d1e7dd' },
  ACTIVE: { badge: 'green', accent: '#198754', soft: '#d1e7dd' },
  COOLING: { badge: 'yellow', accent: '#d97706', soft: '#fef3c7' },
  LAPSED: { badge: '', badgeStyle: { background: '#ffedd5', color: '#9a3412' }, accent: '#ea580c', soft: '#ffedd5' },
  INACTIVE: { badge: 'gray', accent: '#6c757d', soft: '#e2e3e5' },
  NEVER: { badge: 'gray', accent: '#6c757d', soft: '#e2e3e5' },
};
const styleOf = (stage: string): StageStyle => STAGE_STYLE[stage as RetentionStage] ?? STAGE_STYLE.INACTIVE;
const ALL_STYLE: StageStyle = { badge: 'blue', accent: '#0d6efd', soft: '#cfe2ff' };
const ATTENTION_STYLE: StageStyle = { badge: 'yellow', accent: '#d97706', soft: '#fef3c7' };
const ATTENTION_STAGES: RetentionStage[] = ['COOLING', 'LAPSED'];
/** Linhas que pedem um gesto da pastoral ganham um fundo suave */
const ROW_BACKGROUND: Partial<Record<RetentionStage, string>> = { COOLING: '#fffdf5', LAPSED: '#fff8f1' };

const TREND_STYLE: Record<RetentionTrend, { icon: string; label: string; title: string; color: string }> = {
  UP: { icon: '↑', label: 'subindo', title: 'Crescendo: os 3 últimos meses superam os 3 anteriores', color: '#0f5132' },
  DOWN: { icon: '↓', label: 'caindo', title: 'Diminuindo: os 3 últimos meses ficaram abaixo dos 3 anteriores', color: '#b45309' },
  FLAT: { icon: '→', label: 'estável', title: 'Estável em relação aos 3 meses anteriores', color: '#6c757d' },
  NEW: { icon: '✦', label: 'novo', title: 'Histórico curto: ainda não há base para comparar', color: '#084298' },
};
const trendOf = (trend: string) => TREND_STYLE[trend as RetentionTrend] ?? TREND_STYLE.NEW;

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthParts = (month: string): [number, number] | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]);
  return index >= 1 && index <= 12 ? [year, index] : null;
};
/** 'AAAA-MM' → 'ago/26' */
const monthShort = (month: string | null | undefined): string => {
  if (!month) return '—';
  const parts = monthParts(month);
  return parts ? `${MONTHS_SHORT[parts[1] - 1]}/${String(parts[0]).slice(2)}` : month;
};
/** 'AAAA-MM' → 'agosto/2026' */
const monthLong = (month: string): string => {
  const parts = monthParts(month);
  if (!parts) return month;
  const name = new Date(Date.UTC(parts[0], parts[1] - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  return `${name}/${parts[0]}`;
};
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });
};
const money = (value: number | null | undefined): string => (value == null ? '—' : formatBRL(value));
/** 'R$ 1,2 mil' para caber embaixo de cada barra do gráfico */
const compactBRL = (value: number): string =>
  `R$ ${new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
const formatPercent = (value: number): string => `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const monthsText = (count: number): string => `${count} ${plural(count, 'mês', 'meses')}`;

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: '#555' };
const hintStyle: React.CSSProperties = { fontSize: '0.85rem', color: '#666', margin: '0 0 0.8rem' };
const errorStyle: React.CSSProperties = { color: '#b91c1c', fontSize: '0.85rem', margin: '0 0 0.8rem' };
const sectionTitleStyle: React.CSSProperties = { margin: '0 0 0.6rem', color: '#555', textTransform: 'uppercase', fontSize: '0.9rem', letterSpacing: '0.03em' };
const panelStyle: React.CSSProperties = { background: 'white', borderRadius: 12, boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)', padding: '1.25rem', marginBottom: '1.5rem' };
const cardButtonStyle: React.CSSProperties = { border: 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%' };
const cardSubStyle: React.CSSProperties = { fontSize: '0.8rem', color: '#555', marginTop: '0.4rem', lineHeight: 1.3 };
const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.65rem 0.75rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: '0.95rem',
};

interface StageCardProps {
  label: string;
  count: number;
  style: StageStyle;
  active: boolean;
  title?: string;
  sub?: React.ReactNode;
  onClick: () => void;
}

/** Card clicável (filtra a lista); a ação sugerida vai no subtítulo e o "porquê" no title */
const StageCard: React.FC<StageCardProps> = ({ label, count, style, active, title, sub, onClick }) => (
  <button
    type="button"
    className="summary-card"
    aria-pressed={active}
    title={title}
    onClick={onClick}
    style={{
      ...cardButtonStyle,
      borderLeft: `4px solid ${style.accent}`,
      background: active ? style.soft : 'white',
      boxShadow: active ? `0 0 0 2px ${style.accent}, 0 2px 8px rgba(0, 0, 0, 0.1)` : undefined,
    }}
  >
    <div className="label">{label}</div>
    <div className="value" style={{ color: style.accent }}>{count}</div>
    {sub ? <div style={cardSubStyle}>{sub}</div> : null}
  </button>
);

const StageBadge: React.FC<{ stage: string; label: string }> = ({ stage, label }) => {
  const style = styleOf(stage);
  return (
    <span className={`status-badge ${style.badge}`.trim()} style={style.badgeStyle}>
      {label}
    </span>
  );
};

const RetentionTab: React.FC<RetentionTabProps> = ({ communities, parishIdParam, parishReady, wideScope, userRole, userCommunityId }) => {
  const isParishAdmin = PARISH_ADMIN_ROLES.includes(userRole);

  const [communityId, setCommunityId] = useState('');
  const [stageFilter, setStageFilter] = useState<StageFilter>('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [summary, setSummary] = useState<RetentionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [rows, setRows] = useState<RetentionRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);

  // Modal "Registrar ação": tipo + observação e o histórico do dizimista
  const [actionTarget, setActionTarget] = useState<RetentionRow | null>(null);
  const [actionForm, setActionForm] = useState<{ type: RetentionActionType; note: string }>({ type: 'NOTE', note: '' });
  const [history, setHistory] = useState<RetentionAction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState(false);

  // Contadores de requisição: a resposta atrasada de outro filtro/paróquia não sobrescreve a atual
  const summaryRequestRef = useRef(0);
  const rowsRequestRef = useRef(0);
  const historyRequestRef = useRef(0);

  // Busca por nome com debounce
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // "Precisam de atenção" é recorte só na tela; o backend filtra um estágio por vez
  const stageParam = stageFilter && stageFilter !== 'ATTENTION' ? stageFilter : undefined;

  const fetchSummary = useCallback(async () => {
    const requestId = ++summaryRequestRef.current;
    if (!parishReady) {
      setSummary(null);
      setSummaryError(null);
      setSummaryLoading(false);
      return;
    }
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await api.get('/tithe/retention/summary', { params: { communityId: communityId || undefined } });
      if (requestId !== summaryRequestRef.current) return;
      setSummary(res.data && Array.isArray(res.data.stages) ? res.data : null);
    } catch (error) {
      if (requestId !== summaryRequestRef.current) return;
      setSummary(null);
      setSummaryError(friendlyError(error, 'Não foi possível carregar a visão geral'));
    } finally {
      if (requestId === summaryRequestRef.current) setSummaryLoading(false);
    }
  }, [communityId, parishReady]);

  const fetchRows = useCallback(async () => {
    const requestId = ++rowsRequestRef.current;
    if (!parishReady) {
      setRows([]);
      setRowsError(null);
      setRowsLoading(false);
      return;
    }
    setRowsLoading(true);
    setRowsError(null);
    try {
      const res = await api.get('/tithe/retention', {
        params: { communityId: communityId || undefined, stage: stageParam, q: debouncedQuery || undefined },
      });
      if (requestId !== rowsRequestRef.current) return;
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      if (requestId !== rowsRequestRef.current) return;
      setRows([]);
      setRowsError(friendlyError(error, 'Não foi possível carregar os dizimistas'));
    } finally {
      if (requestId === rowsRequestRef.current) setRowsLoading(false);
    }
  }, [communityId, stageParam, debouncedQuery, parishReady]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // Trocar de paróquia zera filtros, busca e o modal da anterior
  useEffect(() => {
    historyRequestRef.current += 1;
    setCommunityId('');
    setStageFilter('');
    setQuery('');
    setDebouncedQuery('');
    setActionTarget(null);
  }, [parishIdParam]);

  const closeAction = useCallback(() => {
    historyRequestRef.current += 1;
    setActionTarget(null);
    setHistory([]);
    setHistoryError(null);
    setHistoryLoading(false);
  }, []);

  // Escape fecha o modal (não durante o salvamento)
  useEffect(() => {
    if (!actionTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingAction) closeAction();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionTarget, savingAction, closeAction]);

  const loadHistory = async (memberId: string) => {
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await api.get(`/tithe/retention/${memberId}/actions`);
      if (requestId !== historyRequestRef.current) return;
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      if (requestId !== historyRequestRef.current) return;
      setHistoryError(friendlyError(error, 'Não foi possível carregar o histórico'));
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  };

  const openAction = (row: RetentionRow) => {
    setActionTarget(row);
    setActionForm({ type: isActionType(row.suggestedAction?.type) ? row.suggestedAction.type : 'NOTE', note: '' });
    setHistory([]);
    void loadHistory(row.memberId);
  };

  const submitAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionTarget || savingAction) return;
    const note = actionForm.note.trim();
    setSavingAction(true);
    try {
      const res = await api.post(`/tithe/retention/${actionTarget.memberId}/actions`, { type: actionForm.type, note: note || undefined });
      const saved: RetentionAction =
        res.data && res.data.id
          ? res.data
          : { id: `local-${Date.now()}`, type: actionForm.type, note: note || null, at: new Date().toISOString(), by: null };
      // Atualiza a linha na hora, sem recarregar a lista inteira
      setRows((current) =>
        current.map((row) =>
          row.memberId === actionTarget.memberId ? { ...row, lastAction: { type: saved.type, note: saved.note, at: saved.at, by: saved.by } } : row,
        ),
      );
      notify.success(`${actionLabel(saved.type)} registrada para ${actionTarget.fullName}`);
      closeAction();
    } catch (error) {
      notify.error(friendlyError(error, 'Não foi possível registrar a ação'));
    } finally {
      setSavingAction(false);
    }
  };

  const toggleStage = (value: StageFilter) => setStageFilter((current) => (current === value ? '' : value));

  const clearFilters = () => {
    setStageFilter('');
    setQuery('');
    setDebouncedQuery('');
    if (isParishAdmin) setCommunityId('');
  };

  const exportCsv = () => {
    const params: Record<string, string> = {};
    if (communityId) params.communityId = communityId;
    if (stageParam) params.stage = stageParam;
    const suffix = stageParam ? `-${stageParam.toLowerCase()}` : '';
    void downloadBlob('/tithe/retention/export.csv', `retencao-dizimistas${suffix}.csv`, params);
  };

  const refresh = () => {
    void fetchSummary();
    void fetchRows();
  };

  const visibleRows = useMemo(
    () => (stageFilter === 'ATTENTION' ? rows.filter((row) => ATTENTION_STAGES.includes(row.stage)) : rows),
    [rows, stageFilter],
  );

  const showCommunitySelect = isParishAdmin || communities.length > 1;
  const ownCommunity = communities.find((community) => community.id === userCommunityId) ?? (communities.length === 1 ? communities[0] : undefined);
  const communityName = communityId ? communities.find((community) => community.id === communityId)?.name ?? 'comunidade' : null;
  const stageName =
    stageFilter === 'ATTENTION'
      ? 'Precisam de atenção'
      : stageFilter
        ? summary?.stages.find((item) => item.stage === stageFilter)?.label ?? stageFilter
        : null;
  const filterParts = [stageName, communityName, debouncedQuery ? `“${debouncedQuery}”` : null].filter(Boolean) as string[];
  const hasFilters = filterParts.length > 0;

  const monthly = summary?.monthly ?? [];
  const maxTotal = monthly.reduce((max, item) => Math.max(max, item.total), 0);
  const currentMonthKey = monthly.length > 0 ? monthly[monthly.length - 1].month : '';
  const trend = summary?.trend;
  const deltaColor = trend?.deltaPercent == null ? '#6c757d' : trend.deltaPercent > 0 ? '#0f5132' : trend.deltaPercent < 0 ? '#b45309' : '#6c757d';
  const csvTitle =
    stageFilter === 'ATTENTION'
      ? 'O recorte "Precisam de atenção" vale só na tela: o CSV sai com todos os estágios da comunidade filtrada'
      : 'Exporta a lista com os filtros de comunidade e estágio (a busca por nome não se aplica ao arquivo)';

  return (
    <>
      <p style={hintStyle}>
        Cada dizimista aparece no estágio em que está — novo, em dia, esfriando, afastado, inativo ou que nunca contribuiu — com
        um gesto sugerido para a pastoral do dízimo. A ideia é cuidar do fiel, nunca cobrar: um obrigado, uma mensagem gentil,
        uma ligação, uma visita. Registre aqui o que foi feito para toda a equipe ver o histórico.
        {!isParishAdmin && ' A coordenação vê os dizimistas da própria comunidade.'}
      </p>

      {!parishReady ? (
        <div className="empty-state">Escolha a paróquia acima para ver os dizimistas.</div>
      ) : (
        <>
          {wideScope && (
            <p style={{ ...hintStyle, color: '#b45309' }}>
              Os números abrangem todas as paróquias do seu escopo; o seletor de paróquia acima só restringe a lista de comunidades —
              escolha uma comunidade para ver só ela.
            </p>
          )}

          <div className="filters" style={{ alignItems: 'flex-end', marginBottom: '1rem' }}>
            {showCommunitySelect ? (
              <label style={fieldStyle}>
                Comunidade
                <select className="filter-select" value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
                  <option value="">{isParishAdmin ? 'Todas as comunidades' : 'Todas as suas comunidades'}</option>
                  {communities.map((community) => (
                    <option key={community.id} value={community.id}>{community.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div style={fieldStyle}>
                Comunidade
                <div style={{ padding: '0.65rem 0', fontWeight: 600, color: '#333' }}>{ownCommunity?.name ?? 'Sua comunidade'}</div>
              </div>
            )}
            <label style={fieldStyle}>
              Buscar por nome
              <input
                type="search"
                className="search-input"
                maxLength={SEARCH_MAX}
                autoComplete="off"
                placeholder="Nome do dizimista"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          {summaryError && (
            <p style={errorStyle}>
              {summaryError}{' '}
              <button type="button" className="btn-small" onClick={() => void fetchSummary()}>Tentar de novo</button>
            </p>
          )}
          {summaryLoading && !summary && <div className="loading">Carregando a visão geral...</div>}

          {summary && (
            <>
              <div className="summary-cards" style={{ opacity: summaryLoading ? 0.6 : 1 }}>
                <StageCard
                  label="Dizimistas"
                  count={summary.total}
                  style={ALL_STYLE}
                  active={stageFilter === ''}
                  title="Todos os estágios"
                  sub={communityName ?? (isParishAdmin ? 'Toda a paróquia' : 'Sua comunidade')}
                  onClick={() => setStageFilter('')}
                />
                <StageCard
                  label="Precisam de atenção"
                  count={summary.needingAttention}
                  style={ATTENTION_STYLE}
                  active={stageFilter === 'ATTENTION'}
                  title="Esfriando e afastados: um gesto agora evita o afastamento"
                  sub="Esfriando + afastados"
                  onClick={() => toggleStage('ATTENTION')}
                />
                {summary.stages.map((item) => (
                  <StageCard
                    key={item.stage}
                    label={item.label}
                    count={item.count}
                    style={styleOf(item.stage)}
                    active={stageFilter === item.stage}
                    title={item.suggestedAction?.hint}
                    sub={item.suggestedAction ? <>💡 {item.suggestedAction.label}</> : null}
                    onClick={() => toggleStage(item.stage)}
                  />
                ))}
              </div>
              <p style={{ ...hintStyle, fontSize: '0.78rem', color: '#888' }}>
                Novo = começou há até 3 meses · Em dia = contribuiu neste mês ou no anterior · Esfriando = 2 a 3 meses sem contribuir ·
                Afastado = 4 a 12 meses · Inativo = mais de um ano · Nunca contribuiu = cadastrado sem contribuição. Clique num card
                para filtrar a lista.
              </p>

              <div style={panelStyle}>
                <h4 style={sectionTitleStyle}>Últimos 12 meses</h4>
                {trend && (
                  <p style={{ ...hintStyle, color: '#444' }}>
                    Últimos 3 meses <strong>{formatBRL(trend.last3)}</strong> vs anteriores <strong>{formatBRL(trend.prev3)}</strong>{' '}
                    <span style={{ color: deltaColor, fontWeight: 600 }}>
                      ({trend.deltaPercent == null ? 'sem base de comparação' : formatPercent(trend.deltaPercent)})
                    </span>
                  </p>
                )}
                {monthly.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#888', margin: 0 }}>Ainda não há contribuições nos últimos 12 meses.</p>
                ) : (
                  <>
                    <div
                      role="img"
                      aria-label={`Total do dízimo por mês nos últimos 12 meses: ${monthly.map((item) => `${monthShort(item.month)} ${formatBRL(item.total)} (${item.contributors})`).join(', ')}`}
                      style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: CHART_BAR_MAX + 60, overflowX: 'auto' }}
                    >
                      {monthly.map((item) => {
                        const isCurrent = item.month === currentMonthKey;
                        const barHeight = maxTotal > 0 && item.total > 0 ? Math.max(3, Math.round((item.total / maxTotal) * CHART_BAR_MAX)) : 2;
                        return (
                          <div
                            key={item.month}
                            title={`${capitalize(monthLong(item.month))} · ${formatBRL(item.total)} · ${item.contributors} ${plural(item.contributors, 'contribuinte', 'contribuintes')}${isCurrent ? ' · mês em andamento' : ''}`}
                            style={{ flex: '1 0 44px', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}
                          >
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#444', marginBottom: 2 }}>{item.contributors}</div>
                            <div
                              aria-hidden="true"
                              style={{
                                width: '68%',
                                height: barHeight,
                                background: item.total > 0 ? (isCurrent ? '#93c5fd' : '#0d6efd') : '#dee2e6',
                                borderRadius: '4px 4px 0 0',
                              }}
                            />
                            <div style={{ fontSize: '0.7rem', color: isCurrent ? '#333' : '#777', fontWeight: isCurrent ? 600 : 400, marginTop: 4, whiteSpace: 'nowrap' }}>
                              {monthShort(item.month)}
                            </div>
                            <div style={{ fontSize: '0.66rem', color: '#999', whiteSpace: 'nowrap' }}>{item.total > 0 ? compactBRL(item.total) : '—'}</div>
                          </div>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#888', margin: '0.5rem 0 0' }}>
                      Altura da barra = total do mês (R$); número acima = contribuintes distintos. O mês atual ainda está em andamento.
                    </p>
                  </>
                )}
              </div>
            </>
          )}

          <div className="filters" style={{ alignItems: 'center', marginBottom: '0.6rem' }}>
            <strong>
              {visibleRows.length} {plural(visibleRows.length, 'dizimista', 'dizimistas')}
              {rowsLoading && rows.length > 0 ? ' · atualizando...' : ''}
            </strong>
            {hasFilters && <span style={{ color: '#666', fontSize: '0.85rem' }}>{filterParts.join(' · ')}</span>}
            {hasFilters && (
              <button type="button" className="btn-small" onClick={clearFilters}>Limpar filtros</button>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn-small" disabled={rowsLoading || summaryLoading} onClick={refresh}>↻ Atualizar</button>
            <button type="button" className="btn-small" title={csvTitle} onClick={exportCsv}>⬇ CSV</button>
          </div>

          {rowsError && (
            <p style={errorStyle}>
              {rowsError}{' '}
              <button type="button" className="btn-small" onClick={() => void fetchRows()}>Tentar de novo</button>
            </p>
          )}
          {rowsLoading && rows.length === 0 && !rowsError && <div className="loading">Carregando os dizimistas...</div>}
          {!rowsLoading && !rowsError && visibleRows.length === 0 && (
            <div className="empty-state">
              {hasFilters ? 'Nenhum dizimista com esses filtros.' : 'Nenhum dizimista cadastrado neste escopo.'}
            </div>
          )}
          {rows.length >= LIST_CAP && (
            <p style={{ ...hintStyle, color: '#b45309' }}>
              A lista mostra os primeiros {LIST_CAP} dizimistas — use o filtro de comunidade, um estágio ou a busca por nome para ver os demais.
            </p>
          )}

          {visibleRows.length > 0 && (
            <div className="table-container" style={{ opacity: rowsLoading ? 0.6 : 1 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dizimista</th>
                    <th>Comunidade</th>
                    <th>Estágio</th>
                    <th>Último mês</th>
                    <th title="Meses desde a última contribuição">Sem contribuir</th>
                    <th title="Meses com contribuição no histórico">Contribuindo</th>
                    <th>Último valor</th>
                    <th title="Média dos últimos 6 meses com contribuição">Média 6m</th>
                    <th title="3 últimos meses de referência comparados aos 3 anteriores">Tendência</th>
                    <th>Ação sugerida</th>
                    <th>Última ação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const trendStyle = trendOf(row.trend);
                    return (
                      <tr key={row.memberId} style={ROW_BACKGROUND[row.stage] ? { background: ROW_BACKGROUND[row.stage] } : undefined}>
                        <td>
                          <strong>{row.fullName}</strong>
                          {row.registrationNumber && <div style={{ fontSize: '0.75rem', color: '#888' }}>nº {row.registrationNumber}</div>}
                        </td>
                        <td>{row.community?.name ?? '—'}</td>
                        <td><StageBadge stage={row.stage} label={row.stageLabel} /></td>
                        <td>{monthShort(row.lastMonth)}</td>
                        <td>{row.monthsSince == null ? '—' : monthsText(row.monthsSince)}</td>
                        <td>{monthsText(row.monthsContributing ?? 0)}</td>
                        <td>{money(row.lastAmount)}</td>
                        <td>{money(row.avgAmount)}</td>
                        <td>
                          <span title={trendStyle.title} style={{ color: trendStyle.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {trendStyle.icon} {trendStyle.label}
                          </span>
                        </td>
                        <td>
                          {row.suggestedAction ? (
                            <span title={row.suggestedAction.hint} style={{ cursor: 'help' }}>💡 {row.suggestedAction.label}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {row.lastAction ? (
                            <div title={row.lastAction.note ?? undefined}>
                              <div>{actionLabel(row.lastAction.type)}</div>
                              <div style={{ fontSize: '0.75rem', color: '#888', whiteSpace: 'nowrap' }}>
                                {formatDateTime(row.lastAction.at)}{row.lastAction.by ? ` · ${row.lastAction.by}` : ''}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: '#999' }}>—</span>
                          )}
                        </td>
                        <td className="actions-cell">
                          <button type="button" className="btn-small" onClick={() => openAction(row)}>Registrar ação</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {actionTarget && (
        <div className="module-modal-overlay" onClick={() => { if (!savingAction) closeAction(); }}>
          <div
            className="module-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="retention-action-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560 }}
          >
            <h2 id="retention-action-title">Registrar ação pastoral</h2>
            <p style={{ fontSize: '0.9rem', color: '#444', margin: '0 0 0.4rem' }}>
              <strong>{actionTarget.fullName}</strong>
              {actionTarget.registrationNumber ? ` · nº ${actionTarget.registrationNumber}` : ''}{' '}
              <StageBadge stage={actionTarget.stage} label={actionTarget.stageLabel} />
            </p>
            <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.6rem' }}>
              {actionTarget.community?.name ?? 'Sem comunidade'}
              {actionTarget.phoneMasked ? ` · ${actionTarget.phoneMasked}` : ''}
              {actionTarget.lastMonth ? ` · última contribuição em ${monthShort(actionTarget.lastMonth)}` : ' · nunca contribuiu'}
              {actionTarget.avgAmount != null ? ` · média ${formatBRL(actionTarget.avgAmount)}` : ''}
            </p>
            {actionTarget.suggestedAction && (
              <p style={{ fontSize: '0.85rem', color: '#555', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.6rem 0.8rem', margin: '0 0 1rem' }}>
                💡 <strong>{actionTarget.suggestedAction.label}</strong> — {actionTarget.suggestedAction.hint}
              </p>
            )}
            <form onSubmit={submitAction}>
              <div className="form-group">
                <label htmlFor="retention-action-type">O que foi feito *</label>
                <select
                  id="retention-action-type"
                  value={actionForm.type}
                  disabled={savingAction}
                  onChange={(e) => setActionForm({ ...actionForm, type: isActionType(e.target.value) ? e.target.value : 'NOTE' })}
                >
                  {ACTION_TYPES.map((type) => (
                    <option key={type} value={type}>{ACTION_LABELS[type]}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="retention-action-note">Observação (opcional)</label>
                <textarea
                  id="retention-action-note"
                  rows={3}
                  maxLength={NOTE_MAX}
                  disabled={savingAction}
                  value={actionForm.note}
                  onChange={(e) => setActionForm({ ...actionForm, note: e.target.value })}
                  placeholder="Ex.: Conversei por telefone; a família mudou de bairro e pediu oração pela mãe."
                  style={textareaStyle}
                />
                <small style={{ color: '#888' }}>{actionForm.note.length}/{NOTE_MAX} · fica visível para a equipe da pastoral do dízimo</small>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" disabled={savingAction} onClick={closeAction}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={savingAction}>{savingAction ? 'Salvando...' : 'Salvar ação'}</button>
              </div>
            </form>

            <div style={{ marginTop: '1.4rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
              <h4 style={sectionTitleStyle}>Histórico</h4>
              {historyLoading && <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>Carregando o histórico...</p>}
              {historyError && (
                <p style={{ ...errorStyle, margin: 0 }}>
                  {historyError}{' '}
                  <button type="button" className="btn-small" onClick={() => void loadHistory(actionTarget.memberId)}>Tentar de novo</button>
                </p>
              )}
              {!historyLoading && !historyError && history.length === 0 && (
                <p style={{ fontSize: '0.85rem', color: '#888', margin: 0 }}>Nenhuma ação registrada ainda para este dizimista.</p>
              )}
              {history.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 220, overflowY: 'auto' }}>
                  {history.map((action) => (
                    <li key={action.id} style={{ padding: '0.45rem 0', borderBottom: '1px solid #f0f0f0', fontSize: '0.85rem' }}>
                      <div>
                        <strong>{actionLabel(action.type)}</strong>{' '}
                        <span style={{ color: '#888' }}>· {formatDateTime(action.at)}{action.by ? ` · ${action.by}` : ''}</span>
                      </div>
                      {action.note && <div style={{ color: '#555', whiteSpace: 'pre-wrap' }}>{action.note}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RetentionTab;
