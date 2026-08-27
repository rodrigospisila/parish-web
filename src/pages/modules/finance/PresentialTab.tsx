import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../services/api';
import { notify } from '../../../services/notification.service';
import { downloadBlob, formatBRL, friendlyError } from './financeShared';
import type { Campaign } from './CampaignsTab';

/**
 * Aba "Registro presencial" do Financeiro (balcão/secretaria): o agente localiza o fiel
 * (nome, nº de dizimista, CPF ou telefone), registra o dízimo/oferta recebido em mãos
 * (dinheiro, envelope, maquininha, Pix, transferência ou cheque), emite o comprovante em
 * PDF e pode desfazer um lançamento seu dentro de 24 h.
 */

export type PresentialMethod = 'CASH' | 'ENVELOPE' | 'POS' | 'PIX' | 'TRANSFER' | 'CHECK';
export type ContributionKind = 'TITHE' | 'OFFERING';

export interface AgentMember {
  id: string;
  fullName: string;
  community: { id: string; name: string } | null;
  /** Paróquia do fiel: campanha de outra paróquia não vale para ele */
  parishId?: string | null;
  registrationNumber: string | null;
  titherStatus: string | null;
  cpfMasked: string | null;
  phoneMasked: string | null;
  lastContribution: { referenceMonth: string | null; amount: number; date: string; method: string } | null;
}

export interface AgentContribution {
  id: string;
  status: string;
  amount: number;
  referenceMonth: string | null;
  kind: ContributionKind;
  /** Identificador do lançamento (nome do comprovante); pode faltar em registros antigos */
  txid?: string | null;
  paymentMethod: string | null;
  /** O backend pode mandar o objeto da campanha ou só o nome */
  campaign: { id: string; name: string } | string | null;
  confirmedAt: string | null;
  member: { id: string; fullName: string } | null;
  /** Só o próprio agente, dentro de 24 h, e enquanto confirmada */
  canUndo: boolean;
}

interface PresentialTabProps {
  /** Paróquia usada para listar as campanhas ativas (admins sem paróquia própria escolhem no seletor) */
  parishIdParam?: string;
  /** Registrar/desfazer mexe nas receitas do Financeiro: avisa a página para recarregar os totais */
  onDataChanged?: () => void;
}

interface PresentialForm {
  kind: ContributionKind;
  amount: string;
  referenceMonth: string;
  method: PresentialMethod;
  date: string;
  campaignId: string;
  receiptNumber: string;
  note: string;
}

export const PRESENTIAL_METHODS: ReadonlyArray<{ value: PresentialMethod; label: string }> = [
  { value: 'CASH', label: 'Dinheiro' },
  { value: 'ENVELOPE', label: 'Envelope' },
  { value: 'POS', label: 'Maquininha' },
  { value: 'PIX', label: 'Pix' },
  { value: 'TRANSFER', label: 'Transferência' },
  { value: 'CHECK', label: 'Cheque' },
];

/** Rótulos de meio: os do balcão + os que podem aparecer na última contribuição (app/gateway) */
const METHOD_LABEL: Record<string, string> = {
  ...Object.fromEntries(PRESENTIAL_METHODS.map((method) => [method.value, method.label])),
  CARD: 'Cartão',
  BOLETO: 'Boleto',
  GATEWAY: 'Provedor',
  MANUAL: 'Lançamento manual',
};
const methodLabel = (method: string | null | undefined): string => (method ? METHOD_LABEL[method.toUpperCase()] ?? method : '—');
const kindLabel = (kind: ContributionKind): string => (kind === 'TITHE' ? 'Dízimo' : 'Oferta');

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  CONFIRMED: { label: 'Confirmado', color: 'green' },
  CANCELLED: { label: 'Desfeito', color: 'gray' },
};
const TITHER_BADGE: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Dizimista', color: 'green' },
  INACTIVE: { label: 'Dizimista inativo', color: 'gray' },
};

const TZ = 'America/Sao_Paulo';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const currentMonth = () => todayIso().slice(0, 7);

/** ISO/datetime → 'AAAA-MM-DD' no fuso de Brasília; data-only passa direto (não perde um dia) */
const isoDay = (value: string): string => (DATE_ONLY.test(value) ? value : new Date(value).toLocaleDateString('sv-SE', { timeZone: TZ }));

