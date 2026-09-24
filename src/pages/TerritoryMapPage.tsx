import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import TitleIcon from '../components/TitleIcon';
import BaseMapLayers, { type BaseMap } from '../components/BaseMapLayers';
import api, { getErrorMessage } from '../services/api';
import './modules/ModulePages.css';
import './TerritoryMapPage.css';

/**
 * Mapa do território — painel do SYSTEM_ADMIN.
 *
 * Três funções: ver o país inteiro, corrigir o pino de uma comunidade sem abrir o
 * cadastro completo e esvaziar a FILA DE REVISÃO — as coordenadas que as cargas
 * automáticas acharam mas não gravaram sozinhas, à espera de um par de olhos.
 * A carga é por retângulo visível, porque são mais de 50 mil comunidades.
 */

type PinKind = 'ok' | 'rua' | 'local' | 'dup' | 'sem';
type Filtro = PinKind | 'todos' | 'fila';

interface Candidate {
  id: string;
  lat: number;
  lng: number;
  source: string;
  reason: string;
  label: string | null;
  detail: string | null;
  distanceKm: number | null;
}

interface MapRow {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  city: string;
  state: string;
  address: string | null;
  parish: string;
  diocese: string;
  kind: PinKind;
  /** De onde veio a coordenada (cep, cnefe, manual...). */
  source?: string | null;
  /** Tem sugestão de pino à espera de conferência. */
  review?: boolean;
  /** Quando e por quem/o quê o pino foi conferido (nulo = palpite de máquina). */
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  hasMass?: boolean;
  candidates?: Candidate[];
}

interface Contadores {
  total: number;
  sem: number;
  local?: number;
  dup: number;
  rua?: number;
  ok: number;
}

interface Stats extends Contadores {
  fila?: number;
  paroquias: number;
  dioceses: number;
  porUf: Array<Contadores & { uf: string }>;
}

interface DioceseRow extends Contadores {
  id: string;
  name: string;
  uf: string;
}

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const CENTRO_BRASIL: [number, number] = [-14.8, -52.5];

const PIN_LABEL: Record<PinKind, string> = {
  ok: 'pino na porta',
  rua: 'pino na rua — pode estar a quadras da porta',
  local: 'pino no centro do povoado ou bairro',
  dup: 'pino aproximado (centro da cidade)',
  sem: 'sem pino',
};
const PIN_COR: Record<PinKind, string> = { ok: '#2E9D62', rua: '#9BBF3B', local: '#2F7FC1', dup: '#C78216', sem: '#8B97A4' };
const COR_SUGESTAO = '#8E44AD';

/** Origem do pino (Community.geoSource) em linguagem de gente. */
const ORIGEM: Record<string, string> = {
  manual: 'posicionado à mão no mapa',
  gps: 'GPS do celular, no local',
  cep: 'CEP do endereço (meio do logradouro)',
  'osm-endereco': 'endereço no OpenStreetMap (meio da rua)',
  cnefe: 'templo no Censo 2022 (IBGE)',
  overture: 'lugar na Overture Maps',
  'cnefe+overture': 'Censo 2022 e Overture Maps concordam',
  'cnefe-endereco': 'endereço com número no Censo 2022 (IBGE)',
  'cnefe-endereco-oficial': 'endereço publicado pela diocese/paróquia, localizado no Censo 2022 (IBGE)',
  'cnefe-localidade': 'centro da localidade no Censo 2022 (IBGE)',
  'cnefe-templo': 'templo católico do povoado no Censo 2022, sem padroeiro declarado',
  'ibge-municipio': 'centro do município (IBGE)',
  'legado-centro': 'pino antigo, empilhado no centro da cidade',
  legado: 'pino anterior ao controle de origem',
};
const origemDoPino = (s?: string | null) => (s ? ORIGEM[s] ?? s : null);

