import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { notify, confirm } from '../services/notification.service';
import './CommunitiesPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Diocese {
  id: string;
  name: string;
}

interface Parish {
  id: string;
  name: string;
  diocese: Diocese;
}

interface Community {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone?: string;
  email?: string;
  parish: Parish;
  createdAt: string;
}

const CommunitiesPage: React.FC = () => {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [parishes, setParishes] = useState<Parish[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Estados para visualização híbrida
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [sortField, setSortField] = useState<'name' | 'city' | 'parish' | 'createdAt'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedCommunities, setSelectedCommunities] = useState<string[]>([]);
  const [filterParish, setFilterParish] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: '',
    parishId: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const [communitiesRes, parishesRes] = await Promise.all([
        axios.get(`${API_URL}/communities`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/parishes`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setCommunities(communitiesRes.data);
      setParishes(parishesRes.data);
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

      if (editingCommunity) {
        await axios.patch(
          `${API_URL}/communities/${editingCommunity.id}`,
          formData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        notify.success('Comunidade atualizada com sucesso!');
      } else {
        await axios.post(`${API_URL}/communities`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        notify.success('Comunidade criada com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar comunidade:', error);
      notify.error(error.response?.data?.message || 'Erro ao salvar comunidade');
    }
  };

  const handleEdit = (community: Community) => {
    setEditingCommunity(community);
    setFormData({
      name: community.name,
      address: community.address,
      city: community.city,
      state: community.state,
      zipCode: community.zipCode,
      phone: community.phone || '',
      email: community.email || '',
      parishId: community.parish.id,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm.delete('esta comunidade');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/communities/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Comunidade excluída com sucesso!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir comunidade:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir comunidade');
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
      parishId: '',
    });
    setEditingCommunity(null);
  };

  // Filtros
  const filteredCommunities = communities.filter((community) => {
    const matchesSearch = 
      community.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      community.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
      community.parish.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesParish = !filterParish || community.parish.id === filterParish;
    return matchesSearch && matchesParish;
  });

  // Ordenação
  const sortedCommunities = [...filteredCommunities].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'city':
        comparison = a.city.localeCompare(b.city);
        break;
      case 'parish':
        comparison = a.parish.name.localeCompare(b.parish.name);
        break;
      case 'createdAt':
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Paginação
  const totalPages = Math.ceil(sortedCommunities.length / itemsPerPage);
  const paginatedCommunities = sortedCommunities.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCommunities(paginatedCommunities.map((c) => c.id));
    } else {
      setSelectedCommunities([]);
    }
  };

  const handleSelectCommunity = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedCommunities([...selectedCommunities, id]);
    } else {
      setSelectedCommunities(selectedCommunities.filter((cid) => cid !== id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCommunities.length === 0) return;
    const confirmed = await confirm.delete(`${selectedCommunities.length} comunidade(s)`);
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      for (const id of selectedCommunities) {
        await axios.delete(`${API_URL}/communities/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      notify.success(`${selectedCommunities.length} comunidade(s) excluída(s) com sucesso!`);
      setSelectedCommunities([]);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir comunidades:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir comunidades');
    }
  };

  const exportToCSV = () => {
    const headers = ['Nome', 'Paróquia', 'Diocese', 'Cidade', 'Estado', 'Endereço', 'CEP', 'Telefone', 'Email'];
    const rows = sortedCommunities.map((community) => [
      community.name,
      community.parish.name,
      community.parish.diocese.name,
      community.city,
      community.state,
      community.address,
      community.zipCode,
      community.phone || '',
      community.email || '',
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `comunidades_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="communities-page">
      <div className="page-header">
        <h1>🏘️ Comunidades</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Nova Comunidade
        </button>
      </div>

      <div className="page-controls">
        <div className="filters">
          <input
            type="text"
            placeholder="Buscar por nome, cidade ou paróquia..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <select
            value={filterParish}
            onChange={(e) => setFilterParish(e.target.value)}
            className="filter-select"
          >
            <option value="">Todas as paróquias</option>
            {parishes.map((parish) => (
              <option key={parish.id} value={parish.id}>
                {parish.name}
              </option>
            ))}
          </select>
        </div>

        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
            onClick={() => setViewMode('cards')}
          >
            📇 Cards
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            📋 Tabela
          </button>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="communities-grid">
          {paginatedCommunities.length === 0 ? (
            <p className="no-results">Nenhuma comunidade encontrada.</p>
          ) : (
            paginatedCommunities.map((community) => (
              <div key={community.id} className="community-card">
                <div className="card-header">
                  <h3>{community.name}</h3>
                  <div className="badges">
                    <span className="parish-badge">{community.parish.name}</span>
                    <span className="diocese-badge">{community.parish.diocese.name}</span>
                  </div>
                </div>
                <div className="card-body">
                  <p><strong>📍 Cidade:</strong> {community.city} - {community.state}</p>
                  <p><strong>🏠 Endereço:</strong> {community.address}</p>
                  <p><strong>📮 CEP:</strong> {community.zipCode}</p>
                  {community.phone && <p><strong>📞 Telefone:</strong> {community.phone}</p>}
                  {community.email && <p><strong>📧 Email:</strong> {community.email}</p>}
                </div>
                <div className="card-actions">
                  <button className="btn-edit" onClick={() => handleEdit(community)}>
                    Editar
                  </button>
                  <button className="btn-delete" onClick={() => handleDelete(community.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="table-container">
          {/* Ações em lote */}
          <div className="table-actions">
            <div className="bulk-actions">
              {selectedCommunities.length > 0 && (
                <>
                  <span className="selected-count">{selectedCommunities.length} selecionada(s)</span>
                  <button className="btn-bulk-delete" onClick={handleBulkDelete}>
                    Excluir Selecionadas
                  </button>
                  <button className="btn-clear-selection" onClick={() => setSelectedCommunities([])}>
                    Limpar Seleção
                  </button>
                </>
              )}
            </div>
            <div className="table-controls">
              <button className="btn-export" onClick={exportToCSV}>
                📥 Exportar CSV
              </button>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="items-per-page"
              >
                <option value={10}>10 por página</option>
                <option value={25}>25 por página</option>
                <option value={50}>50 por página</option>
                <option value={100}>100 por página</option>
              </select>
            </div>
          </div>

          {/* Tabela */}
          <table className="data-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={selectedCommunities.length === paginatedCommunities.length && paginatedCommunities.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </th>
                <th className="sortable" onClick={() => handleSort('name')}>
                  Nome {sortField === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="sortable" onClick={() => handleSort('parish')}>
                  Paróquia {sortField === 'parish' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Diocese</th>
                <th className="sortable" onClick={() => handleSort('city')}>
                  Cidade {sortField === 'city' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Telefone</th>
                <th>Email</th>
                <th className="sortable" onClick={() => handleSort('createdAt')}>
                  Criado em {sortField === 'createdAt' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginatedCommunities.map((community) => (
                <tr key={community.id} className={selectedCommunities.includes(community.id) ? 'selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedCommunities.includes(community.id)}
                      onChange={(e) => handleSelectCommunity(community.id, e.target.checked)}
                    />
                  </td>
                  <td className="name-cell">
                    <strong>{community.name}</strong>
                  </td>
                  <td>
                    <span className="parish-badge-small">{community.parish.name}</span>
                  </td>
                  <td>{community.parish.diocese.name}</td>
                  <td>{community.city} - {community.state}</td>
                  <td>{community.phone || '-'}</td>
                  <td>{community.email || '-'}</td>
                  <td>{formatDate(community.createdAt)}</td>
                  <td className="actions-cell">
                    <button className="btn-action btn-edit-small" onClick={() => handleEdit(community)} title="Editar">
                      ✏️
                    </button>
                    <button className="btn-action btn-delete-small" onClick={() => handleDelete(community.id)} title="Excluir">
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {paginatedCommunities.length === 0 && (
            <div className="empty-table">
              <p>Nenhuma comunidade encontrada</p>
            </div>
          )}
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
          >
            «
          </button>
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            ‹
          </button>
          <span className="pagination-info">
            Página {currentPage} de {totalPages} ({sortedCommunities.length} comunidades)
          </span>
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            ›
          </button>
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
          >
            »
          </button>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingCommunity ? 'Editar Comunidade' : 'Nova Comunidade'}</h2>
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
                <label>Paróquia *</label>
                <select
                  required
                  value={formData.parishId}
                  onChange={(e) => setFormData({ ...formData, parishId: e.target.value })}
                >
                  <option value="">Selecione uma paróquia</option>
                  {parishes.map((parish) => (
                    <option key={parish.id} value={parish.id}>
                      {parish.name} - {parish.diocese.name}
                    </option>
                  ))}
                </select>
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
                  {editingCommunity ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommunitiesPage;
