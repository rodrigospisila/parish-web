import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import './CommunitiesPage.css';

interface Parish {
  id: string;
  name: string;
}

interface Community {
  id: string;
  name: string;
  coordinatorName?: string;
  email?: string;
  phone?: string;
  status: string;
  parishId: string;
  parish?: Parish;
}

export const CommunitiesPage: React.FC = () => {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [parishes, setParishes] = useState<Parish[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    coordinatorName: '',
    phone: '',
    email: '',
    parishId: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [communitiesRes, parishesRes] = await Promise.all([
        api.get('/communities'),
        api.get('/parishes'),
      ]);
      setCommunities(communitiesRes.data);
      setParishes(parishesRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.parishId) {
      alert('Selecione uma paróquia');
      return;
    }
    
    try {
      if (editingCommunity) {
        await api.patch(`/communities/${editingCommunity.id}`, formData);
        alert('Comunidade atualizada!');
      } else {
        await api.post('/communities', formData);
        alert('Comunidade criada!');
      }
      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Erro ao salvar');
    }
  };

  const handleEdit = (community: Community) => {
    setEditingCommunity(community);
    setFormData({
      name: community.name,
      description: '',
      coordinatorName: community.coordinatorName || '',
      phone: community.phone || '',
      email: community.email || '',
      parishId: community.parishId,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta comunidade?')) return;
    try {
      await api.delete(`/communities/${id}`);
      fetchData();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Erro ao excluir');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      coordinatorName: '',
      phone: '',
      email: '',
      parishId: '',
    });
    setEditingCommunity(null);
  };

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="communities-page">
      <div className="page-header">
        <h1>Comunidades</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Nova Comunidade
        </button>
      </div>

      <div className="communities-grid">
        {communities.map((community) => (
          <div key={community.id} className="community-card">
            <div className="card-header">
              <h3>{community.name}</h3>
              <span className={`status ${community.status.toLowerCase()}`}>
                {community.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
              </span>
            </div>
            <div className="card-body">
              <p><strong>Coordenador:</strong> {community.coordinatorName || 'Não informado'}</p>
              <p><strong>Paróquia:</strong> {community.parish?.name || 'N/A'}</p>
              {community.email && <p><strong>Email:</strong> {community.email}</p>}
              {community.phone && <p><strong>Telefone:</strong> {community.phone}</p>}
            </div>
            <div className="card-actions">
              <button className="btn-edit" onClick={() => handleEdit(community)}>Editar</button>
              <button className="btn-delete" onClick={() => handleDelete(community.id)}>Excluir</button>
            </div>
          </div>
        ))}
      </div>

      {communities.length === 0 && (
        <div className="empty-state">
          <p>Nenhuma comunidade cadastrada.</p>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            Cadastrar primeira comunidade
          </button>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingCommunity ? 'Editar Comunidade' : 'Nova Comunidade'}</h2>
              <button className="btn-close" onClick={() => { setShowModal(false); resetForm(); }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Paróquia *</label>
                <select value={formData.parishId} onChange={(e) => setFormData({ ...formData, parishId: e.target.value })} required>
                  <option value="">Selecione</option>
                  {parishes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Nome *</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} />
              </div>
              <div className="form-group">
                <label>Coordenador</label>
                <input type="text" value={formData.coordinatorName} onChange={(e) => setFormData({ ...formData, coordinatorName: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Telefone</label>
                  <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); resetForm(); }}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingCommunity ? 'Atualizar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

