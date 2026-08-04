import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { notify, confirm } from '../../services/notification.service';
import { initials } from '../../components/SaintAvatar';
import './PastoralsPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface GlobalPastoral {
  id: string;
  name: string;
  description?: string;
  mission?: string;
  iconUrl?: string;
  colorHex?: string;
  status: string;
  createdAt: string;
}

const GlobalPastoralsPage: React.FC = () => {
  const [pastorals, setPastorals] = useState<GlobalPastoral[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPastoral, setEditingPastoral] = useState<GlobalPastoral | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    mission: '',
    iconUrl: '',
    colorHex: '#075AA9',
    status: 'ACTIVE',
  });

  useEffect(() => {
    fetchPastorals();
  }, []);

  const fetchPastorals = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/pastorals/global`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPastorals(response.data);
    } catch (error) {
      console.error('Erro ao carregar pastorais globais:', error);
      notify.error('Erro ao carregar pastorais globais');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const url = editingPastoral
        ? `${API_URL}/pastorals/global/${editingPastoral.id}`
        : `${API_URL}/pastorals/global`;
      
      const method = editingPastoral ? 'patch' : 'post';

      await axios[method](url, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });

      notify.success(editingPastoral ? 'Pastoral atualizada com sucesso!' : 'Pastoral criada com sucesso!');
      setShowModal(false);
      resetForm();
      fetchPastorals();
    } catch (error: any) {
      console.error('Erro ao salvar pastoral:', error);
      notify.error(error.response?.data?.message || 'Erro ao salvar pastoral');
    }
  };

  const handleEdit = (pastoral: GlobalPastoral) => {
    setEditingPastoral(pastoral);
    setFormData({
      name: pastoral.name,
      description: pastoral.description || '',
      mission: pastoral.mission || '',
      iconUrl: pastoral.iconUrl || '',
      colorHex: pastoral.colorHex || '#075AA9',
      status: pastoral.status,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm.delete('esta pastoral global');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/pastorals/global/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Pastoral excluída com sucesso!');
      fetchPastorals();
    } catch (error: any) {
      console.error('Erro ao excluir pastoral:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir pastoral');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      mission: '',
      iconUrl: '',
      colorHex: '#075AA9',
      status: 'ACTIVE',
    });
    setEditingPastoral(null);
  };

  const filteredPastorals = pastorals.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="pastorals-page">
      <div className="page-header">
        <h1>📋 Pastorais Globais</h1>
        <p>Cadastro global de pastorais (apenas SYSTEM_ADMIN)</p>
      </div>

      <div className="actions-bar">
        <input
          type="text"
          placeholder="🔍 Buscar pastoral..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="btn-primary"
        >
          + Nova Pastoral Global
        </button>
      </div>

      <div className="pastorals-grid">
        {filteredPastorals.map((pastoral) => (
          <div
            key={pastoral.id}
            className="entity-card"
            style={{ borderLeft: `4px solid ${pastoral.colorHex || '#075AA9'}` }}
          >
            <div className="entity-card-header">
              <div className="entity-monogram" style={{ background: pastoral.colorHex || '#075AA9' }}>
                {initials(pastoral.name)}
              </div>
              <div className="entity-heading">
                <h3 className="entity-title">{pastoral.name}</h3>
                <div className="entity-chips">
                  <span className={`status-badge ${pastoral.status === 'ACTIVE' ? 'green' : 'gray'}`}>
                    {pastoral.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              </div>
            </div>

            <div className="entity-card-body">
              {pastoral.description && (
                <p style={{ margin: '0 0 0.5rem 0', color: '#5a6a7a', fontSize: '0.9rem' }}>{pastoral.description}</p>
              )}
              {pastoral.mission && (
                <div className="entity-field">
                  <span className="entity-field-label">Missão</span>
                  <span className="entity-field-value">{pastoral.mission}</span>
                </div>
              )}
            </div>

            <div className="entity-card-footer">
              <button onClick={() => handleEdit(pastoral)} className="entity-btn primary">
                Editar
              </button>
              <button onClick={() => handleDelete(pastoral.id)} className="entity-btn danger">
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredPastorals.length === 0 && (
        <div className="empty-state">
          <p>Nenhuma pastoral global encontrada.</p>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingPastoral ? 'Editar Pastoral Global' : 'Nova Pastoral Global'}</h2>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nome *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
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
                  <label>Cor</label>
                  <input
                    type="color"
                    value={formData.colorHex}
                    onChange={(e) => setFormData({ ...formData, colorHex: e.target.value })}
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

export default GlobalPastoralsPage;
