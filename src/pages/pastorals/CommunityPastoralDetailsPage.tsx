import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { formatDate, formatDateTime } from '../../utils/dateFormat';
import { notify, confirm as confirmDialog } from '../../services/notification.service';
import './PastoralsPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Member {
  id: string;
  fullName: string;
  email?: string;
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

interface PastoralGroupMember {
  id: string;
  role?: string;
  isActive: boolean;
  member: { id: string; fullName: string };
}

interface PastoralGroup {
  id: string;
  name: string;
  description?: string;
  photoUrl?: string;
  status: string;
  communityPastoralId: string;
  parentGroupId?: string;
  members?: PastoralGroupMember[];
}

/** Papéis dentro do grupo — "Coordenador" é reconhecido como LÍDER da equipe
 *  (aparece no escalar grupo e habilita a resposta pelo grupo no app). */
const GROUP_MEMBER_ROLES = ['Membro', 'Coordenador', 'Vice-Coordenador'];

/** O backend normaliza "Coordenador" para o canônico COORDINATOR — exibe o rótulo pt. */
const groupRoleLabel = (role?: string | null) => {
  if (role === 'COORDINATOR') return 'Coordenador';
  return role && GROUP_MEMBER_ROLES.includes(role) ? role : 'Membro';
};

interface Meeting {
  id: string;
  title: string;
  description?: string;
  date: string;
  startDate?: string;
  location?: string;
  notes?: string;
  participants?: any[];
  eventPastorals?: any[];
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
  mission?: string;
  notes?: string;
  meetingDay?: string;
  meetingTime?: string;
  status: string;
  createdAt: string;
  globalPastoral: GlobalPastoral;
  community: Community;
  members: PastoralMember[];
  groups?: PastoralGroup[];
}

type MemberViewMode = 'cards' | 'list';

const MEMBER_VIEW_STORAGE_KEY = 'community-pastoral-members-view-mode';

// 'COORDINATOR' (em ingles) e o valor gravado pelo backend quando o vinculo de
// coordenador vem do cadastro de Usuario (role PASTORAL_COORDINATOR) - e o valor
// que o controle de acesso (hierarchy.service.ts) realmente verifica. 'Coordenador'
// e o rotulo em portugues usado quando o vinculo e criado manualmente nesta tela.
// As duas formas precisam ser tratadas como equivalentes na exibicao/ordenacao.
const ROLE_PRIORITY: Record<string, number> = {
  Coordenador: 0,
  COORDINATOR: 0,
  'Vice-Coordenador': 1,
  Secretario: 2,
  'Secretário': 2,
  Tesoureiro: 3,
  Membro: 4,
};

const ROLE_LABELS: Record<string, string> = {
  COORDINATOR: 'Coordenador',
};

const formatRoleLabel = (role: string) => ROLE_LABELS[role] || role;

const getRoleClassName = (role: string) => {
  switch (role) {
    case 'Coordenador':
    case 'COORDINATOR':
      return 'role-coordenador';
    case 'Vice-Coordenador':
      return 'role-vice-coordenador';
    case 'Secretario':
    case 'Secretário':
      return 'role-secretario';
    case 'Tesoureiro':
      return 'role-tesoureiro';
    default:
      return 'role-membro';
  }
};

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

const compareTextValues = (left?: string | null, right?: string | null) =>
  (left || '').localeCompare(right || '', 'pt-BR');

const CommunityPastoralDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pastoral, setPastoral] = useState<CommunityPastoral | null>(null);
  const [members, setMembers] = useState<PastoralMember[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<PastoralGroup[]>([]);
  // Modal de integrantes do sub-grupo
  const [groupMembersId, setGroupMembersId] = useState<string | null>(null);
  const [groupMemberToAdd, setGroupMemberToAdd] = useState('');
  const [groupMemberRole, setGroupMemberRole] = useState('Membro');
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
  const [memberSearchTerm, setMemberSearchTerm] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] = useState('all');
  const [memberViewMode, setMemberViewMode] = useState<MemberViewMode>(() => {
    if (typeof window === 'undefined') {
      return 'cards';
    }

    return window.localStorage.getItem(MEMBER_VIEW_STORAGE_KEY) === 'list'
      ? 'list'
      : 'cards';
  });

  useEffect(() => {
    fetchPastoralDetails();
    fetchAllMembers();
    fetchGroups();
  }, [id]);

  useEffect(() => {
    if (!pastoral?.community.id) {
      return;
    }

    fetchMeetings(pastoral.community.id);
    fetchActivities(pastoral.community.id);
  }, [id, pastoral?.community.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(MEMBER_VIEW_STORAGE_KEY, memberViewMode);
  }, [memberViewMode]);

  const fetchPastoralDetails = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/pastorals/community/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPastoral(response.data);

      const membersResponse = await axios.get(`${API_URL}/pastorals/members`, {
        params: { communityPastoralId: id },
        headers: { Authorization: `Bearer ${token}` },
      });
      setMembers(membersResponse.data);
    } catch (error) {
      console.error('Erro ao carregar pastoral:', error);
      notify.error('Erro ao carregar detalhes da pastoral');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllMembers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/pastorals/community/${id}/available-members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAllMembers(
        response.data.map((member: any) => ({
          id: member.id,
          fullName: member.fullName || 'Membro sem nome',
          email: member.email || '',
          phone: member.phone || '',
        })),
      );
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

  const handleAddGroupMember = async () => {
    if (!groupMembersId || !groupMemberToAdd) {
      notify.warning('Selecione o membro para adicionar ao grupo');
      return;
    }
    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `${API_URL}/pastorals/members`,
        {
          memberId: groupMemberToAdd,
          pastoralGroupId: groupMembersId,
          role: groupMemberRole || 'Membro',
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      notify.success('Integrante adicionado ao grupo!');
      setGroupMemberToAdd('');
      setGroupMemberRole('Membro');
      fetchGroups();
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao adicionar integrante');
    }
  };

  const handleChangeGroupMemberRole = async (groupMember: PastoralGroupMember, role: string) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/pastorals/members/${groupMember.id}`,
        { role },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      notify.success(
        /coorden|coordin|líder/i.test(role)
          ? `${groupMember.member.fullName} agora é líder do grupo.`
          : 'Papel atualizado.',
      );
      fetchGroups();
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao atualizar papel');
    }
  };

  const handleRemoveGroupMember = async (groupMember: PastoralGroupMember) => {
    const confirmed = await confirmDialog.delete(
      `${groupMember.member.fullName} do grupo`,
    );
    if (!confirmed) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/pastorals/members/${groupMember.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Integrante removido do grupo.');
      fetchGroups();
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao remover integrante');
    }
  };

  const handleAddGroup = async () => {
    if (!groupFormData.name.trim()) {
      notify.warning('Nome do sub-grupo é obrigatório');
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
        { headers: { Authorization: `Bearer ${token}` } },
      );

      notify.success('Sub-grupo criado com sucesso!');
      setShowAddGroupModal(false);
      setGroupFormData({ name: '', description: '' });
      fetchGroups();
    } catch (error: any) {
      console.error('Erro ao criar sub-grupo:', error);
      notify.error(error.response?.data?.message || 'Erro ao criar sub-grupo');
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
      notify.warning('Nome do sub-grupo é obrigatório');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/pastorals/groups/${editingGroup.id}`,
        groupFormData,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      notify.success('Sub-grupo atualizado com sucesso!');
      setShowEditGroupModal(false);
      setEditingGroup(null);
      setGroupFormData({ name: '', description: '' });
      fetchGroups();
    } catch (error: any) {
      console.error('Erro ao atualizar sub-grupo:', error);
      notify.error(error.response?.data?.message || 'Erro ao atualizar sub-grupo');
    }
  };

  const handleRemoveGroup = async (groupId: string, groupName: string) => {
    const confirmed = await confirmDialog.delete(`o sub-grupo "${groupName}"`);
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/pastorals/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      notify.success('Sub-grupo removido com sucesso!');
      fetchGroups();
    } catch (error: any) {
      console.error('Erro ao remover sub-grupo:', error);
      notify.error(error.response?.data?.message || 'Erro ao remover sub-grupo');
    }
  };

  const fetchMeetings = async (communityId?: string) => {
    if (!communityId) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/events`, {
        params: {
          type: 'PASTORAL_MEETING',
          communityId,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      const pastoralMeetings = response.data.filter((event: any) =>
        event.eventPastorals?.some(
          (eventPastoral: any) => eventPastoral.communityPastoralId === id,
        ),
      );

      setMeetings(pastoralMeetings);
    } catch (error) {
      console.error('Erro ao carregar reuniões:', error);
    }
  };

  const handleAddMeeting = async () => {
    if (!meetingFormData.title.trim() || !meetingFormData.date || !pastoral) {
      notify.warning('Título e data são obrigatórios');
      return;
    }

    try {
      const token = localStorage.getItem('token');
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
        { headers: { Authorization: `Bearer ${token}` } },
      );

      await axios.post(
        `${API_URL}/events/${eventResponse.data.id}/pastorals`,
        {
          communityPastoralId: id,
          role: 'Organizadora',
          isLeader: true,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      notify.success('Reunião criada com sucesso!');
      setShowAddMeetingModal(false);
      setMeetingFormData({ title: '', description: '', date: '', location: '' });
      fetchMeetings(pastoral.community.id);
    } catch (error: any) {
      console.error('Erro ao criar reunião:', error);
      notify.error(error.response?.data?.message || 'Erro ao criar reunião');
    }
  };

  const fetchActivities = async (communityId?: string) => {
    if (!communityId) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/events`, {
        params: {
          type: 'PASTORAL_ACTIVITY',
          communityId,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      const pastoralActivities = response.data.filter((event: any) =>
        event.eventPastorals?.some(
          (eventPastoral: any) => eventPastoral.communityPastoralId === id,
        ),
      );

      setActivities(pastoralActivities);
    } catch (error) {
      console.error('Erro ao carregar atividades:', error);
    }
  };

  const handleAddActivity = async () => {
    if (!activityFormData.title.trim() || !activityFormData.startDate || !pastoral) {
      notify.warning('Título e data de início são obrigatórios');
      return;
    }

    try {
      const token = localStorage.getItem('token');
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
        { headers: { Authorization: `Bearer ${token}` } },
      );

      await axios.post(
        `${API_URL}/events/${eventResponse.data.id}/pastorals`,
        {
          communityPastoralId: id,
          role: 'Organizadora',
          isLeader: true,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      notify.success('Atividade criada com sucesso!');
      setShowAddActivityModal(false);
      setActivityFormData({
        title: '',
        description: '',
        startDate: '',
        endDate: '',
        location: '',
      });
      fetchActivities(pastoral.community.id);
    } catch (error: any) {
      console.error('Erro ao criar atividade:', error);
      notify.error(error.response?.data?.message || 'Erro ao criar atividade');
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
      mission: pastoral.mission || '',
      meetingDay: pastoral.meetingDay || '',
      meetingTime: pastoral.meetingTime || '',
      notes: pastoral.notes || '',
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
        { headers: { Authorization: `Bearer ${token}` } },
      );

      await fetchPastoralDetails();
      setShowEditPastoralModal(false);
      notify.success('Pastoral atualizada com sucesso!');
    } catch (error: any) {
      console.error('Erro ao atualizar pastoral:', error);
      notify.error(error.response?.data?.message || 'Erro ao atualizar pastoral');
    }
  };

  const handleToggleStatus = async () => {
    if (!pastoral) return;

    const isCurrentlyActive = pastoral.status === 'ACTIVE';
    const action = isCurrentlyActive ? 'desativar' : 'ativar';
    const confirmed = await confirmDialog.action(
      `${action.charAt(0).toUpperCase() + action.slice(1)} pastoral`,
      `Deseja ${action} esta pastoral?`,
    );
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/pastorals/community/${pastoral.id}`,
        { status: isCurrentlyActive ? 'INACTIVE' : 'ACTIVE' },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      await fetchPastoralDetails();
      notify.success(`Pastoral ${isCurrentlyActive ? 'desativada' : 'ativada'} com sucesso!`);
    } catch (error: any) {
      console.error('Erro ao alterar status:', error);
      notify.error(error.response?.data?.message || 'Erro ao alterar status da pastoral');
    }
  };

  const handleUpdateRole = async () => {
    if (!editingMember) return;

    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/pastorals/members/${editingMember.id}`,
        { role: editRole },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      await fetchPastoralDetails();
      setShowEditRoleModal(false);
      setEditingMember(null);
      notify.success('Função atualizada com sucesso!');
    } catch (error: any) {
      console.error('Erro ao atualizar função:', error);
      notify.error(error.response?.data?.message || 'Erro ao atualizar função');
    }
  };

  const handleAddMember = async () => {
    if (!selectedMemberId) {
      notify.warning('Selecione um membro');
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
        { headers: { Authorization: `Bearer ${token}` } },
      );

      notify.success('Membro adicionado com sucesso!');
      setShowAddMemberModal(false);
      setSelectedMemberId('');
      setMemberRole('Membro');
      fetchPastoralDetails();
      fetchAllMembers();
    } catch (error: any) {
      console.error('Erro ao adicionar membro:', error);
      notify.error(error.response?.data?.message || 'Erro ao adicionar membro');
    }
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    const confirmed = await confirmDialog.delete(`${memberName} da pastoral`);
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/pastorals/members/${memberId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      notify.success('Membro removido com sucesso!');
      fetchPastoralDetails();
      fetchAllMembers();
    } catch (error: any) {
      console.error('Erro ao remover membro:', error);
      notify.error(error.response?.data?.message || 'Erro ao remover membro');
    }
  };

  if (loading) {
    return (
      <div className="pastorals-page community-pastoral-page">
        <p>Carregando...</p>
      </div>
    );
  }

  if (!pastoral) {
    return (
      <div className="pastorals-page community-pastoral-page">
        <p>Pastoral não encontrada</p>
      </div>
    );
  }

  const availableMembers = allMembers
    .filter(
      (member) => !members.some((pastoralMember) => pastoralMember.member?.id === member.id),
    )
    .sort((left, right) => compareTextValues(left.fullName, right.fullName));

  const sortedMembers = [...members].sort((left, right) => {
    const priorityDiff = (ROLE_PRIORITY[left.role] ?? 99) - (ROLE_PRIORITY[right.role] ?? 99);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return compareTextValues(left.member?.fullName, right.member?.fullName);
  });

  const sortedGroups = [...groups].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'ACTIVE' ? -1 : 1;
    }

    return compareTextValues(left.name, right.name);
  });

  const memberRoleOptions = [...new Set(sortedMembers.map((member) => member.role).filter(Boolean))]
    .sort((left, right) => (ROLE_PRIORITY[left] ?? 99) - (ROLE_PRIORITY[right] ?? 99));

  const normalizedMemberSearch = memberSearchTerm.trim().toLowerCase();
  const filteredMembers = sortedMembers.filter((pastoralMember) => {
    const matchesRole =
      memberRoleFilter === 'all' || pastoralMember.role === memberRoleFilter;

    const matchesSearch =
      normalizedMemberSearch.length === 0 ||
      [
        pastoralMember.member?.fullName,
        pastoralMember.member?.email,
        pastoralMember.member?.phone,
        pastoralMember.role,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedMemberSearch));

    return matchesRole && matchesSearch;
  });

  const sortedMeetings = [...meetings].sort(
    (left, right) =>
      new Date(left.startDate || left.date).getTime() -
      new Date(right.startDate || right.date).getTime(),
  );

  const sortedActivities = [...activities].sort(
    (left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime(),
  );

  const pastoralSummary =
    pastoral.description?.trim() ||
    `Equipe pastoral vinculada à comunidade ${pastoral.community.name}.`;

  const meetingSchedule =
    pastoral.meetingDay && pastoral.meetingTime
      ? `${pastoral.meetingDay} às ${pastoral.meetingTime}`
      : 'Agenda recorrente não definida';

  const leadershipLabel =
    sortedMembers
      .filter(
        (member) =>
          member.role === 'Coordenador' ||
          member.role === 'COORDINATOR' ||
          member.role === 'Vice-Coordenador',
      )
      .map((member) => member.member?.fullName || 'Membro sem nome')
      .join(' • ') || 'Coordenação não definida';

  const nextMeeting =
    sortedMeetings.find(
      (meeting) => new Date(meeting.startDate || meeting.date).getTime() >= Date.now(),
    ) || sortedMeetings[0];

  const renderEmptyState = (title: string, description: string) => (
    <div className="community-pastoral-empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );

  return (
    <div className="pastorals-page community-pastoral-page">
      <div className="community-pastoral-hero">
        <div className="community-pastoral-hero-main">
          <button
            onClick={() => navigate('/admin/pastorals/community')}
            className="back-button"
          >
            ← Voltar
          </button>

          <div className="community-pastoral-context-row">
            <span className="community-pastoral-context-pill">
              Comunidade {pastoral.community.name}
            </span>
            <span
              className={`community-pastoral-status-badge ${
                pastoral.status === 'ACTIVE' ? 'active' : 'inactive'
              }`}
            >
              {pastoral.status === 'ACTIVE' ? 'Pastoral ativa' : 'Pastoral inativa'}
            </span>
          </div>

          <h1>{pastoral.globalPastoral.name}</h1>
          <p className="community-pastoral-summary">{pastoralSummary}</p>
        </div>

        <div className="community-pastoral-hero-actions">
          <button onClick={handleOpenEditPastoral} className="edit-button">
            Editar pastoral
          </button>
          <button
            onClick={handleToggleStatus}
            className={`toggle-status-button ${
              pastoral.status === 'ACTIVE'
                ? 'toggle-status-button--warning'
                : 'toggle-status-button--success'
            }`}
          >
            {pastoral.status === 'ACTIVE' ? 'Desativar pastoral' : 'Ativar pastoral'}
          </button>
          <button onClick={() => setShowAddMemberModal(true)} className="add-button">
            Adicionar membro
          </button>
        </div>

        <div className="community-pastoral-meta-grid">
          <div className="community-pastoral-meta-card">
            <span className="community-pastoral-meta-label">Reunião recorrente</span>
            <strong className="community-pastoral-meta-value">{meetingSchedule}</strong>
          </div>
          <div className="community-pastoral-meta-card">
            <span className="community-pastoral-meta-label">Coordenação</span>
            <strong className="community-pastoral-meta-value">{leadershipLabel}</strong>
          </div>
          <div className="community-pastoral-meta-card">
            <span className="community-pastoral-meta-label">Próxima reunião</span>
            <strong className="community-pastoral-meta-value">
              {nextMeeting
                ? formatDateTime(nextMeeting.startDate || nextMeeting.date)
                : 'Nenhuma reunião agendada'}
            </strong>
          </div>
          <div className="community-pastoral-meta-card">
            <span className="community-pastoral-meta-label">Criada em</span>
            <strong className="community-pastoral-meta-value">{formatDate(pastoral.createdAt)}</strong>
          </div>
        </div>
      </div>

      <div className="community-pastoral-stat-grid">
        <div className="community-pastoral-stat-card community-pastoral-stat-card--blue">
          <span className="community-pastoral-stat-label">Membros ativos</span>
          <strong className="community-pastoral-stat-value">{sortedMembers.length}</strong>
        </div>
        <div className="community-pastoral-stat-card community-pastoral-stat-card--violet">
          <span className="community-pastoral-stat-label">Sub-grupos</span>
          <strong className="community-pastoral-stat-value">{sortedGroups.length}</strong>
        </div>
        <div className="community-pastoral-stat-card community-pastoral-stat-card--amber">
          <span className="community-pastoral-stat-label">Reuniões</span>
          <strong className="community-pastoral-stat-value">{sortedMeetings.length}</strong>
        </div>
        <div className="community-pastoral-stat-card community-pastoral-stat-card--green">
          <span className="community-pastoral-stat-label">Atividades</span>
          <strong className="community-pastoral-stat-value">{sortedActivities.length}</strong>
        </div>
      </div>

      <div className="community-pastoral-content-grid">
        <section
          className={`community-pastoral-section community-pastoral-section--members ${
            memberViewMode === 'list' ? 'community-pastoral-section--list' : ''
          }`}
        >
          <div className="community-pastoral-section-header">
            <div className="community-pastoral-section-heading">
              <span className="community-pastoral-section-kicker">Equipe pastoral</span>
              <h2>Membros</h2>
              <p>Equipe vinculada e apta a atuar nesta pastoral.</p>
            </div>
            <div className="community-pastoral-action-group">
              <div className="community-pastoral-view-toggle" role="group" aria-label="Modo de exibição dos membros">
                <button
                  type="button"
                  className={`community-pastoral-view-button ${
                    memberViewMode === 'cards' ? 'is-active' : ''
                  }`}
                  onClick={() => setMemberViewMode('cards')}
                >
                  Cards
                </button>
                <button
                  type="button"
                  className={`community-pastoral-view-button ${
                    memberViewMode === 'list' ? 'is-active' : ''
                  }`}
                  onClick={() => setMemberViewMode('list')}
                >
                  Lista
                </button>
              </div>
              <button onClick={() => setShowAddMemberModal(true)} className="add-button">
                Adicionar membro
              </button>
            </div>
          </div>

          {sortedMembers.length > 0 && (
            <div className="community-pastoral-member-toolbar">
              <div className="community-pastoral-member-search-group">
                <input
                  type="text"
                  value={memberSearchTerm}
                  onChange={(event) => setMemberSearchTerm(event.target.value)}
                  className="community-pastoral-member-search"
                  placeholder="Buscar por nome, e-mail, telefone ou função"
                />
              </div>
              <div className="community-pastoral-member-filter-group">
                <select
                  value={memberRoleFilter}
                  onChange={(event) => setMemberRoleFilter(event.target.value)}
                  className="community-pastoral-member-filter"
                >
                  <option value="all">Todas as funções</option>
                  {memberRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {formatRoleLabel(role)}
                    </option>
                  ))}
                </select>
                <span className="community-pastoral-member-count">
                  Exibindo {filteredMembers.length} de {sortedMembers.length}
                </span>
              </div>
            </div>
          )}

          {sortedMembers.length === 0 ? (
            renderEmptyState(
              'Nenhum membro vinculado',
              'Adicione membros da comunidade para formar a equipe desta pastoral.',
            )
          ) : filteredMembers.length === 0 ? (
            renderEmptyState(
              'Nenhum membro encontrado',
              'Ajuste a busca ou o filtro para localizar outro membro da equipe.',
            )
          ) : memberViewMode === 'list' ? (
            <div className="community-pastoral-member-list-wrapper">
              <div className="community-pastoral-member-list-head">
                <span>Membro</span>
                <span>Função</span>
                <span>Telefone</span>
                <span>Desde</span>
                <span className="community-pastoral-member-list-head-actions">Ações</span>
              </div>
              <div className="community-pastoral-member-list">
                {filteredMembers.map((pastoralMember) => (
                <article key={pastoralMember.id} className="community-pastoral-member-row">
                  <div className="community-pastoral-member-row-primary">
                    <div className="community-pastoral-member-avatar">
                      {getInitials(pastoralMember.member?.fullName || 'Membro')}
                    </div>
                    <div className="community-pastoral-member-copy">
                      <h3>{pastoralMember.member?.fullName || 'Membro sem nome'}</h3>
                      <p>{pastoralMember.member?.email || 'Sem e-mail cadastrado'}</p>
                    </div>
                  </div>

                  <div className="community-pastoral-member-row-cell" data-label="Função">
                    <span className={`role-badge ${getRoleClassName(pastoralMember.role)}`}>
                      {formatRoleLabel(pastoralMember.role)}
                    </span>
                  </div>

                  <div className="community-pastoral-member-row-cell" data-label="Telefone">
                    <strong className="community-pastoral-row-value">
                      {pastoralMember.member?.phone || 'Não informado'}
                    </strong>
                  </div>

                  <div className="community-pastoral-member-row-cell" data-label="Desde">
                    <strong className="community-pastoral-row-value">
                      {formatDate(pastoralMember.joinedAt)}
                    </strong>
                  </div>

                  <div className="community-pastoral-action-row community-pastoral-action-row--inline">
                    <button
                      onClick={() => handleEditRole(pastoralMember)}
                      className="edit-button"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() =>
                        handleRemoveMember(
                          pastoralMember.id,
                          pastoralMember.member?.fullName || 'Membro sem nome',
                        )
                      }
                      className="remove-button"
                    >
                      Remover
                    </button>
                  </div>
                </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="community-pastoral-member-grid">
              {filteredMembers.map((pastoralMember) => (
                <article key={pastoralMember.id} className="community-pastoral-member-card">
                  <div className="community-pastoral-member-top">
                    <div className="community-pastoral-member-identity">
                      <div className="community-pastoral-member-avatar">
                        {getInitials(pastoralMember.member?.fullName || 'Membro')}
                      </div>
                      <div className="community-pastoral-member-copy">
                        <h3>{pastoralMember.member?.fullName || 'Membro sem nome'}</h3>
                        <p>{pastoralMember.member?.email || 'Sem e-mail cadastrado'}</p>
                      </div>
                    </div>
                    <span className={`role-badge ${getRoleClassName(pastoralMember.role)}`}>
                      {formatRoleLabel(pastoralMember.role)}
                    </span>
                  </div>

                  <div className="community-pastoral-detail-list">
                    <div className="community-pastoral-detail-item">
                      <span className="community-pastoral-detail-label">Telefone</span>
                      <span className="community-pastoral-detail-value">
                        {pastoralMember.member?.phone || 'Não informado'}
                      </span>
                    </div>
                    <div className="community-pastoral-detail-item">
                      <span className="community-pastoral-detail-label">Desde</span>
                      <span className="community-pastoral-detail-value">
                        {formatDate(pastoralMember.joinedAt)}
                      </span>
                    </div>
                  </div>

                  <div className="community-pastoral-action-row">
                    <button
                      onClick={() => handleEditRole(pastoralMember)}
                      className="edit-button"
                    >
                      Editar função
                    </button>
                    <button
                      onClick={() =>
                        handleRemoveMember(
                          pastoralMember.id,
                          pastoralMember.member?.fullName || 'Membro sem nome',
                        )
                      }
                      className="remove-button"
                    >
                      Remover
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="community-pastoral-section">
          <div className="community-pastoral-section-header">
            <div className="community-pastoral-section-heading">
              <span className="community-pastoral-section-kicker">Agenda interna</span>
              <h2>Reuniões</h2>
              <p>Encontros e alinhamentos desta equipe pastoral.</p>
            </div>
            <div className="community-pastoral-action-group">
              <button onClick={() => setShowAddMeetingModal(true)} className="add-button">
                Agendar reunião
              </button>
            </div>
          </div>

          {sortedMeetings.length === 0 ? (
            renderEmptyState(
              'Sem reuniões cadastradas',
              'Cadastre os próximos encontros para organizar a rotina da equipe.',
            )
          ) : (
            <div className="community-pastoral-collection-list">
              {sortedMeetings.map((meeting) => {
                const totalAssignments = meeting.eventPastorals?.[0]?.assignments?.length || 0;
                const checkedInAssignments =
                  meeting.eventPastorals?.[0]?.assignments?.filter(
                    (assignment: any) => assignment.checkedInAt,
                  ).length || 0;

                return (
                  <article key={meeting.id} className="community-pastoral-collection-card">
                    <div className="community-pastoral-collection-header">
                      <h3>{meeting.title}</h3>
                      <span className="community-pastoral-mini-badge is-blue">Reunião</span>
                    </div>

                    <div className="community-pastoral-detail-list community-pastoral-detail-list--compact">
                      <div className="community-pastoral-detail-item">
                        <span className="community-pastoral-detail-label">Quando</span>
                        <span className="community-pastoral-detail-value">
                          {formatDateTime(meeting.startDate || meeting.date)}
                        </span>
                      </div>
                      <div className="community-pastoral-detail-item">
                        <span className="community-pastoral-detail-label">Local</span>
                        <span className="community-pastoral-detail-value">
                          {meeting.location || 'A definir'}
                        </span>
                      </div>
                      {totalAssignments > 0 && (
                        <div className="community-pastoral-detail-item">
                          <span className="community-pastoral-detail-label">Presenças</span>
                          <span className="community-pastoral-detail-value">
                            {checkedInAssignments}/{totalAssignments}
                          </span>
                        </div>
                      )}
                    </div>

                    {meeting.description && (
                      <p className="community-pastoral-collection-description">
                        {meeting.description}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="community-pastoral-section">
          <div className="community-pastoral-section-header">
            <div className="community-pastoral-section-heading">
              <span className="community-pastoral-section-kicker">Ações pastorais</span>
              <h2>Atividades</h2>
              <p>Eventos, ações e iniciativas organizadas pela pastoral.</p>
            </div>
            <div className="community-pastoral-action-group">
              <button onClick={() => setShowAddActivityModal(true)} className="add-button">
                Criar atividade
              </button>
            </div>
          </div>

          {sortedActivities.length === 0 ? (
            renderEmptyState(
              'Sem atividades cadastradas',
              'Crie ações pastorais para registrar o calendário e os compromissos da equipe.',
            )
          ) : (
            <div className="community-pastoral-collection-list">
              {sortedActivities.map((activity) => (
                <article key={activity.id} className="community-pastoral-collection-card">
                  <div className="community-pastoral-collection-header">
                    <h3>{activity.title}</h3>
                    <span className="community-pastoral-mini-badge is-green">Atividade</span>
                  </div>

                  <div className="community-pastoral-detail-list community-pastoral-detail-list--compact">
                    <div className="community-pastoral-detail-item">
                      <span className="community-pastoral-detail-label">Início</span>
                      <span className="community-pastoral-detail-value">
                        {formatDate(activity.startDate)}
                      </span>
                    </div>
                    {activity.endDate && (
                      <div className="community-pastoral-detail-item">
                        <span className="community-pastoral-detail-label">Término</span>
                        <span className="community-pastoral-detail-value">
                          {formatDate(activity.endDate)}
                        </span>
                      </div>
                    )}
                    <div className="community-pastoral-detail-item">
                      <span className="community-pastoral-detail-label">Local</span>
                      <span className="community-pastoral-detail-value">
                        {activity.location || 'A definir'}
                      </span>
                    </div>
                  </div>

                  {activity.description && (
                    <p className="community-pastoral-collection-description">
                      {activity.description}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="community-pastoral-section">
          <div className="community-pastoral-section-header">
            <div className="community-pastoral-section-heading">
              <span className="community-pastoral-section-kicker">Organização interna</span>
              <h2>Sub-grupos</h2>
              <p>Equipes auxiliares, frentes ou divisões internas da pastoral.</p>
            </div>
            <div className="community-pastoral-action-group">
              <button onClick={() => setShowAddGroupModal(true)} className="add-button">
                Adicionar sub-grupo
              </button>
            </div>
          </div>

          {sortedGroups.length === 0 ? (
            renderEmptyState(
              'Sem sub-grupos cadastrados',
              'Use sub-grupos para organizar frentes internas ou equipes de apoio.',
            )
          ) : (
            <div className="community-pastoral-collection-list">
              {sortedGroups.map((group) => {
                const activeMembers = (group.members ?? []).filter((m) => m.isActive);
                const leader = activeMembers.find((m) => /coorden|coordin|líder/i.test(m.role || ''));
                return (
                  <article key={group.id} className="group-card">
                    <div className="group-card-main">
                      <div className="group-card-avatar" aria-hidden="true">
                        {group.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="group-card-body">
                        <div className="group-card-title-row">
                          <h3>{group.name}</h3>
                          <span
                            className={`community-pastoral-mini-badge ${
                              group.status === 'ACTIVE' ? 'is-green' : 'is-slate'
                            }`}
                          >
                            {group.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        {group.description ? (
                          <p className="group-card-desc">{group.description}</p>
                        ) : null}
                        <div className="group-card-chips">
                          <span className="group-chip">
                            👥 {activeMembers.length} integrante{activeMembers.length === 1 ? '' : 's'}
                          </span>
                          {leader ? (
                            <span className="group-chip is-leader" title="Líder do grupo (papel Coordenador)">
                              ⭐ {leader.member.fullName}
                            </span>
                          ) : (
                            <span
                              className="group-chip is-warn"
                              title="Defina o papel Coordenador em um integrante — ele responde pela equipe nas escalas"
                            >
                              ⚠ Sem líder definido
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="group-card-actions">
                      <button
                        onClick={() => {
                          setGroupMembersId(group.id);
                          setGroupMemberToAdd('');
                          setGroupMemberRole('Membro');
                        }}
                        className="group-btn primary"
                      >
                        👥 Integrantes
                      </button>
                      <button onClick={() => handleEditGroup(group)} className="group-btn">
                        Editar
                      </button>
                      <button
                        onClick={() => handleRemoveGroup(group.id, group.name)}
                        className="group-btn danger"
                      >
                        Remover
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {groupMembersId && (() => {
        const activeGroup = groups.find((g) => g.id === groupMembersId);
        if (!activeGroup) return null;
        const groupMembers = (activeGroup.members ?? []).filter((m) => m.isActive);
        const availableMembers = members.filter(
          (pm: any) =>
            pm.isActive !== false &&
            pm.member?.id &&
            !groupMembers.some((gm) => gm.member.id === pm.member.id),
        );
        return (
          <div className="modal-overlay" onClick={() => setGroupMembersId(null)}>
            <div className="modal-content" onClick={(event) => event.stopPropagation()}>
              <h2>Integrantes — {activeGroup.name}</h2>
              <p style={{ color: '#666', fontSize: '0.88rem', margin: '0 0 1rem' }}>
                O papel <strong>Coordenador</strong> define o líder: ele aparece no “Escalar grupo”
                e pode confirmar/recusar a escala pelo grupo no aplicativo.
              </p>

              {groupMembers.length === 0 ? (
                <p style={{ color: '#888', fontStyle: 'italic' }}>Nenhum integrante ainda.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto', marginBottom: '1rem' }}>
                  {groupMembers.map((gm) => (
                    <div
                      key={gm.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '8px 12px',
                      }}
                    >
                      <span style={{ flex: 1, fontWeight: 600 }}>
                        {gm.member.fullName}
                        {/coorden|coordin|líder/i.test(gm.role || '') ? ' ⭐' : ''}
                      </span>
                      <select
                        className="group-select"
                        value={groupRoleLabel(gm.role)}
                        onChange={(event) => handleChangeGroupMemberRole(gm, event.target.value)}
                        style={{ width: 170 }}
                      >
                        {GROUP_MEMBER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        className="remove-button"
                        style={{ padding: '6px 12px' }}
                        onClick={() => handleRemoveGroupMember(gm)}
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="form-group">
                <label>Adicionar integrante (membros desta pastoral)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="group-select"
                    value={groupMemberToAdd}
                    onChange={(event) => setGroupMemberToAdd(event.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Selecione o membro</option>
                    {availableMembers.map((pm: any) => (
                      <option key={pm.member.id} value={pm.member.id}>
                        {pm.member.fullName}
                      </option>
                    ))}
                  </select>
                  <select
                    className="group-select"
                    value={groupMemberRole}
                    onChange={(event) => setGroupMemberRole(event.target.value)}
                    style={{ width: 170 }}
                  >
                    {GROUP_MEMBER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <button className="add-button" onClick={handleAddGroupMember}>
                    Adicionar
                  </button>
                </div>
                {availableMembers.length === 0 && (
                  <p style={{ color: '#888', fontSize: '0.82rem', marginTop: 6 }}>
                    Todos os membros da pastoral já estão neste grupo — adicione novos membros à
                    pastoral pelo botão “Adicionar membro” no topo da página.
                  </p>
                )}
              </div>

              <div className="modal-actions">
                <button className="btn-cancel" onClick={() => setGroupMembersId(null)}>
                  Fechar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showAddMeetingModal && (
        <div className="modal-overlay" onClick={() => setShowAddMeetingModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <h2>Agendar reunião</h2>
            <div className="form-group">
              <label>Título *</label>
              <input
                type="text"
                value={meetingFormData.title}
                onChange={(event) =>
                  setMeetingFormData({ ...meetingFormData, title: event.target.value })
                }
                placeholder="Ex: Reunião mensal"
                required
              />
            </div>
            <div className="form-group">
              <label>Data e hora *</label>
              <input
                type="datetime-local"
                value={meetingFormData.date}
                onChange={(event) =>
                  setMeetingFormData({ ...meetingFormData, date: event.target.value })
                }
                required
              />
            </div>
            <div className="form-group">
              <label>Local</label>
              <input
                type="text"
                value={meetingFormData.location}
                onChange={(event) =>
                  setMeetingFormData({ ...meetingFormData, location: event.target.value })
                }
                placeholder="Ex: Salão paroquial"
              />
            </div>
            <div className="form-group">
              <label>Descrição</label>
              <textarea
                value={meetingFormData.description}
                onChange={(event) =>
                  setMeetingFormData({ ...meetingFormData, description: event.target.value })
                }
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

      {showAddActivityModal && (
        <div className="modal-overlay" onClick={() => setShowAddActivityModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <h2>Criar atividade</h2>
            <div className="form-group">
              <label>Título *</label>
              <input
                type="text"
                value={activityFormData.title}
                onChange={(event) =>
                  setActivityFormData({ ...activityFormData, title: event.target.value })
                }
                placeholder="Ex: Visita aos enfermos"
                required
              />
            </div>
            <div className="form-group">
              <label>Data de início *</label>
              <input
                type="date"
                value={activityFormData.startDate}
                onChange={(event) =>
                  setActivityFormData({ ...activityFormData, startDate: event.target.value })
                }
                required
              />
            </div>
            <div className="form-group">
              <label>Data de término</label>
              <input
                type="date"
                value={activityFormData.endDate}
                onChange={(event) =>
                  setActivityFormData({ ...activityFormData, endDate: event.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Local</label>
              <input
                type="text"
                value={activityFormData.location}
                onChange={(event) =>
                  setActivityFormData({ ...activityFormData, location: event.target.value })
                }
                placeholder="Ex: Hospital Regional"
              />
            </div>
            <div className="form-group">
              <label>Descrição</label>
              <textarea
                value={activityFormData.description}
                onChange={(event) =>
                  setActivityFormData({ ...activityFormData, description: event.target.value })
                }
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

      {showAddGroupModal && (
        <div className="modal-overlay" onClick={() => setShowAddGroupModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <h2>Adicionar sub-grupo</h2>
            <div className="form-group">
              <label>Nome *</label>
              <input
                type="text"
                value={groupFormData.name}
                onChange={(event) =>
                  setGroupFormData({ ...groupFormData, name: event.target.value })
                }
                placeholder="Ex: Coral, Ministros da Eucaristia"
                required
              />
            </div>
            <div className="form-group">
              <label>Descrição</label>
              <textarea
                value={groupFormData.description}
                onChange={(event) =>
                  setGroupFormData({ ...groupFormData, description: event.target.value })
                }
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

      {showEditGroupModal && (
        <div className="modal-overlay" onClick={() => setShowEditGroupModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <h2>Editar sub-grupo</h2>
            <div className="form-group">
              <label>Nome *</label>
              <input
                type="text"
                value={groupFormData.name}
                onChange={(event) =>
                  setGroupFormData({ ...groupFormData, name: event.target.value })
                }
                required
              />
            </div>
            <div className="form-group">
              <label>Descrição</label>
              <textarea
                value={groupFormData.description}
                onChange={(event) =>
                  setGroupFormData({ ...groupFormData, description: event.target.value })
                }
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

      {showEditPastoralModal && (
        <div className="modal-overlay" onClick={() => setShowEditPastoralModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <h2>Editar pastoral</h2>
            <div className="form-group">
              <label>Descrição</label>
              <textarea
                value={editFormData.description}
                onChange={(event) =>
                  setEditFormData({ ...editFormData, description: event.target.value })
                }
                rows={3}
                placeholder="Descreva a pastoral..."
              />
            </div>
            <div className="form-group">
              <label>Missão</label>
              <textarea
                value={editFormData.mission}
                onChange={(event) =>
                  setEditFormData({ ...editFormData, mission: event.target.value })
                }
                rows={3}
                placeholder="Qual a missão desta pastoral?"
              />
            </div>
            <div className="form-group">
              <label>Dia da reunião</label>
              <input
                type="text"
                value={editFormData.meetingDay}
                onChange={(event) =>
                  setEditFormData({ ...editFormData, meetingDay: event.target.value })
                }
                placeholder="Ex: Toda segunda-feira"
              />
            </div>
            <div className="form-group">
              <label>Horário da reunião</label>
              <input
                type="time"
                value={editFormData.meetingTime}
                onChange={(event) =>
                  setEditFormData({ ...editFormData, meetingTime: event.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Observações</label>
              <textarea
                value={editFormData.notes}
                onChange={(event) => setEditFormData({ ...editFormData, notes: event.target.value })}
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

      {showEditRoleModal && (
        <div className="modal-overlay" onClick={() => setShowEditRoleModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <h2>Editar função</h2>
            <p>
              <strong>Membro:</strong> {editingMember?.member?.fullName || 'Membro sem nome'}
            </p>
            <div className="form-group">
              <label>Função *</label>
              <select value={editRole} onChange={(event) => setEditRole(event.target.value)}>
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

      {showAddMemberModal && (
        <div className="modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <h2>Adicionar membro</h2>
            <div className="form-group">
              <label>Membro *</label>
              <select
                value={selectedMemberId}
                onChange={(event) => setSelectedMemberId(event.target.value)}
                required
              >
                <option value="">Selecione um membro</option>
                {availableMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName} {member.email ? `- ${member.email}` : ''}
                  </option>
                ))}
              </select>
              {availableMembers.length === 0 && (
                <p className="community-pastoral-modal-note">
                  Todos os membros ativos da comunidade já estão vinculados a esta pastoral.
                </p>
              )}
            </div>

            <div className="form-group">
              <label>Função *</label>
              <select
                value={memberRole}
                onChange={(event) => setMemberRole(event.target.value)}
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
