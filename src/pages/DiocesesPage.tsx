import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import './DiocesesPage.css';

interface Diocese {
  id: string;
  name: string;
  city: string;
  state: string;
  bishopName?: string;
  email?: string;
  phone?: string;
  status: string;
  createdAt: string;
}

export const DiocesesPage: React.FC = () => {
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDiocese, setEditingDiocese] = useState<Diocese | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: '',
    bishopName: '',
  });

  useEffect(() => {
    fetchDioceses();
  }, []);

  const fetchDioceses = async () => {
    try {
      const response = await api.get('/dioceses');
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
      if (editingDiocese) {
        await api.patch(`/dioceses/${editingDiocese.id}`, formData);
        alert('Diocese atualizada com sucesso!');
      } else {
        await api.post('/dioceses', formData);
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
      address: '',
      city: diocese.city,
      state: diocese.state,
      zipCode: '',
      phone: diocese.phone || '',
      email: diocese.email || '',
      bishopName: diocese.bishopName || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta diocese?')) return;
    
    try {
      await api.delete(`/dioceses/${id}`);
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
      address: '',
      city: '',
      state: '',
      zipCode: '',
      phone: '',
      email: '',
      bishopName: '',
    });
    setEditingDiocese(null);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    resetForm();
  };

  if (loading) {
    return <div className="loading">Carregando...</div>;
  }

  return (
    <div className="dioceses-page">
      <div className="page-header">
        <h1>Dioceses</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Nova Diocese
        </button>
      </div>

      <div className="dioceses-grid">
        {dioceses.map((diocese) => (
          <div key={diocese.id} className="diocese-card">
            <div className="card-header">
              <h3>{diocese.name}</h3>
              <span className={`status ${diocese.status.toLowerCase()}`}>
                {diocese.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
              </span>
            </div>
            <div className="card-body">
              <p><strong>Bispo:</strong> {diocese.bishopName || 'Não informado'}</p>
              <p><strong>Localização:</strong> {diocese.city} - {diocese.state}</p>
              {diocese.email && <p><strong>Email:</strong> {diocese.email}</p>}
              {diocese.phone && <p><strong>Telefone:</strong> {diocese.phone}</p>}
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
        ))}
      </div>

      {dioceses.length === 0 && (
        <div className="empty-state">
          <p>Nenhuma diocese cadastrada.</p>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            Cadastrar primeira diocese
          </button>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingDiocese ? 'Editar Diocese' : 'Nova Diocese'}</h2>
              <button className="btn-close" onClick={handleCloseModal}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nome da Diocese *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Nome do Bispo</label>
                <input
                  type="text"
                  value={formData.bishopName}
                  onChange={(e) => setFormData({ ...formData, bishopName: e.target.value })}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cidade *</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Estado *</label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    maxLength={2}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Endereço *</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  required
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>CEP *</label>
                  <input
                    type="text"
                    value={formData.zipCode}
                    onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Telefone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
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
                <button type="button" className="btn-secondary" onClick={handleCloseModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
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