/** De onde vem a sugestão e por que ela não entrou sozinha. */
const FONTE_DA_SUGESTAO: Record<string, string> = {
  cnefe: 'Censo 2022 — templo',
  overture: 'Overture Maps',
  'cnefe-endereco': 'Censo 2022 — endereço',
  'site-paroquia': 'site da paróquia',
  'site-diocese': 'site da diocese',
  wikidata: 'Wikidata',
  usuario: 'fiel no app',
};
const MOTIVO_DA_SUGESTAO: Record<string, string> = {
  conflito: 'as fontes discordam entre si',
  'fonte-unica': 'uma fonte só, fora da regra automática',
  disputa: 'templo que serve a mais de uma comunidade nossa',
  divergencia: 'o endereço aponta para outro lugar (ou: templo católico na mesma rua, longe do número)',
  'pino-suspeito': 'duas fontes desmentem o pino atual',
  'mesmo-ponto': 'mesmo ponto de outra comunidade',
  evidencia: 'coordenada publicada pela própria paróquia',
  'endereco-oficial': 'endereço oficial, localizado no Censo',
  'sugestao-usuario': 'sugestão de um fiel (confira antes de aceitar)',
};

/** Quem conferiu o pino, em linguagem de gente. */
const conferidoPor = (by?: string | null) => {
  if (!by) return null;
  if (by.startsWith('usuario')) return 'conferido por uma pessoa';
  if (by.startsWith('evidencia:')) return `conferido pelo ${FONTE_DA_SUGESTAO[by.slice(10)] ?? by.slice(10)}`;
  if (by === 'osm') return 'conferido pelo OpenStreetMap (templo com este nome no lugar)';
  return `conferido: ${by}`;
};
/** Texto de detalhe da sugestão com o link clicável, quando há URL. */
const Detalhe: React.FC<{ texto: string }> = ({ texto }) => {
  const m = texto.match(/https?:\/\/\S+/);
  if (!m) return <>{texto}</>;
  const i = texto.indexOf(m[0]);
  return (
    <>
      {texto.slice(0, i)}
      <a href={m[0]} target="_blank" rel="noopener noreferrer">{m[0].replace(/^https?:\/\//, '').slice(0, 60)}</a>
      {texto.slice(i + m[0].length)}
    </>
  );
};

const iconeEdicao = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Resposta inesperada da API não pode derrubar a página inteira.
const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('pt-BR') : '—');
const distancia = (km: number | null) => (km == null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`);
const letra = (i: number) => String.fromCharCode(65 + i);

/** Avisa o pai quando o usuário para de mexer no mapa, para recarregar o recorte. */
const ObservadorDeRecorte: React.FC<{ onChange: (bbox: string, zoom: number) => void }> = ({ onChange }) => {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onChange(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`, map.getZoom());
    },
  });
  useEffect(() => {
    const b = map.getBounds();
    onChange(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`, map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const IrPara: React.FC<{ alvo: [number, number] | null; zoom?: number }> = ({ alvo, zoom }) => {
  const map = useMap();
  useEffect(() => {
    if (alvo) map.setView(alvo, Math.max(map.getZoom(), zoom ?? 15));
  }, [alvo?.[0], alvo?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

/** Clique no mapa define a coordenada enquanto uma comunidade está em edição. */
const CliqueDefinePino: React.FC<{ ativo: boolean; onPick: (lat: number, lng: number) => void }> = ({ ativo, onPick }) => {
  useMapEvents({
    click(e) {
      if (ativo) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
};

/**
 * Consulta o Nominatim. Primeiro ESTRUTURADA (rua + cidade + UF): o resto do endereço —
 * "núcleo 6 – Cidade Nova II", CEP — derruba a busca livre. No Brasil o OpenStreetMap quase
 * não tem número de casa: o que volta costuma ser o MEIO da rua, e quem chama precisa saber.
 */
async function procurarNoNominatim(row: MapRow): Promise<{ lat: number; lng: number; nivel: 'numero' | 'rua' | 'cidade' } | null> {
  const base = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR';
  const rua = (row.address ?? '').split(/\s[–—-]\s|\(|\bCEP\b/i)[0].replace(/\bn[º°.]\s*/i, '').trim();
  const tentativas: Array<[string, boolean]> = [];
  if (rua) tentativas.push([`&street=${encodeURIComponent(rua)}&city=${encodeURIComponent(row.city)}&state=${encodeURIComponent(row.state)}&country=Brasil`, false]);
  if (row.address) tentativas.push([`&q=${encodeURIComponent([row.address, row.city, row.state, 'Brasil'].join(', '))}`, false]);
  tentativas.push([`&q=${encodeURIComponent([row.city, row.state, 'Brasil'].join(', '))}`, true]);
  for (const [consulta, soCidade] of tentativas) {
    const resposta = await fetch(base + consulta);
    const achados = (await resposta.json()) as Array<{ lat: string; lon: string; place_rank?: number }>;
    if (!achados?.length) continue;
    const rank = achados[0].place_rank ?? 0;
    if (!soCidade && rank < 26) continue; // só achou o bairro ou a cidade: tenta a próxima forma
    return { lat: Number(achados[0].lat), lng: Number(achados[0].lon), nivel: soCidade ? 'cidade' : rank >= 28 ? 'numero' : 'rua' };
  }
  return null;
}

const TerritoryMapPage: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dioceses, setDioceses] = useState<DioceseRow[]>([]);
  const [rows, setRows] = useState<MapRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [fila, setFila] = useState<{ total: number; withMass: number } | null>(null);

  const [uf, setUf] = useState('');
  const [dioceseId, setDioceseId] = useState('');
  const [pin, setPin] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [bbox, setBbox] = useState('');
  const [zoom, setZoom] = useState(4);
  const [baseMap, setBaseMap] = useState<BaseMap>('mapa');

  // Edição do pino
  const [emEdicao, setEmEdicao] = useState<MapRow | null>(null);
  const [rascunho, setRascunho] = useState<{ lat: number; lng: number } | null>(null);
  const [candidatos, setCandidatos] = useState<Candidate[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  const [alvoMapa, setAlvoMapa] = useState<[number, number] | null>(null);

  const pedidoRef = useRef(0);
  const naFila = pin === 'fila';

  const carregarStats = useCallback(() => {
    api
      .get('/communities/map/stats')
      .then((r) => setStats(typeof r.data?.total === 'number' ? r.data : null))
      .catch((e) => setErro(getErrorMessage(e, 'Não foi possível carregar o mapa.')));
  }, []);
  useEffect(() => { carregarStats(); }, [carregarStats]);

  useEffect(() => {
    api
      .get('/communities/map/dioceses', { params: uf ? { uf } : {} })
      .then((r) => setDioceses(Array.isArray(r.data) ? r.data : []))
      .catch(() => setDioceses([]));
    setDioceseId('');
  }, [uf]);

  const carregar = useCallback(async () => {
    const meu = ++pedidoRef.current;
    setCarregando(true);
    setErro('');
    try {
      if (naFila) {
        // A fila não depende do recorte do mapa: vem por impacto (com missa primeiro), do país ou do filtro.
        const params: Record<string, string> = { limit: '300' };
        if (uf) params.uf = uf;
        if (dioceseId) params.dioceseId = dioceseId;
        const { data } = await api.get('/communities/map/review', { params });
        if (meu !== pedidoRef.current) return;
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setFila({ total: Number(data?.total) || 0, withMass: Number(data?.withMass) || 0 });
        setTruncated((Number(data?.total) || 0) > (data?.rows?.length ?? 0));
        return;
      }
      // Sem pino não tem onde desenhar: nesse filtro a lista manda, e o recorte
      // do mapa é ignorado — senão a fila de trabalho viria vazia.
      const params: Record<string, string> = { pin };
      if (uf) params.uf = uf;
      if (dioceseId) params.dioceseId = dioceseId;
      if (buscaAplicada) params.q = buscaAplicada;
      if (bbox && pin !== 'sem' && !buscaAplicada) params.bbox = bbox;
      const { data } = await api.get('/communities/map', { params });
      if (meu !== pedidoRef.current) return;
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setTruncated(Boolean(data.truncated));
    } catch (e) {
      if (meu === pedidoRef.current) setErro(getErrorMessage(e, 'Não foi possível carregar as comunidades.'));
    } finally {
      if (meu === pedidoRef.current) setCarregando(false);
    }
  }, [uf, dioceseId, pin, naFila, buscaAplicada, naFila ? '' : bbox]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void carregar(); }, [carregar]);

  const comPino = useMemo(() => rows.filter((r) => r.lat != null && r.lng != null), [rows]);
  const semPino = useMemo(() => rows.filter((r) => r.lat == null), [rows]);

  const abrirEdicao = (row: MapRow) => {
    setEmEdicao(row);
    setAviso('');
    setRascunho(row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null);
    setCandidatos(row.candidates ?? []);
    if (!row.candidates && row.review) {
      api.get(`/communities/${row.id}/geo-candidates`).then((r) => setCandidatos(Array.isArray(r.data) ? r.data : [])).catch(() => setCandidatos([]));
    }
    // Na fila, o que interessa olhar é a sugestão, não o pino que está sob suspeita
    const primeira = row.candidates?.[0];
    if (naFila && primeira) setAlvoMapa([primeira.lat, primeira.lng]);
    else if (row.lat != null && row.lng != null) setAlvoMapa([row.lat, row.lng]);
    // Sem pino, o mapa continuaria no país inteiro e não haveria o que conferir:
    // já pedimos a sugestão do endereço ao abrir, que é o caso mais comum aqui.
    else if (row.address) void sugerirPeloEndereco(row, true);
  };

  /** Sugere a coordenada pelo endereço. Diz com todas as letras quando o que achou foi só a rua. */
  const sugerirPeloEndereco = async (alvoRow?: MapRow, automatico = false) => {
    const row = alvoRow ?? emEdicao;
    if (!row) return;
    setBuscandoEndereco(true);
    setAviso('');
    try {
      const achado = await procurarNoNominatim(row);
      if (!achado) {
        if (!automatico) setAviso('O endereço não foi encontrado. Clique no mapa para marcar à mão.');
        return;
      }
      setRascunho({ lat: achado.lat, lng: achado.lng });
      setAlvoMapa([achado.lat, achado.lng]);
      setAviso(
        achado.nivel === 'numero'
          ? 'Achei o número. Confira no satélite e salve.'
          : achado.nivel === 'rua'
            ? 'Achei só a RUA: o mapa aberto não conhece o número, então o pino foi para o meio dela. Arraste até a igreja — o satélite ajuda — ou abra o endereço no Google Maps para se localizar.'
            : 'Não achei o endereço: o mapa foi para o centro da cidade. Marque onde fica a igreja.',
      );
    } catch {
      if (!automatico) setAviso('Não foi possível consultar o endereço agora.');
    } finally {
      setBuscandoEndereco(false);
    }
  };

  /** A comunidade deixou de ter pendência: some da fila (ou só perde a marca, fora dela). */
  const resolverNaLista = (id: string, mudanca: Partial<MapRow>) => {
    setRows((atual) => (naFila ? atual.filter((r) => r.id !== id) : atual.map((r) => (r.id === id ? { ...r, ...mudanca, review: false, candidates: [] } : r))));
    if (naFila) setFila((f) => (f ? { ...f, total: Math.max(f.total - 1, 0) } : f));
  };

  const salvar = async () => {
    if (!emEdicao || !rascunho) return;
    setSalvando(true);
    setAviso('');
    try {
      await api.patch(`/communities/${emEdicao.id}`, {
        latitude: rascunho.lat,
        longitude: rascunho.lng,
        geoPrecision: 'MANUAL',
      });
      setAviso('Pino salvo.');
      const mudanca = { lat: rascunho.lat, lng: rascunho.lng, kind: 'ok' as PinKind, source: 'manual' };
      // pino posto à mão encerra as sugestões pendentes (o servidor faz o mesmo)
      if (candidatos.length) resolverNaLista(emEdicao.id, mudanca);
      else setRows((atual) => atual.map((r) => (r.id === emEdicao.id ? { ...r, ...mudanca } : r)));
      setCandidatos([]);
      setEmEdicao({ ...emEdicao, ...mudanca, review: false, candidates: [] });
      carregarStats();
    } catch (e) {
      setAviso(getErrorMessage(e, 'Não foi possível salvar o pino.'));
    } finally {
      setSalvando(false);
    }
  };

  const limparPino = async () => {
    if (!emEdicao) return;
    setSalvando(true);
    setAviso('');
    try {
      await api.patch(`/communities/${emEdicao.id}`, { latitude: null, longitude: null, geoPrecision: null });
      setRascunho(null);
      setAviso('Pino removido.');
      setRows((atual) => atual.map((r) => (r.id === emEdicao.id ? { ...r, lat: null, lng: null, kind: 'sem', source: null } : r)));
      carregarStats();
    } catch (e) {
      setAviso(getErrorMessage(e, 'Não foi possível salvar o pino.'));
    } finally {
      setSalvando(false);
    }
  };

  const verCandidato = (c: Candidate) => {
    setRascunho({ lat: c.lat, lng: c.lng });
    setAlvoMapa([c.lat, c.lng]);
    setAviso('Sugestão no mapa. Confira no satélite: se for a igreja, confirme; se estiver perto, arraste e salve.');
  };

  const confirmarCandidato = async (c: Candidate) => {
    if (!emEdicao) return;
    setSalvando(true);
    setAviso('');
    try {
      await api.post(`/communities/geo-candidates/${c.id}/accept`);
      const mudanca = { lat: c.lat, lng: c.lng, kind: 'ok' as PinKind, source: 'manual' };
      resolverNaLista(emEdicao.id, mudanca);
      setCandidatos([]);
      setRascunho({ lat: c.lat, lng: c.lng });
      setEmEdicao({ ...emEdicao, ...mudanca, review: false, candidates: [] });
      setAviso('Sugestão confirmada: o pino agora é conferido por você.');
      carregarStats();
    } catch (e) {
      setAviso(getErrorMessage(e, 'Não foi possível confirmar a sugestão.'));
    } finally {
      setSalvando(false);
    }
  };

  const descartarCandidato = async (c: Candidate) => {
    if (!emEdicao) return;
    setSalvando(true);
    setAviso('');
    try {
      await api.post(`/communities/geo-candidates/${c.id}/reject`);
      const restam = candidatos.filter((x) => x.id !== c.id);
      setCandidatos(restam);
      if (!restam.length) resolverNaLista(emEdicao.id, {});
      else setRows((atual) => atual.map((r) => (r.id === emEdicao.id ? { ...r, candidates: restam } : r)));
      setAviso(restam.length ? 'Sugestão descartada.' : 'Sugestão descartada. Esta comunidade saiu da fila.');
      carregarStats();
    } catch (e) {
      setAviso(getErrorMessage(e, 'Não foi possível descartar a sugestão.'));
    } finally {
      setSalvando(false);
    }
  };

  const naPorta = stats?.ok ?? 0;
  const naRua = stats?.rua ?? 0;
  const pct = (n: number) => (stats && stats.total > 0 ? Math.round((n / stats.total) * 100) : 0);
  const googleMaps = emEdicao
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([emEdicao.address, emEdicao.city, emEdicao.state].filter(Boolean).join(', '))}`
    : '';

  return (
    <div className="module-page territory-map">
      <header className="module-header">
        <h1>
          <TitleIcon name="comunidade" /> Mapa do território
        </h1>
        <p className="module-subtitle">
          Todas as comunidades do país, a correção rápida do pino e a fila de sugestões à espera de conferência.
        </p>
      </header>

      {stats && (
        <section className="tm-kpis">
          <div className="tm-kpi">
            <strong>{num(stats.dioceses)}</strong>
            <span>dioceses</span>
          </div>
          <div className="tm-kpi">
            <strong>{num(stats.paroquias)}</strong>
            <span>paróquias</span>
          </div>
          <div className="tm-kpi">
            <strong>{num(stats.total)}</strong>
            <span>comunidades</span>
          </div>
          <div className="tm-kpi tm-ok" title="Posto por gente, templo casado numa base aberta ou endereço com número no Censo">
            <strong>{num(naPorta)}</strong>
            <span>pino na porta</span>
          </div>
          <div className="tm-kpi tm-rua" title="Veio do CEP ou do endereço no OpenStreetMap: é o meio do logradouro, pode estar a quadras da igreja">
            <strong>{num(naRua)}</strong>
            <span>pino na rua</span>
          </div>
          <div className="tm-kpi tm-local">
            <strong>{num(stats.local ?? 0)}</strong>
            <span>no povoado ou bairro</span>
          </div>
          <div className="tm-kpi tm-dup">
            <strong>{num(stats.dup)}</strong>
            <span>no centro da cidade</span>
          </div>
          {stats.sem > 0 && (
            <div className="tm-kpi tm-sem">
              <strong>{num(stats.sem)}</strong>
              <span>sem pino</span>
            </div>
          )}
          <button type="button" className={`tm-kpi tm-fila${naFila ? ' on' : ''}`} onClick={() => setPin(naFila ? 'todos' : 'fila')}>
            <strong>{num(stats.fila ?? 0)}</strong>
            <span>na fila de revisão</span>
          </button>
        </section>
      )}

      {stats && (
        <div className="tm-barra" title={`${pct(naPorta)}% na porta · ${pct(naRua)}% na rua`}>
          <div className="tm-barra-ok" style={{ width: `${(naPorta / Math.max(stats.total, 1)) * 100}%` }} />
          <div className="tm-barra-rua" style={{ width: `${(naRua / Math.max(stats.total, 1)) * 100}%` }} />
          <div className="tm-barra-local" style={{ width: `${((stats.local ?? 0) / Math.max(stats.total, 1)) * 100}%` }} />
          <div className="tm-barra-dup" style={{ width: `${(stats.dup / Math.max(stats.total, 1)) * 100}%` }} />
          <span className="tm-barra-txt">
            {pct(naPorta)}% na porta · {pct(naRua)}% na rua · {pct(stats.local ?? 0)}% no povoado ou bairro · {pct(stats.dup)}% no centro da cidade
          </span>
        </div>
      )}

      <section className="tm-filtros">
        <select value={uf} onChange={(e) => setUf(e.target.value)} aria-label="Estado">
          <option value="">Todos os estados</option>
          {UFS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <select value={dioceseId} onChange={(e) => setDioceseId(e.target.value)} aria-label="Diocese">
          <option value="">Todas as dioceses{dioceses.length ? ` (${dioceses.length})` : ''}</option>
          {dioceses.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} — {num(d.total)}{d.rua ? ` · ${num(d.rua)} na rua` : ''}
            </option>
          ))}
        </select>
        <div className="tm-chips">
          {([
            ['todos', 'Todas'],
            ['ok', 'Na porta'],
            ['rua', 'Na rua'],
            ['local', 'No povoado/bairro'],
            ['dup', 'Centro da cidade'],
            ['sem', 'Sem pino'],
            ['fila', `Fila de revisão${stats?.fila ? ` (${num(stats.fila)})` : ''}`],
          ] as Array<[Filtro, string]>).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              className={`tm-chip${valor === 'fila' ? ' tm-chip-fila' : ''}${pin === valor ? ' on' : ''}`}
              onClick={() => setPin(valor)}
            >
              {rotulo}
            </button>
          ))}
        </div>
        {!naFila && (
          <form
            className="tm-busca"
            onSubmit={(e) => {
              e.preventDefault();
              setBuscaAplicada(busca.trim());
            }}
          >
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar comunidade, cidade ou paróquia"
            />
            <button type="submit">Buscar</button>
            {buscaAplicada && (
              <button type="button" className="tm-link" onClick={() => { setBusca(''); setBuscaAplicada(''); }}>
                limpar
              </button>
            )}
          </form>
        )}
      </section>

      {naFila && (
        <p className="tm-fila-explica">
          Coordenadas que as cargas automáticas acharam mas <strong>não gravaram sozinhas</strong> — fontes em conflito, uma fonte só,
          endereço que desmente o pino. Abra, olhe no satélite e confirme ou descarte. Vêm primeiro as comunidades com missa cadastrada
          {fila ? ` (${num(fila.withMass)} de ${num(fila.total)})` : ''}.
        </p>
      )}

      {erro && <p className="tm-erro">{erro}</p>}

      <div className="tm-corpo">
        <aside className="tm-lista">
          <div className="tm-lista-topo">
            <strong>{num(naFila && fila ? fila.total : rows.length)}</strong> {naFila ? 'na fila' : `comunidade${rows.length === 1 ? '' : 's'}`}
            {truncated && <span className="tm-aviso"> · {naFila ? `mostrando as ${num(rows.length)} primeiras` : 'recorte cheio, aproxime o mapa'}</span>}
            {carregando && <span className="tm-aviso"> · carregando…</span>}
          </div>
          {rows.length === 0 && !carregando && (
            <p className="tm-vazio">
              {naFila
                ? 'Fila vazia com esse filtro.'
                : pin === 'sem'
                  ? 'Nenhuma comunidade sem pino com esse filtro.'
                  : 'Nada neste recorte. Afaste o mapa ou troque o filtro.'}
            </p>
          )}
          <ul>
            {rows.slice(0, 400).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`tm-item${emEdicao?.id === r.id ? ' on' : ''}`}
                  onClick={() => abrirEdicao(r)}
                >
                  <span className="tm-ponto" style={{ background: PIN_COR[r.kind] }} aria-hidden="true" />
                  <span className="tm-item-txt">
                    <strong>{r.name}</strong>
                    <small>
                      {r.city}/{r.state} · {r.parish}
                    </small>
                    {(r.review || r.candidates?.length || r.hasMass) && (
                      <small className="tm-selos">
                        {r.hasMass && <span className="tm-selo tm-selo-missa">missa</span>}
                        {(r.candidates?.length || r.review) && (
                          <span className="tm-selo tm-selo-sugestao">
                            {r.candidates?.length ? `${r.candidates.length} sugest${r.candidates.length === 1 ? 'ão' : 'ões'}` : 'tem sugestão'}
                          </span>
                        )}
                      </small>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {rows.length > 400 && <p className="tm-vazio">Mostrando as 400 primeiras da lista.</p>}
        </aside>

        <div className="tm-mapa">
          <MapContainer center={CENTRO_BRASIL} zoom={4} style={{ height: '100%', width: '100%' }}>
            <BaseMapLayers onChange={setBaseMap} />
            <ObservadorDeRecorte
              onChange={(b, z) => {
                setBbox(b);
                setZoom(z);
              }}
            />
            <IrPara alvo={alvoMapa} zoom={baseMap === 'satelite' ? 18 : undefined} />
            <CliqueDefinePino
              ativo={!!emEdicao}
              onPick={(lat, lng) => {
                setRascunho({ lat, lng });
                setAviso('Posição marcada. Salve para gravar.');
              }}
            />

            {comPino.map((r) => (
              <CircleMarker
                key={r.id}
                center={[r.lat as number, r.lng as number]}
                radius={zoom >= 10 ? 7 : 5}
                pathOptions={{
                  color: r.review || r.candidates?.length ? COR_SUGESTAO : '#fff',
                  weight: r.review || r.candidates?.length ? 3 : baseMap === 'satelite' ? 2.5 : 1.5,
                  fillColor: PIN_COR[r.kind],
                  fillOpacity: emEdicao && emEdicao.id === r.id ? 1 : 0.85,
                }}
                eventHandlers={{ click: () => abrirEdicao(r) }}
              >
                <Popup>
                  <strong>{r.name}</strong>
                  <br />
                  {r.city}/{r.state}
                  <br />
                  <small>{r.parish}</small>
                  <br />
                  <small>{PIN_LABEL[r.kind]}</small>
                </Popup>
              </CircleMarker>
            ))}

            {emEdicao && candidatos.map((c, i) => (
              <CircleMarker
                key={c.id}
                center={[c.lat, c.lng]}
                radius={11}
                pathOptions={{ color: '#fff', weight: 3, fillColor: COR_SUGESTAO, fillOpacity: 0.95 }}
                eventHandlers={{ click: () => verCandidato(c) }}
              >
                <Tooltip permanent direction="center" className="tm-letra">{letra(i)}</Tooltip>
              </CircleMarker>
            ))}

            {emEdicao && rascunho && (
              <Marker
                position={[rascunho.lat, rascunho.lng]}
                icon={iconeEdicao}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const p = (e.target as L.Marker).getLatLng();
                    setRascunho({ lat: p.lat, lng: p.lng });
                    setAviso('Posição marcada. Salve para gravar.');
                  },
                }}
              />
            )}
          </MapContainer>

          {emEdicao && (
            <div className="tm-editor">
              <div className="tm-editor-topo">
                <div>
                  <strong>{emEdicao.name}</strong>
                  <small>
                    {emEdicao.city}/{emEdicao.state} · {emEdicao.parish} · {emEdicao.diocese}
                  </small>
                  {emEdicao.address && <small className="tm-endereco">{emEdicao.address}</small>}
                  {emEdicao.lat != null && (
                    <small className="tm-origem">
                      <span className="tm-ponto" style={{ background: PIN_COR[emEdicao.kind] }} aria-hidden="true" />
                      {PIN_LABEL[emEdicao.kind]}{origemDoPino(emEdicao.source) ? ` · ${origemDoPino(emEdicao.source)}` : ''}
                    </small>
                  )}
                  {emEdicao.verifiedAt && (
                    <small className="tm-conferido">✓ {conferidoPor(emEdicao.verifiedBy)} em {new Date(emEdicao.verifiedAt).toLocaleDateString('pt-BR')}</small>
                  )}
                </div>
                <button type="button" className="tm-fechar" onClick={() => setEmEdicao(null)} aria-label="Fechar">
                  ×
                </button>
              </div>

              {candidatos.length > 0 && (
                <div className="tm-sugestoes">
                  <p className="tm-sugestoes-titulo">
                    {candidatos.length === 1 ? 'Uma sugestão à espera' : `${candidatos.length} sugestões à espera`}
                  </p>
                  {candidatos.map((c, i) => (
                    <div className="tm-sugestao" key={c.id}>
                      <span className="tm-sugestao-letra" aria-hidden="true">{letra(i)}</span>
                      <div className="tm-sugestao-txt">
                        <strong>{FONTE_DA_SUGESTAO[c.source] ?? c.source}</strong>
                        {c.label && <small>{c.label}</small>}
                        <small>
                          {c.distanceKm != null ? `a ${distancia(c.distanceKm)} do pino atual · ` : ''}
                          {MOTIVO_DA_SUGESTAO[c.reason] ?? c.reason}
                        </small>
                        {c.detail && <small className="tm-sugestao-detalhe"><Detalhe texto={c.detail} /></small>}
                        <div className="tm-sugestao-acoes">
                          <button type="button" onClick={() => verCandidato(c)} disabled={salvando}>Ver</button>
                          <button type="button" className="tm-primario" onClick={() => void confirmarCandidato(c)} disabled={salvando}>Confirmar</button>
                          <button type="button" className="tm-perigo" onClick={() => void descartarCandidato(c)} disabled={salvando}>Descartar</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="tm-dica">
                {rascunho
                  ? 'Arraste o pino azul ou clique no mapa para reposicionar.'
                  : 'Clique no mapa para marcar onde fica a igreja, ou use o endereço.'}
              </p>

              <div className="tm-coords">
                <label>
                  Latitude
                  <input
                    type="number"
                    step="0.000001"
                    value={rascunho?.lat ?? ''}
                    onChange={(e) =>
                      setRascunho((r) => ({ lat: Number(e.target.value), lng: r?.lng ?? 0 }))
                    }
                  />
                </label>
                <label>
                  Longitude
                  <input
                    type="number"
                    step="0.000001"
                    value={rascunho?.lng ?? ''}
                    onChange={(e) =>
                      setRascunho((r) => ({ lat: r?.lat ?? 0, lng: Number(e.target.value) }))
                    }
                  />
                </label>
              </div>

              {aviso && <p className="tm-aviso-editor">{aviso}</p>}

              <div className="tm-acoes">
                <button type="button" onClick={() => void sugerirPeloEndereco()} disabled={buscandoEndereco || !emEdicao.address}>
                  {buscandoEndereco ? 'Buscando…' : 'Buscar pelo endereço'}
                </button>
                <button type="button" className="tm-primario" onClick={salvar} disabled={!rascunho || salvando}>
                  {salvando ? 'Salvando…' : 'Salvar pino'}
                </button>
                {emEdicao.lat != null && (
                  <button type="button" className="tm-perigo" onClick={limparPino} disabled={salvando}>
                    Remover
                  </button>
                )}
              </div>
              {emEdicao.address && (
                <a className="tm-google" href={googleMaps} target="_blank" rel="noopener noreferrer">
                  Abrir este endereço no Google Maps ↗
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {stats && (
        <section className="tm-uf">
          <h2>Cobertura por estado</h2>
          <div className="tm-uf-grade">
            {(stats.porUf ?? []).map((linha) => {
              const base = Math.max(linha.total, 1);
              const pctPorta = Math.round(((linha.ok ?? 0) / base) * 100);
              const pctRua = Math.round(((linha.rua ?? 0) / base) * 100);
              const pctLocal = Math.round(((linha.local ?? 0) / base) * 100);
              return (
                <button
                  key={linha.uf}
                  type="button"
                  className={`tm-uf-item${uf === linha.uf ? ' on' : ''}`}
                  onClick={() => setUf(uf === linha.uf ? '' : linha.uf)}
                >
                  <strong>{linha.uf}</strong>
                  <span>{num(linha.total)} comunidades</span>
                  <span className={pctPorta > 0 ? 'tm-uf-pct' : 'tm-uf-zero'}>{pctPorta}% na porta</span>
                  {pctRua > 0 && <span className="tm-uf-rua">+{pctRua}% na rua</span>}
                  {pctLocal > 0 && <span className="tm-uf-local">+{pctLocal}% no povoado/bairro</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {semPino.length > 0 && pin !== 'sem' && !naFila && (
        <p className="tm-rodape">
          {num(semPino.length)} comunidade(s) desta seleção não têm pino e por isso não aparecem no mapa.
          <button type="button" className="tm-link" onClick={() => setPin('sem')}>
            ver a fila
          </button>
        </p>
      )}
    </div>
  );
};

export default TerritoryMapPage;
