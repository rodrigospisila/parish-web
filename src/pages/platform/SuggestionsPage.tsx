import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapContainer, Circle, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import TitleIcon from '../../components/TitleIcon';
import BaseMapLayers from '../../components/BaseMapLayers';
import api from '../../services/api';
import { notify } from '../../services/notification.service';
import { dataHoraBR, haQuanto, mensagemDeErro, num } from './platformShared';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Sugestões dos fiéis — correções que o fiel manda pelo app (pino, horário,
 * outra informação). Regra de ouro: NADA é aplicado sozinho. Aqui o
 * administrador lê, confere e marca; a correção é feita no cadastro (ou no
 * mapa do território, no caso do pino — a sugestão de localização também cai
 * na fila de revisão de lá).
 */

type Status = 'PENDING' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED';
type Kind = 'LOCATION' | 'SCHEDULE' | 'INFO';

interface Suggestion {
  id: string;
  communityId?: string;
  community: { id: string; name: string; city: string; state: string } | null;
  user: { id: string; name: string } | null;
  kind: Kind;
  scheduleType: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  atChurch: boolean | null;
  message: string;
  status: Status;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

const LIMITE = 50;

const STATUS_CHIPS: Array<[Status | '', string]> = [
  ['PENDING', 'Pendentes'],
  ['REVIEWED', 'Conferidas'],
  ['ACCEPTED', 'Aceitas'],
  ['REJECTED', 'Recusadas'],
  ['', 'Todas'],
];
const KIND_CHIPS: Array<[Kind | '', string]> = [
  ['', 'Todos os tipos'],
  ['LOCATION', 'Localização'],
  ['SCHEDULE', 'Horários'],
  ['INFO', 'Outras'],
];

const STATUS_LABEL: Record<Status, string> = { PENDING: 'Pendente', REVIEWED: 'Conferida', ACCEPTED: 'Aceita', REJECTED: 'Recusada' };
const STATUS_TONE: Record<Status, string> = { PENDING: 'yellow', REVIEWED: 'blue', ACCEPTED: 'green', REJECTED: 'gray' };
const KIND_LABEL: Record<Kind, string> = { LOCATION: 'Localização', SCHEDULE: 'Horário', INFO: 'Outra informação' };
const KIND_ICON: Record<Kind, string> = { LOCATION: '📍', SCHEDULE: '🕒', INFO: '💬' };
const SCHEDULE_TYPE_LABEL: Record<string, string> = { MASS: 'Missa', CONFESSION: 'Confissão', ADORATION: 'Adoração', ROSARY: 'Terço' };

const COR_SUGESTAO = '#8E44AD';

const communityIdOf = (s: Suggestion) => s.community?.id ?? s.communityId ?? '';

const precisao = (m: number | null) => (m == null ? null : m < 1000 ? `± ${Math.round(m)} m` : `± ${(m / 1000).toFixed(1).replace('.', ',')} km`);

/** Mini-mapa do ponto sugerido, com o círculo da precisão do GPS. */
const MiniMapa: React.FC<{ s: Suggestion }> = ({ s }) => {
  if (s.latitude == null || s.longitude == null) return null;
  const centro: [number, number] = [s.latitude, s.longitude];
  const zoom = (s.accuracyM ?? 0) > 300 ? 15 : 17;
  return (
    <div className="pf-minimapa">
      <MapContainer key={s.id} center={centro} zoom={zoom} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <BaseMapLayers />
        {s.accuracyM != null && s.accuracyM > 0 && (
          <Circle center={centro} radius={s.accuracyM} pathOptions={{ color: COR_SUGESTAO, weight: 1, fillColor: COR_SUGESTAO, fillOpacity: 0.12 }} />
        )}
        <CircleMarker center={centro} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: COR_SUGESTAO, fillOpacity: 0.95 }} />
      </MapContainer>
    </div>
  );
};

