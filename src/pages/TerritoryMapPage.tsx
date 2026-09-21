import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
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
 * Duas funções: ver o país inteiro e corrigir o pino de uma comunidade sem
 * abrir o cadastro completo. A carga é por retângulo visível, porque são mais
 * de 50 mil comunidades.
 */

type PinKind = 'ok' | 'local' | 'dup' | 'sem';

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
}

interface Stats {
  total: number;
  sem: number;
  local?: number;
  dup: number;
  ok: number;
  paroquias: number;
  dioceses: number;
  porUf: Array<{ uf: string; total: number; sem: number; local?: number; dup: number }>;
}

interface DioceseRow {
  id: string;
  name: string;
  uf: string;
  total: number;
  sem: number;
  local?: number;
  dup: number;
}

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const CENTRO_BRASIL: [number, number] = [-14.8, -52.5];

const PIN_LABEL: Record<PinKind, string> = {
  ok: 'pino próprio',
  local: 'pino no centro do povoado ou bairro',
  dup: 'pino aproximado (centro da cidade)',
  sem: 'sem pino',
};
const PIN_COR: Record<PinKind, string> = { ok: '#2E9D62', local: '#2F7FC1', dup: '#C78216', sem: '#8B97A4' };

/** Origem do pino (Community.geoSource) em linguagem de gente. */
const ORIGEM: Record<string, string> = {
  manual: 'posicionado à mão no mapa',
  gps: 'GPS do celular, no local',
  cep: 'CEP do endereço',
  'osm-endereco': 'endereço encontrado no OpenStreetMap',
  cnefe: 'templo no Censo 2022 (IBGE)',
  overture: 'lugar na Overture Maps',
  'cnefe+overture': 'Censo 2022 e Overture Maps concordam',
  'cnefe-localidade': 'centro da localidade no Censo 2022 (IBGE)',
  'ibge-municipio': 'centro do município (IBGE)',
  'legado-centro': 'pino antigo, empilhado no centro da cidade',
  legado: 'pino anterior ao controle de origem',
};
const origemDoPino = (s?: string | null) => (s ? ORIGEM[s] ?? s : null);

const iconeEdicao = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Resposta inesperada da API não pode derrubar a página inteira.
const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('pt-BR') : '—');

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

