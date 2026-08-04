import React, { useState, useEffect } from 'react';
import TitleIcon from '../components/TitleIcon';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { notify, confirm } from '../services/notification.service';
import PatronSaintsManager, { usePatronSaints, PatronSaintsBadge } from '../components/PatronSaintsManager';
import SearchSelect from '../components/SearchSelect';
import SaintAvatar, { avatarColor, initials } from '../components/SaintAvatar';
import './ParishesPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Diocese {
  id: string;
  name: string;
  city?: string;
  state?: string;
}

const dioceseOption = (diocese: Diocese) => ({
  value: diocese.id,
  label: diocese.name,
  sublabel: diocese.city ? `${diocese.city}${diocese.state ? ` - ${diocese.state}` : ''}` : undefined,
});

interface Parish {
  id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  zipCode: string;
  phone?: string;
  email?: string;
  diocese: Diocese;
  createdAt: string;
}

const ParishesPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [parishes, setParishes] = useState<Parish[]>([]);
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingParish, setEditingParish] = useState<Parish | null>(null);
  
  const canDelete = currentUser?.role === 'SYSTEM_ADMIN' || currentUser?.role === 'DIOCESAN_ADMIN';
  const [searchTerm, setSearchTerm] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState<string>('');

  // Santos padroeiros (vínculo por paróquia)
  const { patronsByEntity, refresh: refreshPatrons } = usePatronSaints('parish');
  const [patronTarget, setPatronTarget] = useState<Parish | null>(null);

  // Padroeiros das dioceses — avatar nas opções do seletor de diocese
  const { patronsByEntity: diocesePatrons } = usePatronSaints('diocese');
  const dioceseOptions = dioceses.map((diocese) => {
    const patron = diocesePatrons[diocese.id]?.[0];
    return {
      ...dioceseOption(diocese),
      icon: patron ? <SaintAvatar saint={patron.saint} small /> : undefined,
    };
  });

  // Estados para visualização híbrida (preferência persistida por página)
  const [viewMode, setViewModeState] = useState<'cards' | 'table'>(
    () => (localStorage.getItem('parish:viewMode:parishes') === 'table' ? 'table' : 'cards'),
  );
  const setViewMode = (mode: 'cards' | 'table') => {
    setViewModeState(mode);
    localStorage.setItem('parish:viewMode:parishes', mode);
  };
  const [sortField, setSortField] = useState<'name' | 'city' | 'diocese' | 'createdAt'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedParishes, setSelectedParishes] = useState<string[]>([]);
  const [filterDiocese, setFilterDiocese] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    city: '',
    state: '',
    address: '',
    zipCode: '',
    phone: '',
    email: '',
    dioceseId: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        setCurrentUserRole(user.role);
      }
      const [parishesRes, diocesesRes] = await Promise.all([
        axios.get(`${API_URL}/parishes`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/dioceses`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setParishes(parishesRes.data);
      setDioceses(diocesesRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      notify.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.dioceseId) {
      notify.warning('Selecione a diocese da paróquia.');
      return;
    }

    try {
      const token = localStorage.getItem('token');

      if (editingParish) {
        await axios.patch(
          `${API_URL}/parishes/${editingParish.id}`,
          formData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        notify.success('Paróquia atualizada com sucesso!');
      } else {
        await axios.post(`${API_URL}/parishes`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        notify.success('Paróquia criada com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar paróquia:', error);
      notify.error(error.response?.data?.message || 'Erro ao salvar paróquia');
    }
  };

  const handleEdit = (parish: Parish) => {
    setEditingParish(parish);
    setFormData({
      name: parish.name,
      city: parish.city,
      state: parish.state,
      address: parish.address,
      zipCode: parish.zipCode,
      phone: parish.phone || '',
      email: parish.email || '',
      dioceseId: parish.diocese.id,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm.delete('esta paróquia');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/parishes/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Paróquia excluída com sucesso!');
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir paróquia:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir paróquia');
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
      dioceseId: '',
    });
    setEditingParish(null);
  };

  // Filtros
  const filteredParishes = parishes.filter((parish) => {
    const matchesSearch =
      parish.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      parish.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
      parish.diocese.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDiocese = !filterDiocese || parish.diocese.id === filterDiocese;
    return matchesSearch && matchesDiocese;
  });

  // Ordenação
  const sortedParishes = [...filteredParishes].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'city':
        comparison = a.city.localeCompare(b.city);
        break;
      case 'diocese':
        comparison = a.diocese.name.localeCompare(b.diocese.name);
        break;
      case 'createdAt':
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Paginação
  const totalPages = Math.ceil(sortedParishes.length / itemsPerPage);
  const paginatedParishes = sortedParishes.slice(
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
      setSelectedParishes(paginatedParishes.map((p) => p.id));
    } else {
      setSelectedParishes([]);
    }
  };

  const handleSelectParish = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedParishes([...selectedParishes, id]);
    } else {
      setSelectedParishes(selectedParishes.filter((pid) => pid !== id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedParishes.length === 0) return;
    const confirmed = await confirm.delete(`${selectedParishes.length} paróquia(s)`);
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      for (const id of selectedParishes) {
        await axios.delete(`${API_URL}/parishes/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      notify.success(`${selectedParishes.length} paróquia(s) excluída(s) com sucesso!`);
      setSelectedParishes([]);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir paróquias:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir paróquias');
    }
  };

  const exportToCSV = () => {
    const headers = ['Nome', 'Diocese', 'Cidade', 'Estado', 'Endereço', 'CEP', 'Telefone', 'Email'];
    const rows = sortedParishes.map((parish) => [
      parish.name,
      parish.diocese.name,
      parish.city,
      parish.state,
      parish.address,
      parish.zipCode,
      parish.phone || '',
      parish.email || '',
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `paroquias_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="parishes-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="paroquia" /> Paróquias</h1>
        {currentUserRole !== 'PARISH_ADMIN' && (
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            + Nova Paróquia
          </button>
        )}
      </div>

      <div className="page-controls">
        <div className="filters">
          <input
            type="text"
            placeholder="Buscar por nome, cidade ou diocese..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <SearchSelect
            options={dioceseOptions}
            value={filterDiocese}
            onChange={setFilterDiocese}
            placeholder="Todas as dioceses"
            allOption
            searchPlaceholder="Buscar diocese..."
          />
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
        <div className="parishes-grid">
          {paginatedParishes.length === 0 ? (
            <p className="no-results">Nenhuma paróquia encontrada.</p>
          ) : (
            paginatedParishes.map((parish) => (
              <div key={parish.id} className="entity-card">
                <div className="entity-card-header">
                  <div className="entity-monogram" style={{ background: avatarColor(parish.name) }}>
                    {initials(parish.name)}
                  </div>
                  <div className="entity-heading">
                    <h3 className="entity-title">{parish.name}</h3>
                    <div className="entity-chips">
                      <span className="entity-chip soft-blue">{parish.diocese.name}</span>
                    </div>
                  </div>
                </div>
                <div className="entity-card-body">
                  <div className="entity-field">
                    <span className="entity-field-label">Cidade</span>
                    <span className="entity-field-value">{parish.city} - {parish.state}</span>
                  </div>
                  <div className="entity-field">
                    <span className="entity-field-label">Endereço</span>
                    <span className="entity-field-value">{parish.address}</span>
                  </div>
                  <div className="entity-field">
                    <span className="entity-field-label">CEP</span>
                    <span className="entity-field-value">{parish.zipCode}</span>
                  </div>
                  {parish.phone && (
                    <div className="entity-field">
                      <span className="entity-field-label">Telefone</span>
                      <span className="entity-field-value">{parish.phone}</span>
                    </div>
                  )}
                  {parish.email && (
                    <div className="entity-field">
                      <span className="entity-field-label">Email</span>
                      <span className="entity-field-value">{parish.email}</span>
                    </div>
                  )}
                  <PatronSaintsBadge patrons={patronsByEntity[parish.id]} />
                </div>
                <div className="entity-card-footer">
                  <button className="entity-btn primary" onClick={() => handleEdit(parish)}>
                    Editar
                  </button>
                  <button className="entity-btn accent" onClick={() => setPatronTarget(parish)}>
                    🕊️ Padroeiro
                  </button>
                  {canDelete && (
                    <button className="entity-btn danger" onClick={() => handleDelete(parish.id)}>
                      Excluir
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="table-container entity-table">
          {/* Ações em lote */}
          <div className="table-actions">
            <div className="bulk-actions" style={selectedParishes.length === 0 ? { display: 'none' } : undefined}>
              {selectedParishes.length > 0 && canDelete && (
                <>
                  <span className="selected-count">{selectedParishes.length} selecionada(s)</span>
                  <button className="btn-bulk-delete" onClick={handleBulkDelete}>
                    Excluir Selecionadas
                  </button>
                  <button className="btn-clear-selection" onClick={() => setSelectedParishes([])}>
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
                {canDelete && (
                  <th className="checkbox-col">
                    <input
                      type="checkbox"
                      checked={selectedParishes.length === paginatedParishes.length && paginatedParishes.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                )}
                <th className="sortable" onClick={() => handleSort('name')}>
                  Nome {sortField === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="sortable" onClick={() => handleSort('diocese')}>
                  Diocese {sortField === 'diocese' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="sortable" onClick={() => handleSort('city')}>
                  Cidade {sortField === 'city' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Endereço</th>
                <th>Telefone</th>
                <th>Email</th>
                <th>Padroeiro</th>
                <th className="sortable" onClick={() => handleSort('createdAt')}>
                  Criado em {sortField === 'createdAt' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginatedParishes.map((parish) => (
                <tr key={parish.id} className={selectedParishes.includes(parish.id) ? 'selected' : ''}>
                  {canDelete && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedParishes.includes(parish.id)}
                        onChange={(e) => handleSelectParish(parish.id, e.target.checked)}
                      />
                    </td>
                  )}
                  <td className="name-cell">
                    <strong>{parish.name}</strong>
                  </td>
                  <td>
                    <span className="entity-chip soft-blue">{parish.diocese.name}</span>
                  </td>
                  <td>{parish.city} - {parish.state}</td>
                  <td>{parish.address}</td>
                  <td>{parish.phone || '-'}</td>
                  <td>{parish.email || '-'}</td>
                  <td>
                    {patronsByEntity[parish.id]?.[0] ? (
                      <span className="patron-cell">
                        <SaintAvatar saint={patronsByEntity[parish.id][0].saint} small />
                        {patronsByEntity[parish.id][0].saint.name}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{formatDate(parish.createdAt)}</td>
                  <td className="actions-cell">
                    <button className="entity-icon-btn" onClick={() => handleEdit(parish)} title="Editar">
                      ✏️
                    </button>
                    <button className="entity-icon-btn" onClick={() => setPatronTarget(parish)} title="Padroeiro">
                      🕊️
                    </button>
                    {canDelete && (
                      <button className="entity-icon-btn danger" onClick={() => handleDelete(parish.id)} title="Excluir">
                        🗑️
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {paginatedParishes.length === 0 && (
            <div className="empty-table">
              <p>Nenhuma paróquia encontrada</p>
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
            Página {currentPage} de {totalPages} ({sortedParishes.length} paróquias)
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
            <h2>{editingParish ? 'Editar Paróquia' : 'Nova Paróquia'}</h2>
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
                <label>Diocese *</label>
                <SearchSelect
                  options={dioceseOptions}
                  value={formData.dioceseId}
                  onChange={(dioceseId) => setFormData({ ...formData, dioceseId })}
                  placeholder="Selecione uma diocese"
                  searchPlaceholder="Buscar diocese..."
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
                  {editingParish ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {patronTarget && (
        <PatronSaintsManager
          level="parish"
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

export default ParishesPage;