const SuggestionsPage: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | ''>('PENDING');
  const [kind, setKind] = useState<Kind | ''>('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [salvando, setSalvando] = useState(false);
  const pedidoRef = useRef(0);

  const carregar = useCallback(
    async (offset = 0) => {
      const meu = ++pedidoRef.current;
      setCarregando(true);
      setErro('');
      try {
        const params: Record<string, string | number> = { limit: LIMITE, offset };
        if (status) params.status = status;
        if (kind) params.kind = kind;
        const { data } = await api.get('/community-suggestions', { params });
        if (meu !== pedidoRef.current) return;
        const novos: Suggestion[] = Array.isArray(data?.items) ? data.items : [];
        setItems((atual) => (offset === 0 ? novos : [...atual, ...novos]));
        setTotal(Number(data?.total) || 0);
      } catch (e) {
        if (meu !== pedidoRef.current) return;
        if (offset === 0) setItems([]);
        setErro(mensagemDeErro(e, 'Não foi possível carregar as sugestões.'));
      } finally {
        if (meu === pedidoRef.current) setCarregando(false);
      }
    },
    [status, kind],
  );

  useEffect(() => {
    void carregar(0);
  }, [carregar]);

  const sel = items.find((s) => s.id === selId) ?? null;

  // Sem seleção (ou a seleção sumiu com o filtro): abre a primeira da lista
  useEffect(() => {
    if (!items.length) {
      setSelId(null);
      return;
    }
    if (!selId || !items.some((s) => s.id === selId)) setSelId(items[0].id);
  }, [items, selId]);

  useEffect(() => {
    setNota(sel?.reviewNote ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const revisar = async (novo: Exclude<Status, 'PENDING'>) => {
    if (!sel) return;
    setSalvando(true);
    try {
      const { data } = await api.patch(`/community-suggestions/${sel.id}`, {
        status: novo,
        reviewNote: nota.trim() || undefined,
      });
      const atualizado: Suggestion = {
        ...sel,
        ...(data && typeof data === 'object' ? data : {}),
        status: data?.status ?? novo,
        reviewNote: data?.reviewNote ?? (nota.trim() || null),
        reviewedAt: data?.reviewedAt ?? new Date().toISOString(),
      };
      const saiDaLista = Boolean(status) && atualizado.status !== status;
      if (saiDaLista) {
        // Some do filtro atual: a seleção passa para a próxima da fila
        const i = items.findIndex((s) => s.id === sel.id);
        const restam = items.filter((s) => s.id !== sel.id);
        setItems(restam);
        setSelId(restam[Math.min(i, restam.length - 1)]?.id ?? null);
        setTotal((t) => Math.max(t - 1, 0));
      } else {
        setItems((atual) => atual.map((s) => (s.id === sel.id ? atualizado : s)));
      }
      notify.success(`Sugestão marcada como ${STATUS_LABEL[atualizado.status].toLowerCase()}.`);
    } catch (e) {
      notify.error(mensagemDeErro(e, 'Não foi possível salvar a revisão.'));
    } finally {
      setSalvando(false);
    }
  };

  const cid = sel ? communityIdOf(sel) : '';
  const linkMapa =
    sel && cid
      ? `/admin/map?community=${encodeURIComponent(cid)}${
          sel.latitude != null && sel.longitude != null ? `&lat=${sel.latitude}&lng=${sel.longitude}` : ''
        }`
      : '';

  return (
    <div className="module-page platform-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="sino" /> Sugestões dos fiéis
        </h1>
      </div>
      <p className="pf-intro">
        Correções que os fiéis mandam pelo app: onde fica a igreja, horário de missa, outras informações. Leia, confira e marque.
      </p>

      <section className="pf-filtros">
        <div className="pf-chips" role="group" aria-label="Situação">
          {STATUS_CHIPS.map(([valor, rotulo]) => (
            <button
              key={valor || 'todas'}
              type="button"
              className={`pf-chip${status === valor ? ' on' : ''}`}
              aria-pressed={status === valor}
              onClick={() => setStatus(valor)}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <span className="pf-sep" aria-hidden="true" />
        <div className="pf-chips" role="group" aria-label="Tipo">
          {KIND_CHIPS.map(([valor, rotulo]) => (
            <button
              key={valor || 'todos'}
              type="button"
              className={`pf-chip pf-chip-soft${kind === valor ? ' on' : ''}`}
              aria-pressed={kind === valor}
              onClick={() => setKind(valor)}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </section>

      {erro && (
        <p className="pf-erro">
          {erro}{' '}
          <button type="button" className="pf-link" onClick={() => void carregar(0)}>
            tentar de novo
          </button>
        </p>
      )}

      <div className="pf-mestre">
        <aside className="pf-lista" aria-label="Sugestões">
          <div className="pf-lista-topo">
            <strong>{num(total)}</strong> sugest{total === 1 ? 'ão' : 'ões'}
            {carregando && <span className="pf-mudo"> · carregando…</span>}
          </div>
          {!carregando && !erro && items.length === 0 && (
            <p className="pf-vazio">{status === 'PENDING' ? 'Nenhuma sugestão pendente. Tudo em dia.' : 'Nada com esse filtro.'}</p>
          )}
          <ul>
            {items.map((s) => (
              <li key={s.id}>
                <button type="button" className={`pf-item${s.id === selId ? ' on' : ''}`} onClick={() => setSelId(s.id)}>
                  <span className={`pf-item-icone pf-kind-${s.kind.toLowerCase()}`} aria-hidden="true">
                    {KIND_ICON[s.kind] ?? '•'}
                  </span>
                  <span className="pf-item-txt">
                    <strong>{s.community?.name ?? 'Comunidade removida'}</strong>
                    <small>
                      {s.community ? `${s.community.city}/${s.community.state} · ` : ''}
                      {KIND_LABEL[s.kind] ?? s.kind} · {haQuanto(s.createdAt)}
                    </small>
                    <small className="pf-item-msg">{s.message}</small>
                  </span>
                  {!status && <span className={`status-badge ${STATUS_TONE[s.status]} pf-item-selo`}>{STATUS_LABEL[s.status]}</span>}
                </button>
              </li>
            ))}
          </ul>
          {items.length < total && (
            <button type="button" className="pf-mais" onClick={() => void carregar(items.length)} disabled={carregando}>
              {carregando ? 'Carregando…' : `Carregar mais (${num(total - items.length)} restantes)`}
            </button>
          )}
        </aside>

        {/* Lista vazia: o quadro de detalhe não tem o que mostrar */}
        {(items.length > 0 || carregando) && (
        <section className="pf-detalhe" aria-live="polite">
          {!sel ? (
            <p className="pf-vazio pf-detalhe-vazio">Escolha uma sugestão na lista para ver os detalhes.</p>
          ) : (
            <>
              <header className="pf-detalhe-topo">
                <div>
                  <span className="pf-tipo">
                    {KIND_ICON[sel.kind]} {KIND_LABEL[sel.kind] ?? sel.kind}
                    {sel.kind === 'SCHEDULE' && sel.scheduleType ? ` · ${SCHEDULE_TYPE_LABEL[sel.scheduleType] ?? sel.scheduleType}` : ''}
                  </span>
                  <h2>{sel.community?.name ?? 'Comunidade removida'}</h2>
                  {sel.community && (
                    <small>
                      {sel.community.city}/{sel.community.state}
                    </small>
                  )}
                </div>
                <span className={`status-badge ${STATUS_TONE[sel.status]}`}>{STATUS_LABEL[sel.status]}</span>
              </header>

              <blockquote className="pf-mensagem">{sel.message}</blockquote>
              <p className="pf-meta">
                Enviada por <strong>{sel.user?.name ?? 'fiel sem cadastro (ou conta excluída)'}</strong> em {dataHoraBR(sel.createdAt)} ({haQuanto(sel.createdAt)}).
              </p>

              {sel.kind === 'LOCATION' && (
                <div className="pf-bloco">
                  {sel.latitude != null && sel.longitude != null ? (
                    <>
                      <MiniMapa s={sel} />
                      <p className="pf-meta">
                        Ponto sugerido: {sel.latitude.toFixed(6)}, {sel.longitude.toFixed(6)}
                        {precisao(sel.accuracyM) ? ` · precisão do GPS ${precisao(sel.accuracyM)}` : ''}
                        {sel.atChurch ? ' · o fiel disse que estava na igreja' : sel.atChurch === false ? ' · o fiel NÃO estava na igreja (marcou no mapa)' : ''}
                      </p>
                      <p className="pf-dica">
                        O ponto também entrou na fila de revisão do mapa do território (marcador roxo). É lá que o pino é corrigido: confira no
                        satélite e confirme.
                      </p>
                    </>
                  ) : (
                    <p className="pf-meta">A sugestão não trouxe coordenada.</p>
                  )}
                  {linkMapa && (
                    <button type="button" className="pf-btn pf-btn-primario" onClick={() => navigate(linkMapa)}>
                      Abrir no mapa do território
                    </button>
                  )}
                </div>
              )}

              {sel.kind !== 'LOCATION' && cid && (
                <div className="pf-bloco pf-atalhos">
                  {sel.kind === 'SCHEDULE' && (
                    <Link className="pf-btn pf-btn-primario" to={`/admin/fixed-schedule?community=${encodeURIComponent(cid)}`}>
                      Abrir os horários da comunidade
                    </Link>
                  )}
                  <Link
                    className={`pf-btn${sel.kind === 'INFO' ? ' pf-btn-primario' : ''}`}
                    to={`/admin/communities?edit=${encodeURIComponent(cid)}`}
                  >
                    Abrir o cadastro da comunidade
                  </Link>
                </div>
              )}

              {sel.reviewedAt && sel.status !== 'PENDING' && (
                <p className="pf-meta">
                  Revisada em {dataHoraBR(sel.reviewedAt)}
                  {sel.reviewNote ? (
                    <>
                      : <em>“{sel.reviewNote}”</em>
                    </>
                  ) : (
                    '.'
                  )}
                </p>
              )}

              <div className="pf-revisao">
                <p className="pf-alerta">
                  <strong>Aceitar não altera nada sozinho — faça a correção no cadastro.</strong> A marcação só registra o que foi feito com a
                  sugestão.
                </p>
                <label className="pf-campo">
                  Nota da revisão (opcional)
                  <textarea
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    maxLength={1000}
                    rows={2}
                    placeholder="Ex.: horário corrigido na agenda fixa; pino conferido no satélite"
                  />
                </label>
                <div className="pf-acoes">
                  <button type="button" className="pf-btn" onClick={() => void revisar('REVIEWED')} disabled={salvando}>
                    Conferido
                  </button>
                  <button type="button" className="pf-btn pf-btn-ok" onClick={() => void revisar('ACCEPTED')} disabled={salvando}>
                    Aceito (já corrigi)
                  </button>
                  <button type="button" className="pf-btn pf-btn-perigo" onClick={() => void revisar('REJECTED')} disabled={salvando}>
                    Recusar
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
        )}
      </div>
    </div>
  );
};

export default SuggestionsPage;
