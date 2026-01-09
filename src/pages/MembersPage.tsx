import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { notify, confirm } from '../services/notification.service';
import './MembersPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Community {
  id: string;
  name: string;
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
  photoUrl?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DECEASED';
  community: Community;
  createdAt: string;
}

type ViewMode = 'cards' | 'table';
type SortField = 'fullName' | 'email' | 'community' | 'status' | 'createdAt';
type SortDirection = 'asc' | 'desc';

const MembersPage: React.FC = () => {
  const [members, setMembers] = useState<Member[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Estados para visualização híbrida
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [sortField, setSortField] = useState<SortField>('fullName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [filterCommunity, setFilterCommunity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

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
    communityId: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'DECEASED',
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

    try {
      const token = localStorage.getItem('token');
      const payload = {
        ...formData,
        gender: formData.gender || undefined,
        maritalStatus: formData.maritalStatus || undefined,
        birthDate: formData.birthDate ? new Date(formData.birthDate).toISOString() : undefined,
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
      communityId: member.community.id,
      status: member.status,
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
      communityId: '',
      status: 'ACTIVE',
    });
    setEditingMember(null);
  };

  const getGenderLabel = (gender?: string) => {
    const labels = { MALE: 'Masculino', FEMALE: 'Feminino', OTHER: 'Outro' };
    return gender ? labels[gender as keyof typeof labels] : '-';
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

  const getStatusBadge = (status: string, small = false) => {
    const badges = {
      ACTIVE: { label: 'Ativo', className: small ? 'status-badge-small active' : 'status-badge badge-active' },
      INACTIVE: { label: 'Inativo', className: small ? 'status-badge-small inactive' : 'status-badge badge-inactive' },
      DECEASED: { label: 'Falecido', className: small ? 'status-badge-small deceased' : 'status-badge badge-deceased' },
    };
    const badge = badges[status as keyof typeof badges];
    return <span className={badge.className}>{badge.label}</span>;
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
        <h1>👥 Membros</h1>
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
          <select
            value={filterCommunity}
            onChange={(e) => setFilterCommunity(e.target.value)}
            className="filter-select"
          >
            <option value="">Todas as comunidades</option>
            {communities.map((community) => (
              <option key={community.id} value={community.id}>
                {community.name}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="filter-select"
          >
            <option value="">Todos os status</option>
            <option value="ACTIVE">Ativos</option>
            <option value="INACTIVE">Inativos</option>
            <option value="DECEASED">Falecidos</option>
          </select>
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
              <div key={member.id} className="member-card">
                <div className="card-header">
                  <div>
                    <h3>{member.fullName}</h3>
                    <span className="community-badge">{member.community.name}</span>
                  </div>
                  {getStatusBadge(member.status)}
                </div>
                <div className="card-body">
                  {member.cpf && <p><strong>🆔 CPF:</strong> {member.cpf}</p>}
                  {member.gender && <p><strong>👤 Sexo:</strong> {getGenderLabel(member.gender)}</p>}
                  {member.birthDate && (
                    <p><strong>🎂 Nascimento:</strong> {new Date(member.birthDate).toLocaleDateString('pt-BR')}</p>
                  )}
                  {member.maritalStatus && <p><strong>💍 Estado Civil:</strong> {getMaritalStatusLabel(member.maritalStatus)}</p>}
                  {member.occupation && <p><strong>💼 Profissão:</strong> {member.occupation}</p>}
                  {member.email && <p><strong>📧 Email:</strong> {member.email}</p>}
                  {member.phone && <p><strong>📞 Telefone:</strong> {member.phone}</p>}
                  {member.street && (
                    <p><strong>📍 Endereço:</strong> {member.street}, {member.number} - {member.neighborhood}</p>
                  )}
                  {member.city && <p><strong>🏙️ Cidade:</strong> {member.city} - {member.state}</p>}
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
      )}

      {/* Visualização em Tabela */}
      {viewMode === 'table' && (
        <div className="table-container">
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
                      <span className="community-badge-small">{member.community.name}</span>
                    </td>
                    <td>{getStatusBadge(member.status, true)}</td>
                    <td>{member.city ? `${member.city}/${member.state}` : '-'}</td>
                    <td>{new Date(member.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td className="actions-cell">
                      <button className="btn-icon" onClick={() => handleEdit(member)} title="Editar">
                        ✏️
                      </button>
                      <button className="btn-icon danger" onClick={() => handleDelete(member.id)} title="Excluir">
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
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>{editingMember ? 'Editar Membro' : 'Novo Membro'}</h2>
            <form onSubmit={handleSubmit}>
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

                  <div className="form-group">
                    <label>Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    >
                      <option value="ACTIVE">Ativo</option>
                      <option value="INACTIVE">Inativo</option>
                      <option value="DECEASED">Falecido</option>
                    </select>
                  </div>
                </div>
              </fieldset>

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
