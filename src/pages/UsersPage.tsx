import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import './UsersPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Diocese {
  id: string;
  name: string;
}

interface Parish {
  id: string;
  name: string;
  dioceseId: string;
}

interface Community {
  id: string;
  name: string;
  parishId: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  isActive: boolean;
  diocese?: Diocese;
  createdAt: string;
}

const UsersPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [parishes, setParishes] = useState<Parish[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'PARISH_ADMIN',
    dioceseId: '',
    parishId: '',
    communityId: '',
  });

  const roles = [
    { value: 'SYSTEM_ADMIN', label: 'Administrador do Sistema' },
    { value: 'DIOCESAN_ADMIN', label: 'Administrador Diocesano' },
    { value: 'PARISH_ADMIN', label: 'Administrador Paroquial' },
    { value: 'COMMUNITY_COORDINATOR', label: 'Coordenador de Comunidade' },
    { value: 'PASTORAL_COORDINATOR', label: 'Coordenador de Pastoral' },
    { value: 'VOLUNTEER', label: 'Voluntário' },
    { value: 'FAITHFUL', label: 'Fiel' },
  ];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const [usersRes, diocesesRes, parishesRes, communitiesRes] = await Promise.all([
        axios.get(`${API_URL}/users`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/dioceses`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/parishes`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/communities`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setUsers(usersRes.data);
      setDioceses(diocesesRes.data);
      setParishes(parishesRes.data);
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
      const payload: any = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        role: formData.role,
        dioceseId: formData.dioceseId || undefined,
        parishId: formData.parishId || undefined,
        communityId: formData.communityId || undefined,
      };

      if (!editingUser) {
        payload.password = formData.password;
      }

      if (editingUser) {
        await axios.patch(
          `${API_URL}/users/${editingUser.id}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        alert('Usuário atualizado com sucesso!');
      } else {
        await axios.post(`${API_URL}/users`, payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
        alert('Usuário criado com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar usuário:', error);
      alert(error.response?.data?.message || 'Erro ao salvar usuário');
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      password: '',
      role: user.role,
      dioceseId: user.diocese?.id || '',
      parishId: (user as any).parishId || '',
      communityId: (user as any).communityId || '',
    });
    setShowModal(true);
  };

  const handleToggleActive = async (user: User) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/users/${user.id}`,
        { isActive: !user.isActive },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert(`Usuário ${!user.isActive ? 'ativado' : 'desativado'} com sucesso!`);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao alterar status:', error);
      alert(error.response?.data?.message || 'Erro ao alterar status');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este usuário?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/users/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Usuário excluído com sucesso!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir usuário:', error);
      alert(error.response?.data?.message || 'Erro ao excluir usuário');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      password: '',
      role: 'PARISH_ADMIN',
      dioceseId: '',
      parishId: '',
      communityId: '',
    });
    setEditingUser(null);
  };

  const getRoleLabel = (role: string) => {
    return roles.find(r => r.value === role)?.label || role;
  };

  const filteredUsers = users.filter((user) =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading">Carregando...</div>;

  // Verificar permissão de acesso
  const canManageUsers = 
    currentUser?.role === 'SYSTEM_ADMIN' || 
    currentUser?.role === 'DIOCESAN_ADMIN' || 
    currentUser?.role === 'PARISH_ADMIN' || 
    currentUser?.role === 'COMMUNITY_COORDINATOR';

  if (!canManageUsers) {
    return (
      <div className="access-denied">
        <h2>Acesso Negado</h2>
        <p>Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="users-page">
      <div className="page-header">
        <h1>Usuários</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Novo Usuário
        </button>
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Buscar por nome, email ou role..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="users-grid">
        {filteredUsers.length === 0 ? (
          <p className="no-results">Nenhum usuário encontrado.</p>
        ) : (
          filteredUsers.map((user) => (
            <div key={user.id} className="user-card">
              <div className="card-header">
                <h3>{user.name}</h3>
                <div className="badges">
                  <span className="role-badge">{getRoleLabel(user.role)}</span>
                  <span className={`status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                    {user.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              </div>
              <div className="card-body">
                <p><strong>📧 Email:</strong> {user.email}</p>
                {user.phone && <p><strong>📞 Telefone:</strong> {user.phone}</p>}
                {user.diocese && <p><strong>📍 Diocese:</strong> {user.diocese.name}</p>}
              </div>
              <div className="card-actions">
                <button className="btn-edit" onClick={() => handleEdit(user)}>
                  Editar
                </button>
                <button 
                  className={user.isActive ? 'btn-deactivate' : 'btn-activate'}
                  onClick={() => handleToggleActive(user)}
                >
                  {user.isActive ? 'Desativar' : 'Ativar'}
                </button>
                <button className="btn-delete" onClick={() => handleDelete(user.id)}>
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
            <h2>{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h2>
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
                <label>Email *</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              {!editingUser && (
                <div className="form-group">
                  <label>Senha *</label>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  />
                </div>
              )}

              <div className="form-group">
                <label>Telefone</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Função *</label>
                <select
                  required
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              {(formData.role === 'DIOCESAN_ADMIN' || formData.role === 'PARISH_ADMIN' || formData.role === 'COMMUNITY_COORDINATOR') && (
                <div className="form-group">
                  <label>Diocese {(formData.role === 'DIOCESAN_ADMIN' || formData.role === 'PARISH_ADMIN' || formData.role === 'COMMUNITY_COORDINATOR') ? '*' : ''}</label>
                  <select
                    required={formData.role === 'DIOCESAN_ADMIN' || formData.role === 'PARISH_ADMIN' || formData.role === 'COMMUNITY_COORDINATOR'}
                    value={formData.dioceseId}
                    onChange={(e) => {
                      setFormData({ ...formData, dioceseId: e.target.value, parishId: '', communityId: '' });
                    }}
                  >
                    <option value="">Selecione uma diocese</option>
                    {dioceses.map((diocese) => (
                      <option key={diocese.id} value={diocese.id}>
                        {diocese.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(formData.role === 'PARISH_ADMIN' || formData.role === 'COMMUNITY_COORDINATOR') && formData.dioceseId && (
                <div className="form-group">
                  <label>Paróquia *</label>
                  <select
                    required
                    value={formData.parishId}
                    onChange={(e) => {
                      setFormData({ ...formData, parishId: e.target.value, communityId: '' });
                    }}
                  >
                    <option value="">Selecione uma paróquia</option>
                    {parishes
                      .filter(p => p.dioceseId === formData.dioceseId)
                      .map((parish) => (
                        <option key={parish.id} value={parish.id}>
                          {parish.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {formData.role === 'COMMUNITY_COORDINATOR' && formData.parishId && (
                <div className="form-group">
                  <label>Comunidade *</label>
                  <select
                    required
                    value={formData.communityId}
                    onChange={(e) => setFormData({ ...formData, communityId: e.target.value })}
                  >
                    <option value="">Selecione uma comunidade</option>
                    {communities
                      .filter(c => c.parishId === formData.parishId)
                      .map((community) => (
                        <option key={community.id} value={community.id}>
                          {community.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => { setShowModal(false); resetForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-submit">
                  {editingUser ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersPage;
