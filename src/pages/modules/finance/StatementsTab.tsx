import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../services/api';
import { notify } from '../../../services/notification.service';
import { downloadBlob, formatBRL, friendlyError, httpStatus, plural } from './financeShared';

/**
 * Aba "Balancete" do Financeiro (transparência — Dízimo D4.3): a tesouraria gera o
 * balancete mensal (uma foto dos lançamentos do mês) da paróquia inteira ou de uma
 * comunidade; o Conselho de Assuntos Econômicos Paroquiais aprova; a administração
 * publica e os fiéis passam a ver os totais no app. PDF para o mural e CSV com todos
 * os lançamentos do mês para a contabilidade.
 */

export type StatementStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED';

export interface StatementBucket {
  name: string;
  total: number;
  count: number;
}

export interface StatementSide {
  total: number;
  count: number;
  byCategory: StatementBucket[];
  byCostCenter: StatementBucket[];
}

export interface StatementSnapshot {
  referenceMonth: string;
  generatedAt: string;
  income: StatementSide;
  expense: StatementSide;
  balance: number;
  campaigns: Array<{ id: string; name: string; total: number }>;
  /** id null = lançamentos da paróquia sem comunidade */
  communities: Array<{ id: string | null; name: string; income: number; expense: number }>;
  /** Estornos de receita do mês — a receita acima já vem líquida deles; ausente em balancetes antigos */
  reversals?: { total: number; count: number };
}

export interface Statement {
  id: string;
  parishId: string;
  /** null = paróquia inteira */
  communityId: string | null;
  community: { id: string; name: string } | null;
  /** 'AAAA-MM' */
  referenceMonth: string;
  /** 'agosto/2026', pronto para exibir */
  monthLabel: string;
  status: StatementStatus;
  snapshot: StatementSnapshot;
  /** Mensagem do Conselho que acompanha o balancete (app e PDF) */
  notes: string | null;
  generatedAt: string;
  approvedAt: string | null;
  approvedByName: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface StatementCommunity {
  id: string;
  name: string;
  parishId?: string;
}

interface StatementsTabProps {
  communities: StatementCommunity[];
  /** Paróquia enviada ao backend (admins sem paróquia própria escolhem no seletor) */
  parishIdParam: string;
  /** false = admin diocesano/sistema ainda não escolheu a paróquia */
  parishReady: boolean;
  userRole: string;
  userCommunityId?: string;
}

/** Mesmo critério de PARISH_ADMIN+ do restante do Financeiro (canConfigureTithe) */
const PARISH_ADMIN_ROLES = ['PARISH_ADMIN', 'DIOCESAN_ADMIN', 'SYSTEM_ADMIN'];
const CAEP = 'Conselho de Assuntos Econômicos Paroquiais';
const MONTH_OPTIONS = 24;
const NOTES_MAX = 2000;
const EMPTY_SIDE: StatementSide = { total: 0, count: 0, byCategory: [], byCostCenter: [] };

const STATUS_BADGE: Record<StatementStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'gray' },
  APPROVED: { label: 'Aprovado', color: 'blue' },
  PUBLISHED: { label: 'Publicado', color: 'green' },
};
const badgeOf = (status: StatementStatus) => STATUS_BADGE[status] ?? { label: status, color: 'gray' };

