import React, { useState, useEffect } from 'react';
import TitleIcon from '../components/TitleIcon';
import axios from 'axios';
import { notify, confirm } from '../services/notification.service';
import PatronSaintsManager, { usePatronSaints, PatronSaintsBadge } from '../components/PatronSaintsManager';
import { avatarColor, initials } from '../components/SaintAvatar';
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

  // Santos padroeiros (vínculo por diocese)
  const { patronsByEntity, refresh: refreshPatrons } = usePatronSaints('diocese');
  const [patronTarget, setPatronTarget] = useState<Diocese | null>(null);

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
      notify.error('Erro ao carregar dioceses');
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
        notify.success('Diocese atualizada com sucesso!');
      } else {
        await axios.post(`${API_URL}/dioceses`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        notify.success('Diocese criada com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchDioceses();
    } catch (error: any) {
      console.error('Erro ao salvar diocese:', error);
      notify.error(error.response?.data?.message || 'Erro ao salvar diocese');
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
    const confirmed = await confirm.delete('esta diocese');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/dioceses/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Diocese excluída com sucesso!');
      fetchDioceses();
    } catch (error: any) {
      console.error('Erro ao excluir diocese:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir diocese');
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
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="diocese" /> Dioceses</h1>
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
            <div key={diocese.id} className="entity-card">
              <div className="entity-card-header">
                <div className="entity-monogram" style={{ background: avatarColor(diocese.name) }}>
                  {initials(diocese.name)}
                </div>
                <div className="entity-heading">
                  <h3 className="entity-title">{diocese.name}</h3>
                  <div className="entity-chips">
                    <span className="entity-chip">{diocese.city} - {diocese.state}</span>
                  </div>
                </div>
              </div>
              <div className="entity-card-body">
                <div className="entity-field">
                  <span className="entity-field-label">Endereço</span>
                  <span className="entity-field-value">{diocese.address}</span>
                </div>
                <div className="entity-field">
                  <span className="entity-field-label">CEP</span>
                  <span className="entity-field-value">{diocese.zipCode}</span>
                </div>
                {diocese.phone && (
                  <div className="entity-field">
                    <span className="entity-field-label">Telefone</span>
                    <span className="entity-field-value">{diocese.phone}</span>
                  </div>
                )}
                {diocese.email && (
                  <div className="entity-field">
                    <span className="entity-field-label">Email</span>
                    <span className="entity-field-value">{diocese.email}</span>
                  </div>
                )}
                <PatronSaintsBadge patrons={patronsByEntity[diocese.id]} />
              </div>
              <div className="entity-card-footer">
                <button className="entity-btn primary" onClick={() => handleEdit(diocese)}>
                  Editar
                </button>
                <button className="entity-btn accent" onClick={() => setPatronTarget(diocese)}>
                  🕊️ Padroeiro
                </button>
                <button className="entity-btn danger" onClick={() => handleDelete(diocese.id)}>
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

      {patronTarget && (
        <PatronSaintsManager
          level="diocese"
          entityId={patronTarget.id}
          entityName={patronTarget.name}
          onClose={(changed) => {
            setPatronTarget(null);
            if (changed) refreshPatrons();
          }}
        />
      )}
    </div>
  );
};

export default DiocesesPage;
