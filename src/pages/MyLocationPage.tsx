import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import TitleIcon from '../components/TitleIcon';
import MapPicker from '../components/MapPicker';
import api, { getErrorMessage } from '../services/api';
import { notify, confirm } from '../services/notification.service';
import './modules/ModulePages.css';
import './MyLocationPage.css';

/**
 * "Minha localização" — a equipe ajusta o pino e o endereço SÓ das próprias
 * comunidades (plano grátis). Contrato do backend:
 * - GET   /communities/my-locations[?parishId=] → comunidades que o usuário gerencia (teto de 500;
 *         a plataforma só recebe algo informando a paróquia)
 * - PATCH /communities/:id/location { latitude, longitude, confirmPin?, geoSource?, address?, city?, state?, zipCode? }
 *         A tela sempre reenvia o pino; ele só conta como CONFERIDO quando a coordenada muda ou com
 *         `confirmPin: true` (a pessoa moveu/tocou o pino ou marcou "O pino está no lugar certo").
 * - GET   /geocoding/search?q= → endereço → coordenadas (mesmo da tela de Comunidades)
 */

interface MyCommunity {
  id: string;
  name: string;
  parishId?: string | null;
  parishName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  latitude: number | null;
  longitude: number | null;
  geoPrecision?: 'MANUAL' | 'STREET' | 'LOCALITY' | 'CITY' | null;
  geoVerifiedAt?: string | null;
}

interface Pin {
  lat: number;
  lng: number;
}

type GeoStatus = 'missing' | 'approximate' | 'verified';

const STATUS_META: Record<GeoStatus, { label: string; color: string; order: number; hint: string }> = {
  missing: {
    label: 'Sem localização',
    color: 'red',
    order: 0,
    hint: 'Esta comunidade ainda não aparece no mapa do app. Coloque o pino na igreja.',
  },
  approximate: {
    label: 'Aproximada',
    color: 'yellow',
    order: 1,
    hint: 'O pino foi posto por estimativa (pelo endereço). Confira se está em cima da igreja e salve.',
  },
  verified: {
    label: 'Localização conferida',
    color: 'green',
    order: 2,
    hint: 'O pino já foi conferido por uma pessoa. Só mexa se a igreja estiver no lugar errado.',
  },
};

const hasPin = (c: Pick<MyCommunity, 'latitude' | 'longitude'>) =>
  typeof c.latitude === 'number' && typeof c.longitude === 'number';

const statusOf = (c: MyCommunity): GeoStatus => {
  if (!hasPin(c)) return 'missing';
  if (c.geoVerifiedAt || c.geoPrecision === 'MANUAL') return 'verified';
  return 'approximate';
};

const addressLine = (c: MyCommunity) => {
  const cityState = [c.city, c.state].filter(Boolean).join(' – ');
  return [c.address, cityState].filter(Boolean).join(', ');
};

