import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import { useAuth } from '../../contexts/AuthContext';
import './ModulePages.css';

interface Transaction {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  category: string;
  amount: number;
  description?: string | null;
  date: string;
}

interface Summary {
  income: number;
  expense: number;
  balance: number;
  count: number;
}

interface Tither {
  id: string;
  registrationNumber?: string | null;
  status: string;
  member: { id: string; fullName: string };
  _count?: { contributions: number };
}

interface Contribution {
  contributionId: string;
  member: { id: string; name: string };
  amount: number;
  method: string;
  date: string;
}

interface Community {
  id: string;
  name: string;
}

interface Member {
  id: string;
  fullName: string;
}

const METHODS = ['Dinheiro', 'PIX', 'Cartão', 'Transferência', 'Envelope'];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const formatBRL = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface OnlineIntent {
  id: string;
  member: { id: string; fullName: string; community: string | null };
  amount: number;
  referenceMonth: string;
  kind: 'TITHE' | 'OFFERING';
  status: 'CREATED' | 'DECLARED' | 'CONFIRMED' | 'CANCELLED';
  txid: string;
  note?: string | null;
  amountPaid?: number | null;
  anonymous?: boolean;
  contestNote?: string | null;
  contestedAt?: string | null;
  canReopen?: boolean;
  declaredAt?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
}

interface ReportRow {
  communityId: string;
  community: string;
  kind: string;
  method: string;
  count: number;
  total: number;
}

interface TitheConfig {
  id: string;
  name: string;
  titheEnabled: boolean;
  pixKey?: string | null;
  pixKeyType?: string | null;
  pixMerchantName?: string | null;
  pixMerchantCity?: string | null;
  titheMessage?: string | null;
  brCodePreview?: string | null;
  lastChange?: { at: string; byName: string | null } | null;
  cancelledOpenIntents?: number;
}

const INTENT_STATUS: Record<string, { label: string; color: string }> = {
  CREATED: { label: 'Pix gerado', color: 'gray' },
  DECLARED: { label: 'Aguardando conferência', color: 'yellow' },
  CONFIRMED: { label: 'Confirmado', color: 'green' },
  CANCELLED: { label: 'Cancelado', color: 'red' },
};

