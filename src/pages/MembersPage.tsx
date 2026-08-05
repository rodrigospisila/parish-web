import React, { useState, useEffect, useMemo } from 'react';
import TitleIcon from '../components/TitleIcon';
import axios from 'axios';
import { notify, confirm } from '../services/notification.service';
import SacramentsModal from '../components/SacramentsModal';
import SaintAvatar, { avatarColor, initials } from '../components/SaintAvatar';
import SearchSelect from '../components/SearchSelect';
import { usePatronSaints } from '../components/PatronSaintsManager';
import './MembersPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Community {
  id: string;
  name: string;
  city?: string;
  state?: string;
  parish?: { id: string; name: string };
}

interface Member {
  id: string;
  fullName: string;
  cpf?: string;
  rg?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  birthDate?: string;
  maritalStatus?: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | 'COMMON_LAW_MARRIAGE';
  occupation?: string;
  email?: string;
  phone?: string;
  zipCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  fatherName?: string;
  motherName?: string;
  spouseId?: string;
  spouse?: { id: string; fullName: string };
  photoUrl?: string;
  memberType?: MemberType;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  status: MemberStatus;
  community: Community;
  createdAt: string;
}

type MemberStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'DECEASED'
  | 'ANONYMIZED'
  | 'AWAY'
  | 'IN_FORMATION'
  | 'TRANSFERRED'
  | 'DISENGAGED';

type MemberType =
  | 'MEMBER'
  | 'AGENT'
  | 'COORDINATOR'
  | 'CATECHIST'
  | 'MINISTER'
  | 'VOLUNTEER'
  | 'FAMILY_RESPONSIBLE'
  | 'CANDIDATE';

const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  DECEASED: 'Falecido',
  ANONYMIZED: 'Anonimizado',
  AWAY: 'Afastado',
  IN_FORMATION: 'Em formação',
  TRANSFERRED: 'Transferido',
  DISENGAGED: 'Desligado',
};

const STATUS_CHIP_COLORS: Record<MemberStatus, string> = {
  ACTIVE: 'green',
  INACTIVE: 'gray',
  DECEASED: 'gray',
  ANONYMIZED: 'gray',
  AWAY: 'yellow',
  IN_FORMATION: 'blue',
  TRANSFERRED: 'blue',
  DISENGAGED: 'red',
};

const statusChip = (status: MemberStatus) => (
  <span className={`status-badge ${STATUS_CHIP_COLORS[status] ?? 'gray'}`}>
    {MEMBER_STATUS_LABELS[status] ?? status}
  </span>
);

const MEMBER_TYPE_LABELS: Record<MemberType, string> = {
  MEMBER: 'Membro',
  AGENT: 'Agente de pastoral',
  COORDINATOR: 'Coordenador',
  CATECHIST: 'Catequista',
  MINISTER: 'Ministro',
  VOLUNTEER: 'Voluntário',
  FAMILY_RESPONSIBLE: 'Responsável familiar',
  CANDIDATE: 'Candidato/formando',
};

type ViewMode = 'cards' | 'table';
type SortField = 'fullName' | 'email' | 'community' | 'status' | 'createdAt';
type SortDirection = 'asc' | 'desc';

