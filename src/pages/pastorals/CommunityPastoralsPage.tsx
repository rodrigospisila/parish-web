import React, { useState, useEffect } from 'react';
import TitleIcon from '../../components/TitleIcon';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { notify, confirm } from '../../services/notification.service';
import { initials } from '../../components/SaintAvatar';
import './PastoralsPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface GlobalPastoral {
  id: string;
  name: string;
  colorHex?: string;
}

interface Parish {
  id: string;
  name: string;
}

interface Community {
  id: string;
  name: string;
  parish?: Parish;
}

interface CommunityPastoral {
  id: string;
  description?: string;
  mission?: string;
  photoUrl?: string;
  notes?: string;
  foundedAt?: string;
  status: string;
  globalPastoral: GlobalPastoral;
  community: Community;
  members: any[];
  subGroups: any[];
}

const CommunityPastoralsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [pastorals, setPastorals] = useState<CommunityPastoral[]>([]);
  const [globalPastorals, setGlobalPastorals] = useState<GlobalPastoral[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPastoral, setEditingPastoral] = useState<CommunityPastoral | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCommunity, setFilterCommunity] = useState('');

  const [formData, setFormData] = useState({
    globalPastoralId: '',
    communityId: '',
    description: '',
    mission: '',
    photoUrl: '',
    notes: '',
    foundedAt: '',
    status: 'ACTIVE',
  });

  // Verificar se o usuário pode gerenciar pastorais
  const canManagePastorals = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR', 'PASTORAL_COORDINATOR'].includes(currentUser?.role || '');

  // Filtrar comunidades disponíveis baseado no role
  const scopedCommunities = communities.filter((community) => {
    if (currentUser?.role === 'COMMUNITY_COORDINATOR') {
      return community.id === currentUser.communityId;
    }
    if (currentUser?.role === 'PASTORAL_COORDINATOR') {
      return community.id === currentUser.communityId;
    }
    return true;
  });

  // Filtrar pastorais disponíveis baseado no role
  const scopedPastorals = pastorals.filter((pastoral) => {
    if (currentUser?.role === 'PASTORAL_COORDINATOR' && currentUser.pastoralIds?.length) {
      return currentUser.pastoralIds.includes(pastoral.id);
    }
    if (currentUser?.role === 'COMMUNITY_COORDINATOR') {
      return pastoral.community.id === currentUser.communityId;
    }
    return true;
  });

  useEffect(() => {
    fetchData();
  }, [filterCommunity]);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      const [pastoralsRes, globalRes, communitiesRes] = await Promise.all([
        axios.get(
          `${API_URL}/pastorals/community${filterCommunity ? `?communityId=${filterCommunity}` : ''}`,
          { headers }
        ),
        axios.get(`${API_URL}/pastorals/global`, { headers }),
        axios.get(`${API_URL}/communities`, { headers }),
      ]);

      setPastorals(pastoralsRes.data);
      setGlobalPastorals(globalRes.data);
      setCommunities(communitiesRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      notify.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canManagePastorals) {
      notify.error('Você não tem permissão para gerenciar pastorais');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const url = editingPastoral
        ? `${API_URL}/pastorals/community/${editingPastoral.id}`
        : `${API_URL}/pastorals/community`;

      const method = editingPastoral ? 'patch' : 'post';

      // Campos opcionais vazios viram null (o backend rejeita '' em foundedAt;
      // null passa no @IsOptional e limpa o campo na edição)
      const payload = {
        globalPastoralId: formData.globalPastoralId,
        communityId: formData.communityId,
        status: formData.status,
        description: formData.description.trim() || null,
        mission: formData.mission.trim() || null,
        photoUrl: formData.photoUrl.trim() || null,
        notes: formData.notes.trim() || null,
        foundedAt: formData.foundedAt || null,
      };

      await axios[method](url, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      notify.success(editingPastoral ? 'Pastoral atualizada!' : 'Pastoral criada!');
      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar pastoral:', error);
      notify.error(error.response?.data?.message || 'Erro ao salvar pastoral');
    }
  };

  const handleEdit = (pastoral: CommunityPastoral) => {
    setEditingPastoral(pastoral);
    setFormData({
      globalPastoralId: pastoral.globalPastoral.id,
      communityId: pastoral.community.id,
      description: pastoral.description || '',
      mission: pastoral.mission || '',
      photoUrl: pastoral.photoUrl || '',
      notes: pastoral.notes || '',
      foundedAt: pastoral.foundedAt ? pastoral.foundedAt.split('T')[0] : '',
      status: pastoral.status,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm.delete('esta pastoral');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/pastorals/community/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Pastoral excluída!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir pastoral:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir pastoral');
    }
  };

  const resetForm = () => {
    setFormData({
      globalPastoralId: '',
      communityId: '',
      description: '',
      mission: '',
      photoUrl: '',
      notes: '',
      foundedAt: '',
      status: 'ACTIVE',
    });
    setEditingPastoral(null);
  };

  const filteredPastorals = scopedPastorals.filter((p) =>
    p.globalPastoral.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.community.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading">Carregando...</div>;

  if (!canManagePastorals) {
    return (
      <div className="pastorals-page">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ color: '#e74c3c' }}>Acesso Negado</h2>
          <p>Você não tem permissão para acessar esta página.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pastorals-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="pastoral" /> Pastorais Comunitárias</h1>
        <p>Gestão de pastorais nas comunidades</p>
      </div>

      <div className="actions-bar">
        <input
          type="text"
          placeholder="🔍 Buscar pastoral ou comunidade..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <select
          value={filterCommunity}
          onChange={(e) => setFilterCommunity(e.target.value)}
          className="search-input"
          style={{ flex: '0 0 300px' }}
        >
          <option value="">Todas as Comunidades</option>
          {scopedCommunities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parish ? `${c.parish.name} › ${c.name}` : c.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="btn-primary"
          disabled={currentUser?.role === 'PASTORAL_COORDINATOR'}
          title={currentUser?.role === 'PASTORAL_COORDINATOR' ? 'Coordenadores de pastoral não podem criar novas pastorais' : ''}
        >
          + Nova Pastoral
        </button>
      </div>

      <div className="pastorals-grid">
        {filteredPastorals.map((pastoral) => (
          <div
            key={pastoral.id}
            className="entity-card"
            style={{ borderLeft: `4px solid ${pastoral.globalPastoral.colorHex || '#075AA9'}` }}
          >
            <div className="entity-card-header">
              <div className="entity-monogram" style={{ background: pastoral.globalPastoral.colorHex || '#075AA9' }}>
                {initials(pastoral.globalPastoral.name)}
              </div>
              <div className="entity-heading">
                <h3 className="entity-title">{pastoral.globalPastoral.name}</h3>
                <div className="entity-chips">
                  <span className="entity-chip soft-blue">{pastoral.community.name}</span>
                  <span className={`status-badge ${pastoral.status === 'ACTIVE' ? 'green' : 'gray'}`}>
                    {pastoral.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              </div>
            </div>

            <div className="entity-card-body">
              <div className="entity-field">
                <span className="entity-field-label">Membros</span>
                <span className="entity-field-value">{pastoral.members.length}</span>
              </div>
              {pastoral.subGroups.length > 0 && (
                <div className="entity-field">
                  <span className="entity-field-label">Sub-grupos</span>
                  <span className="entity-field-value">{pastoral.subGroups.length}</span>
                </div>
              )}
              {pastoral.foundedAt && (
                <div className="entity-field">
                  <span className="entity-field-label">Fundada em</span>
                  <span className="entity-field-value">{new Date(pastoral.foundedAt).toLocaleDateString('pt-BR')}</span>
                </div>
              )}
              {pastoral.description && (
                <p style={{ margin: '0.5rem 0 0 0', color: '#5a6a7a', fontSize: '0.9rem' }}>{pastoral.description}</p>
              )}
            </div>

            <div className="entity-card-footer">
              <button onClick={() => navigate(`/admin/pastorals/community/${pastoral.id}`)} className="entity-btn accent">
                Ver Detalhes
              </button>
              <button
                onClick={() => handleEdit(pastoral)}
                className="entity-btn primary"
                disabled={currentUser?.role === 'PASTORAL_COORDINATOR'}
                title={currentUser?.role === 'PASTORAL_COORDINATOR' ? 'Coordenadores de pastoral não podem editar pastorais' : ''}
              >
                Editar
              </button>
              <button
                onClick={() => handleDelete(pastoral.id)}
                className="entity-btn danger"
                disabled={currentUser?.role === 'PASTORAL_COORDINATOR'}
                title={currentUser?.role === 'PASTORAL_COORDINATOR' ? 'Coordenadores de pastoral não podem excluir pastorais' : ''}
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredPastorals.length === 0 && (
        <div className="empty-state">
          <p>Nenhuma pastoral encontrada.</p>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingPastoral ? 'Editar Pastoral' : 'Nova Pastoral'}</h2>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Pastoral Global *</label>
                <select
                  value={formData.globalPastoralId}
                  onChange={(e) => setFormData({ ...formData, globalPastoralId: e.target.value })}
                  required
                  disabled={!!editingPastoral}
                >
                  <option value="">Selecione...</option>
                  {globalPastorals.map((gp) => (
                    <option key={gp.id} value={gp.id}>
                      {gp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Comunidade *</label>
                <select
                  value={formData.communityId}
                  onChange={(e) => setFormData({ ...formData, communityId: e.target.value })}
                  required
                  disabled={!!editingPastoral}
                >
                  <option value="">Selecione...</option>
                  {communities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parish ? `${c.parish.name} › ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Missão</label>
                <textarea
                  value={formData.mission}
                  onChange={(e) => setFormData({ ...formData, mission: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Data de Fundação</label>
                  <input
                    type="date"
                    value={formData.foundedAt}
                    onChange={(e) => setFormData({ ...formData, foundedAt: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="ACTIVE">Ativo</option>
                    <option value="INACTIVE">Inativo</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Observações</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="btn-secondary"
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editingPastoral ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommunityPastoralsPage;
