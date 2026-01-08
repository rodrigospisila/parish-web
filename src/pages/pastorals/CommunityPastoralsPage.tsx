import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
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
      alert('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const url = editingPastoral
        ? `${API_URL}/pastorals/community/${editingPastoral.id}`
        : `${API_URL}/pastorals/community`;

      const method = editingPastoral ? 'patch' : 'post';

      await axios[method](url, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });

      alert(editingPastoral ? 'Pastoral atualizada!' : 'Pastoral criada!');
      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar pastoral:', error);
      alert(error.response?.data?.message || 'Erro ao salvar pastoral');
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
    if (!window.confirm('Tem certeza que deseja excluir esta pastoral?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/pastorals/community/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Pastoral excluída!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir pastoral:', error);
      alert(error.response?.data?.message || 'Erro ao excluir pastoral');
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

  const filteredPastorals = pastorals.filter((p) =>
    p.globalPastoral.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.community.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="pastorals-page">
      <div className="page-header">
        <h1>⛪ Pastorais Comunitárias</h1>
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
          {communities.map((c) => (
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
        >
          + Nova Pastoral
        </button>
      </div>

      <div className="pastorals-grid">
        {filteredPastorals.map((pastoral) => (
          <div
            key={pastoral.id}
            className="pastoral-card"
            style={{ borderLeft: `4px solid ${pastoral.globalPastoral.colorHex || '#3498db'}` }}
          >
            <div className="pastoral-header">
              <h3>{pastoral.globalPastoral.name}</h3>
              <span className={`status-badge ${pastoral.status.toLowerCase()}`}>
                {pastoral.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            <div className="pastoral-info">
              <div className="pastoral-info-item">
                <strong>⛪</strong> {pastoral.community.name}
              </div>
              {pastoral.foundedAt && (
                <div className="pastoral-info-item">
                  <strong>📅</strong> Fundada em:{' '}
                  {new Date(pastoral.foundedAt).toLocaleDateString('pt-BR')}
                </div>
              )}
              <div className="pastoral-info-item">
                <strong>👥</strong> {pastoral.members.length} membros
              </div>
              {pastoral.subGroups.length > 0 && (
                <div className="pastoral-info-item">
                  <strong>📂</strong> {pastoral.subGroups.length} sub-grupos
                </div>
              )}
            </div>

            {pastoral.description && (
              <p className="pastoral-description">{pastoral.description}</p>
            )}

            <div className="pastoral-actions">
              <button onClick={() => navigate(`/admin/pastorals/community/${pastoral.id}`)} className="btn-view">
                Ver Detalhes
              </button>
              <button onClick={() => handleEdit(pastoral)} className="btn-edit">
                Editar
              </button>
              <button onClick={() => handleDelete(pastoral.id)} className="btn-delete">
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
