import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../services/api';
import { notify } from '../../../services/notification.service';
import { downloadBlob, formatBRL, friendlyError, httpStatus, plural } from './financeShared';

/**
 * Aba "Campanhas" do Financeiro: campanhas (com prazo/meta) e fundos (contínuos)
 * que os fiéis veem no app. A tesouraria cria, ativa, encerra, acompanha o
 * relatório e lança o que entrou fora do app (dinheiro, Pix direto etc.).
 */

export type CampaignKind = 'CAMPAIGN' | 'FUND';
export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';

export interface Campaign {
  id: string;
  parishId: string;
  communityId: string | null;
  community: { id: string; name: string } | null;
  kind: CampaignKind;
  status: CampaignStatus;
  code: string;
  name: string;
  description: string | null;
  goalAmount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  allowAnonymous: boolean;
  suggestedAmounts: number[];
  raised: number;
  percent: number | null;
  contributors: number;
  entriesCount: number;
  appTotal: number;
  daysLeft: number | null;
  createdAt: string;
  closedAt: string | null;
}

/** O backend pode mandar o nome pronto ou o objeto do fiel */
type PersonRef = string | { fullName?: string | null; name?: string | null } | null;

interface CampaignReport {
  campaign: Campaign;
  raised: number;
  appTotal: number;
  manualTotal: number;
  contributors: number;
  byCommunity: Array<{ communityId: string | null; community: string | null; total: number }>;
  byMethod: Array<{ method: string; total: number; count: number }>;
  pledges: {
    count: number;
    total: number;
    fulfilled: number;
    rows: Array<{ member: PersonRef; community: string | null; amount: number; given: number; fulfilled: boolean }>;
  };
  contributions: Array<{
    id: string;
    date: string;
    amount: number;
    anonymous: boolean;
    member: { id: string | null; fullName: string } | null;
    method: string;
    community: string | null;
    txid: string | null;
  }>;
  entries: Array<{
    id: string;
    date: string;
    amount: number;
    type: 'INCOME' | 'EXPENSE';
    description: string | null;
    community: string | null;
  }>;
}

export interface CampaignCommunity {
  id: string;
  name: string;
}

interface CampaignsTabProps {
  communities: CampaignCommunity[];
  /** Paróquia enviada ao backend (admins sem paróquia própria escolhem no seletor) */
  parishIdParam: string;
  /** false = admin diocesano/sistema ainda não escolheu a paróquia */
  parishReady: boolean;
  userRole: string;
  userCommunityId?: string;
  /** Lançamento manual gera receita no Financeiro: avisa a página para recarregar */
  onDataChanged?: () => void;
}

interface CampaignForm {
  name: string;
  description: string;
  kind: CampaignKind;
  communityId: string;
  goalAmount: string;
  startsAt: string;
  endsAt: string;
  allowAnonymous: boolean;
  suggestedAmounts: string;
}

const STATUS_BADGE: Record<CampaignStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'gray' },
  ACTIVE: { label: 'Ativa', color: 'green' },
  CLOSED: { label: 'Encerrada', color: 'blue' },
};
const KIND_LABEL: Record<CampaignKind, string> = { CAMPAIGN: 'Campanha', FUND: 'Fundo' };
const METHOD_LABEL: Record<string, string> = { PIX: 'Pix', CARD: 'Cartão', BOLETO: 'Boleto', MANUAL: 'Lançamento manual' };
const methodLabel = (method: string | null | undefined): string => (method ? METHOD_LABEL[method.toUpperCase()] ?? method : '—');
const ENTRY_METHODS = ['Dinheiro', 'Pix', 'Cartão', 'Transferência', 'Outro'] as const;

