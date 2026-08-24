import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import TitleIcon from '../components/TitleIcon';
import axios from 'axios';
import { notify, confirm } from '../services/notification.service';
import PatronSaintsManager, { usePatronSaints, PatronSaintsBadge } from '../components/PatronSaintsManager';
import SearchSelect from '../components/SearchSelect';
import SaintAvatar, { avatarColor, initials } from '../components/SaintAvatar';
import MapPicker from '../components/MapPicker';
import './CommunitiesPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Diocese {
  id: string;
  name: string;
}

interface Parish {
  id: string;
  name: string;
  city?: string;
  state?: string;
  diocese: Diocese;
}

const parishOption = (parish: Parish) => ({
  value: parish.id,
  label: parish.name,
  sublabel: `${parish.diocese.name}${parish.city ? ` · ${parish.city}${parish.state ? ` - ${parish.state}` : ''}` : ''}`,
});

interface Community {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone?: string;
  email?: string;
  latitude?: number | null;
  longitude?: number | null;
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
  
  // Estados para visualização híbrida (preferência persistida por página)
  const [viewMode, setViewModeState] = useState<'cards' | 'table'>(
    () => (localStorage.getItem('parish:viewMode:communities') === 'table' ? 'table' : 'cards'),
  );
  const setViewMode = (mode: 'cards' | 'table') => {
    setViewModeState(mode);
    localStorage.setItem('parish:viewMode:communities', mode);
  };
  const [sortField, setSortField] = useState<'name' | 'city' | 'parish' | 'createdAt'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedCommunities, setSelectedCommunities] = useState<string[]>([]);
  // O backend nega criar/editar/excluir abaixo desses papéis — a UI não deve
  // oferecer botões que terminam em 403
  const { user: authUser } = useAuth();
  const isAdminRole = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN'].includes(authUser?.role ?? '');
  const canEditCommunity = isAdminRole || authUser?.role === 'COMMUNITY_COORDINATOR';
  const [filterParish, setFilterParish] = useState('');

  // Santos padroeiros (vínculo por comunidade)
  const { patronsByEntity, refresh: refreshPatrons } = usePatronSaints('community');
  const [patronTarget, setPatronTarget] = useState<Community | null>(null);

  // Padroeiros das paróquias — avatar nas opções do seletor de paróquia
  const { patronsByEntity: parishPatrons } = usePatronSaints('parish');
  const parishOptions = parishes.map((parish) => {
    const patron = parishPatrons[parish.id]?.[0];
    return {
      ...parishOption(parish),
      icon: patron ? <SaintAvatar saint={patron.saint} small /> : undefined,
    };
  });

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: '',
    parishId: '',
    latitude: null as number | null,
    longitude: null as number | null,
  });
  const [geocoding, setGeocoding] = useState(false);
  const [locInput, setLocInput] = useState('');

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
    if (!formData.parishId) {
      notify.warning('Selecione a paróquia da comunidade.');
      return;
    }

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
      latitude: community.latitude ?? null,
      longitude: community.longitude ?? null,
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
      latitude: null,
      longitude: null,
    });
    setEditingCommunity(null);
  };

  // Endereço → coordenadas (Nominatim via backend). Posiciona o pino no mapa.
  const geocodeFromAddress = async () => {
    const query = [formData.address, formData.city, formData.state, formData.zipCode]
      .filter(Boolean)
      .join(', ')
      .trim();
    if (query.length < 3) {
      notify.warning('Preencha o endereço (rua, cidade, estado) para localizar no mapa.');
      return;
    }
    setGeocoding(true);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.get(`${API_URL}/geocoding/search`, {
        params: { q: query },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (Array.isArray(data) && data.length > 0) {
        const best = data[0];
        setFormData((prev) => ({ ...prev, latitude: best.latitude, longitude: best.longitude }));
        notify.success('Local encontrado! Ajuste o pino se necessário.');
      } else {
        notify.warning('Endereço não localizado. Posicione o pino manualmente no mapa.');
      }
    } catch (error: any) {
      console.error('Erro ao geocodificar:', error);
      notify.error('Não foi possível localizar o endereço.');
    } finally {
      setGeocoding(false);
    }
  };

  // Extrai lat/long de um link do Google Maps ou de um texto "lat, long".
  const parseCoords = (input: string): { lat: number; lng: number } | null => {
    const s = (input || '').trim();
    if (!s) return null;
    // 1) Pino do lugar no Google Maps: !3d<lat>!4d<lng> (mais preciso)
    let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // 2) Centro do mapa / query: @lat,lng · q=lat,lng · ll=lat,lng
    m = s.match(/[@?&](?:q=|ll=)?(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // 3) Texto simples "lat, long"
    m = s.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    return null;
  };

  const applyPastedLocation = () => {
    const coords = parseCoords(locInput);
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
      notify.warning('Cole um link do Google Maps ou coordenadas no formato "-25.108, -50.126".');
      return;
    }
    setFormData((prev) => ({ ...prev, latitude: coords.lat, longitude: coords.lng }));
    setLocInput('');
    notify.success('Coordenadas aplicadas! Confira o pino no mapa.');
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
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="comunidade" /> Comunidades</h1>
        {isAdminRole && (
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            + Nova Comunidade
          </button>
        )}
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
          <SearchSelect
            options={parishOptions}
            value={filterParish}
            onChange={setFilterParish}
            placeholder="Todas as paróquias"
            allOption
            searchPlaceholder="Buscar paróquia ou diocese..."
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
        <div className="communities-grid">
          {paginatedCommunities.length === 0 ? (
            <p className="no-results">Nenhuma comunidade encontrada.</p>
          ) : (
            paginatedCommunities.map((community) => (
              <div key={community.id} className="entity-card">
                <div className="entity-card-header">
                  <div className="entity-monogram" style={{ background: avatarColor(community.name) }}>
                    {initials(community.name)}
                  </div>
                  <div className="entity-heading">
                    <h3 className="entity-title">{community.name}</h3>
                    <div className="entity-chips">
                      <span className="entity-chip soft-blue">{community.parish.name}</span>
                      <span className="entity-chip">{community.parish.diocese.name}</span>
                    </div>
                  </div>
                </div>
                <div className="entity-card-body">
                  <div className="entity-field">
                    <span className="entity-field-label">Cidade</span>
                    <span className="entity-field-value">{community.city} - {community.state}</span>
                  </div>
                  <div className="entity-field">
                    <span className="entity-field-label">Endereço</span>
                    <span className="entity-field-value">{community.address}</span>
                  </div>
                  <div className="entity-field">
                    <span className="entity-field-label">CEP</span>
                    <span className="entity-field-value">{community.zipCode}</span>
                  </div>
                  {community.phone && (
                    <div className="entity-field">
                      <span className="entity-field-label">Telefone</span>
                      <span className="entity-field-value">{community.phone}</span>
                    </div>
                  )}
                  {community.email && (
                    <div className="entity-field">
                      <span className="entity-field-label">Email</span>
                      <span className="entity-field-value">{community.email}</span>
                    </div>
                  )}
                  <PatronSaintsBadge patrons={patronsByEntity[community.id]} />
                </div>
                <div className="entity-card-footer">
                  {canEditCommunity && (
                    <button className="entity-btn primary" onClick={() => handleEdit(community)}>
                      Editar
                    </button>
                  )}
                  {canEditCommunity && (
                    <button className="entity-btn accent" onClick={() => setPatronTarget(community)}>
                      🕊️ Padroeiro
                    </button>
                  )}
                  {isAdminRole && (
                    <button className="entity-btn danger" onClick={() => handleDelete(community.id)}>
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
            <div className="bulk-actions" style={selectedCommunities.length === 0 ? { display: 'none' } : undefined}>
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
                <th>Padroeiro</th>
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
                    <span className="entity-chip soft-blue">{community.parish.name}</span>
                  </td>
                  <td>{community.parish.diocese.name}</td>
                  <td>{community.city} - {community.state}</td>
                  <td>{community.phone || '-'}</td>
                  <td>{community.email || '-'}</td>
                  <td>
                    {patronsByEntity[community.id]?.[0] ? (
                      <span className="patron-cell">
                        <SaintAvatar saint={patronsByEntity[community.id][0].saint} small />
                        {patronsByEntity[community.id][0].saint.name}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{formatDate(community.createdAt)}</td>
                  <td className="actions-cell">
                    {canEditCommunity && (
                      <button className="entity-icon-btn" onClick={() => handleEdit(community)} title="Editar">
                        ✏️
                      </button>
                    )}
                    {canEditCommunity && (
                      <button className="entity-icon-btn" onClick={() => setPatronTarget(community)} title="Padroeiro">
                        🕊️
                      </button>
                    )}
                    {isAdminRole && (
                      <button className="entity-icon-btn danger" onClick={() => handleDelete(community.id)} title="Excluir">
                        🗑️
                      </button>
                    )}
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
                <SearchSelect
                  options={parishOptions}
                  value={formData.parishId}
                  onChange={(parishId) => setFormData({ ...formData, parishId })}
                  placeholder="Selecione uma paróquia"
                  searchPlaceholder="Buscar paróquia ou diocese..."
                />
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

              <div className="form-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ margin: 0 }}>📍 Localização no mapa</label>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={geocodeFromAddress}
                    disabled={geocoding}
                  >
                    {geocoding ? 'Localizando…' : '🔎 Localizar pelo endereço'}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: '#888', margin: '4px 0 8px' }}>
                  Usado para encontrar as missas mais próximas. Clique no mapa ou arraste o pino para ajustar.
                </p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={locInput}
                    onChange={(e) => setLocInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPastedLocation(); } }}
                    placeholder='Colar link do Google Maps ou "lat, long"'
                    style={{ flex: 1, minWidth: 220, padding: '8px 10px', fontSize: 13 }}
                  />
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ padding: '6px 14px', fontSize: 13 }}
                    onClick={applyPastedLocation}
                  >
                    📌 Aplicar
                  </button>
                </div>
                <p style={{ fontSize: 11, color: '#aaa', margin: '0 0 8px' }}>
                  Dica: no Google Maps, clique com o botão direito no ponto exato → copie as coordenadas, ou cole o link
                  da barra de endereço.
                </p>
                <MapPicker
                  value={
                    formData.latitude != null && formData.longitude != null
                      ? { lat: formData.latitude, lng: formData.longitude }
                      : null
                  }
                  onChange={(lat, lng) => setFormData((prev) => ({ ...prev, latitude: lat, longitude: lng }))}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#666' }}>
                    {formData.latitude != null && formData.longitude != null
                      ? `Lat ${formData.latitude.toFixed(6)}, Long ${formData.longitude.toFixed(6)}`
                      : 'Nenhuma coordenada definida'}
                  </span>
                  {formData.latitude != null && (
                    <button
                      type="button"
                      className="btn-cancel"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => setFormData((prev) => ({ ...prev, latitude: null, longitude: null }))}
                    >
                      Limpar
                    </button>
                  )}
                </div>
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

      {patronTarget && (
        <PatronSaintsManager
          level="community"
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

export default CommunitiesPage;
