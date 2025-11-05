import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
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
}

const CommunityPastoralDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pastoral, setPastoral] = useState<CommunityPastoral | null>(null);
  const [members, setMembers] = useState<PastoralMember[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberRole, setMemberRole] = useState('Membro');

  useEffect(() => {
    fetchPastoralDetails();
    fetchAllMembers();
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
            <p><strong>Status:</strong> {pastoral.isActive ? '✅ Ativa' : '❌ Inativa'}</p>
            <p><strong>Criada em:</strong> {new Date(pastoral.createdAt).toLocaleDateString('pt-BR')}</p>
          </div>
        </div>

        {/* Membros */}
        <div className="members-section">
          <div className="section-header">
            <h2>Membros ({members.length})</h2>
            <button onClick={() => setShowAddMemberModal(true)} className="add-button">
              + Adicionar Membro
            </button>
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