/** ISO/datetime → 'DD/MM/AAAA' (fuso de Brasília); data-only não perde um dia */
const formatDay = (value: string | null | undefined): string => {
  if (!value) return '—';
  const iso = isoDay(value);
  if (!DATE_ONLY.test(iso)) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};
const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
};

/** 'AAAA-MM' → 'Agosto de 2026' */
const monthLabel = (month: string | null | undefined): string => {
  if (!month) return '—';
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  const text = new Date(Date.UTC(year, index - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Próximo mês, o atual e os 12 anteriores (do mais recente para o mais antigo) */
const buildMonthOptions = (): Array<{ value: string; label: string }> => {
  const [year, month] = currentMonth().split('-').map(Number);
  const options: Array<{ value: string; label: string }> = [];
  for (let offset = 1; offset >= -12; offset -= 1) {
    const value = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
    const suffix = offset === 0 ? ' (atual)' : offset === 1 ? ' (próximo)' : '';
    options.push({ value, label: `${monthLabel(value)}${suffix}` });
  }
  return options;
};

const emptyForm = (): PresentialForm => ({
  kind: 'TITHE',
  amount: '',
  referenceMonth: currentMonth(),
  method: 'CASH',
  date: todayIso(),
  campaignId: '',
  receiptNumber: '',
  note: '',
});

const campaignName = (campaign: AgentContribution['campaign']): string | null =>
  campaign == null ? null : typeof campaign === 'string' ? campaign : campaign.name;

const lastContributionLabel = (last: AgentMember['lastContribution']): string => {
  if (!last) return 'Nenhuma registrada';
  const reference = last.referenceMonth ? ` · ref. ${monthLabel(last.referenceMonth)}` : '';
  return `${formatBRL(last.amount)} em ${formatDay(last.date)} (${methodLabel(last.method)})${reference}`;
};

const SEARCH_MIN = 2;
const SEARCH_DEBOUNCE_MS = 300;
/** Mesmos limites e mensagem do backend (POST /tithe/agent/contributions) */
const AMOUNT_MIN = 1;
const AMOUNT_MAX = 50000;
const AMOUNT_RANGE_MESSAGE = 'Informe um valor entre R$ 1,00 e R$ 50.000';

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: '#555' };
const inputStyle: React.CSSProperties = { padding: '0.5rem 0.65rem', border: '1px solid #ddd', borderRadius: 6, fontSize: '0.9rem' };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' };
const hintStyle: React.CSSProperties = { fontSize: '0.82rem', color: '#666', margin: '0.35rem 0 0' };
const sectionHeadStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' };

const PresentialTab: React.FC<PresentialTabProps> = ({ parishIdParam, onDataChanged }) => {
  // Busca do fiel (debounce + contador para a resposta atrasada não sobrescrever a atual)
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AgentMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  const searchRequestRef = useRef(0);

  // Fiel escolhido + formulário
  const [selected, setSelected] = useState<AgentMember | null>(null);
  const [form, setForm] = useState<PresentialForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  // Campanhas ativas (para lançar oferta destinada a uma delas)
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  // Lançamentos deste agente nas últimas 48 h
  const [recent, setRecent] = useState<AgentContribution[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const monthOptions = useMemo(buildMonthOptions, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < SEARCH_MIN) {
      searchRequestRef.current += 1;
      setResults([]);
      setSearching(false);
      setSearchedQuery('');
      return;
    }
    const requestId = ++searchRequestRef.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.get('/tithe/agent/members', { params: { q: text } });
        if (requestId !== searchRequestRef.current) return;
        setResults(Array.isArray(res.data) ? res.data : []);
        setSearchedQuery(text);
      } catch (error) {
        if (requestId !== searchRequestRef.current) return;
        notify.error(friendlyError(error, 'Erro ao buscar o fiel'));
      } finally {
        if (requestId === searchRequestRef.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/tithe/campaigns/manage', { params: { parishId: parishIdParam || undefined, status: 'ACTIVE' } })
      .then((res) => {
        if (!cancelled) setCampaigns(Array.isArray(res.data) ? res.data : []);
      })
      .catch((error: unknown) => {
        if (!cancelled) notify.error(friendlyError(error, 'Erro ao carregar as campanhas ativas'));
      });
    return () => {
      cancelled = true;
    };
  }, [parishIdParam]);

  const fetchRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await api.get('/tithe/agent/recent');
      setRecent(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao carregar os seus lançamentos recentes'));
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecent();
  }, [fetchRecent]);

  // Campanhas que valem para o fiel escolhido: da paróquia dele (inteira ou da comunidade dele), já iniciadas e com prazo em dia
  const eligibleCampaigns = useMemo(() => {
    if (!selected) return [];
    const communityId = selected.community?.id ?? null;
    const memberParishId = selected.parishId ?? null;
    const today = todayIso();
    return campaigns.filter((campaign) => {
      if (campaign.expired) return false;
      if (campaign.startsAt && isoDay(campaign.startsAt) > today) return false;
      if (memberParishId && campaign.parishId && campaign.parishId !== memberParishId) return false;
      return campaign.communityId === null || campaign.communityId === communityId;
    });
  }, [campaigns, selected]);

  const selectedCampaign = form.campaignId ? eligibleCampaigns.find((campaign) => campaign.id === form.campaignId) ?? null : null;

  const selectMember = (member: AgentMember) => {
    setSelected(member);
    // A campanha escolhida pode não valer para a comunidade do novo fiel
    setForm((current) => ({ ...current, campaignId: '' }));
    window.setTimeout(() => amountRef.current?.focus(), 0);
  };

  const changeMember = () => {
    if (saving) return;
    setSelected(null);
  };

  const changeCampaign = (campaignId: string) => {
    // Oferta para campanha: o tipo é sempre Oferta e não tem mês de referência
    setForm((current) => ({ ...current, campaignId, kind: campaignId ? 'OFFERING' : current.kind }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || saving) return;
    const amount = Number(form.amount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < AMOUNT_MIN || amount > AMOUNT_MAX) {
      notify.error(AMOUNT_RANGE_MESSAGE);
      amountRef.current?.focus();
      return;
    }
    if (!form.date) {
      notify.error('Informe a data do recebimento');
      return;
    }
    if (form.campaignId && !selectedCampaign) {
      notify.error('A campanha escolhida não vale para este fiel (comunidade, paróquia ou prazo)');
      return;
    }
    const member = selected;
    setSaving(true);
    try {
      const res = await api.post<AgentContribution>('/tithe/agent/contributions', {
        memberId: member.id,
        amount: Math.round(amount * 100) / 100,
        kind: selectedCampaign ? 'OFFERING' : form.kind,
        referenceMonth: selectedCampaign ? undefined : form.referenceMonth,
        method: form.method,
        campaignId: selectedCampaign?.id,
        date: form.date,
        note: form.note.trim() || undefined,
        receiptNumber: form.receiptNumber.trim() || undefined,
      });
      const created = res.data;
      notify.success(`${created.kind === 'TITHE' ? 'Dízimo registrado' : 'Oferta registrada'}: ${formatBRL(created.amount)} — ${member.fullName}`);
      setRecent((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      // Mantém o fiel na tela (próximo recebimento dele), já com a última contribuição atualizada
      setSelected((current) =>
        current && current.id === member.id
          ? {
              ...current,
              lastContribution: {
                referenceMonth: created.referenceMonth,
                amount: created.amount,
                date: form.date,
                method: created.paymentMethod ?? form.method,
              },
            }
          : current,
      );
      setForm((current) => ({ ...current, amount: '', receiptNumber: '', note: '' }));
      onDataChanged?.();
      amountRef.current?.focus();
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao registrar a contribuição'));
    } finally {
      setSaving(false);
    }
  };

  const undo = async (item: AgentContribution) => {
    const who = item.member?.fullName ?? 'o fiel';
    if (!window.confirm(`Desfazer o lançamento de ${formatBRL(item.amount)} de ${who}? A contribuição é cancelada e a receita sai do Financeiro.`)) return;
    setBusyId(item.id);
    try {
      const res = await api.post<{ id: string; status: string }>(`/tithe/agent/contributions/${item.id}/undo`, {});
      const status = res.data?.status ?? 'CANCELLED';
      setRecent((current) => current.map((row) => (row.id === item.id ? { ...row, status, canUndo: false } : row)));
      notify.success('Lançamento desfeito');
      onDataChanged?.();
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao desfazer o lançamento'));
    } finally {
      setBusyId(null);
    }
  };

  const receipt = async (item: AgentContribution) => {
    setBusyId(item.id);
    try {
      await downloadBlob(`/tithe/intents/${item.id}/receipt.pdf`, `comprovante-${item.txid || item.id}.pdf`);
    } finally {
      setBusyId(null);
    }
  };

  const titherBadge = (status: string | null) => {
    const badge = status ? TITHER_BADGE[status.toUpperCase()] : undefined;
    if (!badge) return null;
    return <span className={`status-badge ${badge.color}`} style={{ marginLeft: '0.4rem' }}>{badge.label}</span>;
  };

  const recentTotal = recent.filter((item) => item.status === 'CONFIRMED').reduce((sum, item) => sum + item.amount, 0);

  return (
    <>
      <p style={{ ...hintStyle, margin: '0 0 1rem' }}>
        Atendimento no balcão: localize o fiel, registre o que ele entregou em mãos e imprima o comprovante. O lançamento entra como receita
        no Financeiro e pode ser desfeito por você em até 24 h.
      </p>

      {!selected ? (
        <div className="detail-section">
          <h4>1. Localizar o fiel</h4>
          <input
            type="search"
            autoFocus
            className="filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nome, nº de dizimista, CPF ou telefone"
            aria-label="Buscar fiel"
            style={{ width: '100%', maxWidth: 520 }}
          />
          <p style={hintStyle}>
            Busque por nome, nº de dizimista, CPF ou telefone (ao menos {SEARCH_MIN} caracteres). Os resultados mostram CPF e telefone
            mascarados — confira com o fiel antes de selecionar.
          </p>

          {searching && <p style={hintStyle}>Buscando...</p>}

          {results.length > 0 && (
            <div className="table-container" style={{ marginTop: '0.75rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Comunidade</th>
                    <th>Nº</th>
                    <th>CPF / telefone</th>
                    <th>Última contribuição</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.fullName}</strong>
                        {titherBadge(member.titherStatus)}
                      </td>
                      <td>{member.community?.name ?? '—'}</td>
                      <td>{member.registrationNumber || '—'}</td>
                      <td>
                        <div>{member.cpfMasked || '—'}</div>
                        <div style={{ fontSize: '0.8rem', color: '#666' }}>{member.phoneMasked || '—'}</div>
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>{lastContributionLabel(member.lastContribution)}</td>
                      <td className="actions-cell">
                        <button type="button" className="btn-small success" onClick={() => selectMember(member)}>Selecionar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!searching && searchedQuery && results.length === 0 && (
            <div className="empty-state" style={{ marginTop: '0.75rem' }}>
              Nenhum fiel encontrado para "{searchedQuery}". Confira a grafia ou tente pelo CPF/telefone; se o fiel ainda não tem cadastro,
              registre-o em Membros antes.
            </div>
          )}
        </div>
      ) : (
        <div className="detail-section">
          <div style={sectionHeadStyle}>
            <h4 style={{ margin: 0 }}>2. Registrar o recebimento</h4>
            <button type="button" className="btn-small" onClick={changeMember} disabled={saving}>Trocar fiel</button>
          </div>

          <div style={{ margin: '0.75rem 0 1rem', padding: '0.75rem 1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ fontSize: '1.05rem' }}>
              <strong>{selected.fullName}</strong>
              {titherBadge(selected.titherStatus)}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.25rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <span>Comunidade: {selected.community?.name ?? '—'}</span>
              <span>Nº: {selected.registrationNumber || '—'}</span>
              <span>CPF: {selected.cpfMasked || '—'}</span>
              <span>Telefone: {selected.phoneMasked || '—'}</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.25rem' }}>
              Última contribuição: {lastContributionLabel(selected.lastContribution)}
            </div>
          </div>

          <form onSubmit={submit}>
            <div style={gridStyle}>
              <label style={fieldStyle}>
                Tipo *
                <select
                  style={inputStyle}
                  value={form.kind}
                  disabled={!!form.campaignId}
                  title={form.campaignId ? 'Contribuição para campanha é sempre oferta' : undefined}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as ContributionKind })}
                >
                  <option value="TITHE">Dízimo</option>
                  <option value="OFFERING">Oferta</option>
                </select>
              </label>
              <label style={fieldStyle}>
                Valor (R$) *
                <input
                  ref={amountRef}
                  style={inputStyle}
                  type="number"
                  step="0.01"
                  min={AMOUNT_MIN}
                  max={AMOUNT_MAX}
                  inputMode="decimal"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0,00"
                />
              </label>
              <label style={fieldStyle}>
                Mês de referência *
                <select
                  style={inputStyle}
                  value={form.referenceMonth}
                  disabled={!!form.campaignId}
                  title={form.campaignId ? 'Oferta para campanha não tem mês de referência' : undefined}
                  onChange={(e) => setForm({ ...form, referenceMonth: e.target.value })}
                >
                  {monthOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                Meio *
                <select style={inputStyle} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PresentialMethod })}>
                  {PRESENTIAL_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                Data *
                <input style={inputStyle} type="date" required max={todayIso()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label style={fieldStyle}>
                Campanha (opcional)
                <select style={inputStyle} value={form.campaignId} onChange={(e) => changeCampaign(e.target.value)}>
                  <option value="">Nenhuma — dízimo/oferta comum</option>
                  {eligibleCampaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}{campaign.community ? ` · ${campaign.community.name}` : ' · paróquia'}
                    </option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                Nº do recibo / envelope
                <input style={inputStyle} type="text" maxLength={40} value={form.receiptNumber} onChange={(e) => setForm({ ...form, receiptNumber: e.target.value })} />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 2' }}>
                Observação
                <input style={inputStyle} type="text" maxLength={200} placeholder="Ex.: entregue na missa das 19h" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
            </div>
            {selectedCampaign && (
              <p style={hintStyle}>
                Oferta destinada a <strong>{selectedCampaign.name}</strong>: entra no total da campanha e como receita no Financeiro.
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Registrando...' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="detail-section">
        <div style={sectionHeadStyle}>
          <h4 style={{ margin: 0 }}>Lançados por mim (48 h)</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {recent.length > 0 && <span style={{ fontSize: '0.85rem', color: '#555' }}>Confirmados: <strong>{formatBRL(recentTotal)}</strong></span>}
            <button type="button" className="btn-small" onClick={() => void fetchRecent()} disabled={recentLoading}>
              {recentLoading ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </div>
        {recentLoading && recent.length === 0 ? (
          <p style={hintStyle}>Carregando...</p>
        ) : recent.length === 0 ? (
          <div className="empty-state" style={{ marginTop: '0.75rem' }}>Nenhum lançamento seu nas últimas 48 h.</div>
        ) : (
          <div className="table-container" style={{ marginTop: '0.75rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Fiel</th>
                  <th>Tipo</th>
                  <th>Referência</th>
                  <th>Valor</th>
                  <th>Meio</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((item) => {
                  const badge = STATUS_BADGE[item.status] ?? { label: item.status, color: 'gray' };
                  const campaign = campaignName(item.campaign);
                  const busy = busyId === item.id;
                  return (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.confirmedAt)}</td>
                      <td><strong>{item.member?.fullName ?? '—'}</strong></td>
                      <td>
                        {kindLabel(item.kind)}
                        {campaign && <div style={{ fontSize: '0.78rem', color: '#666' }}>{campaign}</div>}
                      </td>
                      <td>{item.referenceMonth ? monthLabel(item.referenceMonth) : '—'}</td>
                      <td>{formatBRL(item.amount)}</td>
                      <td>
                        {methodLabel(item.paymentMethod)}
                        {item.txid && <div style={{ fontSize: '0.72rem', color: '#888' }}><code>{item.txid}</code></div>}
                      </td>
                      <td><span className={`status-badge ${badge.color}`}>{badge.label}</span></td>
                      <td className="actions-cell">
                        {item.status === 'CONFIRMED' && (
                          <button type="button" className="btn-small" disabled={busyId !== null} onClick={() => void receipt(item)}>
                            {busy ? 'Gerando...' : 'Comprovante (PDF)'}
                          </button>
                        )}
                        {item.canUndo && (
                          <button type="button" className="btn-small danger" disabled={busyId !== null} onClick={() => void undo(item)} style={{ marginLeft: '0.4rem' }}>
                            Desfazer
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

export default PresentialTab;