const TZ = 'America/Sao_Paulo';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const currentMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ }).slice(0, 7);
const shiftMonth = (month: string, offset: number): string => {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + offset, 1)).toISOString().slice(0, 7);
};
/** 'AAAA-MM' → 'agosto/2026' (mesmo formato do monthLabel do backend) */
const monthLabelOf = (month: string): string => {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  const name = new Date(Date.UTC(year, index - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  return `${name}/${year}`;
};
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Mês atual (parcial) e os 23 anteriores, do mais recente para o mais antigo */
const buildMonthOptions = (): Array<{ value: string; label: string }> => {
  const now = currentMonth();
  return Array.from({ length: MONTH_OPTIONS }, (_, offset) => {
    const value = shiftMonth(now, -offset);
    return { value, label: `${capitalize(monthLabelOf(value))}${offset === 0 ? ' (mês em andamento)' : ''}` };
  });
};

/** Data-only recebe T12:00 para não voltar um dia no fuso; datetime ISO é mostrado no fuso de Brasília */
const formatDay = (value: string | null | undefined): string => {
  if (!value) return '—';
  const dateOnly = DATE_ONLY.test(value);
  const parsed = new Date(dateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('pt-BR', dateOnly ? undefined : { timeZone: TZ });
};
const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  if (DATE_ONLY.test(value)) return formatDay(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });
};

const scopeLabel = (statement: Statement): string => statement.community?.name ?? 'Paróquia inteira';
const monthOf = (statement: Statement): string => statement.monthLabel || monthLabelOf(statement.referenceMonth);
const slug = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const fileBase = (statement: Statement) =>
  `balancete-${statement.referenceMonth}-${statement.community ? slug(statement.community.name) : 'paroquia'}`;
const percentOf = (part: number, total: number): string => (total > 0 ? `${Math.round((part / total) * 100)}%` : '—');
const entriesCount = (statement: Statement) => (statement.snapshot?.income?.count ?? 0) + (statement.snapshot?.expense?.count ?? 0);
/** Estornos de receita do mês, só quando houve algum (a receita do balancete já vem líquida deles) */
const reversalsOf = (statement: Statement | null | undefined): { total: number; count: number } | null => {
  const reversals = statement?.snapshot?.reversals;
  return reversals && reversals.total > 0 ? reversals : null;
};
const reversalsLabel = (reversals: { total: number; count: number }): string =>
  `${formatBRL(reversals.total)} em ${reversals.count} ${plural(reversals.count, 'estorno', 'estornos')} (já descontados das receitas)`;

/** Erros do backend (400/403) chegam ao usuário; um 403 sem texto vira algo que a coordenação entende */
const statementError = (error: unknown, fallback: string): string => {
  const message = friendlyError(error, fallback);
  if (httpStatus(error) === 403 && (message === fallback || /forbidden/i.test(message))) {
    return 'Sem permissão: a coordenação de comunidade só gera o balancete da própria comunidade; o da paróquia inteira, a aprovação e a publicação ficam com a administração paroquial';
  }
  return message;
};

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: '#555' };
const hintStyle: React.CSSProperties = { fontSize: '0.85rem', color: '#666', margin: '0 0 0.8rem' };
const emptyStyle: React.CSSProperties = { fontSize: '0.85rem', color: '#888', margin: 0 };
const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.6rem 0.75rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: '0.9rem',
};

interface BucketTableProps {
  title: string;
  nameHeader: string;
  rows: StatementBucket[] | undefined;
  total: number;
  empty: string;
  /** Rótulo da linha sem nome (ex.: lançamentos sem centro de custo) */
  unnamed: string;
}