const MembersPage: React.FC = () => {
  const [members, setMembers] = useState<Member[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [sacramentsFor, setSacramentsFor] = useState<Member | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Estados para visualização híbrida (preferência persistida por página)
  const [viewMode, setViewModeState] = useState<ViewMode>(
    () => (localStorage.getItem('parish:viewMode:members') === 'table' ? 'table' : 'cards'),
  );
  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('parish:viewMode:members', mode);
  };
  const [sortField, setSortField] = useState<SortField>('fullName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [filterCommunity, setFilterCommunity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Padroeiros das comunidades — avatar nas opções do seletor de comunidade
  const { patronsByEntity: communityPatrons } = usePatronSaints('community');
  const communityOptions = communities.map((community) => {
    const patron = communityPatrons[community.id]?.[0];
    return {
      value: community.id,
      label: community.name,
      sublabel: [community.parish?.name, community.city ? `${community.city}${community.state ? ` - ${community.state}` : ''}` : null]
        .filter(Boolean)
        .join(' · ') || undefined,
      icon: patron ? <SaintAvatar saint={patron.saint} small /> : undefined,
    };
  });

  const statusOptions = (Object.keys(MEMBER_STATUS_LABELS) as MemberStatus[]).map((status) => ({
    value: status,
    label: MEMBER_STATUS_LABELS[status],
  }));

  const [formData, setFormData] = useState({
    fullName: '',
    cpf: '',
    rg: '',
    gender: '',
    birthDate: '',
    maritalStatus: '',
    occupation: '',
    email: '',
    phone: '',
    zipCode: '',
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    fatherName: '',
    motherName: '',
    spouseId: '',
    communityId: '',
    status: 'ACTIVE' as MemberStatus,
    memberType: '' as '' | MemberType,
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  // Reset página quando filtros mudam
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterCommunity, filterStatus, sortField, sortDirection]);

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
      notify.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.communityId) {
      notify.warning('Selecione a comunidade do membro.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const payload = {
        ...formData,
        gender: formData.gender || undefined,
        maritalStatus: formData.maritalStatus || undefined,
        memberType: formData.memberType || undefined,
        birthDate: formData.birthDate ? new Date(formData.birthDate).toISOString() : undefined,
        // Cônjuge: null remove o vínculo (o backend sincroniza os dois lados)
        spouseId: formData.spouseId || null,
      };

      if (editingMember) {
        await axios.patch(
          `${API_URL}/members/${editingMember.id}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        notify.success('Membro atualizado com sucesso!');
      } else {
        await axios.post(`${API_URL}/members`, payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
        notify.success('Membro criado com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar membro:', error);
      notify.error(error.response?.data?.message || 'Erro ao salvar membro');
    }
  };

  const handleEdit = (member: Member) => {
    setEditingMember(member);
    setFormData({
      fullName: member.fullName,
      cpf: member.cpf || '',
      rg: member.rg || '',
      gender: member.gender || '',
      birthDate: member.birthDate ? member.birthDate.slice(0, 10) : '',
      maritalStatus: member.maritalStatus || '',
      occupation: member.occupation || '',
      email: member.email || '',
      phone: member.phone || '',
      zipCode: member.zipCode || '',
      street: member.street || '',
      number: member.number || '',
      complement: member.complement || '',
      neighborhood: member.neighborhood || '',
      city: member.city || '',
      state: member.state || '',
      fatherName: member.fatherName || '',
      motherName: member.motherName || '',
      spouseId: member.spouseId || member.spouse?.id || '',
      communityId: member.community.id,
      status: member.status,
      memberType: member.memberType || '',
      emergencyContactName: member.emergencyContactName || '',
      emergencyContactPhone: member.emergencyContactPhone || '',
      emergencyContactRelation: member.emergencyContactRelation || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm.delete('este membro');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/members/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Membro excluído com sucesso!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir membro:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir membro');
    }
  };

  const resetForm = () => {
    setFormData({
      fullName: '',
      cpf: '',
      rg: '',
      gender: '',
      birthDate: '',
      maritalStatus: '',
      occupation: '',
      email: '',
      phone: '',
      zipCode: '',
      street: '',
      number: '',
      complement: '',
      neighborhood: '',
      city: '',
      state: '',
      fatherName: '',
      motherName: '',
      spouseId: '',
      communityId: '',
      status: 'ACTIVE',
      memberType: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      emergencyContactRelation: '',
    });
    setEditingMember(null);
  };

  const getMaritalStatusLabel = (status?: string) => {
    const labels = {
      SINGLE: 'Solteiro(a)',
      MARRIED: 'Casado(a)',
      DIVORCED: 'Divorciado(a)',
      WIDOWED: 'Viúvo(a)',
      COMMON_LAW_MARRIAGE: 'União Estável',
    };
    return status ? labels[status as keyof typeof labels] : '-';
  };

  // Ordenação
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Seleção múltipla
  const handleSelectAll = () => {
    if (selectedMembers.length === paginatedMembers.length) {
      setSelectedMembers([]);
    } else {
      setSelectedMembers(paginatedMembers.map(m => m.id));
    }
  };

  const handleSelectMember = (memberId: string) => {
    if (selectedMembers.includes(memberId)) {
      setSelectedMembers(selectedMembers.filter(id => id !== memberId));
    } else {
      setSelectedMembers([...selectedMembers, memberId]);
    }
  };

  // Ações em lote
  const handleBulkDelete = async () => {
    if (selectedMembers.length === 0) return;
    const confirmed = await confirm.delete(`${selectedMembers.length} membro(s)`);
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await Promise.all(
        selectedMembers.map(id =>
          axios.delete(`${API_URL}/members/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        )
      );
      notify.success('Membros excluídos com sucesso!');
      setSelectedMembers([]);
      fetchData();
    } catch (error) {
      console.error('Erro ao excluir membros:', error);
      notify.error('Erro ao excluir alguns membros');
    }
  };

  // Exportar CSV
  const handleExportCSV = () => {
    const headers = ['Nome', 'CPF', 'Email', 'Telefone', 'Comunidade', 'Status', 'Cidade', 'Estado'];
    const rows = filteredAndSortedMembers.map(member => [
      member.fullName,
      member.cpf || '',
      member.email || '',
      member.phone || '',
      member.community.name,
      member.status,
      member.city || '',
      member.state || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `membros_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // Filtrar e ordenar membros
  const filteredAndSortedMembers = useMemo(() => {
    let result = members.filter((member) => {
      const matchesSearch = 
        member.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.cpf?.includes(searchTerm) ||
        member.community.name.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCommunity = filterCommunity ? member.community.id === filterCommunity : true;
      const matchesStatus = filterStatus ? member.status === filterStatus : true;

      return matchesSearch && matchesCommunity && matchesStatus;
    });

    // Ordenar
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'fullName':
          comparison = a.fullName.localeCompare(b.fullName);
          break;
        case 'email':
          comparison = (a.email || '').localeCompare(b.email || '');
          break;
        case 'community':
          comparison = a.community.name.localeCompare(b.community.name);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [members, searchTerm, filterCommunity, filterStatus, sortField, sortDirection]);

  // Paginação
  const totalPages = Math.ceil(filteredAndSortedMembers.length / itemsPerPage);
  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedMembers.slice(start, start + itemsPerPage);
  }, [filteredAndSortedMembers, currentPage, itemsPerPage]);

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="members-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="membros" /> Membros</h1>
        <div className="header-actions">
          <button className="btn-export" onClick={handleExportCSV} title="Exportar CSV">
            📥 Exportar
          </button>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            + Novo Membro
          </button>
        </div>
      </div>

      {/* Filtros e Controles */}
      <div className="filters-section">
        <div className="filters-row">
          <input
            type="text"
            placeholder="Buscar por nome, email, CPF ou comunidade..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <SearchSelect
            options={communityOptions}
            value={filterCommunity}
            onChange={setFilterCommunity}
            placeholder="Todas as comunidades"
            allOption
            searchPlaceholder="Buscar comunidade ou paróquia..."
          />
          <SearchSelect
            options={statusOptions}
            value={filterStatus}
            onChange={setFilterStatus}
            placeholder="Todos os status"
            allOption
            searchPlaceholder="Buscar status..."
          />
        </div>

        <div className="view-controls">
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
              onClick={() => setViewMode('cards')}
              title="Visualização em Cards"
            >
              📊 Cards
            </button>
            <button
              className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Visualização em Tabela"
            >
              📋 Tabela
            </button>
          </div>
          
          {viewMode === 'table' && (
            <div className="items-per-page">
              <label>Itens por página:</label>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Ações em lote */}
      {selectedMembers.length > 0 && (
        <div className="bulk-actions">
          <span>{selectedMembers.length} membro(s) selecionado(s)</span>
          <button className="btn-bulk-delete" onClick={handleBulkDelete}>
            Excluir Selecionados
          </button>
          <button className="btn-bulk-clear" onClick={() => setSelectedMembers([])}>
            Limpar Seleção
          </button>
        </div>
      )}

      {/* Contagem de resultados */}
      <div className="results-info">
        Mostrando {paginatedMembers.length} de {filteredAndSortedMembers.length} membro(s)
      </div>

      {/* Visualização em Cards */}
      {viewMode === 'cards' && (
        <div className="members-grid">
          {paginatedMembers.length === 0 ? (
            <p className="no-results">Nenhum membro encontrado.</p>
          ) : (
            paginatedMembers.map((member) => (
              <div key={member.id} className="entity-card">
                <div className="entity-card-header">
                  <div className="entity-monogram" style={{ background: avatarColor(member.fullName) }}>
                    {initials(member.fullName)}
                  </div>
                  <div className="entity-heading">
                    <h3 className="entity-title">{member.fullName}</h3>
                    <div className="entity-chips">
                      <span className="entity-chip soft-blue">{member.community.name}</span>
                      {statusChip(member.status)}
                    </div>
                  </div>
                </div>
                <div className="entity-card-body">
                  {member.cpf && (
                    <div className="entity-field">
                      <span className="entity-field-label">CPF</span>
                      <span className="entity-field-value">{member.cpf}</span>
                    </div>
                  )}
                  {member.birthDate && (
                    <div className="entity-field">
                      <span className="entity-field-label">Nascimento</span>
                      <span className="entity-field-value">{new Date(member.birthDate).toLocaleDateString('pt-BR')}</span>
                    </div>
                  )}
                  {member.maritalStatus && (
                    <div className="entity-field">
                      <span className="entity-field-label">Est. civil</span>
                      <span className="entity-field-value">{getMaritalStatusLabel(member.maritalStatus)}</span>
                    </div>
                  )}
                  {member.occupation && (
                    <div className="entity-field">
                      <span className="entity-field-label">Profissão</span>
                      <span className="entity-field-value">{member.occupation}</span>
                    </div>
                  )}
                  {member.email && (
                    <div className="entity-field">
                      <span className="entity-field-label">Email</span>
                      <span className="entity-field-value">{member.email}</span>
                    </div>
                  )}
                  {member.phone && (
                    <div className="entity-field">
                      <span className="entity-field-label">Telefone</span>
                      <span className="entity-field-value">{member.phone}</span>
                    </div>
                  )}
                  {member.city && (
                    <div className="entity-field">
                      <span className="entity-field-label">Cidade</span>
                      <span className="entity-field-value">{member.city} - {member.state}</span>
                    </div>
                  )}
                </div>
                <div className="entity-card-footer">
                  <button className="entity-btn primary" onClick={() => handleEdit(member)}>
                    Editar
                  </button>
                  <button className="entity-btn accent" onClick={() => setSacramentsFor(member)}>
                    Sacramentos
                  </button>
                  <button className="entity-btn danger" onClick={() => handleDelete(member.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Visualização em Tabela */}
      {viewMode === 'table' && (
        <div className="table-container entity-table">
          <table className="data-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={selectedMembers.length === paginatedMembers.length && paginatedMembers.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="sortable" onClick={() => handleSort('fullName')}>
                  Nome {sortField === 'fullName' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>CPF</th>
                <th className="sortable" onClick={() => handleSort('email')}>
                  Email {sortField === 'email' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Telefone</th>
                <th className="sortable" onClick={() => handleSort('community')}>
                  Comunidade {sortField === 'community' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="sortable" onClick={() => handleSort('status')}>
                  Status {sortField === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Cidade</th>
                <th className="sortable" onClick={() => handleSort('createdAt')}>
                  Criado em {sortField === 'createdAt' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginatedMembers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="no-results-cell">Nenhum membro encontrado.</td>
                </tr>
              ) : (
                paginatedMembers.map((member) => (
                  <tr key={member.id} className={selectedMembers.includes(member.id) ? 'selected' : ''}>
                    <td className="checkbox-col">
                      <input
                        type="checkbox"
                        checked={selectedMembers.includes(member.id)}
                        onChange={() => handleSelectMember(member.id)}
                      />
                    </td>
                    <td className="name-cell">
                      <strong>{member.fullName}</strong>
                    </td>
                    <td>{member.cpf || '-'}</td>
                    <td>{member.email || '-'}</td>
                    <td>{member.phone || '-'}</td>
                    <td>
                      <span className="entity-chip soft-blue">{member.community.name}</span>
                    </td>
                    <td>{statusChip(member.status)}</td>
                    <td>{member.city ? `${member.city}/${member.state}` : '-'}</td>
                    <td>{new Date(member.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td className="actions-cell">
                      <button className="entity-icon-btn" onClick={() => handleEdit(member)} title="Editar">
                        ✏️
                      </button>
                      <button className="entity-icon-btn" onClick={() => setSacramentsFor(member)} title="Sacramentos">
                        ✝️
                      </button>
                      <button className="entity-icon-btn danger" onClick={() => handleDelete(member.id)} title="Excluir">
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(1)}
          >
            ⏮️
          </button>
          <button
            className="pagination-btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(currentPage - 1)}
          >
            ◀️
          </button>
          
          <span className="pagination-info">
            Página {currentPage} de {totalPages}
          </span>
          
          <button
            className="pagination-btn"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(currentPage + 1)}
          >
            ▶️
          </button>
          <button
            className="pagination-btn"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(totalPages)}
          >
            ⏭️
          </button>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal-content modal-large member-modal" onClick={(e) => e.stopPropagation()}>
            <div className="member-modal-header">
              <div className="member-modal-heading">
                <span className="member-modal-kicker">{editingMember ? 'Editar membro' : 'Cadastro'}</span>
                <h2>{editingMember ? editingMember.fullName : 'Novo membro'}</h2>
              </div>
              <button
                type="button"
                className="member-modal-close"
                aria-label="Fechar"
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="member-modal-form">
              <div className="member-modal-body">
                <div className="member-form-grid">
              {/* Dados Pessoais */}
              <fieldset>
                <legend>📋 Dados Pessoais</legend>
                
                <div className="form-group">
                  <label>Nome Completo *</label>
                  <input
                    type="text"
                    required
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>CPF</label>
                    <input
                      type="text"
                      maxLength={14}
                      value={formData.cpf}
                      onChange={(e) => setFormData({ ...formData, cpf: e.target.value })}
                      placeholder="000.000.000-00"
                    />
                  </div>

                  <div className="form-group">
                    <label>RG</label>
                    <input
                      type="text"
                      value={formData.rg}
                      onChange={(e) => setFormData({ ...formData, rg: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Sexo</label>
                    <select
                      value={formData.gender}
                      onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    >
                      <option value="">Selecione</option>
                      <option value="MALE">Masculino</option>
                      <option value="FEMALE">Feminino</option>
                      <option value="OTHER">Outro</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Data de Nascimento</label>
                    <input
                      type="date"
                      value={formData.birthDate}
                      onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Estado Civil</label>
                    <select
                      value={formData.maritalStatus}
                      onChange={(e) => setFormData({ ...formData, maritalStatus: e.target.value })}
                    >
                      <option value="">Selecione</option>
                      <option value="SINGLE">Solteiro(a)</option>
                      <option value="MARRIED">Casado(a)</option>
                      <option value="DIVORCED">Divorciado(a)</option>
                      <option value="WIDOWED">Viúvo(a)</option>
                      <option value="COMMON_LAW_MARRIAGE">União Estável</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Profissão</label>
                    <input
                      type="text"
                      value={formData.occupation}
                      onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                    />
                  </div>
                </div>
              </fieldset>

              {/* Filiação */}
              <fieldset>
                <legend>👨‍👩‍👦 Filiação</legend>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>Nome do Pai</label>
                    <input
                      type="text"
                      value={formData.fatherName}
                      onChange={(e) => setFormData({ ...formData, fatherName: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Nome da Mãe</label>
                    <input
                      type="text"
                      value={formData.motherName}
                      onChange={(e) => setFormData({ ...formData, motherName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>💍 Cônjuge (membro cadastrado)</label>
                  <SearchSelect
                    options={members
                      .filter((m) => m.id !== editingMember?.id)
                      .filter((m) => !formData.communityId || m.community?.id === formData.communityId)
                      .map((m) => ({ value: m.id, label: m.fullName, sublabel: m.community?.name }))}
                    value={formData.spouseId}
                    onChange={(spouseId) => setFormData({ ...formData, spouseId })}
                    placeholder="Sem cônjuge vinculado"
                    allOption
                    searchPlaceholder="Buscar membro..."
                  />
                  <small style={{ color: '#8b97a4' }}>
                    O vínculo vale nos dois sentidos e é usado pela regra “casais servem juntos” das escalas.
                  </small>
                </div>
              </fieldset>

              {/* Contato */}
              <fieldset>
                <legend>📞 Contato</legend>
                
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
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
              </fieldset>

              {/* Endereço */}
              <fieldset>
                <legend>📍 Endereço</legend>
                
                <div className="form-row">
                  <div className="form-group" style={{flex: '0 0 200px'}}>
                    <label>CEP</label>
                    <input
                      type="text"
                      maxLength={9}
                      value={formData.zipCode}
                      onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                      placeholder="00000-000"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group" style={{flex: '3'}}>
                    <label>Rua</label>
                    <input
                      type="text"
                      value={formData.street}
                      onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                    />
                  </div>

                  <div className="form-group" style={{flex: '1'}}>
                    <label>Número</label>
                    <input
                      type="text"
                      value={formData.number}
                      onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Complemento</label>
                  <input
                    type="text"
                    value={formData.complement}
                    onChange={(e) => setFormData({ ...formData, complement: e.target.value })}
                    placeholder="Apto, Bloco, etc."
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Bairro</label>
                    <input
                      type="text"
                      value={formData.neighborhood}
                      onChange={(e) => setFormData({ ...formData, neighborhood: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Cidade</label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    />
                  </div>

                  <div className="form-group" style={{flex: '0 0 100px'}}>
                    <label>Estado</label>
                    <input
                      type="text"
                      maxLength={2}
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                      placeholder="PR"
                    />
                  </div>
                </div>
              </fieldset>

              {/* Comunidade e Status */}
              <fieldset>
                <legend>⛪ Comunidade e Status</legend>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>Comunidade *</label>
                    <SearchSelect
                      options={communityOptions}
                      value={formData.communityId}
                      onChange={(communityId) => setFormData({ ...formData, communityId })}
                      placeholder="Selecione uma comunidade"
                      searchPlaceholder="Buscar comunidade..."
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="member-status">Status</label>
                    <select
                      id="member-status"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as MemberStatus })}
                    >
                      {(Object.keys(MEMBER_STATUS_LABELS) as MemberStatus[])
                        .filter((s) => s !== 'ANONYMIZED') // anonimização é ação LGPD dedicada
                        .map((s) => (
                          <option key={s} value={s}>
                            {MEMBER_STATUS_LABELS[s]}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="member-type">Tipo de agente</label>
                    <select
                      id="member-type"
                      value={formData.memberType}
                      onChange={(e) =>
                        setFormData({ ...formData, memberType: e.target.value as '' | MemberType })
                      }
                    >
                      <option value="">Não classificado</option>
                      {(Object.keys(MEMBER_TYPE_LABELS) as MemberType[]).map((t) => (
                        <option key={t} value={t}>
                          {MEMBER_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <legend style={{ marginTop: '1rem', fontWeight: 600 }}>Contato de emergência</legend>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="emg-name">Nome</label>
                    <input
                      id="emg-name"
                      type="text"
                      value={formData.emergencyContactName}
                      onChange={(e) =>
                        setFormData({ ...formData, emergencyContactName: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="emg-phone">Telefone</label>
                    <input
                      id="emg-phone"
                      type="tel"
                      value={formData.emergencyContactPhone}
                      onChange={(e) =>
                        setFormData({ ...formData, emergencyContactPhone: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="emg-relation">Parentesco/relação</label>
                    <input
                      id="emg-relation"
                      type="text"
                      value={formData.emergencyContactRelation}
                      onChange={(e) =>
                        setFormData({ ...formData, emergencyContactRelation: e.target.value })
                      }
                    />
                  </div>
                </div>
              </fieldset>

                </div>
              </div>

              <div className="modal-actions member-modal-footer">
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

      {sacramentsFor && (
        <SacramentsModal
          memberId={sacramentsFor.id}
          memberName={sacramentsFor.fullName}
          onClose={() => setSacramentsFor(null)}
        />
      )}
    </div>
  );
};

export default MembersPage;