const TerritoryMapPage: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dioceses, setDioceses] = useState<DioceseRow[]>([]);
  const [rows, setRows] = useState<MapRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const [uf, setUf] = useState('');
  const [dioceseId, setDioceseId] = useState('');
  const [pin, setPin] = useState<PinKind | 'todos'>('todos');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [bbox, setBbox] = useState('');
  const [zoom, setZoom] = useState(4);
  const [baseMap, setBaseMap] = useState<BaseMap>('mapa');

  // Edição do pino
  const [emEdicao, setEmEdicao] = useState<MapRow | null>(null);
  const [rascunho, setRascunho] = useState<{ lat: number; lng: number } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  const [alvoMapa, setAlvoMapa] = useState<[number, number] | null>(null);

  const pedidoRef = useRef(0);

  useEffect(() => {
    api.get('/communities/map/stats').then((r) => setStats(typeof r.data?.total === 'number' ? r.data : null)).catch((e) => setErro(getErrorMessage(e, 'Não foi possível carregar o mapa.')));
  }, []);

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
  }, [uf, dioceseId, pin, buscaAplicada, bbox]);

  useEffect(() => { void carregar(); }, [carregar]);

  const comPino = useMemo(() => rows.filter((r) => r.lat != null && r.lng != null), [rows]);
  const semPino = useMemo(() => rows.filter((r) => r.lat == null), [rows]);

  const abrirEdicao = (row: MapRow) => {
    setEmEdicao(row);
    setAviso('');
    setRascunho(row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null);
    if (row.lat != null && row.lng != null) setAlvoMapa([row.lat, row.lng]);
    // Sem pino, o mapa continuaria no país inteiro e não haveria o que conferir:
    // já pedimos a sugestão do endereço ao abrir, que é o caso mais comum aqui.
    else if (row.address) void sugerirPeloEndereco(row, true);
  };

  /** Sugere a coordenada pelo endereço (Nominatim, o mesmo do backfill). */
  const sugerirPeloEndereco = async (alvoRow?: MapRow, automatico = false) => {
    const row = alvoRow ?? emEdicao;
    if (!row) return;
    setBuscandoEndereco(true);
    setAviso('');
    try {
      // Duas tentativas: o endereço completo e, se falhar, só a cidade — assim o
      // mapa pelo menos chega perto, em vez de ficar no país inteiro.
      const tentativas = [
        [row.address, row.city, row.state, 'Brasil'].filter(Boolean).join(', '),
        [row.city, row.state, 'Brasil'].filter(Boolean).join(', '),
      ];
      let achados: any[] = [];
      let aproximado = false;
      for (let i = 0; i < tentativas.length && !achados.length; i += 1) {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(tentativas[i])}`;
        const resposta = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
        achados = await resposta.json();
        aproximado = i > 0;
      }
      if (!achados?.length) {
        if (!automatico) setAviso('O endereço não foi encontrado. Clique no mapa para marcar à mão.');
        return;
      }
      const lat = Number(achados[0].lat);
      const lng = Number(achados[0].lon);
      setRascunho({ lat, lng });
      setAlvoMapa([lat, lng]);
      if (aproximado) {
        setAviso('Não achei o endereço: o mapa foi para o centro da cidade. Marque onde fica a igreja.');
        return;
      }
      setAviso(automatico ? 'Sugestão do endereço — confira e arraste o pino antes de salvar.' : 'Sugestão do endereço aplicada. Confira e arraste o pino se precisar.');
    } catch {
      if (!automatico) setAviso('Não foi possível consultar o endereço agora.');
    } finally {
      setBuscandoEndereco(false);
    }
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
      setRows((atual) =>
        atual.map((r) => (r.id === emEdicao.id ? { ...r, lat: rascunho.lat, lng: rascunho.lng, kind: 'ok', source: 'manual' } : r)),
      );
      setEmEdicao({ ...emEdicao, lat: rascunho.lat, lng: rascunho.lng, kind: 'ok', source: 'manual' });
      api.get('/communities/map/stats').then((r) => setStats(r.data)).catch(() => undefined);
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
      api.get('/communities/map/stats').then((r) => setStats(r.data)).catch(() => undefined);
    } catch (e) {
      setAviso(getErrorMessage(e, 'Não foi possível salvar o pino.'));
    } finally {
      setSalvando(false);
    }
  };

  const cobertura = stats && stats.total > 0 ? Math.round((stats.ok / stats.total) * 100) : 0;

  return (
    <div className="module-page territory-map">
      <header className="module-header">
        <h1>
          <TitleIcon name="comunidade" /> Mapa do território
        </h1>
        <p className="module-subtitle">
          Todas as comunidades do país e a correção rápida do pino de localização.
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
          <div className="tm-kpi tm-ok">
            <strong>{num(stats.ok)}</strong>
            <span>com pino preciso</span>
          </div>
          <div className="tm-kpi tm-local">
            <strong>{num(stats.local ?? 0)}</strong>
            <span>no povoado ou bairro</span>
          </div>
          <div className="tm-kpi tm-dup">
            <strong>{num(stats.dup)}</strong>
            <span>no centro da cidade</span>
          </div>
          <div className="tm-kpi tm-sem">
            <strong>{num(stats.sem)}</strong>
            <span>sem pino</span>
          </div>
        </section>
      )}

      {stats && (
        <div className="tm-barra" title={`${cobertura}% das comunidades têm pino preciso`}>
          <div className="tm-barra-ok" style={{ width: `${(stats.ok / Math.max(stats.total, 1)) * 100}%` }} />
          <div className="tm-barra-local" style={{ width: `${((stats.local ?? 0) / Math.max(stats.total, 1)) * 100}%` }} />
          <div className="tm-barra-dup" style={{ width: `${(stats.dup / Math.max(stats.total, 1)) * 100}%` }} />
          <span className="tm-barra-txt">
            {cobertura}% com pino preciso · {num(stats.local ?? 0)} no povoado ou bairro · {num(stats.dup)} no centro da cidade · {num(stats.sem)} sem pino
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
              {d.name} — {num(d.total)}{d.sem ? ` · ${num(d.sem)} sem pino` : ''}
            </option>
          ))}
        </select>
        <div className="tm-chips">
          {([
            ['todos', 'Todas'],
            ['ok', 'Pino preciso'],
            ['local', 'No povoado/bairro'],
            ['dup', 'Centro da cidade'],
            ['sem', 'Sem pino'],
          ] as Array<[PinKind | 'todos', string]>).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              className={`tm-chip${pin === valor ? ' on' : ''}`}
              onClick={() => setPin(valor)}
            >
              {rotulo}
            </button>
          ))}
        </div>
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
      </section>

      {erro && <p className="tm-erro">{erro}</p>}

      <div className="tm-corpo">
        <aside className="tm-lista">
          <div className="tm-lista-topo">
            <strong>{num(rows.length)}</strong> comunidade{rows.length === 1 ? '' : 's'}
            {truncated && <span className="tm-aviso"> · recorte cheio, aproxime o mapa</span>}
            {carregando && <span className="tm-aviso"> · carregando…</span>}
          </div>
          {rows.length === 0 && !carregando && (
            <p className="tm-vazio">
              {pin === 'sem'
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
                  color: '#fff',
                  weight: baseMap === 'satelite' ? 2.5 : 1.5,
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
                </div>
                <button type="button" className="tm-fechar" onClick={() => setEmEdicao(null)} aria-label="Fechar">
                  ×
                </button>
              </div>

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
              const pct = Math.round(((linha.total - linha.sem - linha.dup - (linha.local ?? 0)) / base) * 100);
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
                  <span className={pct > 0 ? 'tm-uf-pct' : 'tm-uf-zero'}>{pct}% preciso</span>
                  {pctLocal > 0 && <span className="tm-uf-local">+{pctLocal}% no povoado/bairro</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {semPino.length > 0 && pin !== 'sem' && (
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
