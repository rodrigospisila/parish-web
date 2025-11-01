import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './ParishesPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Diocese {
  id: string;
  name: string;
}

interface Parish {
  id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  zipCode: string;
  phone?: string;
  email?: string;
  diocese: Diocese;
  createdAt: string;
}

const ParishesPage: React.FC = () => {
  const [parishes, setParishes] = useState<Parish[]>([]);
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingParish, setEditingParish] = useState<Parish | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState<string>('');

  const [formData, setFormData] = useState({
    name: '',
    city: '',
    state: '',
    address: '',
    zipCode: '',
    phone: '',
    email: '',
    dioceseId: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        setCurrentUserRole(user.role);
      }
      const [parishesRes, diocesesRes] = await Promise.all([
        axios.get(`${API_URL}/parishes`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/dioceses`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setParishes(parishesRes.data);
      setDioceses(diocesesRes.data);
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

      if (editingParish) {
        await axios.patch(
          `${API_URL}/parishes/${editingParish.id}`,
          formData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        alert('Paróquia atualizada com sucesso!');
      } else {
        await axios.post(`${API_URL}/parishes`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        alert('Paróquia criada com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar paróquia:', error);
      alert(error.response?.data?.message || 'Erro ao salvar paróquia');
    }
  };

  const handleEdit = (parish: Parish) => {
    setEditingParish(parish);
    setFormData({
      name: parish.name,
      city: parish.city,
      state: parish.state,
      address: parish.address,
      zipCode: parish.zipCode,
      phone: parish.phone || '',
      email: parish.email || '',
      dioceseId: parish.diocese.id,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta paróquia?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/parishes/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Paróquia excluída com sucesso!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir paróquia:', error);
      alert(error.response?.data?.message || 'Erro ao excluir paróquia');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      city: '',
      state: '',
      address: '',
      zipCode: '',
      phone: '',
      email: '',
      dioceseId: '',
    });
    setEditingParish(null);
  };

  const filteredParishes = parishes.filter((parish) =>
    parish.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    parish.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
    parish.diocese.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="parishes-page">
      <div className="page-header">
        <h1>Paróquias</h1>
        {currentUserRole !== 'PARISH_ADMIN' && (
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            + Nova Paróquia
          </button>
        )}
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Buscar por nome, cidade ou diocese..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="parishes-grid">
        {filteredParishes.length === 0 ? (
          <p className="no-results">Nenhuma paróquia encontrada.</p>
        ) : (
          filteredParishes.map((parish) => (
            <div key={parish.id} className="parish-card">
              <div className="card-header">
                <h3>{parish.name}</h3>
                <span className="diocese-badge">{parish.diocese.name}</span>
              </div>
              <div className="card-body">
                <p><strong>📍 Cidade:</strong> {parish.city} - {parish.state}</p>
                <p><strong>🏠 Endereço:</strong> {parish.address}</p>
                <p><strong>📮 CEP:</strong> {parish.zipCode}</p>
                {parish.phone && <p><strong>📞 Telefone:</strong> {parish.phone}</p>}
                {parish.email && <p><strong>📧 Email:</strong> {parish.email}</p>}
              </div>
              <div className="card-actions">
                <button className="btn-edit" onClick={() => handleEdit(parish)}>
                  Editar
                </button>
                <button className="btn-delete" onClick={() => handleDelete(parish.id)}>
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
            <h2>{editingParish ? 'Editar Paróquia' : 'Nova Paróquia'}</h2>
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
                <label>Diocese *</label>
                <select
                  required
                  value={formData.dioceseId}
                  onChange={(e) => setFormData({ ...formData, dioceseId: e.target.value })}
                >
                  <option value="">Selecione uma diocese</option>
                  {dioceses.map((diocese) => (
                    <option key={diocese.id} value={diocese.id}>
                      {diocese.name}
                    </option>
                  ))}
                </select>
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
                <label>Endereço *</label>
                <input
                  type="text"
                  required
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
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
                  {editingParish ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ParishesPage;
