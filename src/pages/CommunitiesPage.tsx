import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './CommunitiesPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Diocese {
  id: string;
  name: string;
}

interface Parish {
  id: string;
  name: string;
  diocese: Diocese;
}

interface Community {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone?: string;
  email?: string;
  parish: Parish;
  createdAt: string;
}

const CommunitiesPage: React.FC = () => {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [parishes, setParishes] = useState<Parish[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: '',
    parishId: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const [communitiesRes, parishesRes] = await Promise.all([
        axios.get(`${API_URL}/communities`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/parishes`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setCommunities(communitiesRes.data);
      setParishes(parishesRes.data);
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

      if (editingCommunity) {
        await axios.patch(
          `${API_URL}/communities/${editingCommunity.id}`,
          formData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        alert('Comunidade atualizada com sucesso!');
      } else {
        await axios.post(`${API_URL}/communities`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        alert('Comunidade criada com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar comunidade:', error);
      alert(error.response?.data?.message || 'Erro ao salvar comunidade');
    }
  };

  const handleEdit = (community: Community) => {
    setEditingCommunity(community);
    setFormData({
      name: community.name,
      address: community.address,
      city: community.city,
      state: community.state,
      zipCode: community.zipCode,
      phone: community.phone || '',
      email: community.email || '',
      parishId: community.parish.id,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta comunidade?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/communities/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Comunidade excluída com sucesso!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir comunidade:', error);
      alert(error.response?.data?.message || 'Erro ao excluir comunidade');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      phone: '',
      email: '',
      parishId: '',
    });
    setEditingCommunity(null);
  };

  const filteredCommunities = communities.filter((community) =>
    community.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    community.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
    community.parish.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="communities-page">
      <div className="page-header">
        <h1>Comunidades</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Nova Comunidade
        </button>
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Buscar por nome, cidade ou paróquia..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="communities-grid">
        {filteredCommunities.length === 0 ? (
          <p className="no-results">Nenhuma comunidade encontrada.</p>
        ) : (
          filteredCommunities.map((community) => (
            <div key={community.id} className="community-card">
              <div className="card-header">
                <h3>{community.name}</h3>
                <div className="badges">
                  <span className="parish-badge">{community.parish.name}</span>
                  <span className="diocese-badge">{community.parish.diocese.name}</span>
                </div>
              </div>
              <div className="card-body">
                <p><strong>📍 Cidade:</strong> {community.city} - {community.state}</p>
                <p><strong>🏠 Endereço:</strong> {community.address}</p>
                <p><strong>📮 CEP:</strong> {community.zipCode}</p>
                {community.phone && <p><strong>📞 Telefone:</strong> {community.phone}</p>}
                {community.email && <p><strong>📧 Email:</strong> {community.email}</p>}
              </div>
              <div className="card-actions">
                <button className="btn-edit" onClick={() => handleEdit(community)}>
                  Editar
                </button>
                <button className="btn-delete" onClick={() => handleDelete(community.id)}>
                  Excluir
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingCommunity ? 'Editar Comunidade' : 'Nova Comunidade'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nome *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Paróquia *</label>
                <select
                  required
                  value={formData.parishId}
                  onChange={(e) => setFormData({ ...formData, parishId: e.target.value })}
                >
                  <option value="">Selecione uma paróquia</option>
                  {parishes.map((parish) => (
                    <option key={parish.id} value={parish.id}>
                      {parish.name} - {parish.diocese.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Endereço *</label>
                <input
                  type="text"
                  required
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Cidade *</label>
                  <input
                    type="text"
                    required
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Estado *</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>CEP *</label>
                <input
                  type="text"
                  required
                  value={formData.zipCode}
                  onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Telefone</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => { setShowModal(false); resetForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-submit">
                  {editingCommunity ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommunitiesPage;
