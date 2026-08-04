import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
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

const FinancePage: React.FC = () => {
  const [tab, setTab] = useState<'transactions' | 'tithe'>('transactions');
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
