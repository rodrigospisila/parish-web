import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import './ParishesPage.css';

interface Diocese {
  id: string;
  name: string;
}

interface Parish {
  id: string;
  name: string;
  city: string;
  state: string;
  priestName?: string;
  email?: string;
  phone?: string;
  status: string;
  dioceseId: string;
  diocese?: Diocese;
}

export const ParishesPage: React.FC = () => {
  const [parishes, setParishes] = useState<Parish[]>([]);
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingParish, setEditingParish] = useState<Parish | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: '',
    priestName: '',
    dioceseId: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [parishesRes, diocesesRes] = await Promise.all([
        api.get('/parishes'),
        api.get('/dioceses'),
      ]);
      setParishes(parishesRes.data);
      setDioceses(diocesesRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.dioceseId) {
      alert('Selecione uma diocese');
      return;
    }
    
    try {
      if (editingParish) {
        await api.patch(`/parishes/${editingParish.id}`, formData);
        alert('Paróquia atualizada!');
      } else {
        await api.post('/parishes', formData);
        alert('Paróquia criada!');
      }
      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Erro ao salvar');
    }
  };

  const handleEdit = (parish: Parish) => {
    setEditingParish(parish);
    setFormData({
      name: parish.name,
      address: '',
      city: parish.city,
      state: parish.state,
      zipCode: '',
      phone: parish.phone || '',
      email: parish.email || '',
      priestName: parish.priestName || '',
      dioceseId: parish.dioceseId,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta paróquia?')) return;
    try {
      await api.delete(`/parishes/${id}`);
      fetchData();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Erro ao excluir');
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
      priestName: '',
      dioceseId: '',
    });
    setEditingParish(null);
  };

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="parishes-page">
      <div className="page-header">
        <h1>Paróquias</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Nova Paróquia
        </button>
      </div>

      <div className="parishes-grid">
        {parishes.map((parish) => (
          <div key={parish.id} className="parish-card">
            <div className="card-header">
              <h3>{parish.name}</h3>
              <span className={`status ${parish.status.toLowerCase()}`}>
                {parish.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
              </span>
            </div>
            <div className="card-body">
              <p><strong>Pároco:</strong> {parish.priestName || 'Não informado'}</p>
              <p><strong>Diocese:</strong> {parish.diocese?.name || 'N/A'}</p>
              <p><strong>Localização:</strong> {parish.city} - {parish.state}</p>
              {parish.email && <p><strong>Email:</strong> {parish.email}</p>}
              {parish.phone && <p><strong>Telefone:</strong> {parish.phone}</p>}
            </div>
            <div className="card-actions">
              <button className="btn-edit" onClick={() => handleEdit(parish)}>Editar</button>
              <button className="btn-delete" onClick={() => handleDelete(parish.id)}>Excluir</button>
            </div>
          </div>
        ))}
      </div>

      {parishes.length === 0 && (
        <div className="empty-state">
          <p>Nenhuma paróquia cadastrada.</p>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            Cadastrar primeira paróquia
          </button>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingParish ? 'Editar Paróquia' : 'Nova Paróquia'}</h2>
              <button className="btn-close" onClick={() => { setShowModal(false); resetForm(); }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Diocese *</label>
                <select value={formData.dioceseId} onChange={(e) => setFormData({ ...formData, dioceseId: e.target.value })} required>
                  <option value="">Selecione</option>
                  {dioceses.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Nome *</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Pároco</label>
                <input type="text" value={formData.priestName} onChange={(e) => setFormData({ ...formData, priestName: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cidade *</label>
                  <input type="text" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Estado *</label>
                  <input type="text" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} maxLength={2} required />
                </div>
              </div>
              <div className="form-group">
                <label>Endereço *</label>
                <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>CEP *</label>
                  <input type="text" value={formData.zipCode} onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Telefone</label>
                  <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); resetForm(); }}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingParish ? 'Atualizar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

