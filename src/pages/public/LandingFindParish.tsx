import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../services/api';
import type { DemoPrefill } from './DemoRequestForm';

/**
 * "Encontre sua paróquia" no site: não há busca de paróquia por nome na API
 * pública, então a busca reaproveita o mapa público — cidade/bairro pelo
 * geocodificador (GET /public/map/geocode) e as igrejas em volta
 * (GET /public/map/nearby), agrupadas por paróquia. "Esta paróquia é minha"
 * leva à reivindicação (/reivindicar/:parishId, sempre aprovada pela equipe
 * do Parish); "Quero uma demonstração" abre o pedido de demonstração já com a
 * paróquia (o Lead leva o parishId).
 */

interface GeoHit {
  latitude: number;
  longitude: number;
  label: string;
}

interface NearbyCommunity {
  id: string;
  name: string;
  city: string;
  state: string;
  distanceKm: number | null;
  parish: { id: string; name: string } | null;
}

interface ParishGroup {
  id: string;
  name: string;
  city: string;
  state: string;
  distanceKm: number | null;
  communities: string[];
}

const RAIO_KM = 12;

/** Junta as igrejas por paróquia, da mais perto à mais longe. */
function agrupar(rows: NearbyCommunity[]): ParishGroup[] {
  const map = new Map<string, ParishGroup>();
  for (const c of rows) {
    if (!c?.parish?.id) continue;
    const g = map.get(c.parish.id);
    if (g) {
      g.communities.push(c.name);
      if (c.distanceKm !== null && (g.distanceKm === null || c.distanceKm < g.distanceKm)) g.distanceKm = c.distanceKm;
    } else {
      map.set(c.parish.id, {
        id: c.parish.id,
        name: c.parish.name,
        city: c.city,
        state: c.state,
        distanceKm: c.distanceKm,
        communities: [c.name],
      });
    }
  }
  return [...map.values()].sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999)).slice(0, 12);
}

const km = (v: number | null) => (v === null ? '' : v < 1 ? 'menos de 1 km' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`);

interface Props {
  onPick: (prefill: DemoPrefill) => void;
  appLinks?: { iosUrl?: string | null; androidUrl?: string | null } | null;
}

const LandingFindParish: React.FC<Props> = ({ onPick, appLinks }) => {
  const [q, setQ] = useState('');
  const [lugares, setLugares] = useState<GeoHit[] | null>(null);
  const [lugar, setLugar] = useState<GeoHit | null>(null);
  const [paroquias, setParoquias] = useState<ParishGroup[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const erroDeRede = (e: unknown) =>
    axios.isAxiosError(e) && e.response?.status === 429
      ? 'Muitas buscas seguidas. Espere um minuto e tente de novo.'
      : 'A busca não respondeu agora. Tente de novo em instantes.';

  const buscarIgrejas = async (hit: GeoHit) => {
    setLugar(hit);
    setLugares(null);
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/public/map/nearby', {
        params: { lat: hit.latitude, lng: hit.longitude, radiusKm: RAIO_KM, days: 1, limit: 150 },
        timeout: 15_000,
      });
      const rows: NearbyCommunity[] = Array.isArray(data?.communities) ? data.communities : [];
      setParoquias(agrupar(rows));
    } catch (e) {
      setParoquias(null);
      setErro(erroDeRede(e));
    } finally {
      setCarregando(false);
    }
  };

  const buscar = async (e: React.FormEvent) => {
    e.preventDefault();
    const texto = q.trim();
    if (texto.length < 3) {
      setErro('Digite ao menos 3 letras da cidade ou do bairro.');
      return;
    }
    setErro('');
    setCarregando(true);
    setParoquias(null);
    setLugar(null);
    try {
      const { data } = await api.get('/public/map/geocode', { params: { q: texto }, timeout: 15_000 });
      const hits: GeoHit[] = (Array.isArray(data) ? data : [])
        .filter((h: any) => h && Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
        .slice(0, 5);
      if (hits.length === 0) {
        setLugares([]);
        setCarregando(false);
        return;
      }
      if (hits.length === 1) {
        await buscarIgrejas(hits[0]);
        return;
      }
      setLugares(hits);
      setCarregando(false);
    } catch (err) {
      setLugares(null);
      setErro(erroDeRede(err));
      setCarregando(false);
    }
  };

  return (
    <div className="lp-find">
      <form className="lp-find-form" onSubmit={buscar} role="search">
        <label htmlFor="lp-find-q" className="lp-sr">
          Cidade ou bairro
        </label>
        <input
          id="lp-find-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Digite a cidade ou o bairro (ex.: Ponta Grossa, PR)"
          maxLength={120}
          autoComplete="address-level2"
        />
        <button type="submit" className="lp-btn lp-btn-primary" disabled={carregando}>
          {carregando ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {erro && (
        <p className="lp-form-erro" role="alert">
          {erro}
        </p>
      )}

      <div aria-live="polite">
        {lugares && lugares.length === 0 && (
          <p className="lp-muted">Não achamos esse lugar. Tente só o nome da cidade e a UF.</p>
        )}
        {lugares && lugares.length > 1 && (
          <div className="lp-find-lugares">
            <p className="lp-muted">Qual destes lugares?</p>
            <ul>
              {lugares.map((h, i) => (
                <li key={`${h.latitude},${h.longitude},${i}`}>
                  <button type="button" className="lp-find-lugar" onClick={() => void buscarIgrejas(h)}>
                    {h.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {paroquias && lugar && (
          <>
            <p className="lp-muted">
              {paroquias.length
                ? `Paróquias com igrejas a até ${RAIO_KM} km de ${lugar.label.split(',')[0]}:`
                : `Nenhuma igreja cadastrada a até ${RAIO_KM} km deste ponto. Peça uma demonstração que nós incluímos a sua paróquia.`}
            </p>
            {paroquias.length > 0 && (
              <ul className="lp-find-lista">
                {paroquias.map((p) => (
                  <li key={p.id} className="lp-find-item">
                    <div>
                      <strong>{p.name}</strong>
                      <span className="lp-find-sub">
                        {p.city}/{p.state}
                        {p.distanceKm !== null ? ` · ${km(p.distanceKm)}` : ''} · {p.communities.length}{' '}
                        {p.communities.length === 1 ? 'igreja' : 'igrejas'}
                      </span>
                    </div>
                    <div className="lp-find-acoes">
                      <Link to={`/reivindicar/${encodeURIComponent(p.id)}`} className="lp-btn lp-btn-primary lp-btn-mini">
                        Esta paróquia é minha
                      </Link>
                      <button
                        type="button"
                        className="lp-btn lp-btn-outline lp-btn-mini"
                        onClick={() =>
                          onPick({
                            parishId: p.id,
                            parishName: p.name,
                            city: p.city,
                            state: p.state,
                            message: 'Quero conhecer o Parish para esta paróquia.',
                          })
                        }
                      >
                        Quero uma demonstração
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <p className="lp-muted lp-find-rodape">
        É fiel e quer ver os horários de missa? Eles estão no app Parish
        {appLinks?.iosUrl || appLinks?.androidUrl ? ': ' : '.'}
        {appLinks?.iosUrl && (
          <a href={appLinks.iosUrl} target="_blank" rel="noopener noreferrer">
            iPhone
          </a>
        )}
        {appLinks?.iosUrl && appLinks?.androidUrl && ' · '}
        {appLinks?.androidUrl && (
          <a href={appLinks.androidUrl} target="_blank" rel="noopener noreferrer">
            Android
          </a>
        )}
      </p>
    </div>
  );
};

export default LandingFindParish;
