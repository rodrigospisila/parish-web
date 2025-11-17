import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatDateTime, formatDate } from '../../utils/dateFormat';
import './PastoralsPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Member {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

interface PastoralMember {
  id: string;
  role: string;
  isActive: boolean;
  joinedAt: string;
  leftAt?: string;
  member: Member;
}

interface GlobalPastoral {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

interface Community {
  id: string;
  name: string;
}

interface PastoralGroup {
  id: string;
  name: string;
  description?: string;
  photoUrl?: string;
  status: string;
  communityPastoralId: string;
  parentGroupId?: string;
}

interface Meeting {
  id: string;
  title: string;
  description?: string;
  date: string;
  location?: string;
  notes?: string;
  participants?: any[];
}

interface Activity {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  location?: string;
}

interface CommunityPastoral {
  id: string;
  description?: string;
  meetingDay?: string;
  meetingTime?: string;
  isActive: boolean;
  createdAt: string;
  globalPastoral: GlobalPastoral;
  community: Community;
  members: PastoralMember[];
  groups?: PastoralGroup[];
}

const CommunityPastoralDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pastoral, setPastoral] = useState<CommunityPastoral | null>(null);
  const [members, setMembers] = useState<PastoralMember[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<PastoralGroup[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showEditPastoralModal, setShowEditPastoralModal] = useState(false);
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editingMember, setEditingMember] = useState<PastoralMember | null>(null);
  const [editingGroup, setEditingGroup] = useState<PastoralGroup | null>(null);
  const [editFormData, setEditFormData] = useState({
    description: '',
    mission: '',
    meetingDay: '',
    meetingTime: '',
    notes: '',
  });
  const [groupFormData, setGroupFormData] = useState({
    name: '',
    description: '',
  });
  const [meetingFormData, setMeetingFormData] = useState({
    title: '',
    description: '',
    date: '',
    location: '',
  });
  const [showAddMeetingModal, setShowAddMeetingModal] = useState(false);
  const [showAddActivityModal, setShowAddActivityModal] = useState(false);
  const [activityFormData, setActivityFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    location: '',
  });
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberRole, setMemberRole] = useState('Membro');
  const [editRole, setEditRole] = useState('');

  useEffect(() => {
    fetchPastoralDetails();
    fetchAllMembers();
    fetchGroups();
    fetchMeetings();
    fetchActivities();
  }, [id]);

  const fetchPastoralDetails = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/pastorals/community/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPastoral(response.data);
      
      // Buscar membros da pastoral
      const membersResponse = await axios.get(`${API_URL}/pastorals/members`, {
        params: { communityPastoralId: id },
        headers: { Authorization: `Bearer ${token}` },
      });
      setMembers(membersResponse.data);
    } catch (error) {
      console.error('Erro ao carregar pastoral:', error);
      alert('Erro ao carregar detalhes da pastoral');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllMembers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAllMembers(response.data);
    } catch (error) {
      console.error('Erro ao carregar membros:', error);
    }
  };

  const fetchGroups = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/pastorals/groups`, {
        params: { communityPastoralId: id },
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroups(response.data);
    } catch (error) {
      console.error('Erro ao carregar sub-grupos:', error);
    }
  };

  const handleAddGroup = async () => {
    if (!groupFormData.name.trim()) {
      alert('Nome do sub-grupo é obrigatório');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `${API_URL}/pastorals/groups`,
        {
          ...groupFormData,
          communityPastoralId: id,
          status: 'ACTIVE',
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert('Sub-grupo criado com sucesso!');
      setShowAddGroupModal(false);
      setGroupFormData({ name: '', description: '' });
      fetchGroups();
    } catch (error: any) {
      console.error('Erro ao criar sub-grupo:', error);
      alert(error.response?.data?.message || 'Erro ao criar sub-grupo');
    }
  };

  const handleEditGroup = (group: PastoralGroup) => {
    setEditingGroup(group);
    setGroupFormData({
      name: group.name,
      description: group.description || '',
    });
    setShowEditGroupModal(true);
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup || !groupFormData.name.trim()) {
      alert('Nome do sub-grupo é obrigatório');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/pastorals/groups/${editingGroup.id}`,
        groupFormData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert('Sub-grupo atualizado com sucesso!');
      setShowEditGroupModal(false);
      setEditingGroup(null);
      setGroupFormData({ name: '', description: '' });
      fetchGroups();
    } catch (error: any) {
      console.error('Erro ao atualizar sub-grupo:', error);
      alert(error.response?.data?.message || 'Erro ao atualizar sub-grupo');
    }
  };

  const handleRemoveGroup = async (groupId: string, groupName: string) => {
    if (!confirm(`Deseja remover o sub-grupo "${groupName}"?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/pastorals/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      alert('Sub-grupo removido com sucesso!');
      fetchGroups();
    } catch (error: any) {
      console.error('Erro ao remover sub-grupo:', error);
      alert(error.response?.data?.message || 'Erro ao remover sub-grupo');
    }
  };

  const fetchMeetings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/events`, {
        params: { 
          type: 'PASTORAL_MEETING',
          communityId: pastoral?.community.id 
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      
      // Filtrar apenas eventos desta pastoral
      const pastoralMeetings = response.data.filter((event: any) =>
        event.eventPastorals?.some((ep: any) => ep.communityPastoralId === id)
      );
      
      setMeetings(pastoralMeetings);
    } catch (error) {
      console.error('Erro ao carregar reuniões:', error);
    }
  };

  const handleAddMeeting = async () => {
    if (!meetingFormData.title.trim() || !meetingFormData.date || !pastoral) {
      alert('Título e data são obrigatórios');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      
      // Criar evento do tipo PASTORAL_MEETING
      const eventResponse = await axios.post(
        `${API_URL}/events`,
        {
          title: meetingFormData.title,
          description: meetingFormData.description,
          type: 'PASTORAL_MEETING',
          startDate: meetingFormData.date,
          location: meetingFormData.location,
          communityId: pastoral.community.id,
          isPublic: false,
          status: 'PUBLISHED',
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Vincular pastoral ao evento
      await axios.post(
        `${API_URL}/events/${eventResponse.data.id}/pastorals`,
        {
          communityPastoralId: id,
          role: 'Organizadora',
          isLeader: true,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert('Reunião criada com sucesso!');
      setShowAddMeetingModal(false);
      setMeetingFormData({ title: '', description: '', date: '', location: '' });
      fetchMeetings();
    } catch (error: any) {
      console.error('Erro ao criar reunião:', error);
      alert(error.response?.data?.message || 'Erro ao criar reunião');
    }
  };

  const fetchActivities = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/events`, {
        params: { 
          type: 'PASTORAL_ACTIVITY',
          communityId: pastoral?.community.id 
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      
      // Filtrar apenas eventos desta pastoral
      const pastoralActivities = response.data.filter((event: any) =>
        event.eventPastorals?.some((ep: any) => ep.communityPastoralId === id)
      );
      
      setActivities(pastoralActivities);
    } catch (error) {
      console.error('Erro ao carregar atividades:', error);
    }
  };

  const handleAddActivity = async () => {
    if (!activityFormData.title.trim() || !activityFormData.startDate || !pastoral) {
      alert('Título e data de início são obrigatórios');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      
      // Criar evento do tipo PASTORAL_ACTIVITY
      const eventResponse = await axios.post(
        `${API_URL}/events`,
        {
          title: activityFormData.title,
          description: activityFormData.description,
          type: 'PASTORAL_ACTIVITY',
          startDate: activityFormData.startDate,
          endDate: activityFormData.endDate || undefined,
          location: activityFormData.location,
          communityId: pastoral.community.id,
          isPublic: false,
          status: 'PUBLISHED',
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Vincular pastoral ao evento
      await axios.post(
        `${API_URL}/events/${eventResponse.data.id}/pastorals`,
        {
          communityPastoralId: id,
          role: 'Organizadora',
          isLeader: true,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert('Atividade criada com sucesso!');
      setShowAddActivityModal(false);
      setActivityFormData({ title: '', description: '', startDate: '', endDate: '', location: '' });
      fetchActivities();
    } catch (error: any) {
      console.error('Erro ao criar atividade:', error);
      alert(error.response?.data?.message || 'Erro ao criar atividade');
    }
  };

  const handleEditRole = (member: PastoralMember) => {
    setEditingMember(member);
    setEditRole(member.role);
    setShowEditRoleModal(true);
  };

  const handleOpenEditPastoral = () => {
    if (!pastoral) return;
    setEditFormData({
      description: pastoral.description || '',
      mission: '', // Adicionar ao schema se necessário
      meetingDay: pastoral.meetingDay || '',
      meetingTime: pastoral.meetingTime || '',
      notes: '', // Adicionar ao schema se necessário
    });
    setShowEditPastoralModal(true);
  };

  const handleUpdatePastoral = async () => {
    if (!pastoral) return;

    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/pastorals/community/${pastoral.id}`,
        editFormData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Atualizar dados
      await fetchPastoralDetails();
      setShowEditPastoralModal(false);
      alert('Pastoral atualizada com sucesso!');
    } catch (error: any) {
      console.error('Erro ao atualizar pastoral:', error);
      alert(error.response?.data?.message || 'Erro ao atualizar pastoral');
    }
  };

  const handleToggleStatus = async () => {
    if (!pastoral) return;

    const confirmMessage = pastoral.isActive
      ? 'Deseja desativar esta pastoral?'
      : 'Deseja ativar esta pastoral?';

    if (!confirm(confirmMessage)) return;

    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/pastorals/community/${pastoral.id}`,
        { status: pastoral.isActive ? 'INACTIVE' : 'ACTIVE' },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Atualizar dados
      await fetchPastoralDetails();
      alert(`Pastoral ${pastoral.isActive ? 'desativada' : 'ativada'} com sucesso!`);
    } catch (error: any) {
      console.error('Erro ao alterar status:', error);
      alert(error.response?.data?.message || 'Erro ao alterar status da pastoral');
    }
  };

  const handleUpdateRole = async () => {
    if (!editingMember) return;

    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/pastorals/members/${editingMember.id}`,
        { role: editRole },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Atualizar lista de membros
      await fetchPastoralDetails();
      setShowEditRoleModal(false);
      setEditingMember(null);
      alert('Função atualizada com sucesso!');
    } catch (error: any) {
      console.error('Erro ao atualizar função:', error);
      alert(error.response?.data?.message || 'Erro ao atualizar função');
    }
  };

  const handleAddMember = async () => {
    if (!selectedMemberId) {
      alert('Selecione um membro');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `${API_URL}/pastorals/members`,
        {
          memberId: selectedMemberId,
          communityPastoralId: id,
          role: memberRole,
          isActive: true,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert('Membro adicionado com sucesso!');
      setShowAddMemberModal(false);
      setSelectedMemberId('');
      setMemberRole('Membro');
      fetchPastoralDetails();
    } catch (error: any) {
      console.error('Erro ao adicionar membro:', error);
      alert(error.response?.data?.message || 'Erro ao adicionar membro');
    }
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!confirm(`Deseja remover ${memberName} da pastoral?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/pastorals/members/${memberId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      alert('Membro removido com sucesso!');
      fetchPastoralDetails();
    } catch (error: any) {
      console.error('Erro ao remover membro:', error);
      alert(error.response?.data?.message || 'Erro ao remover membro');
    }
  };

  if (loading) {
    return (
      <div className="pastorals-page">
        <p>Carregando...</p>
      </div>
    );
  }

  if (!pastoral) {
    return (
      <div className="pastorals-page">
        <p>Pastoral não encontrada</p>
      </div>
    );
  }

  // Filtrar membros que já estão na pastoral
  const availableMembers = allMembers.filter(
    (m) => !members.some((pm) => pm.member.id === m.id)
  );

  return (
    <div className="pastorals-page">
        <div className="page-header">
          <div>
            <button onClick={() => navigate('/admin/pastorals/community')} className="back-button">
              ← Voltar
            </button>
            <h1 style={{ marginTop: '10px' }}>{pastoral.globalPastoral.name}</h1>
            <p style={{ color: '#666', marginTop: '5px' }}>
              {pastoral.community.name}
            </p>
          </div>
        </div>

        {/* Informações da Pastoral */}
        <div className="pastoral-info-card">
          <h2>Informações</h2>
          <div style={{ marginTop: '15px' }}>
            {pastoral.description && (
              <p><strong>Descrição:</strong> {pastoral.description}</p>
            )}
            {pastoral.meetingDay && pastoral.meetingTime && (
              <p><strong>Reuniões:</strong> {pastoral.meetingDay} às {pastoral.meetingTime}</p>
            )}
            <p>
              <strong>Status:</strong> {pastoral.isActive ? '✅ Ativa' : '❌ Inativa'}
              <button onClick={handleToggleStatus} className="toggle-status-button">
                {pastoral.isActive ? 'Desativar' : 'Ativar'}
              </button>
            </p>
            <p><strong>Criada em:</strong> {new Date(pastoral.createdAt).toLocaleDateString('pt-BR')}</p>
          </div>
        </div>

        {/* Sub-grupos */}
        <div className="members-section">
          <div className="section-header">
            <h2>Sub-grupos ({groups.length})</h2>
            <button onClick={() => setShowAddGroupModal(true)} className="add-button">
              + Adicionar Sub-grupo
            </button>
          </div>

          {groups.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#666', marginTop: '20px' }}>
              Nenhum sub-grupo cadastrado
            </p>
          ) : (
            <div className="members-grid">
              {groups.map((group) => (
                <div key={group.id} className="member-card">
                  <div className="member-header">
                    <h3>{group.name}</h3>
                    <span className={`role-badge ${group.status === 'ACTIVE' ? 'role-membro' : 'role-inactive'}`}>
                      {group.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  {group.description && <p>📝 {group.description}</p>}
                  <div className="member-actions">
                    <button
                      onClick={() => handleEditGroup(group)}
                      className="edit-button"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleRemoveGroup(group.id, group.name)}
                      className="remove-button"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reuniões */}
        <div className="members-section" style={{ marginTop: '20px' }}>
          <div className="section-header">
            <h2>Reuniões ({meetings.length})</h2>
            <button onClick={() => setShowAddMeetingModal(true)} className="add-button">
              + Agendar Reunião
            </button>
          </div>

          {meetings.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#666', marginTop: '20px' }}>
              Nenhuma reunião agendada
            </p>
          ) : (
            <div className="members-grid">
              {meetings.map((meeting) => (
                <div key={meeting.id} className="member-card">
                  <div className="member-header">
                    <h3>{meeting.title}</h3>
                  </div>
                  <p>📅 {formatDateTime(meeting.startDate || meeting.date)}</p>
                  {meeting.location && <p>📍 {meeting.location}</p>}
                  {meeting.description && <p>📝 {meeting.description}</p>}
                  {meeting.eventPastorals?.[0]?.assignments && (
                    <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                      {meeting.eventPastorals[0].assignments.filter((a: any) => a.checkedInAt).length} / {meeting.eventPastorals[0].assignments.length} presentes
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Atividades */}
        <div className="members-section" style={{ marginTop: '20px' }}>
          <div className="section-header">
            <h2>Atividades ({activities.length})</h2>
            <button onClick={() => setShowAddActivityModal(true)} className="add-button">
              + Criar Atividade
            </button>
          </div>

          {activities.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#666', marginTop: '20px' }}>
              Nenhuma atividade cadastrada
            </p>
          ) : (
            <div className="members-grid">
              {activities.map((activity) => (
                <div key={activity.id} className="member-card">
                  <div className="member-header">
                    <h3>{activity.title}</h3>
                  </div>
                  <p>📅 Início: {formatDate(activity.startDate)}</p>
                  {activity.endDate && (
                    <p>📅 Término: {formatDate(activity.endDate)}</p>
                  )}
                  {activity.location && <p>📍 {activity.location}</p>}
                  {activity.description && <p>📝 {activity.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Estatísticas */}
        <div className="members-section" style={{ marginTop: '20px' }}>
          <div className="section-header">
            <h2>Estatísticas</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginTop: '15px' }}>
            <div style={{ background: '#e3f2fd', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '2rem', color: '#1976d2' }}>{members.length}</h3>
              <p style={{ margin: 0, color: '#555' }}>Membros Ativos</p>
            </div>
            <div style={{ background: '#f3e5f5', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '2rem', color: '#7b1fa2' }}>{groups.length}</h3>
              <p style={{ margin: 0, color: '#555' }}>Sub-grupos</p>
            </div>
            <div style={{ background: '#fff3e0', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '2rem', color: '#f57c00' }}>{meetings.length}</h3>
              <p style={{ margin: 0, color: '#555' }}>Reuniões</p>
            </div>
            <div style={{ background: '#e8f5e9', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '2rem', color: '#388e3c' }}>{activities.length}</h3>
              <p style={{ margin: 0, color: '#555' }}>Atividades</p>
            </div>
          </div>
        </div>

        {/* Membros */}
        <div className="members-section" style={{ marginTop: '20px' }}>
          <div className="section-header">
            <h2>Membros ({members.length})</h2>
            <div>
              <button onClick={handleOpenEditPastoral} className="edit-button" style={{ marginRight: '10px' }}>
                ✏️ Editar Pastoral
              </button>
              <button onClick={() => setShowAddMemberModal(true)} className="add-button">
                + Adicionar Membro
              </button>
            </div>
          </div>

          {members.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#666', marginTop: '20px' }}>
              Nenhum membro cadastrado
            </p>
          ) : (
            <div className="members-grid">
              {members.map((pm) => (
                <div key={pm.id} className="member-card">
                  <div className="member-header">
                    <h3>{pm.member.name}</h3>
                    <span className={`role-badge role-${pm.role.toLowerCase()}`}>
                      {pm.role}
                    </span>
                  </div>
                  <p>📧 {pm.member.email}</p>
                  {pm.member.phone && <p>📞 {pm.member.phone}</p>}
                  <p>📅 Desde: {new Date(pm.joinedAt).toLocaleDateString('pt-BR')}</p>
                  <div className="member-actions">
                    <button
                      onClick={() => handleEditRole(pm)}
                      className="edit-button"
                    >
                      Editar Função
                    </button>
                    <button
                      onClick={() => handleRemoveMember(pm.id, pm.member.name)}
                      className="remove-button"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Adicionar Reunião */}
        {showAddMeetingModal && (
          <div className="modal-overlay" onClick={() => setShowAddMeetingModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Agendar Reunião</h2>
              <div className="form-group">
                <label>Título *</label>
                <input
                  type="text"
                  value={meetingFormData.title}
                  onChange={(e) => setMeetingFormData({ ...meetingFormData, title: e.target.value })}
                  placeholder="Ex: Reunião Mensal"
                  required
                />
              </div>
              <div className="form-group">
                <label>Data e Hora *</label>
                <input
                  type="datetime-local"
                  value={meetingFormData.date}
                  onChange={(e) => setMeetingFormData({ ...meetingFormData, date: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Local</label>
                <input
                  type="text"
                  value={meetingFormData.location}
                  onChange={(e) => setMeetingFormData({ ...meetingFormData, location: e.target.value })}
                  placeholder="Ex: Salão Paroquial"
                />
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  value={meetingFormData.description}
                  onChange={(e) => setMeetingFormData({ ...meetingFormData, description: e.target.value })}
                  rows={3}
                  placeholder="Descreva a pauta da reunião..."
                />
              </div>
              <div className="modal-actions">
                <button onClick={() => setShowAddMeetingModal(false)} className="cancel-button">
                  Cancelar
                </button>
                <button onClick={handleAddMeeting} className="submit-button">
                  Agendar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Adicionar Atividade */}
        {showAddActivityModal && (
          <div className="modal-overlay" onClick={() => setShowAddActivityModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Criar Atividade</h2>
              <div className="form-group">
                <label>Título *</label>
                <input
                  type="text"
                  value={activityFormData.title}
                  onChange={(e) => setActivityFormData({ ...activityFormData, title: e.target.value })}
                  placeholder="Ex: Visita aos Enfermos"
                  required
                />
              </div>
              <div className="form-group">
                <label>Data de Início *</label>
                <input
                  type="date"
                  value={activityFormData.startDate}
                  onChange={(e) => setActivityFormData({ ...activityFormData, startDate: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Data de Término</label>
                <input
                  type="date"
                  value={activityFormData.endDate}
                  onChange={(e) => setActivityFormData({ ...activityFormData, endDate: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Local</label>
                <input
                  type="text"
                  value={activityFormData.location}
                  onChange={(e) => setActivityFormData({ ...activityFormData, location: e.target.value })}
                  placeholder="Ex: Hospital Regional"
                />
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  value={activityFormData.description}
                  onChange={(e) => setActivityFormData({ ...activityFormData, description: e.target.value })}
                  rows={3}
                  placeholder="Descreva a atividade..."
                />
              </div>
              <div className="modal-actions">
                <button onClick={() => setShowAddActivityModal(false)} className="cancel-button">
                  Cancelar
                </button>
                <button onClick={handleAddActivity} className="submit-button">
                  Criar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Adicionar Sub-grupo */}
        {showAddGroupModal && (
          <div className="modal-overlay" onClick={() => setShowAddGroupModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Adicionar Sub-grupo</h2>
              <div className="form-group">
                <label>Nome *</label>
                <input
                  type="text"
                  value={groupFormData.name}
                  onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })}
                  placeholder="Ex: Coral, Ministros da Eucaristia"
                  required
                />
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  value={groupFormData.description}
                  onChange={(e) => setGroupFormData({ ...groupFormData, description: e.target.value })}
                  rows={3}
                  placeholder="Descreva o sub-grupo..."
                />
              </div>
              <div className="modal-actions">
                <button onClick={() => setShowAddGroupModal(false)} className="cancel-button">
                  Cancelar
                </button>
                <button onClick={handleAddGroup} className="submit-button">
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Editar Sub-grupo */}
        {showEditGroupModal && (
          <div className="modal-overlay" onClick={() => setShowEditGroupModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Editar Sub-grupo</h2>
              <div className="form-group">
                <label>Nome *</label>
                <input
                  type="text"
                  value={groupFormData.name}
                  onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  value={groupFormData.description}
                  onChange={(e) => setGroupFormData({ ...groupFormData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button onClick={() => setShowEditGroupModal(false)} className="cancel-button">
                  Cancelar
                </button>
                <button onClick={handleUpdateGroup} className="submit-button">
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Editar Pastoral */}
        {showEditPastoralModal && (
          <div className="modal-overlay" onClick={() => setShowEditPastoralModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Editar Pastoral</h2>
              <div className="form-group">
                <label>Descrição:</label>
                <textarea
                  value={editFormData.description}
                  onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                  rows={3}
                  placeholder="Descreva a pastoral..."
                />
              </div>
              <div className="form-group">
                <label>Missão:</label>
                <textarea
                  value={editFormData.mission}
                  onChange={(e) => setEditFormData({ ...editFormData, mission: e.target.value })}
                  rows={3}
                  placeholder="Qual a missão desta pastoral?"
                />
              </div>
              <div className="form-group">
                <label>Dia da Reunião:</label>
                <input
                  type="text"
                  value={editFormData.meetingDay}
                  onChange={(e) => setEditFormData({ ...editFormData, meetingDay: e.target.value })}
                  placeholder="Ex: Toda segunda-feira"
                />
              </div>
              <div className="form-group">
                <label>Horário da Reunião:</label>
                <input
                  type="time"
                  value={editFormData.meetingTime}
                  onChange={(e) => setEditFormData({ ...editFormData, meetingTime: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Observações:</label>
                <textarea
                  value={editFormData.notes}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                  rows={2}
                  placeholder="Informações adicionais..."
                />
              </div>
              <div className="modal-actions">
                <button onClick={() => setShowEditPastoralModal(false)} className="cancel-button">
                  Cancelar
                </button>
                <button onClick={handleUpdatePastoral} className="submit-button">
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Editar Função */}
        {showEditRoleModal && (
          <div className="modal-overlay" onClick={() => setShowEditRoleModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Editar Função</h2>
              <p><strong>Membro:</strong> {editingMember?.member.name}</p>
              <div className="form-group">
                <label>Função *</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                  <option value="Coordenador">Coordenador</option>
                  <option value="Vice-Coordenador">Vice-Coordenador</option>
                  <option value="Secretário">Secretário</option>
                  <option value="Tesoureiro">Tesoureiro</option>
                  <option value="Membro">Membro</option>
                </select>
              </div>
              <div className="modal-actions">
                <button onClick={() => setShowEditRoleModal(false)} className="cancel-button">
                  Cancelar
                </button>
                <button onClick={handleUpdateRole} className="submit-button">
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Adicionar Membro */}
        {showAddMemberModal && (
          <div className="modal-overlay" onClick={() => setShowAddMemberModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Adicionar Membro</h2>
              <div className="form-group">
                <label>Membro *</label>
                <select
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  required
                >
                  <option value="">Selecione um membro</option>
                  {availableMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} - {member.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Função *</label>
                <select
                  value={memberRole}
                  onChange={(e) => setMemberRole(e.target.value)}
                  required
                >
                  <option value="Coordenador">Coordenador</option>
                  <option value="Vice-Coordenador">Vice-Coordenador</option>
                  <option value="Secretário">Secretário</option>
                  <option value="Tesoureiro">Tesoureiro</option>
                  <option value="Membro">Membro</option>
                </select>
              </div>

              <div className="modal-actions">
                <button onClick={() => setShowAddMemberModal(false)} className="cancel-button">
                  Cancelar
                </button>
                <button onClick={handleAddMember} className="submit-button">
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default CommunityPastoralDetailsPage;
