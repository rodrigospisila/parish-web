import React, { useState, useEffect, useMemo } from 'react';
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

interface UserCommunity {
  id: string;
  community: Community;
}

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  isActive: boolean;
  diocese?: Diocese;
  dioceseId?: string;
  parishId?: string;
  communityId?: string;
  communities?: UserCommunity[];
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
    role: 'FAITHFUL',
    dioceseId: '',
    parishId: '',
    communityId: '',
    communityIds: [] as string[],
  });

  // Definir hierarquia de roles
  const allRoles = [
    { value: 'SYSTEM_ADMIN', label: 'Administrador do Sistema', level: 1 },
    { value: 'DIOCESAN_ADMIN', label: 'Administrador Diocesano', level: 2 },
    { value: 'PARISH_ADMIN', label: 'Administrador Paroquial', level: 3 },
    { value: 'COMMUNITY_COORDINATOR', label: 'Coordenador de Comunidade', level: 4 },
    { value: 'PASTORAL_COORDINATOR', label: 'Coordenador de Pastoral', level: 5 },
    { value: 'VOLUNTEER', label: 'Voluntário', level: 6 },
    { value: 'FAITHFUL', label: 'Fiel', level: 7 },
  ];

  // Filtrar roles disponíveis baseado no usuário logado
  const availableRoles = useMemo(() => {
    if (!currentUser) return [];
    
    const currentUserLevel = allRoles.find(r => r.value === currentUser.role)?.level || 999;
    
    // Só pode criar usuários de nível inferior
    return allRoles.filter(r => r.level > currentUserLevel);
  }, [currentUser]);

  // Filtrar dioceses disponíveis baseado no usuário logado
  const availableDioceses = useMemo(() => {
    if (!currentUser) return [];
    
    if (currentUser.role === 'SYSTEM_ADMIN') {
      return dioceses; // Todas as dioceses
    }
    
    if (currentUser.role === 'DIOCESAN_ADMIN') {
      // Apenas sua diocese
      return dioceses.filter(d => d.id === currentUser.dioceseId);
    }
    
    // PARISH_ADMIN e COMMUNITY_COORDINATOR não veem o campo
    return [];
  }, [currentUser, dioceses]);

  // Filtrar paróquias disponíveis baseado no usuário logado e diocese selecionada
  const availableParishes = useMemo(() => {
    if (!currentUser) return [];
    
    if (currentUser.role === 'SYSTEM_ADMIN') {
      // Todas as paróquias da diocese selecionada
      return parishes.filter(p => p.dioceseId === formData.dioceseId);
    }
    
    if (currentUser.role === 'DIOCESAN_ADMIN') {
      // Apenas paróquias da sua diocese
      return parishes.filter(p => p.dioceseId === currentUser.dioceseId);
    }
    
    // PARISH_ADMIN e COMMUNITY_COORDINATOR não veem o campo
    return [];
  }, [currentUser, parishes, formData.dioceseId]);

  // Filtrar comunidades disponíveis baseado no usuário logado e paróquia selecionada
  const availableCommunities = useMemo(() => {
    if (!currentUser) return [];
    
    if (currentUser.role === 'SYSTEM_ADMIN' || currentUser.role === 'DIOCESAN_ADMIN') {
      // Todas as comunidades da paróquia selecionada
      return communities.filter(c => c.parishId === formData.parishId);
    }
    
    if (currentUser.role === 'PARISH_ADMIN') {
      // Apenas comunidades da sua paróquia
      const filtered = communities.filter(c => c.parishId === currentUser.parishId);
      console.log('DEBUG availableCommunities:', {
        currentUserRole: currentUser.role,
        currentUserParishId: currentUser.parishId,
        allCommunities: communities,
        filteredCommunities: filtered,
        formDataRole: formData.role,
      });
      return filtered;
    }
    
    // COMMUNITY_COORDINATOR não vê o campo
    return [];
  }, [currentUser, communities, formData.parishId, formData.role]);

  // Verificar se deve mostrar campo Diocese
  const shouldShowDioceseField = useMemo(() => {
    if (!currentUser) return false;
    
    // Só mostra para SYSTEM_ADMIN e DIOCESAN_ADMIN
    if (!['SYSTEM_ADMIN', 'DIOCESAN_ADMIN'].includes(currentUser.role)) {
      return false;
    }
    
    // E só quando o role selecionado precisa de diocese
    return ['DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(formData.role);
  }, [currentUser, formData.role]);

  // Verificar se deve mostrar campo Paróquia
  const shouldShowParishField = useMemo(() => {
    if (!currentUser) return false;
    
    // Só mostra para SYSTEM_ADMIN e DIOCESAN_ADMIN
    if (!['SYSTEM_ADMIN', 'DIOCESAN_ADMIN'].includes(currentUser.role)) {
      return false;
    }
    
    // E só quando o role selecionado precisa de paróquia
    return ['PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(formData.role);
  }, [currentUser, formData.role]);

  // Verificar se deve mostrar campo Comunidade
  const shouldShowCommunityField = useMemo(() => {
    if (!currentUser) return false;
    
    // Só mostra para SYSTEM_ADMIN, DIOCESAN_ADMIN e PARISH_ADMIN
    if (!['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN'].includes(currentUser.role)) {
      return false;
    }
    
    // E só quando o role selecionado é COMMUNITY_COORDINATOR
    return formData.role === 'COMMUNITY_COORDINATOR';
  }, [currentUser, formData.role]);

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

    // Validar communityIds para COMMUNITY_COORDINATOR
    if (formData.role === 'COMMUNITY_COORDINATOR' && formData.communityIds.length === 0) {
      alert('Selecione pelo menos uma comunidade para o Coordenador de Comunidade');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      
      // Preparar dados para envio
      const dataToSend: any = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        role: formData.role,
      };

      // Adicionar senha apenas se for criação
      if (!editingUser) {
        dataToSend.password = formData.password;
      }

      // Adicionar dioceseId, parishId, communityId baseado no role
      if (['DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(formData.role)) {
        dataToSend.dioceseId = formData.dioceseId || currentUser?.dioceseId || null;
      }
      
      if (['PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(formData.role)) {
        dataToSend.parishId = formData.parishId || currentUser?.parishId || null;
      }
      
      if (formData.role === 'COMMUNITY_COORDINATOR') {
        dataToSend.communityId = formData.communityId || currentUser?.communityId || null;
        // Adicionar array de communityIds
        dataToSend.communityIds = formData.communityIds;
      }

      if (editingUser) {
        await axios.patch(`${API_URL}/users/${editingUser.id}`, dataToSend, {
          headers: { Authorization: `Bearer ${token}` },
        });
        alert('Usuário atualizado com sucesso!');
      } else {
        await axios.post(`${API_URL}/users`, dataToSend, {
          headers: { Authorization: `Bearer ${token}` },
        });
        alert('Usuário criado com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar usuário:', error);
      const errorMessage = error.response?.data?.message || 'Erro ao salvar usuário';
      alert(errorMessage);
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
      parishId: '',
      communityId: '',
      communityIds: [],
    });
    setShowModal(true);
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
      const errorMessage = error.response?.data?.message || 'Erro ao excluir usuário';
      alert(errorMessage);
    }
  };

  const handleToggleActive = async (user: User) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/users/${user.id}`,
        { isActive: !user.isActive },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      alert(`Usuário ${!user.isActive ? 'ativado' : 'desativado'} com sucesso!`);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao atualizar status:', error);
      const errorMessage = error.response?.data?.message || 'Erro ao atualizar status';
      alert(errorMessage);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      password: '',
      role: 'FAITHFUL',
      dioceseId: '',
      parishId: '',
      communityId: '',
      communityIds: [],
    });
    setEditingUser(null);
  };

  const getRoleLabel = (role: string) => {
    return allRoles.find(r => r.value === role)?.label || role;
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
                {user.communities && user.communities.length > 0 && (
                  <p>
                    <strong>🏘️ Comunidades:</strong>{' '}
                    {user.communities.map(uc => uc.community.name).join(', ')}
                  </p>
                )}
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
                  onChange={(e) => setFormData({ ...formData, role: e.target.value, dioceseId: '', parishId: '', communityId: '' })}
                >
                  <option value="">Selecione uma função</option>
                  {availableRoles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              {shouldShowDioceseField && (
                <div className="form-group">
                  <label>Diocese *</label>
                  <select
                    required
                    value={formData.dioceseId}
                    onChange={(e) => {
                      setFormData({ ...formData, dioceseId: e.target.value, parishId: '', communityId: '' });
                    }}
                  >
                    <option value="">Selecione uma diocese</option>
                    {availableDioceses.map((diocese) => (
                      <option key={diocese.id} value={diocese.id}>
                        {diocese.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {shouldShowParishField && formData.dioceseId && (
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
                    {availableParishes.map((parish) => (
                      <option key={parish.id} value={parish.id}>
                        {parish.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {shouldShowCommunityField && formData.parishId && (
                <div className="form-group">
                  <label>Comunidade *</label>
                  <select
                    required
                    value={formData.communityId}
                    onChange={(e) => setFormData({ ...formData, communityId: e.target.value })}
                  >
                    <option value="">Selecione uma comunidade</option>
                    {availableCommunities.map((community) => (
                      <option key={community.id} value={community.id}>
                        {community.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {formData.role === 'COMMUNITY_COORDINATOR' && (formData.parishId || currentUser?.parishId) && (
                <div className="form-group">
                  <label>Comunidade(s) Vinculada(s) *</label>
                  <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '8px', maxHeight: '150px', overflowY: 'auto' }}>
                    {availableCommunities.length === 0 ? (
                      <p style={{ margin: 0, color: '#666' }}>Nenhuma comunidade disponível</p>
                    ) : (
                      availableCommunities.map((community) => (
                        <label key={community.id} style={{ display: 'block', marginBottom: '4px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={formData.communityIds.includes(community.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({ ...formData, communityIds: [...formData.communityIds, community.id] });
                              } else {
                                setFormData({ ...formData, communityIds: formData.communityIds.filter(id => id !== community.id) });
                              }
                            }}
                            style={{ marginRight: '8px' }}
                          />
                          {community.name}
                        </label>
                      ))
                    )}
                  </div>
                  {formData.communityIds.length === 0 && (
                    <small style={{ color: '#e74c3c' }}>Selecione pelo menos uma comunidade</small>
                  )}
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