/** Tabela "por categoria" / "por centro de custo" com quantidade, total e participação */
const BucketTable: React.FC<BucketTableProps> = ({ title, nameHeader, rows, total, empty, unnamed }) => {
  const list = rows ?? [];
  return (
    <div className="detail-section">
      <h4>{title}</h4>
      {list.length === 0 ? (
        <p style={emptyStyle}>{empty}</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>{nameHeader}</th><th>Qtde</th><th>Total</th><th>% do total</th></tr></thead>
            <tbody>
              {list.map((row, index) => (
                <tr key={`${row.name || unnamed}-${index}`}>
                  <td>{row.name || <em style={{ color: '#666' }}>{unnamed}</em>}</td>
                  <td>{row.count}</td>
                  <td>{formatBRL(row.total)}</td>
                  <td>{percentOf(row.total, total)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Total</strong></td>
                <td><strong>{list.reduce((sum, row) => sum + (row.count ?? 0), 0)}</strong></td>
                <td><strong>{formatBRL(total)}</strong></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const StatementsTab: React.FC<StatementsTabProps> = ({ communities, parishIdParam, parishReady, userRole, userCommunityId }) => {
  const isParishAdmin = PARISH_ADMIN_ROLES.includes(userRole);
  // '' = paróquia inteira (só PARISH_ADMIN+); a coordenação começa na própria comunidade
  const defaultScope = isParishAdmin ? '' : userCommunityId ?? '';

  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState(defaultScope);
  const [month, setMonth] = useState(() => shiftMonth(currentMonth(), -1));
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Balancete aberto no painel + mensagem do Conselho em edição
  const [opened, setOpened] = useState<Statement | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Aprovação num modal: quem aprova (em nome do Conselho)
  const [approveTarget, setApproveTarget] = useState<Statement | null>(null);
  const [approvedByName, setApprovedByName] = useState(CAEP);
  const [approving, setApproving] = useState(false);

  // Resposta atrasada de outra paróquia não sobrescreve a atual (lista e painel)
  const requestRef = useRef(0);
  const openRequestRef = useRef(0);

  const monthOptions = useMemo(buildMonthOptions, []);

  // Coordenação de comunidade: pede os balancetes da comunidade escolhida (sem isso a lista vem vazia e "Gerar" duplica o balancete, zerando a aprovação)
  const listCommunityId = isParishAdmin ? undefined : scope || undefined;

  const fetchStatements = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!parishReady) {
      setStatements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get('/finance/statements', { params: { parishId: parishIdParam || undefined, communityId: listCommunityId } });
      if (requestId !== requestRef.current) return;
      setStatements(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      notify.error(friendlyError(error, 'Erro ao carregar os balancetes'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [parishIdParam, parishReady, listCommunityId]);

  useEffect(() => {
    void fetchStatements();
  }, [fetchStatements]);

  // Trocar de paróquia fecha painel e modal da anterior e volta o escopo ao padrão
  useEffect(() => {
    openRequestRef.current += 1;
    setOpened(null);
    setOpeningId(null);
    setApproveTarget(null);
    setScope(defaultScope);
  }, [parishIdParam, defaultScope]);

  // Coordenação sem comunidade no perfil: assume a primeira do escopo
  useEffect(() => {
    if (isParishAdmin || scope) return;
    const fallback = communities.find((community) => community.id === userCommunityId) ?? communities[0];
    if (fallback) setScope(fallback.id);
  }, [isParishAdmin, scope, communities, userCommunityId]);

  // Escape fecha o modal de aprovação
  useEffect(() => {
    if (!approveTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !approving) setApproveTarget(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [approveTarget, approving]);

  // Mês mais recente primeiro; dentro do mês, paróquia inteira antes das comunidades
  const sorted = useMemo(() => {
    const order = (statement: Statement) => (statement.communityId === null ? 0 : 1);
    return [...statements].sort(
      (a, b) => b.referenceMonth.localeCompare(a.referenceMonth) || order(a) - order(b) || scopeLabel(a).localeCompare(scopeLabel(b), 'pt-BR'),
    );
  }, [statements]);

  const scopeName = scope ? communities.find((community) => community.id === scope)?.name ?? 'a comunidade' : 'a paróquia inteira';
  const monthName = capitalize(monthLabelOf(month));
  const existing = statements.find((statement) => statement.referenceMonth === month && (statement.communityId ?? '') === scope);
  const notesDirty = opened !== null && notes !== (opened.notes ?? '');
  const canGenerate = parishReady && !generating && (isParishAdmin || !!scope) && existing?.status !== 'PUBLISHED';

  const replaceInList = (updated: Statement) => {
    setStatements((current) =>
      current.some((statement) => statement.id === updated.id)
        ? current.map((statement) => (statement.id === updated.id ? updated : statement))
        : [updated, ...current],
    );
    setOpened((current) => (current && current.id === updated.id ? updated : current));
  };

  const showInPanel = (statement: Statement, scroll: boolean) => {
    setOpened(statement);
    setNotes(statement.notes ?? '');
    if (scroll) window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const discardNotesOk = () => !notesDirty || window.confirm('Há uma mensagem do Conselho não salva. Descartar?');

  const openStatement = async (id: string, scroll = true) => {
    if (!discardNotesOk()) return;
    const requestId = ++openRequestRef.current;
    setOpeningId(id);
    try {
      const res = await api.get(`/finance/statements/${id}`);
      if (requestId !== openRequestRef.current) return;
      showInPanel(res.data, scroll);
    } catch (error) {
      if (requestId !== openRequestRef.current) return;
      notify.error(statementError(error, 'Erro ao abrir o balancete'));
    } finally {
      if (requestId === openRequestRef.current) setOpeningId(null);
    }
  };

  const closePanel = () => {
    if (!discardNotesOk()) return;
    openRequestRef.current += 1;
    setOpened(null);
    setOpeningId(null);
  };

  /** Recarrega o painel sem perguntar pela mensagem em edição (o texto não salvo é mantido) */
  const refreshOpened = async (id: string) => {
    const requestId = ++openRequestRef.current;
    try {
      const res = await api.get(`/finance/statements/${id}`);
      if (requestId !== openRequestRef.current) return;
      const fresh: Statement = res.data;
      setOpened(fresh);
      if (!notesDirty) setNotes(fresh.notes ?? '');
    } catch {
      // a lista já foi recarregada; o painel fica com a versão anterior até o próximo "Atualizar"
    }
  };

  const generate = async () => {
    if (!isParishAdmin && !scope) {
      notify.error('Escolha a comunidade do balancete');
      return;
    }
    if (existing?.status === 'PUBLISHED') {
      notify.warning('Este balancete já está publicado — despublique antes de regenerar');
      return;
    }
    if (
      existing &&
      !window.confirm(
        `Já existe um balancete de ${monthName} para ${scopeName}. Regenerar recalcula os totais com os lançamentos atuais e ZERA a aprovação (volta a rascunho). Continuar?`,
      )
    ) {
      return;
    }
    if (opened?.id === existing?.id && !discardNotesOk()) return;
    setGenerating(true);
    try {
      const res = await api.post('/finance/statements/generate', {
        referenceMonth: month,
        parishId: parishIdParam || undefined,
        communityId: scope || null,
      });
      const saved: Statement | undefined = res.data && res.data.id ? res.data : undefined;
      notify.success(
        existing ? `Balancete de ${monthName} regenerado — aprovação zerada, confira e aprove de novo` : `Balancete de ${monthName} gerado como rascunho`,
      );
      await fetchStatements();
      if (saved) {
        openRequestRef.current += 1;
        setOpeningId(null);
        showInPanel(saved, true);
      }
    } catch (error) {
      notify.error(statementError(error, 'Erro ao gerar o balancete'));
    } finally {
      setGenerating(false);
    }
  };

  const saveNotes = async () => {
    if (!opened) return;
    const text = notes.trim();
    setSavingNotes(true);
    try {
      const res = await api.patch(`/finance/statements/${opened.id}`, { notes: text || null });
      const saved: Statement = res.data && res.data.id ? res.data : { ...opened, notes: text || null };
      replaceInList(saved);
      setNotes(saved.notes ?? '');
      notify.success('Mensagem do Conselho salva');
    } catch (error) {
      notify.error(statementError(error, 'Erro ao salvar a mensagem'));
    } finally {
      setSavingNotes(false);
    }
  };

  const openApprove = (statement: Statement) => {
    setApprovedByName(CAEP);
    setApproveTarget(statement);
  };

  const closeApprove = () => {
    if (approving) return;
    setApproveTarget(null);
  };

  const submitApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveTarget) return;
    const name = approvedByName.trim();
    if (!name) {
      notify.error('Informe quem aprova o balancete');
      return;
    }
    const target = approveTarget;
    setApproving(true);
    try {
      // generatedAt = guarda de versão: se o balancete foi regenerado depois de aberto, o backend recusa (400)
      const res = await api.post(`/finance/statements/${target.id}/approve`, { approvedByName: name, generatedAt: target.generatedAt });
      replaceInList(res.data);
      notify.success(`Balancete de ${monthOf(target)} aprovado em nome de ${name}`);
      setApproveTarget(null);
    } catch (error) {
      notify.error(statementError(error, 'Erro ao aprovar o balancete'));
      if (httpStatus(error) === 400) {
        // Versão desatualizada (ou já aprovado por outra pessoa): fecha o modal e recarrega a lista e o painel
        setApproveTarget(null);
        await fetchStatements();
        if (opened?.id === target.id) await refreshOpened(target.id);
      }
    } finally {
      setApproving(false);
    }
  };

  const publish = async (statement: Statement) => {
    if (
      !window.confirm(
        `Publicar o balancete de ${monthOf(statement)} (${scopeLabel(statement)})? Os fiéis serão avisados e passam a ver os totais no app.`,
      )
    ) {
      return;
    }
    setBusyId(statement.id);
    try {
      const res = await api.post(`/finance/statements/${statement.id}/publish`, {});
      replaceInList(res.data);
      notify.success('Balancete publicado — os fiéis foram avisados');
    } catch (error) {
      notify.error(statementError(error, 'Erro ao publicar o balancete'));
    } finally {
      setBusyId(null);
    }
  };

  const unpublish = async (statement: Statement) => {
    if (
      !window.confirm(
        `Despublicar o balancete de ${monthOf(statement)} (${scopeLabel(statement)})? Ele sai do app dos fiéis e volta para "Aprovado".`,
      )
    ) {
      return;
    }
    setBusyId(statement.id);
    try {
      const res = await api.post(`/finance/statements/${statement.id}/unpublish`, {});
      replaceInList(res.data);
      notify.success('Balancete despublicado — volta para aprovado (os fiéis não veem mais)');
    } catch (error) {
      notify.error(statementError(error, 'Erro ao despublicar o balancete'));
    } finally {
      setBusyId(null);
    }
  };

  /** Aprovar / Publicar / Despublicar (só PARISH_ADMIN+), usados na lista e no painel */
  const renderAdminActions = (statement: Statement) => {
    if (!isParishAdmin) return null;
    const busy = busyId !== null;
    return (
      <>
        {statement.status === 'DRAFT' && (
          <button
            type="button"
            className="btn-small success"
            disabled={busy}
            title="Registra a aprovação em nome do Conselho de Assuntos Econômicos Paroquiais"
            onClick={() => openApprove(statement)}
          >
            Aprovar
          </button>
        )}
        {statement.status === 'APPROVED' && (
          <button type="button" className="btn-small success" disabled={busy} title="Os fiéis são avisados e veem os totais no app" onClick={() => void publish(statement)}>
            {busyId === statement.id ? 'Publicando...' : 'Publicar'}
          </button>
        )}
        {statement.status === 'PUBLISHED' && (
          <button type="button" className="btn-small" disabled={busy} title="Sai do app dos fiéis e volta para aprovado" onClick={() => void unpublish(statement)}>
            {busyId === statement.id ? 'Despublicando...' : 'Despublicar'}
          </button>
        )}
      </>
    );
  };

  const renderDownloads = (statement: Statement) => (
    <>
      <button type="button" className="btn-small" title="Balancete em PDF para o mural e o site" onClick={() => void downloadBlob(`/finance/statements/${statement.id}/pdf`, `${fileBase(statement)}.pdf`)}>
        🖨 PDF
      </button>
      {(isParishAdmin || statement.communityId !== null) && (
        <button
          type="button"
          className="btn-small"
          title="Exportação contábil com todos os lançamentos do mês"
          onClick={() => void downloadBlob(`/finance/statements/${statement.id}/export.csv`, `${fileBase(statement)}.csv`)}
        >
          ⬇ CSV
        </button>
      )}
    </>
  );

  const timelineOf = (statement: Statement) => {
    const approved = statement.status !== 'DRAFT';
    const published = statement.status === 'PUBLISHED';
    return [
      { done: true, label: 'Gerado', detail: `em ${formatDateTime(statement.generatedAt || statement.snapshot?.generatedAt)}` },
      {
        done: approved,
        label: 'Aprovado',
        detail: approved ? `por ${statement.approvedByName || CAEP} em ${formatDateTime(statement.approvedAt)}` : 'aguardando a aprovação do Conselho',
      },
      {
        done: published,
        label: 'Publicado',
        detail: published ? `em ${formatDateTime(statement.publishedAt)} — visível aos fiéis no app` : approved ? 'pronto para publicar' : 'depois da aprovação',
      },
    ];
  };

  const snapshot = opened?.snapshot;
  const income = snapshot?.income ?? EMPTY_SIDE;
  const expense = snapshot?.expense ?? EMPTY_SIDE;
  const balance = snapshot?.balance ?? income.total - expense.total;
  const campaigns = snapshot?.campaigns ?? [];
  const byCommunity = snapshot?.communities ?? [];
  const openedBadge = opened ? badgeOf(opened.status) : null;
  const openedReversals = reversalsOf(opened);
  const approveReversals = reversalsOf(approveTarget);
  const notesLocked = opened?.status === 'PUBLISHED';

  return (
    <>
      <p style={hintStyle}>
        O balancete é uma foto dos lançamentos do mês (receitas, despesas, centros de custo e campanhas). Fluxo: gerar →
        aprovação do Conselho de Assuntos Econômicos Paroquiais → publicar, e os fiéis veem os totais no app.
        {!isParishAdmin && ' A coordenação gera o balancete da própria comunidade; a aprovação e a publicação ficam com a administração paroquial.'}
      </p>

      {!parishReady ? (
        <div className="empty-state">Escolha a paróquia acima para ver os balancetes.</div>
      ) : (
        <>
          <div className="filters" style={{ alignItems: 'flex-end', marginBottom: '0.6rem' }}>
            <label style={fieldStyle}>
              Escopo
              <select className="filter-select" value={scope} onChange={(e) => setScope(e.target.value)}>
                {isParishAdmin ? <option value="">Paróquia inteira</option> : !scope ? <option value="">Escolha a comunidade...</option> : null}
                {communities.map((community) => (
                  <option key={community.id} value={community.id}>{community.name}</option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              Mês de referência
              <select className="filter-select" value={month} onChange={(e) => setMonth(e.target.value)}>
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={!canGenerate}
              title={existing?.status === 'PUBLISHED' ? 'Balancete publicado: despublique antes de regenerar' : existing ? 'Recalcula com os lançamentos atuais e zera a aprovação' : undefined}
              onClick={() => void generate()}
            >
              {generating ? 'Gerando...' : existing ? '↻ Regenerar balancete' : 'Gerar balancete'}
            </button>
            <button type="button" className="btn-small" disabled={loading} onClick={() => void fetchStatements()} style={{ alignSelf: 'center' }}>
              {loading ? 'Atualizando...' : '↻ Atualizar lista'}
            </button>
          </div>

          {existing ? (
            <p style={hintStyle}>
              Já existe um balancete de {monthName} para {scopeName}:{' '}
              <span className={`status-badge ${badgeOf(existing.status).color}`}>{badgeOf(existing.status).label}</span>{' '}
              {existing.status === 'PUBLISHED'
                ? '— despublique antes de regenerar.'
                : '— regenerar recalcula os totais com os lançamentos atuais e zera a aprovação.'}{' '}
              <button type="button" className="btn-small" disabled={openingId !== null} onClick={() => void openStatement(existing.id)}>
                {openingId === existing.id ? 'Abrindo...' : 'Abrir'}
              </button>
            </p>
          ) : !loading ? (
            <p style={hintStyle}>Ainda não há balancete de {monthName} para {scopeName}.</p>
          ) : null}

          {loading && statements.length === 0 && <div className="loading">Carregando balancetes...</div>}
          {!loading && statements.length === 0 && (
            <div className="empty-state">Nenhum balancete ainda. Escolha o escopo e o mês acima e clique em "Gerar balancete".</div>
          )}
          {statements.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th>Escopo</th>
                    <th>Situação</th>
                    <th>Receitas</th>
                    <th>Despesas</th>
                    <th>Saldo</th>
                    <th>Aprovação</th>
                    <th>Publicação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((statement) => {
                    const badge = badgeOf(statement.status);
                    const snap = statement.snapshot;
                    const rowBalance = snap?.balance ?? 0;
                    const rowReversals = reversalsOf(statement);
                    return (
                      <tr key={statement.id} style={opened?.id === statement.id ? { background: '#f0f7ff' } : undefined}>
                        <td><strong>{capitalize(monthOf(statement))}</strong></td>
                        <td>{scopeLabel(statement)}</td>
                        <td><span className={`status-badge ${badge.color}`}>{badge.label}</span></td>
                        <td style={{ color: '#0f5132' }}>
                          {formatBRL(snap?.income?.total ?? 0)}
                          {rowReversals && (
                            <div style={{ fontSize: '0.72rem', color: '#888' }} title={reversalsLabel(rowReversals)}>
                              líquido de {formatBRL(rowReversals.total)} em estornos
                            </div>
                          )}
                        </td>
                        <td style={{ color: '#842029' }}>{formatBRL(snap?.expense?.total ?? 0)}</td>
                        <td style={{ fontWeight: 600, color: rowBalance >= 0 ? '#0f5132' : '#842029' }}>{formatBRL(rowBalance)}</td>
                        <td>
                          {statement.status !== 'DRAFT' && statement.approvedAt ? (
                            <>
                              <div>{statement.approvedByName || CAEP}</div>
                              <div style={{ fontSize: '0.75rem', color: '#888' }}>em {formatDay(statement.approvedAt)}</div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{statement.status === 'PUBLISHED' ? formatDay(statement.publishedAt) : '—'}</td>
                        <td className="actions-cell">
                          <button type="button" className="btn-small" disabled={openingId !== null} onClick={() => void openStatement(statement.id)}>
                            {openingId === statement.id ? 'Abrindo...' : 'Abrir'}
                          </button>
                          {renderDownloads(statement)}
                          {renderAdminActions(statement)}
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

      {opened && openedBadge && (
        <div className="detail-panel" ref={panelRef}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ marginBottom: '0.25rem' }}>
                Balancete de {monthOf(opened)}{' '}
                <span className={`status-badge ${openedBadge.color}`} style={{ verticalAlign: 'middle' }}>{openedBadge.label}</span>
              </h2>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>
                {scopeLabel(opened)} · gerado em {formatDateTime(opened.generatedAt || snapshot?.generatedAt)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn-small" disabled={openingId !== null} onClick={() => void openStatement(opened.id, false)}>
                {openingId === opened.id ? 'Atualizando...' : '↻ Atualizar'}
              </button>
              {renderDownloads(opened)}
              {renderAdminActions(opened)}
              <button type="button" className="btn-small" onClick={closePanel}>Fechar</button>
            </div>
          </div>

          <div className="summary-cards" style={{ marginTop: '1rem' }}>
            <div className="summary-card"><div className="label">{openedReversals ? 'Receitas (líquidas de estornos)' : 'Receitas'}</div><div className="value positive">{formatBRL(income.total)}</div></div>
            {openedReversals && (
              <div className="summary-card" title="Receitas estornadas no mês; o total de receitas já está líquido delas">
                <div className="label">Estornos de receita</div>
                <div className="value negative">− {formatBRL(openedReversals.total)}</div>
                <div style={{ fontSize: '0.75rem', color: '#888' }}>
                  {openedReversals.count} {plural(openedReversals.count, 'estorno já descontado', 'estornos já descontados')} das receitas
                </div>
              </div>
            )}
            <div className="summary-card"><div className="label">Despesas</div><div className="value negative">{formatBRL(expense.total)}</div></div>
            <div className="summary-card"><div className="label">Saldo</div><div className={`value ${balance >= 0 ? 'positive' : 'negative'}`}>{formatBRL(balance)}</div></div>
            <div className="summary-card"><div className="label">Lançamentos</div><div className="value">{entriesCount(opened)}</div></div>
          </div>

          <div className="detail-section">
            <h4>Linha do tempo</h4>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {timelineOf(opened).map((step) => (
                <li key={step.label} style={{ flex: '1 1 200px', borderLeft: `3px solid ${step.done ? '#198754' : '#dee2e6'}`, paddingLeft: '0.7rem' }}>
                  <div style={{ fontWeight: 600, color: step.done ? '#0f5132' : '#888' }}>{step.done ? '✓ ' : '○ '}{step.label}</div>
                  <div style={{ fontSize: '0.82rem', color: '#666' }}>{step.detail}</div>
                </li>
              ))}
            </ol>
          </div>

          <div className="detail-section">
            <h4>Mensagem do Conselho</h4>
            <p style={{ ...hintStyle, margin: '0 0 0.5rem' }}>
              Texto que acompanha o balancete no app e no PDF (ex.: destino do saldo, obras em andamento, agradecimento aos dizimistas).
            </p>
            {notesLocked && (
              <p style={{ fontSize: '0.85rem', color: '#b45309', fontWeight: 600, margin: '0 0 0.5rem' }}>
                Balancete publicado: a mensagem está travada. Para alterar, despublique (ele volta para "Aprovado") e publique de novo.
              </p>
            )}
            <textarea
              id="statement-notes"
              aria-label="Mensagem do Conselho"
              rows={4}
              maxLength={NOTES_MAX}
              disabled={notesLocked || savingNotes}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: O saldo do mês foi destinado à reforma do salão paroquial. Obrigado a todos os dizimistas!"
              style={textareaStyle}
            />
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn-small success" disabled={notesLocked || savingNotes || !notesDirty} onClick={() => void saveNotes()}>
                {savingNotes ? 'Salvando...' : 'Salvar mensagem'}
              </button>
              <span style={{ fontSize: '0.78rem', color: '#888' }}>
                {notes.length}/{NOTES_MAX}
                {notesDirty ? ' · alterações não salvas' : ''}
              </span>
            </div>
          </div>

          <BucketTable title="Receitas por categoria" nameHeader="Categoria" rows={income.byCategory} total={income.total} empty="Nenhuma receita no mês." unnamed="Sem categoria" />
          <BucketTable title="Despesas por categoria" nameHeader="Categoria" rows={expense.byCategory} total={expense.total} empty="Nenhuma despesa no mês." unnamed="Sem categoria" />
          <BucketTable
            title="Despesas por centro de custo"
            nameHeader="Centro de custo"
            rows={expense.byCostCenter}
            total={expense.total}
            empty="Nenhuma despesa no mês."
            unnamed="Sem centro de custo"
          />
          <BucketTable
            title="Receitas por centro de custo"
            nameHeader="Centro de custo"
            rows={income.byCostCenter}
            total={income.total}
            empty="Nenhuma receita no mês."
            unnamed="Sem centro de custo"
          />

          <div className="detail-section">
            <h4>Campanhas</h4>
            {campaigns.length === 0 ? (
              <p style={emptyStyle}>Nenhuma arrecadação de campanha no mês.</p>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>Campanha</th><th>Arrecadado no mês</th></tr></thead>
                  <tbody>
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id}><td>{campaign.name}</td><td>{formatBRL(campaign.total)}</td></tr>
                    ))}
                    <tr>
                      <td><strong>Total</strong></td>
                      <td><strong>{formatBRL(campaigns.reduce((sum, campaign) => sum + (campaign.total ?? 0), 0))}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {opened.communityId === null && (
            <div className="detail-section">
              <h4>Por comunidade</h4>
              {byCommunity.length === 0 ? (
                <p style={emptyStyle}>Nenhum lançamento no mês.</p>
              ) : (
                <div className="table-container">
                  <table className="data-table">
                    <thead><tr><th>Comunidade</th><th>Receitas</th><th>Despesas</th><th>Saldo</th></tr></thead>
                    <tbody>
                      {byCommunity.map((row, index) => {
                        const rowBalance = (row.income ?? 0) - (row.expense ?? 0);
                        return (
                          <tr key={row.id ?? `parish-${index}`}>
                            <td>{row.id === null ? <em style={{ color: '#666' }}>{row.name || 'Paróquia (sem comunidade)'}</em> : row.name}</td>
                            <td style={{ color: '#0f5132' }}>{formatBRL(row.income ?? 0)}</td>
                            <td style={{ color: '#842029' }}>{formatBRL(row.expense ?? 0)}</td>
                            <td style={{ fontWeight: 600, color: rowBalance >= 0 ? '#0f5132' : '#842029' }}>{formatBRL(rowBalance)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {approveTarget && (
        <div className="module-modal-overlay" onClick={closeApprove}>
          <div className="module-modal" role="dialog" aria-modal="true" aria-labelledby="statement-approve-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2 id="statement-approve-title">Aprovar balancete</h2>
            <p style={{ fontSize: '0.88rem', color: '#666' }}>
              <strong>{capitalize(monthOf(approveTarget))}</strong> · {scopeLabel(approveTarget)} · receitas {formatBRL(approveTarget.snapshot?.income?.total ?? 0)} ·
              despesas {formatBRL(approveTarget.snapshot?.expense?.total ?? 0)} · saldo {formatBRL(approveTarget.snapshot?.balance ?? 0)}.
              {approveReversals && <> Estornos de receita: {reversalsLabel(approveReversals)}.</>}
            </p>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              A aprovação é registrada em nome do Conselho de Assuntos Econômicos Paroquiais (CAEP). Depois dela o balancete pode ser
              publicado para os fiéis; se for regenerado, a aprovação é zerada.
            </p>
            <form onSubmit={submitApprove}>
              <div className="form-group">
                <label htmlFor="statement-approved-by">Aprovado por</label>
                <input
                  id="statement-approved-by"
                  type="text"
                  maxLength={120}
                  autoFocus
                  value={approvedByName}
                  onChange={(e) => setApprovedByName(e.target.value)}
                  placeholder={CAEP}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" disabled={approving} onClick={closeApprove}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={approving}>{approving ? 'Aprovando...' : 'Aprovar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default StatementsTab;