/** Distância em metros entre dois pontos (haversine) */
const distanceMeters = (a: Pin, b: Pin) => {
  const R = 6371000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const formatDistance = (meters: number) =>
  meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;

/** Acima disso pedimos confirmação antes de mover o pino */
const FAR_MOVE_METERS = 2000;
/** GPS com erro maior que isso recebe um aviso para conferir no mapa */
const GPS_WEAK_ACCURACY_METERS = 100;
/** A partir desta quantidade a lista ganha busca */
const SEARCH_FROM = 8;
/** Teto da lista no servidor: chegou nele, a lista está cortada */
const LIST_LIMIT = 500;

const emptyForm = { address: '', city: '', state: '', zipCode: '' };

const MyLocationPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [communities, setCommunities] = useState<MyCommunity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [pin, setPin] = useState<Pin | null>(null);
  // Origem do pino atual: 'gps' só enquanto ninguém mexer nele depois do GPS
  const [pinSource, setPinSource] = useState<'manual' | 'gps'>('manual');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  // "O pino está no lugar certo": conferência explícita sem mover o pino
  const [pinConfirmed, setPinConfirmed] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [mapHeight] = useState(() =>
    typeof window === 'undefined' ? 320 : Math.round(Math.min(440, Math.max(280, window.innerHeight * 0.45))),
  );

  const selected = useMemo(
    () => communities.find((c) => c.id === selectedId) ?? null,
    [communities, selectedId],
  );
  // Comunidade aberta AGORA (a resposta de um salvamento não pode reabrir outra)
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // Plataforma: a lista é por paróquia (?parishId=); sem ela, o servidor devolve vazio
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const parishIdFromUrl = (searchParams.get('parishId') ?? '').trim();
  const needsParish = user?.role === 'SYSTEM_ADMIN' && !parishIdFromUrl;

  const openCommunity = useCallback((c: MyCommunity) => {
    setSelectedId(c.id);
    setPin(hasPin(c) ? { lat: c.latitude as number, lng: c.longitude as number } : null);
    setPinSource('manual');
    setGpsAccuracy(null);
    setPinConfirmed(false);
    setSaveError('');
    setForm({
      address: c.address ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
      zipCode: c.zipCode ?? '',
    });
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    if (needsParish) {
      // Sem paróquia escolhida não há o que listar (a tela mostra a orientação)
      setCommunities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<MyCommunity[]>('/communities/my-locations', {
        params: parishIdFromUrl ? { parishId: parishIdFromUrl } : undefined,
      });
      const list = Array.isArray(res.data) ? res.data : [];
      setCommunities(list);
      // Com uma só comunidade, já abre nela
      if (list.length === 1) openCommunity(list[0]);
    } catch (error) {
      setLoadError(getErrorMessage(error, 'Não foi possível carregar as suas comunidades. Tente de novo.'));
    } finally {
      setLoading(false);
    }
  }, [openCommunity, needsParish, parishIdFromUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  // Primeiro as que precisam de atenção (sem pino → aproximada → conferida)
  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...communities]
      .filter(
        (c) =>
          !term ||
          c.name.toLowerCase().includes(term) ||
          (c.parishName ?? '').toLowerCase().includes(term) ||
          (c.city ?? '').toLowerCase().includes(term),
      )
      .sort(
        (a, b) =>
          STATUS_META[statusOf(a)].order - STATUS_META[statusOf(b)].order ||
          a.name.localeCompare(b.name, 'pt-BR'),
      );
  }, [communities, search]);

  const pending = useMemo(() => communities.filter((c) => statusOf(c) !== 'verified').length, [communities]);

  const originalPin: Pin | null =
    selected && hasPin(selected)
      ? { lat: selected.latitude as number, lng: selected.longitude as number }
      : null;
  const moved = pin && originalPin ? distanceMeters(originalPin, pin) : 0;
  const pinChanged = !!pin && (!originalPin || moved >= 1);
  // GPS impreciso (> 100 m): não vale como conferência até a pessoa tocar/arrastar o pino
  const gpsWeak = pinSource === 'gps' && gpsAccuracy != null && gpsAccuracy > GPS_WEAK_ACCURACY_METERS;

  const changedAddress = useMemo(() => {
    if (!selected) return {} as Partial<typeof emptyForm>;
    const out: Partial<typeof emptyForm> = {};
    (Object.keys(emptyForm) as (keyof typeof emptyForm)[]).forEach((key) => {
      const value = form[key].trim();
      // Campo esvaziado não é enviado: o cadastro exige endereço preenchido
      if (value && value !== (selected[key] ?? '').trim()) out[key] = value;
    });
    return out;
  }, [form, selected]);
  const addressChanged = Object.keys(changedAddress).length > 0;

  const movePin = (lat: number, lng: number) => {
    // Durante o salvamento o mapa fica travado
    if (saving) return;
    setPin({ lat, lng });
    setPinSource('manual');
    setGpsAccuracy(null);
    setSaveError('');
  };

  const locateMe = () => {
    if (!('geolocation' in navigator)) {
      notify.warning('Este aparelho não informa a posição. Coloque o pino tocando no mapa.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const accuracy = Math.round(position.coords.accuracy);
        setPin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setPinSource('gps');
        setGpsAccuracy(accuracy);
        setPinConfirmed(false);
        setSaveError('');
        if (accuracy > GPS_WEAK_ACCURACY_METERS) {
          notify.warning(
            `Posição com pouca precisão (cerca de ${formatDistance(accuracy)}). Toque no mapa ou arraste o pino até a igreja antes de salvar.`,
          );
        } else {
          notify.success('Pino colocado onde você está. Confira no mapa e salve.');
        }
      },
      (error) => {
        setLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          notify.error(
            'O navegador não tem permissão para ver a sua posição. Libere a localização nas configurações do site ou coloque o pino tocando no mapa.',
          );
        } else if (error.code === error.TIMEOUT) {
          notify.warning('A posição demorou demais. Tente de novo perto de uma janela ou coloque o pino no mapa.');
        } else {
          notify.error('Não foi possível obter a sua posição. Coloque o pino tocando no mapa.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  // Endereço → coordenadas (Nominatim via backend), como na tela de Comunidades
  const geocodeFromAddress = async () => {
    const query = [form.address, form.city, form.state, form.zipCode]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
    if (query.length < 3) {
      notify.warning('Preencha o endereço (rua, cidade, estado) para localizar no mapa.');
      return;
    }
    setGeocoding(true);
    try {
      const { data } = await api.get('/geocoding/search', { params: { q: query } });
      const best = Array.isArray(data) ? data[0] : null;
      if (best && Number.isFinite(Number(best.latitude)) && Number.isFinite(Number(best.longitude))) {
        movePin(Number(best.latitude), Number(best.longitude));
        notify.success('Endereço encontrado! Arraste o pino até a porta da igreja, se precisar.');
      } else {
        notify.warning('Endereço não localizado. Coloque o pino tocando no mapa.');
      }
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível localizar o endereço.'));
    } finally {
      setGeocoding(false);
    }
  };

  const save = async () => {
    if (!selected || saving) return;
    if (!pin) {
      setSaveError('Coloque o pino no mapa antes de salvar: toque no ponto onde fica a igreja.');
      return;
    }
    if (gpsWeak) {
      setSaveError(
        'A posição do GPS veio com pouca precisão. Toque no mapa ou arraste o pino até a igreja antes de salvar.',
      );
      return;
    }
    // O pino só vai como conferido se a pessoa o mudou (mapa, GPS, endereço) ou
    // marcou "O pino está no lugar certo". Só endereço → o pino antigo vai igual
    // (o servidor não mexe na conferência nem na fila de revisão).
    const confirmPin = pinChanged || pinConfirmed;
    const sentPin = pinChanged || !originalPin ? pin : originalPin;
    const savingId = selected.id;
    if (originalPin && pinChanged && moved > FAR_MOVE_METERS) {
      const ok = await confirm.action(
        'Mover o pino para longe?',
        `O novo ponto fica a ${formatDistance(moved)} do pino atual de ${selected.name}. É isso mesmo?`,
        'Sim, mover o pino',
        'Voltar e conferir',
      );
      if (!ok) return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const { data } = await api.patch<Partial<MyCommunity>>(`/communities/${selected.id}/location`, {
        latitude: sentPin.lat,
        longitude: sentPin.lng,
        ...(confirmPin ? { confirmPin: true, geoSource: pinSource } : {}),
        ...changedAddress,
      });
      // Sem conferência, o estado do pino fica como estava
      const fallbackPrecision = confirmPin ? 'MANUAL' : (selected.geoPrecision ?? null);
      const fallbackVerifiedAt = confirmPin ? new Date().toISOString() : (selected.geoVerifiedAt ?? null);
      const updated: MyCommunity = {
        ...selected,
        ...changedAddress,
        latitude: sentPin.lat,
        longitude: sentPin.lng,
        geoPrecision: fallbackPrecision,
        geoVerifiedAt: fallbackVerifiedAt,
        // A resposta do servidor (comunidade atualizada) prevalece no que trouxer
        ...(data && typeof data === 'object'
          ? {
              address: data.address ?? changedAddress.address ?? selected.address,
              city: data.city ?? changedAddress.city ?? selected.city,
              state: data.state ?? changedAddress.state ?? selected.state,
              zipCode: data.zipCode ?? changedAddress.zipCode ?? selected.zipCode,
              latitude: typeof data.latitude === 'number' ? data.latitude : sentPin.lat,
              longitude: typeof data.longitude === 'number' ? data.longitude : sentPin.lng,
              geoPrecision: 'geoPrecision' in data ? (data.geoPrecision ?? null) : fallbackPrecision,
              geoVerifiedAt: 'geoVerifiedAt' in data ? (data.geoVerifiedAt ?? null) : fallbackVerifiedAt,
            }
          : {}),
      };
      setCommunities((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      // Só reabre se a pessoa ainda está nesta comunidade (não troca a que estiver aberta)
      if (selectedIdRef.current === savingId) openCommunity(updated);
      notify.success(
        confirmPin
          ? `Localização de ${selected.name} salva! Os fiéis já veem a igreja neste ponto no mapa do app.`
          : `Endereço de ${selected.name} salvo. O pino continua como estava — confira-o quando puder.`,
      );
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      let message: string;
      if (status === 403) {
        message = getErrorMessage(error, '');
        if (!message || /forbidden/i.test(message)) {
          message = 'Você não tem permissão para alterar a localização desta comunidade.';
        }
      } else if (status === 400) {
        const server = getErrorMessage(error, 'Não foi possível salvar esta localização.');
        message = /fora do territ/i.test(server)
          ? 'O pino está fora do Brasil. Coloque-o no ponto onde fica a igreja e salve de novo.'
          : server;
      } else if (status === 404) {
        message = 'Comunidade não encontrada. Atualize a página e tente de novo.';
      } else {
        message = getErrorMessage(error, 'Não foi possível salvar a localização. Verifique a internet e tente de novo.');
      }
      setSaveError(message);
      notify.error(message);
    } finally {
      setSaving(false);
    }
  };

  const backToList = async () => {
    if (saving) return;
    if (pinChanged || addressChanged) {
      const ok = await confirm.action(
        'Sair sem salvar?',
        'Você mexeu no pino ou no endereço e ainda não salvou.',
        'Sair sem salvar',
        'Continuar editando',
      );
      if (!ok) return;
    }
    setSelectedId(null);
    setSaveError('');
  };

  if (loading) {
    return (
      <div className="module-page myloc-page">
        <div className="loading">Carregando...</div>
      </div>
    );
  }

  const status = selected ? statusOf(selected) : null;

  return (
    <div className="module-page myloc-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}>
          <TitleIcon name="igreja" /> Minha localização
        </h1>
      </div>

      <div className="privacy-note myloc-intro">
        É por este pino que o fiel <strong>encontra a igreja no mapa do app</strong> e traça o caminho até a missa.
        Confira se ele está <strong>em cima da igreja</strong> — se estiver na rua errada, a pessoa chega ao lugar
        errado.
      </div>

      {loadError && (
        <div className="myloc-error" role="alert">
          {loadError}{' '}
          <button type="button" className="myloc-link" onClick={() => void load()}>
            Tentar de novo
          </button>
        </div>
      )}

      {needsParish && (
        <div className="empty-state">
          A plataforma ajusta a localização de uma paróquia por vez. Escolha uma paróquia em{' '}
          <Link to="/admin/communities">Comunidades</Link> e edite o pino no cadastro da comunidade — ou abra esta
          tela com <code>?parishId=</code> da paróquia desejada.
        </div>
      )}

      {!loadError && !needsParish && communities.length === 0 && (
        <div className="empty-state">
          Você ainda não gerencia nenhuma comunidade. Peça ao administrador da paróquia para vincular o seu acesso.
        </div>
      )}

      {/* ---------- Lista ---------- */}
      {!selected && communities.length > 0 && (
        <>
          <p className="myloc-summary">
            {pending === 0
              ? 'Todas as suas comunidades estão com a localização conferida.'
              : `${pending} de ${communities.length} ${
                  communities.length === 1 ? 'comunidade precisa' : 'comunidades precisam'
                } de conferência — elas aparecem primeiro.`}
          </p>
          {communities.length >= LIST_LIMIT && (
            <div className="myloc-error" role="status">
              A lista está cortada: só as primeiras {LIST_LIMIT} comunidades aparecem aqui. Para ajustar as demais,
              use a tela de Comunidades (filtrando por paróquia).
            </div>
          )}
          {communities.length >= SEARCH_FROM && (
            <input
              type="search"
              className="myloc-search"
              placeholder="Buscar comunidade, paróquia ou cidade..."
              aria-label="Buscar comunidade"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          {sorted.length === 0 ? (
            <div className="empty-state">Nenhuma comunidade encontrada com esse nome.</div>
          ) : (
            <ul className="myloc-list">
              {sorted.map((c) => {
                const meta = STATUS_META[statusOf(c)];
                return (
                  <li key={c.id}>
                    <button type="button" className="myloc-card" onClick={() => openCommunity(c)}>
                      <span className="myloc-card-info">
                        <span className="myloc-card-name">{c.name}</span>
                        {c.parishName && <span className="myloc-card-parish">{c.parishName}</span>}
                        <span className="myloc-card-address">{addressLine(c) || 'Endereço não informado'}</span>
                      </span>
                      <span className="myloc-card-side">
                        <span className={`status-badge ${meta.color}`}>{meta.label}</span>
                        <span className="myloc-card-go" aria-hidden="true">
                          Ajustar ›
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* ---------- Editor ---------- */}
      {selected && status && (
        <section className="myloc-editor" aria-labelledby="myloc-editor-title">
          {communities.length > 1 && (
            <button
              type="button"
              className="myloc-link myloc-back"
              onClick={() => void backToList()}
              disabled={saving}
            >
              ‹ Voltar para as comunidades
            </button>
          )}

          <div className="myloc-editor-head">
            <div>
              <h2 id="myloc-editor-title" className="myloc-editor-title">
                {selected.name}
              </h2>
              {selected.parishName && <div className="myloc-card-parish">{selected.parishName}</div>}
            </div>
            <span className={`status-badge ${STATUS_META[status].color}`}>{STATUS_META[status].label}</span>
          </div>
          <p className="myloc-hint">{STATUS_META[status].hint}</p>

          <div className="myloc-tools">
            <button type="button" className="myloc-btn primary" onClick={locateMe} disabled={locating || saving}>
              {locating ? 'Obtendo posição…' : '📍 Usar minha posição atual'}
            </button>
            <button
              type="button"
              className="myloc-btn"
              onClick={() => void geocodeFromAddress()}
              disabled={geocoding || saving}
            >
              {geocoding ? 'Localizando…' : '🔎 Localizar pelo endereço'}
            </button>
          </div>
          <p className="myloc-tip">
            Está na igreja agora? Toque em <strong>Usar minha posição atual</strong>. Depois, toque no mapa ou arraste
            o pino até a porta da igreja. O botão <strong>Satélite</strong> do mapa ajuda a achar o telhado.
          </p>

          {/* Durante o salvamento o mapa não aceita toque nem arrasto */}
          <div
            aria-busy={saving}
            style={saving ? { pointerEvents: 'none', opacity: 0.6 } : undefined}
          >
            <MapPicker value={pin} onChange={movePin} height={mapHeight} />
          </div>

          {gpsWeak && (
            <div className="myloc-error" role="alert">
              ⚠ O GPS informou a posição com pouca precisão (erro de cerca de {formatDistance(gpsAccuracy ?? 0)}).
              Ela ainda <strong>não vale como conferência</strong>: toque no mapa ou arraste o pino até a porta da
              igreja para liberar o botão Salvar.
            </div>
          )}

          <div className="myloc-status" role="status" aria-live="polite">
            {!pin ? (
              <span className="myloc-status-warn">Nenhum pino no mapa. Toque no ponto onde fica a igreja.</span>
            ) : (
              <>
                <span className="myloc-coords">
                  Lat {pin.lat.toFixed(6)}, Long {pin.lng.toFixed(6)}
                </span>
                {pinSource === 'gps' && gpsAccuracy != null && (
                  <span className="myloc-status-info">GPS · precisão de cerca de {formatDistance(gpsAccuracy)}</span>
                )}
                {!originalPin ? (
                  <span className="myloc-status-info">Primeiro pino desta comunidade.</span>
                ) : pinChanged ? (
                  <span className={moved > FAR_MOVE_METERS ? 'myloc-status-warn' : 'myloc-status-info'}>
                    {moved > FAR_MOVE_METERS ? '⚠ ' : ''}A {formatDistance(moved)} do pino atual
                    {moved > FAR_MOVE_METERS ? ' — confira se é isso mesmo' : ''}
                  </span>
                ) : (
                  <span className="myloc-status-info">Pino no lugar atual (sem mudança).</span>
                )}
                {pinChanged && originalPin && (
                  <button
                    type="button"
                    className="myloc-link"
                    disabled={saving}
                    onClick={() => movePin(originalPin.lat, originalPin.lng)}
                  >
                    Desfazer
                  </button>
                )}
              </>
            )}
          </div>

          <fieldset className="myloc-address">
            <legend>Endereço que aparece para o fiel</legend>
            <div className="myloc-field myloc-field-wide">
              <label htmlFor="myloc-address">Rua e número</label>
              <input
                id="myloc-address"
                type="text"
                autoComplete="off"
                value={form.address}
                placeholder="Ex.: Rua São José, 120 – Centro"
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="myloc-field">
              <label htmlFor="myloc-city">Cidade</label>
              <input
                id="myloc-city"
                type="text"
                autoComplete="off"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="myloc-field myloc-field-small">
              <label htmlFor="myloc-state">UF</label>
              <input
                id="myloc-state"
                type="text"
                autoComplete="off"
                maxLength={2}
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
              />
            </div>
            <div className="myloc-field myloc-field-small">
              <label htmlFor="myloc-zip">CEP</label>
              <input
                id="myloc-zip"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={9}
                value={form.zipCode}
                placeholder="00000-000"
                onChange={(e) => setForm({ ...form, zipCode: e.target.value.replace(/[^\d-]/g, '') })}
              />
            </div>
          </fieldset>

          {/* Conferir sem mover: só quando o pino existe, não foi mexido e ainda não está conferido */}
          {originalPin && !pinChanged && status !== 'verified' && (
            <label className="myloc-confirm" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '0 0 1rem' }}>
              <input
                type="checkbox"
                checked={pinConfirmed}
                disabled={saving}
                onChange={(e) => setPinConfirmed(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>O pino está no lugar certo</strong> — conferi no mapa e ele está em cima da igreja.
              </span>
            </label>
          )}

          {saveError && (
            <div className="myloc-error" role="alert">
              {saveError}
            </div>
          )}

          <div className="myloc-save-bar">
            <span className="myloc-save-note">
              {gpsWeak
                ? 'Toque no mapa ou arraste o pino até a igreja para poder salvar.'
                : pinChanged || pinConfirmed
                  ? 'Ao salvar, o pino fica marcado como conferido.'
                  : addressChanged
                    ? 'Só o endereço será salvo (o pino não muda).'
                    : status === 'verified'
                      ? 'Nada para salvar.'
                      : 'O pino está certo? Marque "O pino está no lugar certo" ou ajuste-o no mapa.'}
            </span>
            <button
              type="button"
              className="myloc-btn primary myloc-save"
              onClick={() => void save()}
              disabled={saving || !pin || gpsWeak || (!pinChanged && !pinConfirmed && !addressChanged)}
            >
              {saving ? 'Salvando…' : 'Salvar localização'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default MyLocationPage;