const FinancePage: React.FC = () => {
  const { user } = useAuth();
  const canConfigureTithe = ['PARISH_ADMIN', 'DIOCESAN_ADMIN', 'SYSTEM_ADMIN'].includes(user?.role ?? '');
  const [tab, setTab] = useState<'transactions' | 'tithe' | 'online'>('transactions');

  // Dízimo online (Pix da paróquia)
  const [onlineIntents, setOnlineIntents] = useState<OnlineIntent[]>([]);
  const [onlineStatus, setOnlineStatus] = useState('DECLARED');
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [busyIntent, setBusyIntent] = useState<string | null>(null);
  const [titheConfig, setTitheConfig] = useState<TitheConfig | null>(null);
  const [configForm, setConfigForm] = useState({
    titheEnabled: false,
    pixKeyType: 'CNPJ',
    pixKey: '',
    pixMerchantName: '',
    pixMerchantCity: '',
    titheMessage: '',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  // Conferência (um ou vários) num modal — nada de window.prompt
  const [confirmTargets, setConfirmTargets] = useState<OnlineIntent[] | null>(null);
  const [confirmForm, setConfirmForm] = useState({ date: '', receiptNumber: '', amountPaid: '', referenceMonth: '' });
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  // Relatório do mês, QR institucional e extrato anual
  const [reportMonth, setReportMonth] = useState(currentMonth());
  const [reportCommunity, setReportCommunity] = useState('');
  const [report, setReport] = useState<{ referenceMonth: string; rows: ReportRow[]; totals: { count: number; total: number } } | null>(null);
  const [institutionalQr, setInstitutionalQr] = useState<{ qrDataUrl: string; brCode: string } | null>(null);
  const [statementMember, setStatementMember] = useState('');
  const [statementYear, setStatementYear] = useState(String(new Date().getFullYear()));
  // Troca de chave Pix: senha atual num modal (nunca em texto claro)
  const [pwdModal, setPwdModal] = useState(false);
  const [pwd, setPwd] = useState('');

  // DIOCESAN/SYSTEM_ADMIN não têm paróquia própria: escolhem qual configurar
  const [parishOptions, setParishOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [configParishId, setConfigParishId] = useState<string>(user?.parishId ?? '');
  useEffect(() => {
    // Trocar de paróquia zera o que era da anterior
    setInstitutionalQr(null);
    setTitheConfig(null);
    setConfigError(null);
  }, [configParishId]);
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filters, setFilters] = useState({ communityId: '', from: '', to: '' });

  const [tithers, setTithers] = useState<Tither[]>([]);
  const [referenceMonth, setReferenceMonth] = useState(currentMonth());
  const [contributions, setContributions] = useState<Contribution[]>([]);

  const [showTxModal, setShowTxModal] = useState(false);
  const [txForm, setTxForm] = useState({ type: 'INCOME', category: '', amount: '', description: '', date: '', communityId: '' });

  const [showTitherModal, setShowTitherModal] = useState(false);
  const [titherForm, setTitherForm] = useState({ memberId: '', registrationNumber: '' });

  const [showContributionModal, setShowContributionModal] = useState(false);
  const [contributionForm, setContributionForm] = useState({
    titherId: '',
    amount: '',
    date: '',
    referenceMonth: currentMonth(),
    method: 'PIX',
    receiptNumber: '',
  });

  const fetchFinance = useCallback(async () => {
    try {
      const params = {
        communityId: filters.communityId || undefined,
        from: filters.from ? new Date(filters.from).toISOString() : undefined,
        to: filters.to ? new Date(filters.to).toISOString() : undefined,
      };
      const [summaryRes, txRes] = await Promise.all([
        api.get('/finance/summary', { params }),
        api.get('/finance/transactions', { params }),
      ]);
      setSummary(summaryRes.data);
      setTransactions(txRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar dados financeiros'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchTithe = useCallback(async () => {
    try {
      const [tithersRes, contributionsRes] = await Promise.all([
        api.get('/finance/tithers'),
        api.get('/finance/tithe/contributions', { params: { referenceMonth } }),
      ]);
      setTithers(tithersRes.data);
      setContributions(contributionsRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar dízimo'));
    }
  }, [referenceMonth]);

  useEffect(() => {
    fetchFinance();
  }, [fetchFinance]);

  useEffect(() => {
    if (tab === 'tithe') fetchTithe();
  }, [tab, fetchTithe]);

  const fetchOnline = useCallback(async () => {
    setOnlineLoading(true);
    try {
      const [intentsRes, configRes] = await Promise.all([
        api.get('/tithe/intents', { params: { status: onlineStatus } }),
        canConfigureTithe && (configParishId || user?.parishId)
          ? api
              .get('/tithe/config', { params: configParishId ? { parishId: configParishId } : undefined })
              .then((res) => {
                setConfigError(null);
                return res;
              })
              .catch((error) => {
                setConfigError(getErrorMessage(error, 'Não foi possível carregar a configuração do Pix'));
                setTitheConfig(null);
                return { data: null };
              })
          : Promise.resolve({ data: null }),
      ]);
      setOnlineIntents(intentsRes.data ?? []);
      if (configRes.data) {
        const cfg: TitheConfig = configRes.data;
        setTitheConfig(cfg);
        setConfigForm({
          titheEnabled: !!cfg.titheEnabled,
          pixKeyType: cfg.pixKeyType ?? 'CNPJ',
          pixKey: cfg.pixKey ?? '',
          pixMerchantName: cfg.pixMerchantName ?? '',
          pixMerchantCity: cfg.pixMerchantCity ?? '',
          titheMessage: cfg.titheMessage ?? '',
        });
      }
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o dízimo online'));
    } finally {
      setOnlineLoading(false);
    }
  }, [onlineStatus, canConfigureTithe, configParishId, user?.parishId]);

  useEffect(() => {
    if (tab === 'online') {
      void fetchOnline();
      void fetchTithe();
    }
  }, [tab, fetchOnline, fetchTithe]);

  useEffect(() => {
    if (tab === 'online' && canConfigureTithe && !user?.parishId && parishOptions.length === 0) {
      api
        .get('/parishes')
        .then((res) => {
          const list = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
          setParishOptions(list.map((parish: any) => ({ id: parish.id, name: parish.name })));
        })
        .catch(() => setParishOptions([]));
    }
  }, [tab, canConfigureTithe, user?.parishId, parishOptions.length]);

  const downloadBlob = async (path: string, filename: string, params?: Record<string, string>) => {
    try {
      const res = await api.get(path, { responseType: 'blob', params });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      let message = 'Erro ao gerar o arquivo';
      try {
        if (error?.response?.data instanceof Blob) {
          const parsed = JSON.parse(await error.response.data.text());
          if (parsed?.message) message = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
        }
      } catch {
        // genérico
      }
      notify.error(message);
    }
  };

  const loadReport = async () => {
    try {
      const res = await api.get('/tithe/report', {
        params: { referenceMonth: reportMonth, communityId: reportCommunity || undefined },
      });
      setReport(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o relatório'));
    }
  };

  const openConfirm = (targets: OnlineIntent[]) => {
    if (!targets.length) return;
    const first = targets[0];
    setConfirmForm({
      date: new Date(first.declaredAt ?? first.createdAt).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
      receiptNumber: '',
      amountPaid: targets.length === 1 ? String(first.amount) : '',
      referenceMonth: targets.length === 1 ? first.referenceMonth : '',
    });
    setConfirmTargets(targets);
  };

  const submitConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmTargets) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmForm.date)) {
      notify.error('Informe a data em que o Pix caiu no extrato');
      return;
    }
    setBusyIntent('batch');
    let done = 0;
    try {
      for (const intent of confirmTargets) {
        await api.post(`/tithe/intents/${intent.id}/confirm`, {
          date: confirmForm.date,
          receiptNumber: confirmForm.receiptNumber.trim() || undefined,
          amountPaid: confirmTargets.length === 1 && confirmForm.amountPaid ? Number(confirmForm.amountPaid) : undefined,
          referenceMonth: confirmForm.referenceMonth || undefined,
        });
        done += 1;
      }
      notify.success(done === 1 ? 'Contribuição confirmada e lançada no Financeiro' : `${done} contribuições confirmadas`);
      setConfirmTargets(null);
      setSelectedIds({});
      await fetchOnline();
      fetchFinance();
    } catch (error) {
      notify.error(getErrorMessage(error, `Erro ao confirmar (${done} de ${confirmTargets.length} feitas)`));
      await fetchOnline();
    } finally {
      setBusyIntent(null);
    }
  };

  const rejectIntent = async (intent: OnlineIntent) => {
    const typed = window.prompt('Motivo (o fiel recebe o aviso e pode contestar):', 'Pix não localizado no extrato');
    if (typed === null) return;
    setBusyIntent(intent.id);
    try {
      await api.post(`/tithe/intents/${intent.id}/reject`, { reason: typed.trim() || undefined });
      notify.success('Pix marcado como não localizado');
      await fetchOnline();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao processar'));
    } finally {
      setBusyIntent(null);
    }
  };

  const reopenIntent = async (intent: OnlineIntent) => {
    setBusyIntent(intent.id);
    try {
      await api.post(`/tithe/intents/${intent.id}/reopen`, {});
      notify.success('Pix reaberto — volta para a fila de conferência');
      await fetchOnline();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao reabrir'));
    } finally {
      setBusyIntent(null);
    }
  };

  const submitConfig = async (currentPassword?: string) => {
    setSavingConfig(true);
    try {
      const res = await api.patch('/tithe/config', {
        parishId: configParishId || undefined,
        currentPassword,
        titheEnabled: configForm.titheEnabled,
        pixKeyType: configForm.pixKeyType,
        pixKey: configForm.pixKey.trim() || null,
        pixMerchantName: configForm.pixMerchantName.trim() || null,
        pixMerchantCity: configForm.pixMerchantCity.trim() || null,
        titheMessage: configForm.titheMessage.trim() || null,
      });
      setTitheConfig(res.data);
      setConfigForm((current) => ({
        ...current,
        pixKey: res.data?.pixKey ?? '',
        pixKeyType: res.data?.pixKeyType ?? current.pixKeyType,
        pixMerchantName: res.data?.pixMerchantName ?? '',
        pixMerchantCity: res.data?.pixMerchantCity ?? '',
      }));
      notify.success(res.data?.titheEnabled ? 'Dízimo pelo app ATIVO para os fiéis' : 'Configuração salva (dízimo pelo app desativado)');
      if (res.data?.cancelledOpenIntents > 0) {
        notify.success(`${res.data.cancelledOpenIntents} Pix em aberto foram cancelados — os fiéis geram um novo código`);
      }
      setPwdModal(false);
      setPwd('');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar a configuração'));
    } finally {
      setSavingConfig(false);
    }
  };

  const saveTitheConfig = (e: React.FormEvent) => {
    e.preventDefault();
    // Qualquer mudança de chave/tipo (inclusive a primeira) pede a senha atual
    const keyChanged =
      configForm.pixKey.trim() !== (titheConfig?.pixKey ?? '') ||
      configForm.pixKeyType !== (titheConfig?.pixKeyType ?? configForm.pixKeyType);
    if (keyChanged) {
      setPwd('');
      setPwdModal(true);
      return;
    }
    void submitConfig();
  };


  useEffect(() => {
    api.get('/communities').then((res) => setCommunities(res.data)).catch(() => undefined);
    api.get('/members').then((res) => setMembers(res.data)).catch(() => undefined);
  }, []);

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/transactions', {
        type: txForm.type,
        category: txForm.category,
        amount: Number(txForm.amount),
        description: txForm.description || undefined,
        date: new Date(txForm.date).toISOString(),
        communityId: txForm.communityId || undefined,
      });
      notify.success('Lançamento registrado!');
      setShowTxModal(false);
      setTxForm({ type: 'INCOME', category: '', amount: '', description: '', date: '', communityId: '' });
      fetchFinance();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar lançamento'));
    }
  };

  const handleRegisterTither = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/tithers', {
        memberId: titherForm.memberId,
        registrationNumber: titherForm.registrationNumber || undefined,
      });
      notify.success('Dizimista cadastrado!');
      setShowTitherModal(false);
      setTitherForm({ memberId: '', registrationNumber: '' });
      fetchTithe();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao cadastrar dizimista'));
    }
  };

  const handleAddContribution = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/tithe/contributions', {
        titherId: contributionForm.titherId,
        amount: Number(contributionForm.amount),
        date: new Date(contributionForm.date).toISOString(),
        referenceMonth: contributionForm.referenceMonth,
        method: contributionForm.method,
        receiptNumber: contributionForm.receiptNumber || undefined,
      });
      notify.success('Contribuição lançada — transação "Dízimo" gerada!');
      setShowContributionModal(false);
      setContributionForm({ titherId: '', amount: '', date: '', referenceMonth: currentMonth(), method: 'PIX', receiptNumber: '' });
      fetchTithe();
      fetchFinance();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao lançar contribuição'));
    }
  };

  const formatDate = (value: string) => new Date(value).toLocaleDateString('pt-BR');
  const monthTotal = contributions.reduce((sum, c) => sum + c.amount, 0);

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="dizimo" /> Financeiro</h1>
        <div className="header-actions">
          {tab === 'transactions' ? (
            <button className="btn-primary" onClick={() => setShowTxModal(true)}>+ Lançamento</button>
          ) : (
            <>
              <button className="btn-secondary" onClick={() => setShowTitherModal(true)}>+ Dizimista</button>
              <button className="btn-primary" onClick={() => setShowContributionModal(true)}>+ Contribuição</button>
            </>
          )}
        </div>
      </div>

      <div className="privacy-note">
        Gestão pastoral de receitas e despesas — não substitui a contabilidade oficial da paróquia.
        Dados individuais de dízimo são restritos à coordenação (LGPD).
      </div>

      <div className="module-tabs">
        <button className={`tab-btn ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}>
          Receitas e Despesas
        </button>
        <button className={`tab-btn ${tab === 'tithe' ? 'active' : ''}`} onClick={() => setTab('tithe')}>
          Dízimo
        </button>
        <button className={`tab-btn ${tab === 'online' ? 'active' : ''}`} onClick={() => setTab('online')}>
          Dízimo online (Pix)
        </button>
      </div>

      {tab === 'transactions' && (
        <>
          <div className="filters">
            <select className="filter-select" value={filters.communityId} onChange={(e) => setFilters({ ...filters, communityId: e.target.value })}>
              <option value="">Todo o escopo</option>
              {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="date" className="filter-input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <input type="date" className="filter-input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>

          {summary && (
            <div className="summary-cards">
              <div className="summary-card"><div className="label">Receitas</div><div className="value positive">{formatBRL(summary.income)}</div></div>
              <div className="summary-card"><div className="label">Despesas</div><div className="value negative">{formatBRL(summary.expense)}</div></div>
              <div className="summary-card"><div className="label">Saldo</div><div className={`value ${summary.balance >= 0 ? 'positive' : 'negative'}`}>{formatBRL(summary.balance)}</div></div>
              <div className="summary-card"><div className="label">Lançamentos</div><div className="value">{summary.count}</div></div>
            </div>
          )}

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Categoria</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.date)}</td>
                    <td>
                      {tx.type === 'INCOME'
                        ? <span className="status-badge green">Receita</span>
                        : <span className="status-badge red">Despesa</span>}
                    </td>
                    <td>{tx.category}</td>
                    <td>{tx.description || '—'}</td>
                    <td style={{ fontWeight: 600, color: tx.type === 'INCOME' ? '#0f5132' : '#842029' }}>
                      {tx.type === 'INCOME' ? '+' : '−'} {formatBRL(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length === 0 && <div className="empty-state">Nenhum lançamento no período.</div>}
          </div>
        </>
      )}

      {tab === 'online' && (
        <>
          {canConfigureTithe && (
            <div className="filters-bar" style={{ display: 'block', marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.3rem', color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>
                Pix da paróquia {titheConfig ? `· ${titheConfig.name}` : ''}
              </h4>
              {!user?.parishId && (
                <div className="form-group" style={{ maxWidth: 420 }}>
                  <label>Paróquia</label>
                  <select className="filter-select" value={configParishId} onChange={(e) => setConfigParishId(e.target.value)}>
                    <option value="">Escolha a paróquia...</option>
                    {parishOptions.map((parish) => (
                      <option key={parish.id} value={parish.id}>{parish.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {configError && <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{configError}</p>}
              {!titheConfig && !configError && (configParishId || user?.parishId) && (
                <p style={{ color: '#666', fontSize: '0.85rem' }}>Carregando a configuração...</p>
              )}
              <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.8rem' }}>
                O app gera um Pix “copia e cola” com a chave abaixo, o valor e um identificador. O fiel paga no próprio
                banco e avisa; você confere no extrato e confirma aqui. Sem gateway, sem taxa.
              </p>
              {titheConfig && (
              <form onSubmit={saveTitheConfig}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Tipo da chave</label>
                    <select className="filter-select" value={configForm.pixKeyType} onChange={(e) => setConfigForm({ ...configForm, pixKeyType: e.target.value })}>
                      <option value="CNPJ">CNPJ da paróquia</option>
                      <option value="CPF">CPF (conta pessoal — evite)</option>
                      <option value="EMAIL">E-mail</option>
                      <option value="PHONE">Telefone (+55…)</option>
                      <option value="RANDOM">Chave aleatória</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Chave Pix</label>
                    <input type="text" maxLength={77} autoCapitalize="off" autoCorrect="off" spellCheck={false} value={configForm.pixKey} onChange={(e) => setConfigForm({ ...configForm, pixKey: e.target.value })} placeholder="CPF só números · CNPJ pode ter letras · e-mail em minúsculas" />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Nome do recebedor (até 25, sem acento)</label>
                    <input type="text" maxLength={25} value={configForm.pixMerchantName} onChange={(e) => setConfigForm({ ...configForm, pixMerchantName: e.target.value })} placeholder="PAROQUIA SANTA RITA" />
                  </div>
                  <div className="form-group">
                    <label>Cidade (até 15)</label>
                    <input type="text" maxLength={15} value={configForm.pixMerchantCity} onChange={(e) => setConfigForm({ ...configForm, pixMerchantCity: e.target.value })} placeholder="PONTA GROSSA" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Mensagem ao fiel (opcional)</label>
                  <input type="text" maxLength={500} value={configForm.titheMessage} onChange={(e) => setConfigForm({ ...configForm, titheMessage: e.target.value })} placeholder="Seu dízimo sustenta a missão da paróquia…" />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '0.6rem' }}>
                  <input type="checkbox" checked={configForm.titheEnabled} onChange={(e) => setConfigForm({ ...configForm, titheEnabled: e.target.checked })} />
                  Ativar o dízimo pelo app para os fiéis desta paróquia
                </label>
                <button type="submit" className="btn-small success" disabled={savingConfig}>{savingConfig ? 'Salvando...' : 'Salvar configuração'}</button>
                {titheConfig?.lastChange && (
                  <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.6rem' }}>
                    🔐 Última troca da chave: {new Date(titheConfig.lastChange.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {titheConfig.lastChange.byName ? ` por ${titheConfig.lastChange.byName}` : ''}. Não reconhece? Desative o dízimo agora e fale com a diocese.
                  </p>
                )}
                {titheConfig?.brCodePreview && (
                  <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.6rem', wordBreak: 'break-all' }}>
                    Prévia do código: {titheConfig.brCodePreview}
                  </p>
                )}
              </form>
              )}
              {titheConfig?.titheEnabled && (
                <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn-small"
                    onClick={async () => {
                      try {
                        const res = await api.get('/tithe/config/institutional-qr', { params: configParishId ? { parishId: configParishId } : undefined });
                        setInstitutionalQr(res.data);
                      } catch (error) {
                        notify.error(getErrorMessage(error, 'Erro ao gerar o QR'));
                      }
                    }}
                  >
                    📱 Ver QR da paróquia (sem valor)
                  </button>
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => downloadBlob('/tithe/config/institutional-qr.pdf', 'pix-paroquia.pdf', configParishId ? { parishId: configParishId } : undefined)}
                  >
                    🖨 Cartaz do QR (PDF)
                  </button>
                  {institutionalQr && (
                    <img src={institutionalQr.qrDataUrl} alt="QR Pix da paróquia" style={{ width: 160, height: 160, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  )}
                </div>
              )}
            </div>
          )}

          <div className="filters-bar">
            {Object.values(selectedIds).some(Boolean) && (
              <button
                className="btn-small success"
                disabled={busyIntent !== null}
                onClick={() => openConfirm(onlineIntents.filter((i) => selectedIds[i.id] && (i.status === 'DECLARED' || i.status === 'CREATED')))}
              >
                ✓ Confirmar selecionados ({Object.values(selectedIds).filter(Boolean).length})
              </button>
            )}
            <select className="filter-select" value={onlineStatus} onChange={(e) => setOnlineStatus(e.target.value)}>
              <option value="DECLARED">Aguardando conferência</option>
              <option value="CREATED">Pix gerados (não informados)</option>
              <option value="CONFIRMED">Confirmados</option>
              <option value="CANCELLED">Cancelados / não localizados</option>
              <option value="ALL">Todos</option>
            </select>
            <button className="btn-small" onClick={() => void fetchOnline()} disabled={onlineLoading}>↻ Atualizar</button>
          </div>

          {onlineLoading && <div className="loading">Carregando...</div>}
          {!onlineLoading && onlineIntents.length === 0 && (
            <p style={{ color: '#666' }}>
              {onlineStatus === 'DECLARED' ? 'Nenhum Pix aguardando conferência.' : 'Nada por aqui.'}
            </p>
          )}
          {!onlineLoading && onlineIntents.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        title="Selecionar todos os aguardando"
                        onChange={(e) => {
                          const next: Record<string, boolean> = {};
                          if (e.target.checked) onlineIntents.filter((i) => i.status === 'DECLARED' || i.status === 'CREATED').forEach((i) => { next[i.id] = true; });
                          setSelectedIds(next);
                        }}
                      />
                    </th>
                    <th>Fiel</th>
                    <th>Comunidade</th>
                    <th>Tipo</th>
                    <th>Referência</th>
                    <th>Valor</th>
                    <th>Identificador (txid)</th>
                    <th>Informado em</th>
                    <th>Situação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {onlineIntents.map((intent) => (
                    <tr key={intent.id}>
                      <td>
                        {(intent.status === 'DECLARED' || intent.status === 'CREATED') && (
                          <input type="checkbox" checked={!!selectedIds[intent.id]} onChange={(e) => setSelectedIds({ ...selectedIds, [intent.id]: e.target.checked })} />
                        )}
                      </td>
                      <td>
                        {intent.member.fullName}
                        {intent.contestNote && <div style={{ fontSize: '0.78rem', color: '#b45309' }}>💬 Contestação: {intent.contestNote}</div>}
                      </td>
                      <td>{intent.member.community ?? '—'}</td>
                      <td>{intent.kind === 'TITHE' ? 'Dízimo' : 'Oferta'}</td>
                      <td>{intent.referenceMonth}</td>
                      <td>
                        {formatBRL(intent.amount)}
                        {intent.amountPaid != null && intent.amountPaid !== intent.amount && (
                          <div style={{ fontSize: '0.78rem', color: '#666' }}>pago {formatBRL(intent.amountPaid)}</div>
                        )}
                      </td>
                      <td><code>{intent.txid}</code></td>
                      <td>{intent.declaredAt ? new Date(intent.declaredAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td>
                        <span className={`status-badge ${INTENT_STATUS[intent.status]?.color ?? 'gray'}`}>{INTENT_STATUS[intent.status]?.label ?? intent.status}</span>
                        {intent.note && intent.status === 'CANCELLED' ? <div style={{ fontSize: '0.75rem', color: '#888' }}>{intent.note}</div> : null}
                      </td>
                      <td className="actions-cell">
                        {(intent.status === 'DECLARED' || intent.status === 'CREATED') && (
                          <>
                            <button className="btn-small success" disabled={busyIntent !== null} onClick={() => openConfirm([intent])}>Confirmar</button>
                            <button className="btn-small" disabled={busyIntent !== null} onClick={() => void rejectIntent(intent)}>Não localizado</button>
                          </>
                        )}
                        {intent.status === 'CANCELLED' && intent.canReopen && (
                          <button className="btn-small" disabled={busyIntent !== null} onClick={() => void reopenIntent(intent)}>Reabrir</button>
                        )}
                        {intent.status === 'CONFIRMED' && intent.member.id && (
                          <button className="btn-small" onClick={() => downloadBlob(`/tithe/intents/${intent.id}/receipt.pdf`, 'comprovante.pdf')}>🧾</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem', marginTop: '1.6rem' }}>Relatório do mês por comunidade</h4>
          <div className="filters-bar">
            <input type="month" className="filter-input" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} />
            <select className="filter-select" value={reportCommunity} onChange={(e) => setReportCommunity(e.target.value)}>
              <option value="">Todas as comunidades do escopo</option>
              {communities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="btn-small" onClick={() => void loadReport()}>Gerar</button>
            <button className="btn-small" onClick={() => downloadBlob('/tithe/report.csv', `dizimo-${reportMonth}.csv`, { referenceMonth: reportMonth, ...(reportCommunity ? { communityId: reportCommunity } : {}) })}>⬇ CSV</button>
          </div>
          {report && (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Comunidade</th><th>Tipo</th><th>Meio</th><th>Qtde</th><th>Total</th></tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={`${r.communityId}-${r.kind}-${r.method}`}><td>{r.community}</td><td>{r.kind}</td><td>{r.method}</td><td>{r.count}</td><td>{formatBRL(r.total)}</td></tr>
                  ))}
                  <tr><td colSpan={3}><strong>Total {report.referenceMonth}</strong></td><td><strong>{report.totals.count}</strong></td><td><strong>{formatBRL(report.totals.total)}</strong></td></tr>
                </tbody>
              </table>
            </div>
          )}

          <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem', marginTop: '1.6rem' }}>Extrato anual do dizimista</h4>
          <div className="filters-bar">
            <select className="filter-select" value={statementMember} onChange={(e) => setStatementMember(e.target.value)}>
              <option value="">Escolha o dizimista...</option>
              {tithers.map((t: any) => (
                <option key={t.id} value={t.member?.id ?? t.memberId}>{t.member?.fullName ?? t.memberId}</option>
              ))}
            </select>
            <input type="number" className="filter-input" style={{ width: 110 }} value={statementYear} onChange={(e) => setStatementYear(e.target.value)} />
            <button className="btn-small" disabled={!statementMember} onClick={() => downloadBlob(`/tithe/tithers/${statementMember}/statement.pdf`, `extrato-${statementYear}.pdf`, { year: statementYear })}>🖨 Extrato (PDF)</button>
          </div>

          {pwdModal && (
            <div className="module-modal-overlay" onClick={() => setPwdModal(false)}>
              <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
                <h2>🔐 Confirmar troca da chave Pix</h2>
                <p style={{ fontSize: '0.88rem', color: '#666' }}>
                  Você está alterando a chave Pix da paróquia. Os Pix ainda não informados serão cancelados e os outros
                  administradores serão avisados. Confirme com a sua senha atual.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!pwd.trim()) {
                      notify.error('Informe sua senha atual');
                      return;
                    }
                    void submitConfig(pwd);
                  }}
                >
                  <div className="form-group">
                    <label>Senha atual</label>
                    <input type="password" autoComplete="current-password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn-cancel" onClick={() => setPwdModal(false)}>Cancelar</button>
                    <button type="submit" className="btn-submit" disabled={savingConfig}>{savingConfig ? 'Salvando...' : 'Confirmar e salvar'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {confirmTargets && (
            <div className="module-modal-overlay" onClick={() => setConfirmTargets(null)}>
              <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
                <h2>Confirmar {confirmTargets.length === 1 ? 'Pix' : `${confirmTargets.length} Pix`}</h2>
                <p style={{ fontSize: '0.85rem', color: '#666' }}>
                  {confirmTargets.length === 1
                    ? `${confirmTargets[0].member.fullName} · ${formatBRL(confirmTargets[0].amount)} · id ${confirmTargets[0].txid}`
                    : 'A mesma data vale para todos; valor pago e mês só podem ser ajustados um a um.'}
                </p>
                <form onSubmit={submitConfirm}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Data em que caiu no extrato *</label>
                      <input type="date" required value={confirmForm.date} onChange={(e) => setConfirmForm({ ...confirmForm, date: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Nº no extrato (opcional)</label>
                      <input type="text" value={confirmForm.receiptNumber} onChange={(e) => setConfirmForm({ ...confirmForm, receiptNumber: e.target.value })} />
                    </div>
                  </div>
                  {confirmTargets.length === 1 && (
                    <div className="form-row">
                      <div className="form-group">
                        <label>Valor que caiu (R$)</label>
                        <input type="number" step="0.01" min="1" value={confirmForm.amountPaid} onChange={(e) => setConfirmForm({ ...confirmForm, amountPaid: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Mês de referência</label>
                        <input type="month" value={confirmForm.referenceMonth} onChange={(e) => setConfirmForm({ ...confirmForm, referenceMonth: e.target.value })} />
                      </div>
                    </div>
                  )}
                  <div className="modal-actions">
                    <button type="button" className="btn-cancel" onClick={() => setConfirmTargets(null)}>Cancelar</button>
                    <button type="submit" className="btn-submit" disabled={busyIntent !== null}>{busyIntent ? 'Confirmando...' : 'Confirmar e lançar'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'tithe' && (
        <>
          <div className="summary-cards">
            <div className="summary-card"><div className="label">Dizimistas cadastrados</div><div className="value">{tithers.length}</div></div>
            <div className="summary-card"><div className="label">Contribuições em {referenceMonth}</div><div className="value">{contributions.length}</div></div>
            <div className="summary-card"><div className="label">Total do mês</div><div className="value positive">{formatBRL(monthTotal)}</div></div>
          </div>

          <div className="filters">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#555' }}>
              Mês de referência:
              <input type="month" className="filter-input" value={referenceMonth} onChange={(e) => setReferenceMonth(e.target.value)} />
            </label>
          </div>

          <div className="detail-section" style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>Contribuições de {referenceMonth}</h4>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Dizimista</th><th>Valor</th><th>Forma</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {contributions.map((c) => (
                    <tr key={c.contributionId}>
                      <td><strong>{c.member.name}</strong></td>
                      <td>{formatBRL(c.amount)}</td>
                      <td>{c.method}</td>
                      <td>{formatDate(c.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {contributions.length === 0 && <div className="empty-state">Nenhuma contribuição lançada neste mês.</div>}
            </div>
          </div>

          <div className="detail-section">
            <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>Dizimistas</h4>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Nome</th><th>Registro/Envelope</th><th>Status</th><th>Contribuições</th></tr>
                </thead>
                <tbody>
                  {tithers.map((tither) => (
                    <tr key={tither.id}>
                      <td><strong>{tither.member.fullName}</strong></td>
                      <td>{tither.registrationNumber || '—'}</td>
                      <td>
                        {tither.status === 'ACTIVE'
                          ? <span className="status-badge green">Ativo</span>
                          : <span className="status-badge gray">Inativo</span>}
                      </td>
                      <td>{tither._count?.contributions ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tithers.length === 0 && <div className="empty-state">Nenhum dizimista cadastrado.</div>}
            </div>
          </div>
        </>
      )}

      {showTxModal && (
        <div className="module-modal-overlay" onClick={() => setShowTxModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Lançamento</h2>
            <form onSubmit={handleCreateTransaction}>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value })}>
                    <option value="INCOME">Receita</option>
                    <option value="EXPENSE">Despesa</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Valor (R$) *</label>
                  <input type="number" step="0.01" min="0.01" required value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Categoria *</label>
                  <input type="text" required placeholder="Ex.: Coleta, Festa, Energia" value={txForm.category} onChange={(e) => setTxForm({ ...txForm, category: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Data *</label>
                  <input type="date" required value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Comunidade (opcional)</label>
                <select value={txForm.communityId} onChange={(e) => setTxForm({ ...txForm, communityId: e.target.value })}>
                  <option value="">Paróquia</option>
                  {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <input type="text" value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowTxModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTitherModal && (
        <div className="module-modal-overlay" onClick={() => setShowTitherModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Cadastrar Dizimista</h2>
            <form onSubmit={handleRegisterTither}>
              <div className="form-group">
                <label>Membro *</label>
                <select required value={titherForm.memberId} onChange={(e) => setTitherForm({ ...titherForm, memberId: e.target.value })}>
                  <option value="">Selecione</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Nº de registro / envelope</label>
                <input type="text" value={titherForm.registrationNumber} onChange={(e) => setTitherForm({ ...titherForm, registrationNumber: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowTitherModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Cadastrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showContributionModal && (
        <div className="module-modal-overlay" onClick={() => setShowContributionModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Lançar Contribuição</h2>
            <form onSubmit={handleAddContribution}>
              <div className="form-group">
                <label>Dizimista *</label>
                <select required value={contributionForm.titherId} onChange={(e) => setContributionForm({ ...contributionForm, titherId: e.target.value })}>
                  <option value="">Selecione</option>
                  {tithers.map((t) => <option key={t.id} value={t.id}>{t.member.fullName}{t.registrationNumber ? ` (${t.registrationNumber})` : ''}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Valor (R$) *</label>
                  <input type="number" step="0.01" min="0.01" required value={contributionForm.amount} onChange={(e) => setContributionForm({ ...contributionForm, amount: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Data *</label>
                  <input type="date" required value={contributionForm.date} onChange={(e) => setContributionForm({ ...contributionForm, date: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Mês de referência *</label>
                  <input type="month" required value={contributionForm.referenceMonth} onChange={(e) => setContributionForm({ ...contributionForm, referenceMonth: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Forma *</label>
                  <select value={contributionForm.method} onChange={(e) => setContributionForm({ ...contributionForm, method: e.target.value })}>
                    {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Nº do recibo (opcional)</label>
                <input type="text" value={contributionForm.receiptNumber} onChange={(e) => setContributionForm({ ...contributionForm, receiptNumber: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowContributionModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Lançar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancePage;
