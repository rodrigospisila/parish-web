import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './MembersPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Community {
  id: string;
  name: string;
}

interface Member {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  community: Community;
  createdAt: string;
}

const MembersPage: React.FC = () => {
  const [members, setMembers] = useState<Member[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    birthDate: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    communityId: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const [membersRes, communitiesRes] = await Promise.all([
        axios.get(`${API_URL}/members`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/communities`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setMembers(membersRes.data);
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
      const payload = {
        ...formData,
        birthDate: formData.birthDate ? new Date(formData.birthDate).toISOString() : undefined,
      };

      if (editingMember) {
        await axios.patch(
          `${API_URL}/members/${editingMember.id}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        alert('Membro atualizado com sucesso!');
      } else {
        await axios.post(`${API_URL}/members`, payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
        alert('Membro criado com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar membro:', error);
      alert(error.response?.data?.message || 'Erro ao salvar membro');
    }
  };

  const handleEdit = (member: Member) => {
    setEditingMember(member);
    setFormData({
      name: member.name,
      email: member.email || '',
      phone: member.phone || '',
      birthDate: member.birthDate ? member.birthDate.slice(0, 10) : '',
      address: member.address || '',
      city: member.city || '',
      state: member.state || '',
      zipCode: member.zipCode || '',
      communityId: member.community.id,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este membro?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/members/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Membro excluído com sucesso!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir membro:', error);
      alert(error.response?.data?.message || 'Erro ao excluir membro');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      birthDate: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      communityId: '',
    });
    setEditingMember(null);
  };

  const filteredMembers = members.filter((member) =>
    member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.community.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="members-page">
      <div className="page-header">
        <h1>Membros</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Novo Membro
        </button>
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Buscar por nome, email ou comunidade..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="members-grid">
        {filteredMembers.length === 0 ? (
          <p className="no-results">Nenhum membro encontrado.</p>
        ) : (
          filteredMembers.map((member) => (
            <div key={member.id} className="member-card">
              <div className="card-header">
                <h3>{member.name}</h3>
                <span className="community-badge">{member.community.name}</span>
              </div>
              <div className="card-body">
                {member.email && <p><strong>📧 Email:</strong> {member.email}</p>}
                {member.phone && <p><strong>📞 Telefone:</strong> {member.phone}</p>}
                {member.birthDate && (
                  <p><strong>🎂 Nascimento:</strong> {new Date(member.birthDate).toLocaleDateString('pt-BR')}</p>
                )}
                {member.city && <p><strong>📍 Cidade:</strong> {member.city} - {member.state}</p>}
                {member.address && <p><strong>🏠 Endereço:</strong> {member.address}</p>}
              </div>
              <div className="card-actions">
                <button className="btn-edit" onClick={() => handleEdit(member)}>
                  Editar
                </button>
                <button className="btn-delete" onClick={() => handleDelete(member.id)}>
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
            <h2>{editingMember ? 'Editar Membro' : 'Novo Membro'}</h2>
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
                <label>Comunidade *</label>
                <select
                  required
                  value={formData.communityId}
                  onChange={(e) => setFormData({ ...formData, communityId: e.target.value })}
                >
                  <option value="">Selecione uma comunidade</option>
                  {communities.map((community) => (
                    <option key={community.id} value={community.id}>
                      {community.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
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
              </div>

              <div className="form-group">
                <label>Data de Nascimento</label>
                <input
                  type="date"
                  value={formData.birthDate}
                  onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Endereço</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Cidade</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Estado</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>CEP</label>
                <input
                  type="text"
                  value={formData.zipCode}
                  onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => { setShowModal(false); resetForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-submit">
                  {editingMember ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MembersPage;
