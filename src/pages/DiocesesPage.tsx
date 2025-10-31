import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './DiocesesPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Diocese {
  id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  zipCode: string;
  phone?: string;
  email?: string;
  createdAt: string;
}

const DiocesesPage: React.FC = () => {
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDiocese, setEditingDiocese] = useState<Diocese | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    city: '',
    state: '',
    address: '',
    zipCode: '',
    phone: '',
    email: '',
  });

  useEffect(() => {
    fetchDioceses();
  }, []);

  const fetchDioceses = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/dioceses`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDioceses(response.data);
    } catch (error) {
      console.error('Erro ao carregar dioceses:', error);
      alert('Erro ao carregar dioceses');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem('token');

      if (editingDiocese) {
        await axios.patch(
          `${API_URL}/dioceses/${editingDiocese.id}`,
          formData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        alert('Diocese atualizada com sucesso!');
      } else {
        await axios.post(`${API_URL}/dioceses`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        alert('Diocese criada com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchDioceses();
    } catch (error: any) {
      console.error('Erro ao salvar diocese:', error);
      alert(error.response?.data?.message || 'Erro ao salvar diocese');
    }
  };

  const handleEdit = (diocese: Diocese) => {
    setEditingDiocese(diocese);
    setFormData({
      name: diocese.name,
      city: diocese.city,
      state: diocese.state,
      address: diocese.address,
      zipCode: diocese.zipCode,
      phone: diocese.phone || '',
      email: diocese.email || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta diocese?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/dioceses/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Diocese excluída com sucesso!');
      fetchDioceses();
    } catch (error: any) {
      console.error('Erro ao excluir diocese:', error);
      alert(error.response?.data?.message || 'Erro ao excluir diocese');
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
    });
    setEditingDiocese(null);
  };

  const filteredDioceses = dioceses.filter((diocese) =>
    diocese.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    diocese.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
    diocese.state.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="dioceses-page">
      <div className="page-header">
        <h1>Dioceses</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Nova Diocese
        </button>
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Buscar por nome, cidade ou estado..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="dioceses-grid">
        {filteredDioceses.length === 0 ? (
          <p className="no-results">Nenhuma diocese encontrada.</p>
        ) : (
          filteredDioceses.map((diocese) => (
            <div key={diocese.id} className="diocese-card">
              <div className="card-header">
                <h3>{diocese.name}</h3>
              </div>
              <div className="card-body">
                <p><strong>📍 Cidade:</strong> {diocese.city} - {diocese.state}</p>
                <p><strong>🏠 Endereço:</strong> {diocese.address}</p>
                <p><strong>📮 CEP:</strong> {diocese.zipCode}</p>
                {diocese.phone && <p><strong>📞 Telefone:</strong> {diocese.phone}</p>}
                {diocese.email && <p><strong>📧 Email:</strong> {diocese.email}</p>}
              </div>
              <div className="card-actions">
                <button className="btn-edit" onClick={() => handleEdit(diocese)}>
                  Editar
                </button>
                <button className="btn-delete" onClick={() => handleDelete(diocese.id)}>
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
            <h2>{editingDiocese ? 'Editar Diocese' : 'Nova Diocese'}</h2>
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
                  {editingDiocese ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiocesesPage;