const TZ = 'America/Sao_Paulo';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** ISO/datetime → 'AAAA-MM-DD' (fuso de Brasília); data-only passa direto para não perder um dia */
const toDateInput = (value: string | null | undefined): string => {
  if (!value) return '';
  if (DATE_ONLY.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('sv-SE', { timeZone: TZ });
};
const formatDay = (value: string | null | undefined): string => {
  const iso = toDateInput(value);
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const periodLabel = (campaign: Campaign): string => {
  if (!campaign.startsAt && !campaign.endsAt) return 'Sem prazo';
  if (campaign.startsAt && campaign.endsAt) return `${formatDay(campaign.startsAt)} a ${formatDay(campaign.endsAt)}`;
  return campaign.startsAt ? `Desde ${formatDay(campaign.startsAt)}` : `Até ${formatDay(campaign.endsAt)}`;
};
const personName = (ref: PersonRef): string => (typeof ref === 'string' ? ref : ref?.fullName ?? ref?.name ?? '—');
const percentLabel = (percent: number | null): string => (percent == null ? '—' : `${Math.round(percent)}%`);

/** "20, 50, 100" → [20, 50, 100]; null quando algum trecho não é um valor positivo */
const parseSuggested = (text: string): number[] | null => {
  const values: number[] = [];
  for (const token of text.split(/[,;\s]+/).filter(Boolean)) {
    const value = Number(token);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (!values.includes(value)) values.push(value);
  }
  return values;
};

/** 403 do backend (campanha de outra comunidade) vira um texto que a coordenação entende */
const campaignError = (error: unknown, fallback: string): string => {
  const message = friendlyError(error, fallback);
  if (httpStatus(error) === 403 && (message === fallback || /forbidden/i.test(message))) {
    return 'Sem permissão: a coordenação de comunidade só cria e edita campanhas da própria comunidade';
  }
  return message;
};

const EMPTY_FORM: CampaignForm = {
  name: '',
  description: '',
  kind: 'CAMPAIGN',
  communityId: '',
  goalAmount: '',
  startsAt: '',
  endsAt: '',
  allowAnonymous: true,
  suggestedAmounts: '20, 50, 100',
};

const CampaignsTab: React.FC<CampaignsTabProps> = ({ communities, parishIdParam, parishReady, userRole, userCommunityId, onDataChanged }) => {
  const isCommunityCoordinator = userRole === 'COMMUNITY_COORDINATOR';

  const [status, setStatus] = useState<'ALL' | CampaignStatus>('ALL');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Formulário (novo/edição) num modal
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const activateOnSubmit = useRef(false);

  // Relatório da campanha escolhida + lançamento manual
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [reportLoadingId, setReportLoadingId] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState({ amount: '', date: today(), method: 'Dinheiro', communityId: '', description: '' });
  const [savingEntry, setSavingEntry] = useState(false);
  const reportRef = useRef<HTMLDivElement | null>(null);

  // Resposta atrasada de outra paróquia/filtro não sobrescreve a atual
  const requestRef = useRef(0);

  const fetchCampaigns = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const res = await api.get('/tithe/campaigns/manage', { params: { parishId: parishIdParam || undefined, status } });
      if (requestId !== requestRef.current) return;
      setCampaigns(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      notify.error(friendlyError(error, 'Erro ao carregar as campanhas'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [parishIdParam, status]);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  // Trocar de paróquia fecha relatório e formulário da anterior
  useEffect(() => {
    setReport(null);
    setShowForm(false);
    setEditing(null);
  }, [parishIdParam]);

  const replaceInList = (updated: Campaign) => {
    setCampaigns((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setReport((current) => (current && current.campaign.id === updated.id ? { ...current, campaign: updated } : current));
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, communityId: isCommunityCoordinator ? userCommunityId ?? '' : '' });
    setShowForm(true);
  };

  const openEdit = (campaign: Campaign) => {
    setEditing(campaign);
    setForm({
      name: campaign.name,
      description: campaign.description ?? '',
      kind: campaign.kind,
      communityId: campaign.communityId ?? '',
      goalAmount: campaign.goalAmount != null ? String(campaign.goalAmount) : '',
      startsAt: toDateInput(campaign.startsAt),
      endsAt: toDateInput(campaign.endsAt),
      allowAnonymous: campaign.allowAnonymous,
      suggestedAmounts: (campaign.suggestedAmounts ?? []).join(', '),
    });
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setEditing(null);
  };

  // Escape fecha o modal do formulário
  useEffect(() => {
    if (!showForm) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeForm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, saving]);

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const activate = activateOnSubmit.current;
    activateOnSubmit.current = false;

    const name = form.name.trim();
    if (!name) {
      notify.error('Dê um nome à campanha');
      return;
    }
    if (isCommunityCoordinator && !form.communityId) {
      notify.error('Escolha a comunidade da campanha');
      return;
    }
    const goalAmount = form.goalAmount.trim() ? Number(form.goalAmount) : null;
    if (goalAmount != null && (!Number.isFinite(goalAmount) || goalAmount <= 0)) {
      notify.error('A meta precisa ser um valor maior que zero (ou deixe em branco)');
      return;
    }
    if (form.startsAt && form.endsAt && form.endsAt < form.startsAt) {
      notify.error('A data final não pode ser antes do início');
      return;
    }
    const suggestedAmounts = parseSuggested(form.suggestedAmounts);
    if (suggestedAmounts === null) {
      notify.error('Valores sugeridos: use números positivos separados por vírgula (ex.: 20, 50, 100)');
      return;
    }

    // Na edição, campo vazio vira null para limpar o que estava salvo; na criação basta omitir
    const cleared = editing ? null : undefined;
    const payload = {
      name,
      description: form.description.trim() || cleared,
      kind: form.kind,
      communityId: form.communityId || null,
      goalAmount: goalAmount ?? cleared,
      startsAt: form.startsAt || cleared,
      endsAt: form.endsAt || cleared,
      allowAnonymous: form.allowAnonymous,
      suggestedAmounts,
    };

    setSaving(true);
    try {
      let saved: Campaign;
      if (editing) {
        const res = await api.patch(`/tithe/campaigns/${editing.id}`, payload);
        saved = res.data;
        if (activate && saved.status === 'DRAFT') {
          const activated = await api.post(`/tithe/campaigns/${editing.id}/activate`, {});
          saved = activated.data;
        }
      } else {
        const res = await api.post('/tithe/campaigns', { ...payload, parishId: parishIdParam || undefined, activate });
        saved = res.data;
      }
      if (activate && saved.status === 'ACTIVE') {
        notify.success(`"${saved.name}" ativada — os fiéis já veem no app e foram avisados uma vez`);
      } else {
        notify.success(editing ? 'Campanha atualizada' : 'Campanha salva como rascunho (os fiéis ainda não veem)');
      }
      setShowForm(false);
      setEditing(null);
      await fetchCampaigns();
    } catch (error) {
      notify.error(campaignError(error, 'Erro ao salvar a campanha'));
    } finally {
      setSaving(false);
    }
  };

  const activateCampaign = async (campaign: Campaign) => {
    const scope = campaign.community ? `os fiéis de ${campaign.community.name}` : 'todos os fiéis da paróquia';
    if (!window.confirm(`Ativar "${campaign.name}"? Ela passa a aparecer no app e ${scope} recebem um aviso (uma única vez).`)) return;
    setBusyId(campaign.id);
    try {
      const res = await api.post(`/tithe/campaigns/${campaign.id}/activate`, {});
      replaceInList(res.data);
      notify.success('Campanha ativada — os fiéis foram avisados');
    } catch (error) {
      notify.error(campaignError(error, 'Erro ao ativar a campanha'));
    } finally {
      setBusyId(null);
    }
  };

  const closeCampaign = async (campaign: Campaign) => {
    if (
      !window.confirm(
        `Encerrar "${campaign.name}"? Ela sai do app e não recebe mais contribuições. ` +
          `Arrecadado até agora: ${formatBRL(campaign.raised)}. Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    setBusyId(campaign.id);
    try {
      const res = await api.post(`/tithe/campaigns/${campaign.id}/close`, {});
      replaceInList(res.data);
      notify.success('Campanha encerrada');
    } catch (error) {
      notify.error(campaignError(error, 'Erro ao encerrar a campanha'));
    } finally {
      setBusyId(null);
    }
  };

  const loadReport = async (campaign: Campaign, scroll = true) => {
    setReportLoadingId(campaign.id);
    try {
      const res = await api.get(`/tithe/campaigns/${campaign.id}/report`);
      const data: CampaignReport = res.data;
      setReport(data);
      if (!report || report.campaign.id !== campaign.id) {
        setEntryForm({ amount: '', date: today(), method: 'Dinheiro', communityId: campaign.communityId ?? '', description: '' });
      }
      if (scroll) {
        window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }
    } catch (error) {
      notify.error(campaignError(error, 'Erro ao carregar o relatório'));
    } finally {
      setReportLoadingId(null);
    }
  };

  const submitEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report) return;
    const amount = Number(entryForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      notify.error('Informe o valor recebido');
      return;
    }
    if (!DATE_ONLY.test(entryForm.date)) {
      notify.error('Informe a data em que o valor entrou');
      return;
    }
    setSavingEntry(true);
    try {
      await api.post(`/tithe/campaigns/${report.campaign.id}/entries`, {
        amount,
        date: entryForm.date,
        method: entryForm.method,
        communityId: entryForm.communityId || undefined,
        description: entryForm.description.trim() || undefined,
      });
      notify.success(`${formatBRL(amount)} lançado na campanha e no Financeiro`);
      setEntryForm((current) => ({ ...current, amount: '', description: '' }));
      await Promise.all([loadReport(report.campaign, false), fetchCampaigns()]);
      onDataChanged?.();
    } catch (error) {
      notify.error(campaignError(error, 'Erro ao lançar a contribuição'));
    } finally {
      setSavingEntry(false);
    }
  };

  const fileBase = (campaign: Campaign) => `campanha-${campaign.code || campaign.id}`;

  return (
    <>
      <p style={{ fontSize: '0.88rem', color: '#666', margin: '0 0 0.8rem' }}>
        <strong>Campanhas</strong> têm prazo e meta (reforma, festa, obra); <strong>fundos</strong> são contínuos (caridade, missões).
        Ativas, aparecem no app para os fiéis contribuírem por Pix; o que entrar fora do app você lança pelo relatório.
        {isCommunityCoordinator ? ' A coordenação de comunidade cria e edita só as campanhas da própria comunidade.' : ''}
      </p>

      <div className="filters" style={{ alignItems: 'center' }}>
        <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value as 'ALL' | CampaignStatus)}>
          <option value="ALL">Todas as situações</option>
          <option value="DRAFT">Rascunhos</option>
          <option value="ACTIVE">Ativas</option>
          <option value="CLOSED">Encerradas</option>
        </select>
        <button type="button" className="btn-small" onClick={() => void fetchCampaigns()} disabled={loading}>↻ Atualizar</button>
        <button
          type="button"
          className="btn-primary"
          style={{ marginLeft: 'auto' }}
          disabled={!parishReady}
          title={parishReady ? undefined : 'Escolha a paróquia para criar uma campanha'}
          onClick={openNew}
        >
          + Nova campanha
        </button>
      </div>

      {loading && <div className="loading">Carregando campanhas...</div>}
      {!loading && campaigns.length === 0 && (
        <div className="empty-state">
          {status === 'ALL' ? 'Nenhuma campanha ainda. Clique em "Nova campanha" para começar.' : 'Nenhuma campanha nesta situação.'}
        </div>
      )}
      {!loading && campaigns.length > 0 && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Comunidade</th>
                <th>Período</th>
                <th>Meta</th>
                <th>Arrecadado</th>
                <th>Contribuintes</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => {
                const badge = STATUS_BADGE[campaign.status] ?? { label: campaign.status, color: 'gray' };
                const busy = busyId !== null;
                const percent = campaign.percent;
                return (
                  <tr key={campaign.id}>
                    <td>
                      <strong>{campaign.name}</strong>
                      <div style={{ fontSize: '0.75rem', color: '#888' }}>código {campaign.code}</div>
                    </td>
                    <td>{KIND_LABEL[campaign.kind] ?? campaign.kind}</td>
                    <td>{campaign.community?.name ?? 'Paróquia'}</td>
                    <td>
                      {periodLabel(campaign)}
                      {campaign.status === 'ACTIVE' && campaign.daysLeft != null && (
                        <div style={{ fontSize: '0.75rem', color: campaign.daysLeft <= 7 ? '#b45309' : '#666' }}>
                          {campaign.daysLeft > 0
                            ? `${plural(campaign.daysLeft, 'falta', 'faltam')} ${campaign.daysLeft} ${plural(campaign.daysLeft, 'dia', 'dias')}`
                            : campaign.daysLeft === 0
                              ? 'último dia'
                              : 'prazo vencido'}
                        </div>
                      )}
                    </td>
                    <td>{campaign.goalAmount != null ? formatBRL(campaign.goalAmount) : '—'}</td>
                    <td>
                      <strong>{formatBRL(campaign.raised)}</strong>
                      {percent != null && (
                        <>
                          <div className={`campaign-progress${percent >= 100 ? ' over' : ''}`} title={`${percentLabel(percent)} da meta`}>
                            <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#666' }}>{percentLabel(percent)} da meta</div>
                        </>
                      )}
                    </td>
                    <td>{campaign.contributors}</td>
                    <td>
                      <span className={`status-badge ${badge.color}`}>{badge.label}</span>
                      {campaign.status === 'CLOSED' && campaign.closedAt && (
                        <div style={{ fontSize: '0.75rem', color: '#888' }}>em {formatDay(campaign.closedAt)}</div>
                      )}
                    </td>
                    <td className="actions-cell">
                      {campaign.status !== 'CLOSED' && (
                        <button type="button" className="btn-small" disabled={busy} onClick={() => openEdit(campaign)}>Editar</button>
                      )}
                      {campaign.status === 'DRAFT' && (
                        <button type="button" className="btn-small success" disabled={busy} onClick={() => void activateCampaign(campaign)}>
                          {busyId === campaign.id ? 'Ativando...' : 'Ativar'}
                        </button>
                      )}
                      {campaign.status === 'ACTIVE' && (
                        <button type="button" className="btn-small" disabled={busy} title="Sai do app e não recebe mais contribuições" onClick={() => void closeCampaign(campaign)}>
                          {busyId === campaign.id ? 'Encerrando...' : 'Encerrar'}
                        </button>
                      )}
                      <button type="button" className="btn-small" disabled={reportLoadingId !== null} onClick={() => void loadReport(campaign)}>
                        {reportLoadingId === campaign.id ? 'Abrindo...' : 'Relatório'}
                      </button>
                      {campaign.status !== 'CLOSED' && (
                        <button
                          type="button"
                          className="btn-small"
                          title="Cartaz com o QR Pix da campanha para imprimir (precisa do Pix pelo app ativo)"
                          onClick={() => void downloadBlob(`/tithe/campaigns/${campaign.id}/qr.pdf`, `${fileBase(campaign)}-qr.pdf`)}
                        >
                          🖨 Cartaz QR
                        </button>
                      )}
                      <button type="button" className="btn-small" onClick={() => void downloadBlob(`/tithe/campaigns/${campaign.id}/report.csv`, `${fileBase(campaign)}.csv`)}>
                        ⬇ CSV
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {report && (
        <div className="detail-panel" ref={reportRef}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ marginBottom: '0.25rem' }}>
                {report.campaign.name}{' '}
                <span className={`status-badge ${STATUS_BADGE[report.campaign.status]?.color ?? 'gray'}`} style={{ verticalAlign: 'middle' }}>
                  {STATUS_BADGE[report.campaign.status]?.label ?? report.campaign.status}
                </span>
              </h2>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>
                {KIND_LABEL[report.campaign.kind] ?? report.campaign.kind} · {report.campaign.community?.name ?? 'Paróquia inteira'} · {periodLabel(report.campaign)}
                {report.campaign.goalAmount != null ? ` · meta ${formatBRL(report.campaign.goalAmount)}` : ''}
              </div>
              {report.campaign.description && <p style={{ fontSize: '0.88rem', color: '#555', margin: '0.5rem 0 0' }}>{report.campaign.description}</p>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn-small" disabled={reportLoadingId !== null} onClick={() => void loadReport(report.campaign, false)}>
                {reportLoadingId ? 'Atualizando...' : '↻ Atualizar'}
              </button>
              <button type="button" className="btn-small" onClick={() => void downloadBlob(`/tithe/campaigns/${report.campaign.id}/report.csv`, `${fileBase(report.campaign)}.csv`)}>
                ⬇ CSV
              </button>
              <button type="button" className="btn-small" onClick={() => setReport(null)}>Fechar</button>
            </div>
          </div>

          <div className="summary-cards" style={{ marginTop: '1rem' }}>
            <div className="summary-card"><div className="label">Arrecadado</div><div className="value positive">{formatBRL(report.raised)}</div></div>
            <div className="summary-card"><div className="label">Pelo app</div><div className="value">{formatBRL(report.appTotal)}</div></div>
            <div className="summary-card"><div className="label">Lançado à mão</div><div className="value">{formatBRL(report.manualTotal)}</div></div>
            <div className="summary-card"><div className="label">Contribuintes</div><div className="value">{report.contributors}</div></div>
            <div className="summary-card">
              <div className="label">Meta</div>
              <div className="value">{report.campaign.goalAmount != null ? percentLabel(report.campaign.percent) : 'Sem meta'}</div>
            </div>
          </div>

          {report.campaign.status === 'CLOSED' ? (
            <p style={{ fontSize: '0.85rem', color: '#666' }}>Campanha encerrada — não aceita novos lançamentos.</p>
          ) : (
            <div className="detail-section">
              <h4>Lançar contribuição manual</h4>
              <p style={{ fontSize: '0.82rem', color: '#666', margin: '0 0 0.6rem' }}>
                Dinheiro, Pix direto na conta ou transferência que não passou pelo app. Entra no total da campanha e como receita no Financeiro.
              </p>
              <form className="inline-form" onSubmit={submitEntry}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: '#555' }}>
                  Valor (R$) *
                  <input type="number" step="0.01" min="0.01" required value={entryForm.amount} onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })} style={{ width: 120 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: '#555' }}>
                  Data *
                  <input type="date" required value={entryForm.date} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: '#555' }}>
                  Meio
                  <select value={entryForm.method} onChange={(e) => setEntryForm({ ...entryForm, method: e.target.value })}>
                    {ENTRY_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: '#555' }}>
                  Comunidade
                  <select value={entryForm.communityId} onChange={(e) => setEntryForm({ ...entryForm, communityId: e.target.value })}>
                    <option value="">{report.campaign.community ? 'Da campanha' : 'Paróquia'}</option>
                    {communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: '#555', flex: '1 1 200px' }}>
                  Descrição
                  <input type="text" maxLength={200} placeholder="Ex.: coleta da missa das 19h" value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} />
                </label>
                <button type="submit" className="btn-small success" disabled={savingEntry} style={{ padding: '0.6rem 1rem' }}>
                  {savingEntry ? 'Lançando...' : 'Lançar'}
                </button>
              </form>
            </div>
          )}

          <div className="detail-section">
            <h4>Por comunidade</h4>
            {report.byCommunity.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#888', margin: 0 }}>Nada arrecadado ainda.</p>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>Comunidade</th><th>Total</th></tr></thead>
                  <tbody>
                    {report.byCommunity.map((row, index) => (
                      <tr key={row.communityId ?? `parish-${index}`}><td>{row.community ?? 'Paróquia'}</td><td>{formatBRL(row.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="detail-section">
            <h4>Por meio de pagamento</h4>
            {report.byMethod.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#888', margin: 0 }}>Nada arrecadado ainda.</p>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>Meio</th><th>Qtde</th><th>Total</th></tr></thead>
                  <tbody>
                    {report.byMethod.map((row) => (
                      <tr key={row.method}><td>{methodLabel(row.method)}</td><td>{row.count}</td><td>{formatBRL(row.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="detail-section">
            <h4>Promessas</h4>
            <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.6rem' }}>
              {report.pledges.count === 0
                ? 'Nenhum fiel prometeu um valor para esta campanha.'
                : `${report.pledges.count} ${plural(report.pledges.count, 'promessa', 'promessas')} somando ${formatBRL(report.pledges.total)} · ${report.pledges.fulfilled} ${plural(report.pledges.fulfilled, 'cumprida', 'cumpridas')}`}
            </p>
            {report.pledges.rows.length > 0 && (
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>Fiel</th><th>Comunidade</th><th>Prometido</th><th>Já deu</th><th>Situação</th></tr></thead>
                  <tbody>
                    {report.pledges.rows.map((row, index) => (
                      <tr key={`${personName(row.member)}-${index}`}>
                        <td>{personName(row.member)}</td>
                        <td>{row.community ?? '—'}</td>
                        <td>{formatBRL(row.amount)}</td>
                        <td>{formatBRL(row.given)}</td>
                        <td>{row.fulfilled ? <span className="status-badge green">Cumprida</span> : <span className="status-badge yellow">Em aberto</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="detail-section">
            <h4>Contribuições pelo app</h4>
            {report.contributions.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#888', margin: 0 }}>Nenhuma contribuição confirmada pelo app.</p>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>Data</th><th>Quem</th><th>Valor</th><th>Meio</th><th>Comunidade</th></tr></thead>
                  <tbody>
                    {report.contributions.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDay(row.date)}</td>
                        <td>
                          {row.anonymous || !row.member ? <em style={{ color: '#666' }}>Oferta anônima</em> : row.member.fullName}
                          {row.txid && <div style={{ fontSize: '0.72rem', color: '#888' }}><code>{row.txid}</code></div>}
                        </td>
                        <td>{formatBRL(row.amount)}</td>
                        <td>{methodLabel(row.method)}</td>
                        <td>{row.community ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="detail-section">
            <h4>Lançamentos manuais</h4>
            {report.entries.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#888', margin: 0 }}>Nenhum lançamento feito à mão.</p>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>Data</th><th>Valor</th><th>Descrição</th><th>Comunidade</th></tr></thead>
                  <tbody>
                    {report.entries.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDay(row.date)}</td>
                        <td style={{ fontWeight: 600, color: row.type === 'EXPENSE' ? '#842029' : '#0f5132' }}>
                          {row.type === 'EXPENSE' ? '−' : '+'} {formatBRL(row.amount)}
                        </td>
                        <td>{row.description || '—'}</td>
                        <td>{row.community ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="module-modal-overlay" onClick={closeForm}>
          <div className="module-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-form-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2 id="campaign-form-title">{editing ? `Editar "${editing.name}"` : 'Nova campanha'}</h2>
            {editing?.status === 'ACTIVE' && (
              <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '-0.75rem' }}>Campanha ativa: as mudanças aparecem no app na hora.</p>
            )}
            <form onSubmit={submitForm}>
              <div className="form-group">
                <label htmlFor="campaign-name">Nome *</label>
                <input id="campaign-name" type="text" required maxLength={120} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Reforma do telhado" />
              </div>
              <div className="form-group">
                <label htmlFor="campaign-description">Descrição (o fiel lê no app)</label>
                <textarea id="campaign-description" rows={3} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Para que serve a arrecadação e como será usada" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="campaign-kind">Tipo</label>
                  <select id="campaign-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CampaignKind })}>
                    <option value="CAMPAIGN">Campanha (com prazo e meta)</option>
                    <option value="FUND">Fundo (contínuo)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="campaign-community">Comunidade</label>
                  <select id="campaign-community" required={isCommunityCoordinator} value={form.communityId} onChange={(e) => setForm({ ...form, communityId: e.target.value })}>
                    {isCommunityCoordinator ? <option value="">Escolha a comunidade...</option> : <option value="">Paróquia inteira</option>}
                    {communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="campaign-goal">Meta (R$, opcional)</label>
                  <input id="campaign-goal" type="number" step="0.01" min="0.01" value={form.goalAmount} onChange={(e) => setForm({ ...form, goalAmount: e.target.value })} placeholder="Sem meta" />
                </div>
                <div className="form-group">
                  <label htmlFor="campaign-suggested">Valores sugeridos (R$)</label>
                  <input id="campaign-suggested" type="text" value={form.suggestedAmounts} onChange={(e) => setForm({ ...form, suggestedAmounts: e.target.value })} placeholder="20, 50, 100" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="campaign-starts">Início</label>
                  <input id="campaign-starts" type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="campaign-ends">Fim</label>
                  <input id="campaign-ends" type="date" min={form.startsAt || undefined} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
                </div>
              </div>
              <label className="form-check">
                <input type="checkbox" checked={form.allowAnonymous} onChange={(e) => setForm({ ...form, allowAnonymous: e.target.checked })} />
                <span>Permitir oferta anônima (sem identificar o fiel)</span>
              </label>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" disabled={saving} onClick={closeForm}>Cancelar</button>
                {editing?.status === 'ACTIVE' ? (
                  <button type="submit" className="btn-submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
                ) : (
                  <>
                    <button type="submit" className="btn-submit" disabled={saving} style={{ background: '#6c757d' }} onClick={() => { activateOnSubmit.current = false; }}>
                      {saving ? 'Salvando...' : 'Salvar como rascunho'}
                    </button>
                    <button type="submit" className="btn-submit" disabled={saving} title="Aparece no app e os fiéis recebem um aviso (uma vez)" onClick={() => { activateOnSubmit.current = true; }}>
                      {saving ? 'Salvando...' : 'Salvar e ativar'}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default CampaignsTab;
