import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import TitleIcon from '../components/TitleIcon';
import axios from 'axios';
import api, { getErrorMessage } from '../services/api';
import { notify, confirm } from '../services/notification.service';
import { csvInstantDate, downloadCsv } from '../utils/csvExport';
import { isPagedResponse, useDebouncedValue } from '../utils/useDebouncedValue';
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

// A lista leve da cascata (`/parishes?dioceseId=`) não traz a diocese
const parishOption = (parish: Parish) => ({
  value: parish.id,
  label: parish.name,
  sublabel:
    [parish.diocese?.name, parish.city ? `${parish.city}${parish.state ? ` - ${parish.state}` : ''}` : null]
      .filter(Boolean)
      .join(' · ') || undefined,
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
  /** Coordenador leigo pode registrar sacramentos e emitir certidão (padrão: não) */
  laySacramentRecords?: boolean;
  parishId?: string;
  parish: Parish;
  createdAt: string;
}

/** Paróquias por busca no filtro do escopo amplo */
const FILTER_PARISH_PAGE_SIZE = 20;

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

  /**
   * Escopo amplo (plataforma ~53 mil comunidades; diocese, centenas): a lista
   * vem paginada do servidor (`page`, `pageSize`, `search` sem acento por
   * nome/cidade), com busca atrasada (debounce). Servidor antigo que ignora
   * `page` devolve a lista inteira — aí a tela volta ao modo local.
   */
  const serverMode = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN'].includes(authUser?.role ?? '');
  // Plataforma: paróquias do formulário em cascata pela diocese (12,8 mil no total)
  const platformScope = authUser?.role === 'SYSTEM_ADMIN';
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(searchTerm.trim(), 350);
  const serverPaged = serverMode && serverTotal !== null;
  const requestSeq = useRef(0);
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [formDioceseId, setFormDioceseId] = useState('');

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

  /**
   * Filtro por paróquia no escopo amplo: busca paginada no servidor
   * (`/parishes?page=1&search=`, já limitada ao escopo — diocese do
   * DIOCESAN_ADMIN, país do SYSTEM_ADMIN). Independe da cascata do formulário.
   */
  const [filterParishSearch, setFilterParishSearch] = useState('');
  const debouncedFilterParishSearch = useDebouncedValue(filterParishSearch.trim(), 350);
  const [filterParishHits, setFilterParishHits] = useState<Parish[]>([]);
  const [filterParishTotal, setFilterParishTotal] = useState<number | null>(null);
  const [selectedFilterParish, setSelectedFilterParish] = useState<Parish | null>(null);
  useEffect(() => {
    if (!serverMode) return;
    let alive = true;
    api
      .get('/parishes', {
        params: { page: 1, pageSize: FILTER_PARISH_PAGE_SIZE, search: debouncedFilterParishSearch || undefined },
      })
      .then((res) => {
        if (!alive) return;
        if (isPagedResponse<Parish>(res.data)) {
          setFilterParishHits(res.data.items);
          setFilterParishTotal(res.data.total);
        } else {
          // Servidor antigo (ignora `page`): lista inteira; o SearchSelect filtra
          setFilterParishHits(Array.isArray(res.data) ? res.data : []);
          setFilterParishTotal(null);
        }
      })
      .catch(() => {
        if (alive) setFilterParishHits([]);
      });
    return () => {
      alive = false;
    };
  }, [serverMode, debouncedFilterParishSearch]);
  const pickFilterParish = (id: string) => {
    setSelectedFilterParish(id ? filterParishHits.find((parish) => parish.id === id) ?? null : null);
    setFilterParish(id);
  };
  // A paróquia escolhida continua no seletor mesmo fora do resultado da busca atual
  const filterParishOptions = [
    ...(selectedFilterParish && !filterParishHits.some((parish) => parish.id === selectedFilterParish.id)
      ? [selectedFilterParish]
      : []),
    ...filterParishHits,
  ].map((parish) => {
    const patron = parishPatrons[parish.id]?.[0];
    return { ...parishOption(parish), icon: patron ? <SaintAvatar saint={patron.saint} small /> : undefined };
  });
  const filterParishFooter =
    filterParishTotal !== null && filterParishTotal > filterParishHits.length
      ? `${filterParishHits.length} de ${filterParishTotal.toLocaleString('pt-BR')} — digite para refinar a busca`
      : undefined;

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
    laySacramentRecords: false,
  });
  const [geocoding, setGeocoding] = useState(false);
  const [locInput, setLocInput] = useState('');

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Uma página da lista (escopo amplo). Resposta fora de ordem é descartada. */
  const fetchPage = useCallback(async () => {
    const seq = ++requestSeq.current;
    setListLoading(true);
    try {
      const { data } = await api.get('/communities', {
        params: {
          page: currentPage,
          pageSize: itemsPerPage,
          search: debouncedSearch || undefined,
          // Filtro por paróquia dentro do escopo (o servidor aceita junto com `page`)
          parishId: filterParish || undefined,
        },
      });
      if (seq !== requestSeq.current) return;
      if (isPagedResponse<Community>(data)) {
        setCommunities(data.items);
        setServerTotal(data.total);
      } else {
        // Servidor sem paginação: lista inteira, filtrada/paginada aqui
        setCommunities(Array.isArray(data) ? data : []);
        setServerTotal(null);
      }
    } catch (error) {
      if (seq === requestSeq.current) notify.error(getErrorMessage(error, 'Erro ao carregar comunidades'));
    } finally {
      if (seq === requestSeq.current) {
        setListLoading(false);
        setLoading(false);
      }
    }
  }, [currentPage, itemsPerPage, debouncedSearch, filterParish]);

  useEffect(() => {
    if (serverMode) fetchPage();
  }, [serverMode, fetchPage]);

  // Nova busca/filtro volta para a primeira página
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filterParish]);

  // Cascata da plataforma: paróquias da diocese escolhida no formulário
  useEffect(() => {
    if (!platformScope || !showModal || !formDioceseId) return;
    let cancelled = false;
    const diocese = dioceses.find((d) => d.id === formDioceseId);
    api
      .get('/parishes', { params: { dioceseId: formDioceseId } })
      .then((res) => {
        if (cancelled) return;
        const rows: Parish[] = (Array.isArray(res.data) ? res.data : []).map((parish: any) => ({
          ...parish,
          diocese: parish.diocese ?? (diocese ? { id: diocese.id, name: diocese.name } : undefined),
        }));
        setParishes(rows);
      })
      .catch((error) => {
        if (!cancelled) notify.error(getErrorMessage(error, 'Erro ao carregar as paróquias da diocese'));
      });
    return () => {
      cancelled = true;
    };
  }, [platformScope, showModal, formDioceseId, dioceses]);

  /** Recarrega a lista depois de criar/editar/excluir */
  const refreshList = () => (serverMode ? fetchPage() : fetchData());

  const fetchData = async () => {
    if (serverMode) {
      // Escopo amplo: a lista vem por página (fetchPage); aqui só a fonte das paróquias
      try {
        if (platformScope) {
          const { data } = await api.get('/dioceses');
          setDioceses(Array.isArray(data) ? data : []);
        } else {
          const { data } = await api.get('/parishes');
          setParishes(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        notify.error(getErrorMessage(error, 'Erro ao carregar paróquias'));
      }
      return;
    }
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
      const { laySacramentRecords, ...communityData } = formData;

      if (editingCommunity) {
        await axios.patch(
          `${API_URL}/communities/${editingCommunity.id}`,
          // Interruptor de sacramentos por leigos: só PARISH_ADMIN+ (o coordenador não muda)
          isAdminRole ? { ...communityData, laySacramentRecords } : communityData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        notify.success('Comunidade atualizada com sucesso!');
      } else {
        await axios.post(`${API_URL}/communities`, communityData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        notify.success('Comunidade criada com sucesso!');
      }

      setShowModal(false);
      resetForm();
      refreshList();
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
      parishId: community.parish?.id ?? community.parishId ?? '',
      latitude: community.latitude ?? null,
      longitude: community.longitude ?? null,
      laySacramentRecords: community.laySacramentRecords === true,
    });
    // Plataforma: abre a cascata na diocese da paróquia atual
    if (platformScope) setFormDioceseId(community.parish?.diocese?.id ?? '');
    setShowModal(true);
  };

  // Atalho ?edit=<id> (Sugestões dos fiéis): abre o cadastro direto no formulário.
  // A comunidade pode não estar na lista carregada — nesse caso vem do detalhe.
  const [searchParams, setSearchParams] = useSearchParams();
  const editFromUrl = searchParams.get('edit');
  useEffect(() => {
    if (!editFromUrl || loading || !canEditCommunity) return;
    const open = (community: Community) => {
      handleEdit(community);
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    };
    const found = communities.find((c) => c.id === editFromUrl);
    if (found) {
      open(found);
      return;
    }
    axios
      .get(`${API_URL}/communities/${editFromUrl}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
      .then((res) => open(res.data))
      .catch(() => notify.error('Não foi possível abrir a comunidade do atalho'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFromUrl, loading]);

  const handleDelete = async (id: string) => {
    const confirmed = await confirm.delete('esta comunidade');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/communities/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Comunidade excluída com sucesso!');
      refreshList();
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
      laySacramentRecords: false,
    });
    setEditingCommunity(null);
    setFormDioceseId('');
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

  // Extrai lat/long de um texto "lat, long" ou de um link do OpenStreetMap
  // (?mlat=..&mlon=.. ou #map=zoom/lat/lon). Google Maps/Places é proibido
  // como fonte de posição (contrato): link do Google é recusado.
  const parseCoords = (input: string): { lat: number; lng: number } | 'google' | null => {
    const s = (input || '').trim();
    if (!s) return null;
    if (/google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(s)) return 'google';
    const ok = (lat: number, lng: number) =>
      Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
        ? { lat, lng }
        : null;
    // 1) Pino do OpenStreetMap: mlat=<lat>&mlon=<lon>
    const mlat = s.match(/[?&]mlat=(-?\d{1,3}(?:\.\d+)?)/);
    const mlon = s.match(/[?&]mlon=(-?\d{1,3}(?:\.\d+)?)/);
    if (mlat && mlon) return ok(parseFloat(mlat[1]), parseFloat(mlon[1]));
    // 2) Centro do mapa do OpenStreetMap: #map=<zoom>/<lat>/<lon>
    let m = s.match(/#map=\d{1,2}\/(-?\d{1,3}\.\d+)\/(-?\d{1,3}\.\d+)/);
    if (m) return ok(parseFloat(m[1]), parseFloat(m[2]));
    // 3) Texto simples "lat, long"
    m = s.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
    if (m) return ok(parseFloat(m[1]), parseFloat(m[2]));
    return null;
  };

  const applyPastedLocation = () => {
    const coords = parseCoords(locInput);
    if (coords === 'google') {
      notify.warning('Links do Google Maps não podem ser usados. Cole as coordenadas "lat, long" ou um link do OpenStreetMap — ou ajuste o pino no mapa.');
      return;
    }
    if (!coords) {
      notify.warning('Cole coordenadas no formato "-25.108, -50.126" ou um link do OpenStreetMap.');
      return;
    }
    setFormData((prev) => ({ ...prev, latitude: coords.lat, longitude: coords.lng }));
    setLocInput('');
    notify.success('Coordenadas aplicadas! Confira o pino no mapa.');
  };

  // Filtros (modo local). Paginado no servidor, a busca já veio aplicada lá
  // (sem acento, por nome/cidade) e a ordem é a do servidor (nome).
  const normalizeText = (text: string | null | undefined) =>
    (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = normalizeText(searchTerm.trim());
  const filteredCommunities = serverPaged
    ? communities
    : communities.filter((community) => {
        const matchesSearch =
          !term ||
          normalizeText(community.name).includes(term) ||
          normalizeText(community.city).includes(term) ||
          normalizeText(community.parish?.name).includes(term);
        const matchesParish = !filterParish || community.parish?.id === filterParish;
        return matchesSearch && matchesParish;
      });

  // Ordenação
  const sortedCommunities = serverPaged
    ? filteredCommunities
    : [...filteredCommunities].sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'city':
            comparison = (a.city ?? '').localeCompare(b.city ?? '');
            break;
          case 'parish':
            comparison = (a.parish?.name ?? '').localeCompare(b.parish?.name ?? '');
            break;
          case 'createdAt':
            comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            break;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });

  // Paginação (no servidor, `communities` já é a página atual)
  const totalCount = serverPaged ? serverTotal ?? 0 : sortedCommunities.length;
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const paginatedCommunities = serverPaged
    ? sortedCommunities
    : sortedCommunities.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (field: typeof sortField) => {
    // Paginado no servidor a ordem é a do servidor (nome)
    if (serverPaged) return;
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
      refreshList();
    } catch (error: any) {
      console.error('Erro ao excluir comunidades:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir comunidades');
    }
  };

  const exportToCSV = () => {
    // Excel pt-BR: ';', BOM UTF-8, datas dd/mm/aaaa. Paginado no servidor,
    // exporta a página exibida (a lista inteira seria o país).
    downloadCsv(
      'comunidades',
      ['Nome', 'Paróquia', 'Diocese', 'Cidade', 'Estado', 'Endereço', 'CEP', 'Telefone', 'Email', 'Leigos registram sacramentos', 'Criada em'],
      sortedCommunities.map((community) => [
        community.name,
        community.parish?.name ?? '',
        community.parish?.diocese?.name ?? '',
        community.city,
        community.state,
        community.address,
        community.zipCode,
        community.phone || '',
        community.email || '',
        community.laySacramentRecords === true,
        csvInstantDate(community.createdAt),
      ]),
    );
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
            placeholder={serverPaged ? 'Buscar por nome ou cidade...' : 'Buscar por nome, cidade ou paróquia...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
            aria-label="Buscar comunidades"
          />
          {/* Escopo amplo: paróquias buscadas no servidor; filtro enviado como `parishId` */}
          {serverMode ? (
            <SearchSelect
              options={filterParishOptions}
              value={filterParish}
              onChange={pickFilterParish}
              placeholder="Todas as paróquias"
              allOption
              searchPlaceholder="Buscar paróquia ou cidade..."
              onSearchChange={filterParishTotal !== null ? setFilterParishSearch : undefined}
              footer={filterParishFooter}
            />
          ) : (
            <SearchSelect
              options={parishOptions}
              value={filterParish}
              onChange={setFilterParish}
              placeholder="Todas as paróquias"
              allOption
              searchPlaceholder="Buscar paróquia ou diocese..."
            />
          )}
          {listLoading && <span style={{ alignSelf: 'center', color: '#888', fontSize: 13 }}>Buscando…</span>}
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
                      <span className="entity-chip soft-blue">{community.parish?.name}</span>
                      {community.parish?.diocese?.name && (
                        <span className="entity-chip">{community.parish.diocese.name}</span>
                      )}
                      {community.laySacramentRecords && (
                        <span
                          className="entity-chip"
                          title="Coordenador leigo pode registrar sacramentos e emitir certidão"
                        >
                          Leigos registram sacramentos
                        </span>
                      )}
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
                    <span className="entity-chip soft-blue">{community.parish?.name}</span>
                  </td>
                  <td>{community.parish?.diocese?.name ?? '-'}</td>
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
          <button aria-label="Primeira página"
            className="pagination-btn"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
          >
            «
          </button>
          <button aria-label="Página anterior"
            className="pagination-btn"
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            ‹
          </button>
          <span className="pagination-info">
            Página {currentPage} de {totalPages} ({totalCount.toLocaleString('pt-BR')} comunidades)
          </span>
          <button aria-label="Próxima página"
            className="pagination-btn"
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            ›
          </button>
          <button aria-label="Última página"
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

              {platformScope && (
                <div className="form-group">
                  <label>Diocese *</label>
                  <SearchSelect
                    options={dioceses.map((diocese) => ({ value: diocese.id, label: diocese.name }))}
                    value={formDioceseId}
                    onChange={(dioceseId) => {
                      setFormDioceseId(dioceseId);
                      setParishes([]);
                      setFormData({ ...formData, parishId: '' });
                    }}
                    placeholder="Selecione a diocese"
                    searchPlaceholder="Buscar diocese..."
                  />
                </div>
              )}

              <div className="form-group">
                <label>Paróquia *</label>
                {platformScope && !formDioceseId ? (
                  <p style={{ fontSize: 13, color: '#888', margin: 0 }}>Escolha a diocese para listar as paróquias.</p>
                ) : (
                  <SearchSelect
                    options={parishOptions}
                    value={formData.parishId}
                    onChange={(parishId) => setFormData({ ...formData, parishId })}
                    placeholder="Selecione uma paróquia"
                    searchPlaceholder="Buscar paróquia ou diocese..."
                  />
                )}
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

              {/* Registro sacramental por leigos: decisão da paróquia, por comunidade (PARISH_ADMIN+) */}
              {editingCommunity && isAdminRole && (
                <div className="form-group">
                  <label
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontWeight: 'normal' }}
                  >
                    <input
                      type="checkbox"
                      checked={formData.laySacramentRecords}
                      onChange={(e) => setFormData({ ...formData, laySacramentRecords: e.target.checked })}
                      style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }}
                    />
                    <span>
                      <strong>Coordenador leigo pode registrar sacramentos e emitir certidão</strong>
                      <br />
                      <small style={{ color: '#66788c' }}>
                        Desligado (padrão): só a secretaria paroquial e o pároco registram assentos, retificam e
                        emitem certidões desta comunidade. Ligue apenas se o pároco delegou essa tarefa ao
                        coordenador da comunidade.
                      </small>
                    </span>
                  </label>
                </div>
              )}

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
                    placeholder='Colar "lat, long" ou link do OpenStreetMap'
                    aria-label="Coordenadas ou link do OpenStreetMap"
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
                  Dica: no openstreetmap.org, clique com o botão direito no ponto exato → "Mostrar endereço" e copie as
                  coordenadas, ou cole o link da barra de endereço. Não use posições do Google Maps.
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
