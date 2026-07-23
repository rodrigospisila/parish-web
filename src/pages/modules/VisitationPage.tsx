import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import './ModulePages.css';

interface VisitRequestRow {
  id: string;
  personName?: string | null;
  memberId?: string | null;
  reason: string;
  status: string;
  communityPastoralId?: string | null;
  createdAt: string;
}

interface Visit {
  id: string;
  date: string;
  notes?: string | null;
  visitorMemberIds?: string | null;
}

interface VisitRequestDetail extends VisitRequestRow {
  address?: string | null;
  contactPhone?: string | null;
  visits: Visit[];
}

interface Community {
  id: string;
  name: string;
}

interface CommunityPastoral {
  id: string;
  globalPastoral?: { name: string } | null;
}

interface Member {
  id: string;
  fullName: string;
}

const REASONS: Record<string, string> = {
  SICK: 'Enfermo',
  ELDERLY: 'Idoso',
  BEREAVEMENT: 'Luto',
  OTHER: 'Outro',
};

const REQUEST_STATUS: Record<string, { label: string; color: string }> = {
  OPEN: { label: 'Aberto', color: 'yellow' },
  SCHEDULED: { label: 'Agendado', color: 'blue' },
  DONE: { label: 'Realizado', color: 'green' },
  CANCELLED: { label: 'Cancelado', color: 'gray' },
};

const VisitationPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<VisitRequestRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [pastorals, setPastorals] = useState<CommunityPastoral[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [detail, setDetail] = useState<VisitRequestDetail | null>(null);
  const [detailForbidden, setDetailForbidden] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    communityId: '',
    communityPastoralId: '',
    memberId: '',
    personName: '',
    address: '',
    contactPhone: '',
    reason: 'SICK',
    consentGiven: false,
  });

  const [showVisitModal, setShowVisitModal] = useState(false);
  const [visitForm, setVisitForm] = useState({ date: '', notes: '', visitorMemberIds: [] as string[] });

  const fetchData = useCallback(async () => {
    try {
      const [requestsRes, communitiesRes, membersRes] = await Promise.all([
        api.get('/visitation/requests', { params: { status: statusFilter || undefined } }),
        api.get('/communities'),
        api.get('/members'),
      ]);
      setRequests(requestsRes.data);
      setCommunities(communitiesRes.data);
      setMembers(membersRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar pedidos de visita'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!createForm.communityId) {
      setPastorals([]);
      return;
    }
    api
      .get('/pastorals/community', { params: { communityId: createForm.communityId } })
      .then((res) => setPastorals(res.data))
      .catch(() => setPastorals([]));
  }, [createForm.communityId]);

  const openDetail = async (id: string) => {
    setDetailForbidden(false);
    try {
      const res = await api.get(`/visitation/requests/${id}`);
      setDetail(res.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        setDetail(null);
        setDetailForbidden(true);
      } else {
        notify.error(getErrorMessage(error, 'Erro ao carregar o pedido'));
      }
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.consentGiven) {
      notify.warning('O consentimento da pessoa (ou responsável) é obrigatório.');
      return;
    }
    try {
      await api.post('/visitation/requests', {
        communityId: createForm.communityId,
        communityPastoralId: createForm.communityPastoralId || undefined,
        memberId: createForm.memberId || undefined,
        personName: createForm.personName || undefined,
        address: createForm.address || undefined,
        contactPhone: createForm.contactPhone || undefined,
        reason: createForm.reason,
        consentGiven: createForm.consentGiven,
      });
      notify.success('Pedido de visita registrado!');
      setShowCreateModal(false);
      setCreateForm({ communityId: '', communityPastoralId: '', memberId: '', personName: '', address: '', contactPhone: '', reason: 'SICK', consentGiven: false });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar pedido'));
    }
  };

  const handleRegisterVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    try {
      await api.post(`/visitation/requests/${detail.id}/visits`, {
        date: new Date(visitForm.date).toISOString(),
        notes: visitForm.notes || undefined,
        visitorMemberIds: visitForm.visitorMemberIds.length ? visitForm.visitorMemberIds : undefined,
      });
      notify.success('Visita registrada!');
      setShowVisitModal(false);
      setVisitForm({ date: '', notes: '', visitorMemberIds: [] });
      openDetail(detail.id);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar visita'));
    }
  };

  const personLabel = (row: VisitRequestRow) =>
    row.personName || members.find((m) => m.id === row.memberId)?.fullName || 'Pessoa';

  const visitorNames = (ids?: string | null) => {
    if (!ids) return '—';
    return ids
      .split(',')
      .map((id) => members.find((m) => m.id === id)?.fullName ?? 'Visitador')
      .join(', ');
  };

  const formatDate = (value: string) => new Date(value).toLocaleDateString('pt-BR');

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1>🏠 Visitação e Enfermos</h1>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>+ Pedido de Visita</button>
        </div>
      </div>

      <div className="privacy-note">
        🔒 As anotações das visitas são restritas ao coordenador da pastoral responsável e aos visitadores designados.
        O registro do pedido exige o consentimento da pessoa visitada (ou responsável) — LGPD.
      </div>

      <div className="filters">
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(REQUEST_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
        </select>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Motivo</th>
              <th>Status</th>
              <th>Solicitado em</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((row) => {
              const st = REQUEST_STATUS[row.status] ?? { label: row.status, color: 'gray' };
              return (
                <tr key={row.id}>
                  <td><strong>{personLabel(row)}</strong></td>
                  <td>{REASONS[row.reason] ?? row.reason}</td>
                  <td><span className={`status-badge ${st.color}`}>{st.label}</span></td>
                  <td>{formatDate(row.createdAt)}</td>
                  <td className="actions-cell">
                    <button className="btn-small" onClick={() => openDetail(row.id)}>Acompanhamento</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {requests.length === 0 && <div className="empty-state">Nenhum pedido de visita.</div>}
      </div>

      {detailForbidden && (
        <div className="detail-panel">
          <div className="privacy-note" style={{ marginBottom: 0 }}>
            🔒 <strong>Acesso restrito.</strong> As anotações deste acompanhamento são visíveis apenas ao coordenador
            da pastoral responsável e aos visitadores designados. Este acesso é auditado.
          </div>
        </div>
      )}

      {detail && (
        <div className="detail-panel">
          <h2>Acompanhamento — {personLabel(detail)}</h2>
          <div className="detail-section">
            <div className="inline-form">
              <button className="btn-small success" onClick={() => setShowVisitModal(true)}>+ Registrar visita</button>
              <button className="btn-small" onClick={() => setDetail(null)}>Fechar</button>
            </div>
          </div>
          {(detail.address || detail.contactPhone) && (
            <div className="detail-section">
              {detail.address && <p><strong>Endereço:</strong> {detail.address}</p>}
              {detail.contactPhone && <p><strong>Contato:</strong> {detail.contactPhone}</p>}
            </div>
          )}
          <div className="detail-section">
            <h4>Visitas realizadas</h4>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Data</th><th>Visitadores</th><th>Anotações (restritas)</th></tr>
                </thead>
                <tbody>
                  {detail.visits.map((visit) => (
                    <tr key={visit.id}>
                      <td>{formatDate(visit.date)}</td>
                      <td>{visitorNames(visit.visitorMemberIds)}</td>
                      <td>{visit.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.visits.length === 0 && <div className="empty-state">Nenhuma visita registrada ainda.</div>}
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="module-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Pedido de Visita</h2>
            <form onSubmit={handleCreate}>
              <div className="form-row">
                <div className="form-group">
                  <label>Comunidade *</label>
                  <select required value={createForm.communityId} onChange={(e) => setCreateForm({ ...createForm, communityId: e.target.value, communityPastoralId: '' })}>
                    <option value="">Selecione</option>
                    {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Pastoral responsável</label>
                  <select value={createForm.communityPastoralId} onChange={(e) => setCreateForm({ ...createForm, communityPastoralId: e.target.value })}>
                    <option value="">A definir</option>
                    {pastorals.map((p) => <option key={p.id} value={p.id}>{p.globalPastoral?.name ?? 'Pastoral'}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Membro cadastrado (se houver)</label>
                <select value={createForm.memberId} onChange={(e) => setCreateForm({ ...createForm, memberId: e.target.value })}>
                  <option value="">Não é membro cadastrado</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              {!createForm.memberId && (
                <div className="form-group">
                  <label>Nome da pessoa *</label>
                  <input
                    type="text"
                    required={!createForm.memberId}
                    value={createForm.personName}
                    onChange={(e) => setCreateForm({ ...createForm, personName: e.target.value })}
                  />
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Motivo *</label>
                  <select value={createForm.reason} onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}>
                    {Object.entries(REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Telefone de contato</label>
                  <input type="text" value={createForm.contactPhone} onChange={(e) => setCreateForm({ ...createForm, contactPhone: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Endereço</label>
                <input type="text" value={createForm.address} onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })} />
              </div>
              <label className="form-check">
                <input
                  type="checkbox"
                  checked={createForm.consentGiven}
                  onChange={(e) => setCreateForm({ ...createForm, consentGiven: e.target.checked })}
                />
                Declaro que a pessoa visitada (ou seu responsável) consentiu com o registro destes dados
                e com o acompanhamento pastoral. *
              </label>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={!createForm.consentGiven}>Registrar pedido</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVisitModal && detail && (
        <div className="module-modal-overlay" onClick={() => setShowVisitModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Registrar visita — {personLabel(detail)}</h2>
            <form onSubmit={handleRegisterVisit}>
              <div className="form-group">
                <label>Data da visita *</label>
                <input type="date" required value={visitForm.date} onChange={(e) => setVisitForm({ ...visitForm, date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Visitadores</label>
                <select
                  multiple
                  size={5}
                  value={visitForm.visitorMemberIds}
                  onChange={(e) =>
                    setVisitForm({
                      ...visitForm,
                      visitorMemberIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                    })
                  }
                >
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Anotações (visíveis só à pastoral)</label>
                <textarea rows={4} value={visitForm.notes} onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowVisitModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default VisitationPage;
