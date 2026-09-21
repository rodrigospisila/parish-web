import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import './BaseMapLayers.css';

/**
 * Camada de fundo dos mapas, com alternador Mapa | Satélite.
 *
 * O satélite existe para quem vai posicionar igreja à mão: do alto, o telhado e a
 * praça em frente se reconhecem, e o pino sai no prédio certo. Usa a World Imagery
 * da Esri com os rótulos de lugares e de vias por cima — imagem pura, sem nome de
 * rua, deixa qualquer um perdido.
 *
 * Deve ser filho de <MapContainer>. A escolha fica guardada no navegador.
 */

export type BaseMap = 'mapa' | 'satelite';

const CHAVE_LOCAL = 'parish.map.base';

/**
 * Com chave (VITE_ESRI_API_KEY) os ladrilhos saem do serviço autenticado, que é a
 * forma contratual de usar os mapas da Esri em aplicativo próprio — a conta
 * gratuita da ArcGIS Location Platform dá 2 milhões de ladrilhos por mês. Sem a
 * chave, cai no serviço público, que responde sem autenticação.
 */
const ESRI_KEY = String(import.meta.env.VITE_ESRI_API_KEY ?? '').trim();
const ESRI_BASE = ESRI_KEY
  ? 'https://ibasemaps-api.arcgis.com/arcgis/rest/services'
  : 'https://server.arcgisonline.com/ArcGIS/rest/services';
const token = ESRI_KEY ? `?token=${ESRI_KEY}` : '';
const IMAGEM = `${ESRI_BASE}/World_Imagery/MapServer/tile/{z}/{y}/{x}${token}`;
const VIAS = `${ESRI_BASE}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}${token}`;
const LUGARES = `${ESRI_BASE}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}${token}`;

const ATRIBUICAO_SATELITE =
  'Imagem: <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, Vantor, Earthstar Geographics e comunidade GIS · Powered by Esri';
const ATRIBUICAO_MAPA =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/** Zoom até onde a interface deixa ir; acima do nativo o Leaflet amplia o último ladrilho real. */
export const ZOOM_MAXIMO = 20;
const NATIVO_MAPA = 19;
const NATIVO_SATELITE_PADRAO = 18;

/**
 * Onde não há imagem naquele zoom a Esri devolve um ladrilho cinza de "Map data
 * not yet available" com status 200 — o Leaflet não tem como saber. O aviso pesa
 * ~2,5 KB e um ladrilho de satélite de verdade, de 5 a 25 KB, então o tamanho
 * denuncia. Água muito lisa pode cair abaixo do corte; o efeito é só ampliar um
 * nível a menos, o que não faz mal a ninguém.
 */
const LADRILHO_VAZIO_BYTES = 3000;

const ladrilhoDe = (lat: number, lng: number, z: number) => {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
};

async function temImagem(lat: number, lng: number, z: number): Promise<boolean> {
  const { x, y } = ladrilhoDe(lat, lng, z);
  const url = IMAGEM.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));
  const resposta = await fetch(url);
  if (!resposta.ok) return false;
  return (await resposta.blob()).size > LADRILHO_VAZIO_BYTES;
}

const lerEscolha = (): BaseMap => {
  try {
    return localStorage.getItem(CHAVE_LOCAL) === 'satelite' ? 'satelite' : 'mapa';
  } catch {
    return 'mapa';
  }
};

interface Props {
  /** Avisa o pai da troca — útil para aproximar mais quando o satélite está ligado. */
  onChange?: (base: BaseMap) => void;
}

const BaseMapLayers: React.FC<Props> = ({ onChange }) => {
  const map = useMap();
  const [base, setBase] = useState<BaseMap>(lerEscolha);
  const [nativo, setNativo] = useState(NATIVO_SATELITE_PADRAO);
  const controle = useRef<HTMLDivElement>(null);
  const sondados = useRef(new Map<string, number>());
  const pedido = useRef(0);

  useEffect(() => {
    map.setMaxZoom(ZOOM_MAXIMO);
  }, [map]);

  // O alternador fica dentro do mapa: sem isto, clicar nele marcaria um pino
  useEffect(() => {
    if (!controle.current) return;
    L.DomEvent.disableClickPropagation(controle.current);
    L.DomEvent.disableScrollPropagation(controle.current);
  }, []);

  useEffect(() => {
    onChange?.(base);
    try {
      localStorage.setItem(CHAVE_LOCAL, base);
    } catch {
      /* navegador sem armazenamento: a escolha vale só para esta visita */
    }
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Descobre até que zoom há imagem no centro da tela — 19 nas capitais, 17 no meio da Amazônia. */
  const sondar = useCallback(async () => {
    if (base !== 'satelite' || map.getZoom() < 17) return;
    const c = map.getCenter();
    const chave = `${c.lat.toFixed(1)},${c.lng.toFixed(1)}`;
    const conhecido = sondados.current.get(chave);
    if (conhecido !== undefined) {
      setNativo(conhecido);
      return;
    }
    const meu = ++pedido.current;
    try {
      let achado = 17;
      if (await temImagem(c.lat, c.lng, 19)) achado = 19;
      else if (await temImagem(c.lat, c.lng, 18)) achado = 18;
      if (meu !== pedido.current) return;
      sondados.current.set(chave, achado);
      setNativo(achado);
    } catch {
      /* sem rede para sondar: fica o padrão */
    }
  }, [base, map]);

  useMapEvents({ moveend: () => void sondar() });
  useEffect(() => {
    void sondar();
  }, [sondar]);

  return (
    <>
      {base === 'mapa' ? (
        <TileLayer
          key="mapa"
          attribution={ATRIBUICAO_MAPA}
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={NATIVO_MAPA}
          maxZoom={ZOOM_MAXIMO}
        />
      ) : (
        <>
          {/* A chave inclui o zoom nativo: o react-leaflet não atualiza essa opção numa camada já criada */}
          <TileLayer
            key={`satelite-${nativo}`}
            attribution={ATRIBUICAO_SATELITE}
            url={IMAGEM}
            maxNativeZoom={nativo}
            maxZoom={ZOOM_MAXIMO}
          />
          <TileLayer key="vias" url={VIAS} maxNativeZoom={18} maxZoom={ZOOM_MAXIMO} opacity={0.9} />
          <TileLayer key="lugares" url={LUGARES} maxNativeZoom={18} maxZoom={ZOOM_MAXIMO} />
        </>
      )}

      <div className="leaflet-bottom leaflet-left">
        <div ref={controle} className="leaflet-control base-map-toggle" role="group" aria-label="Tipo de mapa">
          <button
            type="button"
            className={base === 'mapa' ? 'on' : ''}
            aria-pressed={base === 'mapa'}
            onClick={() => setBase('mapa')}
          >
            Mapa
          </button>
          <button
            type="button"
            className={base === 'satelite' ? 'on' : ''}
            aria-pressed={base === 'satelite'}
            onClick={() => setBase('satelite')}
          >
            Satélite
          </button>
        </div>
      </div>
    </>
  );
};

export default BaseMapLayers;
