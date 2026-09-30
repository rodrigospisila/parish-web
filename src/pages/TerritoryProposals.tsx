import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapContainer, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BaseMapLayers from '../components/BaseMapLayers';
import api from '../services/api';
import { UFS, dataBR, haQuanto, mensagemDeErro, num } from './platform/platformShared';
import { SEMANAS_DO_MES, type MassRecurrence } from '../utils/recorrencia';
import './modules/ModulePages.css';
import './platform/PlatformPages.css';
import './TerritoryProposals.css';

/**
 * Propostas de dados — segunda aba do Mapa do território (SYSTEM_ADMIN).
 *
 * Agentes levantaram, em fonte oficial (site da paróquia, da diocese...), horários
 * de missa/confissão/adoração/terço e correções de cadastro. O que tinha confiança
 * alta já foi gravado por script; o resto está aqui, à espera de alguém que olhe a
 * EVIDÊNCIA (o trecho literal e o link) e aprove, edite ou rejeite.
 *
 * Nada aqui é aplicado sem clique: aprovar chama o servidor, que grava e responde
 * com a mensagem do que fez (ou do porquê não fez — 409/400 aparecem no cartão).
 */

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export type ProposalKind =
  | 'SCHEDULE_CREATE'
  | 'SCHEDULE_UPDATE'
  | 'SCHEDULE_DELETE'
  | 'SCHEDULE_RECURRENCE'
  | 'COMMUNITY_ADDRESS'
  | 'COMMUNITY_PARISH'
  | 'COMMUNITY_CREATE'
  | 'COMMUNITY_WEBSITE'
  | 'PARISH_WEBSITE';
type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface HorarioLike {
  type?: string | null;
  dayOfWeek?: number | null;
  time?: string | null;
  recurrence?: MassRecurrence | null;
  weeksOfMonth?: number[] | null;
  dayOfMonth?: number | null;
  notes?: string | null;
}

interface Proposta {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  communityId: string | null;
  parishId: string | null;
  massScheduleId: string | null;
  payload: Record<string, unknown> | null;
  current: unknown;
  evidenceUrl: string | null;
  evidenceQuote: string | null;
  sourceKind: string | null;
  confidence: number | string | null;
  reason: string | null;
  batch: string | null;
  city: string | null;
  state: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  community: {
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    parish: { id: string; name: string } | null;
  } | null;
  parish: { id: string; name: string; website: string | null } | null;
  schedule: (HorarioLike & { id: string }) | null;
}

interface Ponto {
  communityId: string;
  name: string;
  latitude: number;
  longitude: number;
  count: number;
  kinds: string[];
}

export interface ResumoPropostas {
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  byBatch: Array<{ batch: string; pending: number; approved: number; rejected: number }>;
}

/** Aceita { PENDING: 3 } ou [{ status: 'PENDING', count: 3 }]; objeto por status conta os pendentes. */
const paraContagem = (v: unknown, chave: string): Record<string, number> => {
  const out: Record<string, number> = {};
  const valor = (n: unknown): number => {
    if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      return valor(o.PENDING ?? o.pending ?? o.count ?? o._count ?? o.total);
    }
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  };
  if (Array.isArray(v)) {
    for (const it of v) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const k = String(o[chave] ?? '');
      if (k) out[k] = (out[k] ?? 0) + valor(o.count ?? o._count ?? o.total ?? o.pending);
    }
  } else if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) out[k] = valor(n);
  }
  return out;
};

export function normalizarResumo(data: unknown): ResumoPropostas | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const lotes = Array.isArray(d.byBatch) ? (d.byBatch as Array<Record<string, unknown>>) : [];
  return {
    byStatus: paraContagem(d.byStatus, 'status'),
    byKind: paraContagem(d.byKind, 'kind'),
    byBatch: lotes
      .filter((l) => l && l.batch != null)
      .map((l) => ({
        batch: String(l.batch),
        pending: Number(l.pending) || 0,
        approved: Number(l.approved) || 0,
        rejected: Number(l.rejected) || 0,
      })),
  };
}

// ---------------------------------------------------------------------------
// Linguagem de gente
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<ProposalKind, string> = {
  SCHEDULE_CREATE: 'Novo horário',
  SCHEDULE_UPDATE: 'Corrigir horário',
  SCHEDULE_DELETE: 'Remover horário',
  SCHEDULE_RECURRENCE: 'Recorrência',
  COMMUNITY_ADDRESS: 'Endereço',
  COMMUNITY_PARISH: 'Paróquia',
  COMMUNITY_CREATE: 'Nova comunidade',
  COMMUNITY_WEBSITE: 'Site da comunidade',
  PARISH_WEBSITE: 'Site da paróquia',
};
const KINDS = Object.keys(KIND_LABEL) as ProposalKind[];
const grupoDoKind = (k: ProposalKind) => (k.startsWith('SCHEDULE') ? 'horario' : k.endsWith('WEBSITE') ? 'site' : 'cadastro');
const ehHorario = (k: ProposalKind) => k === 'SCHEDULE_CREATE' || k === 'SCHEDULE_UPDATE' || k === 'SCHEDULE_RECURRENCE';

const TIPO_LABEL: Record<string, string> = { MASS: 'Missa', CONFESSION: 'Confissão', ADORATION: 'Adoração', ROSARY: 'Terço' };
const TIPOS = Object.keys(TIPO_LABEL);

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_FORM = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
/** Domingo e sábado são masculinos; os dias úteis, femininos ("1ª sexta", "1º domingo"). */
const feminino = (d: number) => d >= 1 && d <= 5;

const FONTE_LABEL: Record<string, string> = {
  'site-paroquia': 'site da paróquia',
  'site-diocese': 'site da diocese',
  'site-comunidade': 'site da comunidade',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  pdf: 'documento (PDF)',
  anuario: 'anuário da diocese',
};

const CONFIANCA_LABEL: Record<string, string> = { HIGH: 'alta', MEDIUM: 'média', LOW: 'baixa', ALTA: 'alta', MEDIA: 'média', BAIXA: 'baixa' };
const confianca = (c: number | string | null) => {
  if (c == null || c === '') return null;
  if (typeof c === 'number' && Number.isFinite(c)) return `${Math.round(c <= 1 ? c * 100 : c)}%`;
  const s = String(c);
  const n = Number(s);
  if (Number.isFinite(n)) return `${Math.round(n <= 1 ? n * 100 : n)}%`;
  return CONFIANCA_LABEL[s.toUpperCase()] ?? s;
};

/** "sexta", "toda sexta", "1ª e 3ª sexta do mês", "último domingo do mês", "todo dia 13". */
function quandoTexto(h: HorarioLike | null | undefined, comToda = false): string {
  if (!h) return '—';
  if (h.recurrence === 'MONTHLY_DAY') return h.dayOfMonth ? `todo dia ${h.dayOfMonth}` : 'dia fixo do mês';
  const d = h.dayOfWeek;
  if (typeof d !== 'number' || d < 0 || d > 6) return '—';
  const semanas = h.recurrence === 'MONTHLY_NTH' ? (h.weeksOfMonth ?? []) : [];
  if (semanas.length) {
    const fem = feminino(d);
    const rotulo = (n: number) => (n === -1 ? (fem ? 'última' : 'último') : `${n}${fem ? 'ª' : 'º'}`);
    const partes = [...semanas].sort((a, b) => (a === -1 ? 9 : a) - (b === -1 ? 9 : b)).map(rotulo);
    const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0];
    return `${lista} ${DIAS[d]} do mês`;
  }
  if (!comToda) return DIAS[d];
  return `${feminino(d) ? 'toda' : 'todo'} ${DIAS[d]}`;
}

/** "Confissão · sexta · 15:00 (até 17h)". */
function horarioTexto(h: HorarioLike | null | undefined): string {
  if (!h) return 'horário não encontrado';
  const partes = [TIPO_LABEL[h.type ?? ''] ?? h.type ?? 'Horário', quandoTexto(h), h.time || '—'];
  return `${partes.join(' · ')}${h.notes ? ` (${h.notes})` : ''}`;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null);

/** Valor atual gravado quando a proposta foi feita: `current` pode vir objeto ou valor cru. */
function atual(p: Proposta, chave: string): string | null {
  if (ehObjeto(p.current)) return texto(p.current[chave]);
  return texto(p.current);
}

/** O horário "de": o que está no cadastro (ou o retrato de quando foi proposto). */
const horarioAtual = (p: Proposta): HorarioLike | null => p.schedule ?? (ehObjeto(p.current) ? (p.current as HorarioLike) : null);

/** Pede edição antes de aprovar: a fonte contradiz o cadastro, mas a regra certa está só no motivo. */
function precisaEditar(p: Proposta): boolean {
  if (p.kind === 'SCHEDULE_DELETE') return false;
  if (p.payload == null) return true;
  return p.kind === 'SCHEDULE_UPDATE' && Object.keys(p.payload).length === 0;
}

interface Mudanca {
  de?: string | null;
  para?: string | null;
  /** "para" é apagar (site). */
  apagar?: boolean;
  /** Frase que substitui o "para" quando a fonte só contradiz. */
  nota?: string | null;
  /** Complemento do título (ex.: o horário cuja recorrência muda). */
  sobre?: string | null;
}

function descrever(p: Proposta): Mudanca {
  const pl = (p.payload ?? {}) as Record<string, unknown>;
  const fonteDiz = p.reason || p.evidenceQuote;
  switch (p.kind) {
    case 'SCHEDULE_CREATE':
      return p.payload ? { para: horarioTexto(pl as HorarioLike) } : { nota: `A fonte não trouxe o horário completo${fonteDiz ? ` — ${fonteDiz}` : ''}.` };
    case 'SCHEDULE_UPDATE': {
      const antes = horarioAtual(p);
      if (precisaEditar(p)) return { de: horarioTexto(antes), nota: fonteDiz ? `a fonte diz: ${fonteDiz}` : 'a fonte contradiz o cadastro.' };
      return { de: horarioTexto(antes), para: horarioTexto({ ...(antes ?? {}), ...(pl as HorarioLike) }) };
    }
    case 'SCHEDULE_DELETE':
      return { de: horarioTexto(horarioAtual(p)), para: 'remover', apagar: true };
    case 'SCHEDULE_RECURRENCE': {
      const antes = horarioAtual(p);
      const sobre = antes ? `${TIPO_LABEL[antes.type ?? ''] ?? 'Horário'} das ${antes.time ?? '—'}` : null;
      if (!p.payload) return { sobre, de: quandoTexto(antes, true), nota: fonteDiz ? `a fonte diz: ${fonteDiz}` : 'a fonte contradiz a recorrência.' };
      return { sobre, de: quandoTexto(antes, true), para: quandoTexto({ ...(antes ?? {}), ...(pl as HorarioLike) }, true) };
    }
    case 'COMMUNITY_ADDRESS':
      return { de: atual(p, 'address') ?? p.community?.address ?? '(sem endereço)', para: texto(pl.address) ?? '—' };
    case 'COMMUNITY_PARISH': {
      const novoId = texto(pl.parishId);
      const nomeNovo =
        texto(pl.parishName) ?? (p.parish && p.parish.id === novoId ? p.parish.name : null) ?? (novoId ? `paróquia ${novoId}` : '—');
      const nomeAtual =
        (ehObjeto(p.current) ? texto(p.current.parishName) ?? texto((p.current.parish as Record<string, unknown> | undefined)?.name) : null) ??
        p.community?.parish?.name ??
        '(sem paróquia)';
      return { de: nomeAtual, para: nomeNovo };
    }
    case 'COMMUNITY_CREATE': {
      const onde = [texto(pl.address), [texto(pl.city), texto(pl.state)].filter(Boolean).join('/')].filter(Boolean).join(' · ');
      return { para: `${texto(pl.name) ?? '(sem nome)'}${onde ? ` · ${onde}` : ''}` };
    }
    case 'COMMUNITY_WEBSITE':
    case 'PARISH_WEBSITE': {
      const site = texto(pl.website);
      const antes = atual(p, 'website') ?? (p.kind === 'PARISH_WEBSITE' ? p.parish?.website : null) ?? '(sem site)';
      return { de: antes, para: site ?? 'apagar', apagar: !site };
    }
    default:
      return {};
  }
}

const hostDe = (url: string) => {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '')).slice(0, 70);
  } catch {
    return url.slice(0, 70);
  }
};
const semChave = (m: Record<string, string>, k: string) => {
  const n = { ...m };
  delete n[k];
  return n;
};
const linkSeguro = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

// ---------------------------------------------------------------------------
// Formulário "Editar e aprovar"
// ---------------------------------------------------------------------------

interface FormHorario {
  type: string;
  recurrence: MassRecurrence;
  dayOfWeek: number;
  weeksOfMonth: number[];
  dayOfMonth: string;
  time: string;
  notes: string;
}

interface FormEdicao {
  horario?: FormHorario;
  address?: string;
  parishId?: string;
  name?: string;
  city?: string;
  state?: string;
  website?: string;
  apagarSite?: boolean;
}

function formInicial(p: Proposta): FormEdicao {
  const pl = (p.payload ?? {}) as Record<string, unknown>;
  if (ehHorario(p.kind)) {
    const base: HorarioLike = p.kind === 'SCHEDULE_CREATE' ? {} : { ...(horarioAtual(p) ?? {}) };
    const m = { ...base, ...(pl as HorarioLike) };
    return {
      horario: {
        type: m.type && TIPOS.includes(m.type) ? m.type : 'MASS',
        recurrence: m.recurrence ?? 'WEEKLY',
        dayOfWeek: typeof m.dayOfWeek === 'number' ? m.dayOfWeek : 0,
        weeksOfMonth: Array.isArray(m.weeksOfMonth) ? m.weeksOfMonth : [],
        dayOfMonth: m.dayOfMonth ? String(m.dayOfMonth) : '',
        time: m.time ?? '',
        notes: m.notes ?? '',
      },
    };
  }
  switch (p.kind) {
    case 'COMMUNITY_ADDRESS':
      return { address: texto(pl.address) ?? atual(p, 'address') ?? p.community?.address ?? '' };
    case 'COMMUNITY_PARISH':
      return { parishId: texto(pl.parishId) ?? '' };
    case 'COMMUNITY_CREATE':
      return { name: texto(pl.name) ?? '', address: texto(pl.address) ?? '', city: texto(pl.city) ?? p.city ?? '', state: texto(pl.state) ?? p.state ?? '' };
    case 'COMMUNITY_WEBSITE':
    case 'PARISH_WEBSITE':
      return { website: texto(pl.website) ?? '', apagarSite: p.payload != null && !texto(pl.website) };
    default:
      return {};
  }
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function montarPayload(p: Proposta, f: FormEdicao): { payload: Record<string, unknown> } | { erro: string } {
  if (ehHorario(p.kind) && f.horario) {
    const h = f.horario;
    const time = h.time.trim().replace(/^(\d):/, '0$1:').replace(/h$/i, ':00');
    if (p.kind !== 'SCHEDULE_RECURRENCE' && !HORA.test(time)) return { erro: 'Informe a hora no formato HH:MM (ex.: 07:30).' };
    const dia = Number(h.dayOfMonth);
    if (h.recurrence === 'MONTHLY_DAY' && !(Number.isInteger(dia) && dia >= 1 && dia <= 31)) return { erro: 'Informe o dia do mês (1 a 31).' };
    if (h.recurrence === 'MONTHLY_NTH' && h.weeksOfMonth.length === 0) return { erro: 'Marque ao menos uma semana do mês (1ª, 2ª... ou última).' };
    const recorrencia = {
      recurrence: h.recurrence,
      dayOfWeek: h.recurrence === 'MONTHLY_DAY' ? null : h.dayOfWeek,
      weeksOfMonth: h.recurrence === 'MONTHLY_NTH' ? [...h.weeksOfMonth].sort((a, b) => (a === -1 ? 9 : a) - (b === -1 ? 9 : b)) : [],
      dayOfMonth: h.recurrence === 'MONTHLY_DAY' ? dia : null,
    };
    if (p.kind === 'SCHEDULE_RECURRENCE') return { payload: recorrencia };
    const completo = { type: h.type, time, notes: h.notes.trim() || null, ...recorrencia };
    if (p.kind === 'SCHEDULE_CREATE') return { payload: completo };

    // SCHEDULE_UPDATE: só o que muda em relação ao cadastro (a recorrência vai inteira, para ficar coerente)
    const antes = horarioAtual(p);
    if (!antes) return { payload: completo };
    const mudou: Record<string, unknown> = {};
    if (completo.type !== antes.type) mudou.type = completo.type;
    if (completo.time !== antes.time) mudou.time = completo.time;
    if ((completo.notes ?? null) !== (antes.notes ?? null)) mudou.notes = completo.notes;
    const semanasAntes = JSON.stringify([...(antes.weeksOfMonth ?? [])].sort());
    const recorrenciaMudou =
      recorrencia.recurrence !== (antes.recurrence ?? 'WEEKLY') ||
      (recorrencia.dayOfWeek ?? null) !== (antes.dayOfWeek ?? null) ||
      (recorrencia.dayOfMonth ?? null) !== (antes.dayOfMonth ?? null) ||
      JSON.stringify([...recorrencia.weeksOfMonth].sort()) !== semanasAntes;
    if (recorrenciaMudou) Object.assign(mudou, recorrencia);
    if (Object.keys(mudou).length === 0) return { erro: 'Nada mudou em relação ao horário cadastrado. Se o cadastro está certo, rejeite a proposta.' };
    return { payload: mudou };
  }
  switch (p.kind) {
    case 'COMMUNITY_ADDRESS':
      return f.address?.trim() ? { payload: { address: f.address.trim() } } : { erro: 'Informe o endereço.' };
    case 'COMMUNITY_PARISH':
      return f.parishId?.trim() ? { payload: { parishId: f.parishId.trim() } } : { erro: 'Informe o identificador da paróquia.' };
    case 'COMMUNITY_CREATE': {
      if (!f.name?.trim()) return { erro: 'Informe o nome da comunidade.' };
      if (!f.city?.trim() || !f.state) return { erro: 'Informe a cidade e a UF.' };
      return { payload: { name: f.name.trim(), address: f.address?.trim() || null, city: f.city.trim(), state: f.state } };
    }
    case 'COMMUNITY_WEBSITE':
    case 'PARISH_WEBSITE': {
      if (f.apagarSite) return { payload: { website: null } };
      let site = (f.website ?? '').trim();
      if (!site) return { erro: 'Informe o site ou marque "apagar o site".' };
      if (!/^https?:\/\//i.test(site)) site = `https://${site}`;
      if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(site)) return { erro: 'Endereço de site inválido.' };
      return { payload: { website: site } };
    }
    default:
      return { erro: 'Esta proposta não tem o que editar.' };
  }
}

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------

const CENTRO_BRASIL: [number, number] = [-14.8, -52.5];

/** Recorte visível no formato do contrato: minLng,minLat,maxLng,maxLat. */
const ObservadorDeRecorte: React.FC<{ onChange: (bbox: string) => void }> = ({ onChange }) => {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onChange(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`);
    },
  });
  useEffect(() => {
    const b = map.getBounds();
    onChange(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const IrPara: React.FC<{ alvo: { lat: number; lng: number; n: number } | null }> = ({ alvo }) => {
  const map = useMap();
  useEffect(() => {
    if (alvo) map.setView([alvo.lat, alvo.lng], Math.max(map.getZoom(), 14));
  }, [alvo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

const icones = new Map<string, L.DivIcon>();
const iconeContador = (count: number, on: boolean) => {
  const chave = `${count}|${on}`;
  let ic = icones.get(chave);
  if (!ic) {
    const rotulo = count > 99 ? '99+' : String(Math.max(count, 0));
    const tam = on ? 34 : count > 9 ? 30 : 26;
    ic = L.divIcon({
      className: `dp-pino${on ? ' on' : ''}`,
      html: `<span>${rotulo}</span>`,
      iconSize: [tam, tam],
      iconAnchor: [tam / 2, tam / 2],
    });
    icones.set(chave, ic);
  }
  return ic;
};

// ---------------------------------------------------------------------------
// Cartão da proposta
// ---------------------------------------------------------------------------

interface CartaoProps {
  p: Proposta;
  selecionada: boolean;
  ocupado: boolean;
  erro?: string;
  mostrarComunidade: boolean;
  onToggle: () => void;
  onAprovar: () => void;
  onEditar: () => void;
  onRejeitar: (nota: string) => void;
  onAbrirComunidade: () => void;
}

const CartaoProposta: React.FC<CartaoProps> = ({ p, selecionada, ocupado, erro, mostrarComunidade, onToggle, onAprovar, onEditar, onRejeitar, onAbrirComunidade }) => {
  const [rejeitando, setRejeitando] = useState(false);
  const [nota, setNota] = useState('');
  const d = descrever(p);
  const editar = precisaEditar(p);
  const pendente = p.status === 'PENDING';
  const link = linkSeguro(p.evidenceUrl);
  const conf = confianca(p.confidence);
  const cidade = [p.city, p.state].filter(Boolean).join('/');
  const motivoNaNota = !!d.nota && !!p.reason && d.nota.includes(p.reason);

  let alvo: React.ReactNode = null;
  if (p.kind === 'PARISH_WEBSITE') alvo = <span className="dp-alvo-nome">{p.parish?.name ?? 'Paróquia'}</span>;
  else if (p.kind === 'COMMUNITY_CREATE') alvo = <span className="dp-alvo-nome">A criar{p.parish ? ` · ${p.parish.name}` : ''}</span>;
  else if (p.community)
    alvo = mostrarComunidade ? (
      <button type="button" className="dp-alvo-nome dp-alvo-link" onClick={onAbrirComunidade} title="Ver todas as propostas desta comunidade">
        {p.community.name}
      </button>
    ) : (
      <span className="dp-alvo-nome">{p.community.name}</span>
    );

  return (
    <article className={`dp-cartao${selecionada ? ' on' : ''}${pendente ? '' : ' dp-cartao-feita'}`}>
      <header className="dp-cartao-topo">
        {pendente && (
          <input
            type="checkbox"
            className="dp-check"
            checked={selecionada}
            onChange={onToggle}
            aria-label={`Selecionar proposta: ${KIND_LABEL[p.kind]}`}
          />
        )}
        <div className="dp-cartao-titulo">
          <span className={`dp-kind dp-kind-${grupoDoKind(p.kind)}`}>{KIND_LABEL[p.kind] ?? p.kind}</span>
          {alvo}
          {(cidade || (p.community?.parish && p.kind !== 'COMMUNITY_PARISH')) && (
            <small className="dp-alvo-sub">
              {[cidade, p.kind !== 'COMMUNITY_PARISH' && p.kind !== 'PARISH_WEBSITE' ? p.community?.parish?.name : null].filter(Boolean).join(' · ')}
            </small>
          )}
        </div>
      </header>

      <div className="dp-mudanca">
        {d.sobre && <small className="dp-sobre">{d.sobre}</small>}
        {d.de != null && (
          <p className="dp-linha">
            <span className="dp-rotulo">{pendente ? 'Hoje' : 'Antes'}</span>
            <span className="dp-de">{d.de}</span>
          </p>
        )}
        {d.para != null && (
          <p className="dp-linha">
            {d.de != null && <span className="dp-rotulo">→</span>}
            <span className={`dp-para${d.apagar ? ' dp-apagar' : ''}`}>{d.para}</span>
          </p>
        )}
        {d.nota && (
          <p className="dp-linha">
            {d.de != null && <span className="dp-rotulo">—</span>}
            <span className="dp-nota">{d.nota}</span>
          </p>
        )}
      </div>

      {(p.evidenceQuote || link) && (
        <div className="dp-evidencia">
          {p.evidenceQuote && <blockquote>“{p.evidenceQuote}”</blockquote>}
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer">
              {hostDe(link)} ↗
            </a>
          ) : (
            p.evidenceUrl && <small>{p.evidenceUrl}</small>
          )}
        </div>
      )}

      <p className="dp-meta">
        {conf && <span>Confiança <strong>{conf}</strong></span>}
        {p.sourceKind && <span>Fonte: {FONTE_LABEL[p.sourceKind] ?? p.sourceKind}</span>}
        {p.batch && <span>Lote: {p.batch}</span>}
        <span title={dataBR(p.createdAt)}>{haQuanto(p.createdAt)}</span>
      </p>
      {p.reason && !motivoNaNota && (
        <p className="dp-motivo">
          <strong>Motivo:</strong> {p.reason}
        </p>
      )}

      {!pendente && (
        <p className={`dp-revisada dp-revisada-${p.status === 'APPROVED' ? 'ok' : 'nao'}`}>
          {p.status === 'APPROVED' ? 'Aprovada' : 'Rejeitada'}
          {p.reviewedAt ? ` em ${dataBR(p.reviewedAt)}` : ''}
          {p.reviewNote ? ` — ${p.reviewNote}` : ''}
        </p>
      )}

      {erro && <p className="pf-erro dp-erro-cartao">{erro}</p>}

      {pendente && !rejeitando && (
        <div className="pf-acoes dp-acoes">
          {editar ? (
            <>
              <span className="dp-precisa">Precisa editar: a regra certa não veio pronta.</span>
              <button type="button" className="pf-btn pf-btn-mini pf-btn-primario" onClick={onEditar} disabled={ocupado}>
                Editar e aprovar
              </button>
            </>
          ) : (
            <>
              <button type="button" className="pf-btn pf-btn-mini pf-btn-ok" onClick={onAprovar} disabled={ocupado}>
                {ocupado ? 'Gravando…' : 'Aprovar'}
              </button>
              {p.kind !== 'SCHEDULE_DELETE' && (
                <button type="button" className="pf-btn pf-btn-mini" onClick={onEditar} disabled={ocupado}>
                  Editar e aprovar
                </button>
              )}
            </>
          )}
          <button type="button" className="pf-btn pf-btn-mini pf-btn-perigo" onClick={() => setRejeitando(true)} disabled={ocupado}>
            Rejeitar
          </button>
        </div>
      )}
      {pendente && rejeitando && (
        <form
          className="dp-rejeitar"
          onSubmit={(e) => {
            e.preventDefault();
            onRejeitar(nota.trim());
          }}
        >
          <label className="pf-campo">
            Observação (opcional)
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: a fonte é de 2019; o horário atual está certo" autoFocus />
          </label>
          <div className="pf-acoes">
            <button type="submit" className="pf-btn pf-btn-mini pf-btn-perigo-cheio" disabled={ocupado}>
              {ocupado ? 'Gravando…' : 'Confirmar rejeição'}
            </button>
            <button type="button" className="pf-btn pf-btn-mini" onClick={() => setRejeitando(false)} disabled={ocupado}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </article>
  );
};

// ---------------------------------------------------------------------------
// Aba
// ---------------------------------------------------------------------------

const TAMANHO = 50;
type Aviso = { tipo: 'ok' | 'erro'; texto: string; detalhes?: string[] } | null;

interface Props {
  resumo: ResumoPropostas | null;
  recarregarResumo: () => void;
}

const TerritoryProposals: React.FC<Props> = ({ resumo, recarregarResumo }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const comunidade = searchParams.get('community') ?? '';

  const [status, setStatus] = useState<ProposalStatus>('PENDING');
  const [kind, setKind] = useState('');
  const [lote, setLote] = useState('');
  const [uf, setUf] = useState('');
  const [cidade, setCidade] = useState('');
  const [cidadeAplicada, setCidadeAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [versao, setVersao] = useState(0);

  const [itens, setItens] = useState<Proposta[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);

  const [bbox, setBbox] = useState('');
  const [pontos, setPontos] = useState<Ponto[]>([]);
  const [erroMapa, setErroMapa] = useState('');
  const [alvo, setAlvo] = useState<{ lat: number; lng: number; n: number } | null>(null);
  const [comunidadeInfo, setComunidadeInfo] = useState<{ id: string; name: string; parish?: string | null; lat?: number | null; lng?: number | null } | null>(null);

  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [errosCartao, setErrosCartao] = useState<Record<string, string>>({});
  const [notaLote, setNotaLote] = useState('');

  const [editando, setEditando] = useState<{ p: Proposta; form: FormEdicao; nota: string; erro: string } | null>(null);

  const pedidoLista = useRef(0);
  const pedidoMapa = useRef(0);
  const voouPara = useRef('');

  const mudarFiltro = (f: () => void) => {
    f();
    setPagina(1);
    setAviso(null);
  };

  const abrirComunidade = useCallback(
    (id: string | null) => {
      setSearchParams(
        (atualParams) => {
          const n = new URLSearchParams(atualParams);
          n.set('proposals', '1');
          if (id) n.set('community', id);
          else n.delete('community');
          return n;
        },
        { replace: true },
      );
      setPagina(1);
      setSelecionadas(new Set());
      if (!id) setComunidadeInfo(null);
    },
    [setSearchParams],
  );

  // Lista
  useEffect(() => {
    const meu = ++pedidoLista.current;
    setCarregando(true);
    setErro('');
    const params: Record<string, string> = { status, page: String(pagina), pageSize: String(TAMANHO) };
    if (comunidade) params.communityId = comunidade;
    else {
      if (kind) params.kind = kind;
      if (lote) params.batch = lote;
      if (uf) params.state = uf;
      if (cidadeAplicada) params.city = cidadeAplicada;
    }
    api
      .get('/platform/data-proposals', { params })
      .then(({ data }) => {
        if (meu !== pedidoLista.current) return;
        const lista: Proposta[] = Array.isArray(data?.items) ? data.items : [];
        const tot = Number(data?.total) || 0;
        // A última página esvaziou depois de uma ação: volta uma
        if (!lista.length && pagina > 1 && tot > 0) {
          setPagina(Math.max(1, Math.ceil(tot / TAMANHO)));
          return;
        }
        setItens(lista);
        setTotal(tot);
        setSelecionadas((sel) => new Set([...sel].filter((id) => lista.some((x) => x.id === id && x.status === 'PENDING'))));
      })
      .catch((e) => {
        if (meu === pedidoLista.current) setErro(mensagemDeErro(e, 'Não foi possível carregar as propostas.'));
      })
      .finally(() => {
        if (meu === pedidoLista.current) setCarregando(false);
      });
  }, [status, pagina, comunidade, kind, lote, uf, cidadeAplicada, versao]);

  // Comunidade escolhida (pino, lista ou endereço): cabeçalho e voo até ela
  useEffect(() => {
    if (!comunidade) return;
    const c = itens.find((x) => x.communityId === comunidade)?.community;
    const ponto = pontos.find((x) => x.communityId === comunidade);
    if (c || ponto) {
      setComunidadeInfo((info) => ({
        id: comunidade,
        name: c?.name ?? ponto?.name ?? info?.name ?? 'Comunidade',
        parish: c?.parish?.name ?? info?.parish ?? null,
        lat: c?.latitude ?? ponto?.latitude ?? info?.lat ?? null,
        lng: c?.longitude ?? ponto?.longitude ?? info?.lng ?? null,
      }));
    }
    const lat = c?.latitude ?? ponto?.latitude;
    const lng = c?.longitude ?? ponto?.longitude;
    if (voouPara.current !== comunidade && typeof lat === 'number' && typeof lng === 'number') {
      voouPara.current = comunidade;
      setAlvo({ lat, lng, n: Date.now() });
    }
  }, [comunidade, itens, pontos]);

  // Pinos do recorte
  useEffect(() => {
    if (!bbox) return;
    const meu = ++pedidoMapa.current;
    const params: Record<string, string> = { bbox, status };
    if (kind) params.kind = kind;
    if (lote) params.batch = lote;
    api
      .get('/platform/data-proposals/map', { params })
      .then(({ data }) => {
        if (meu !== pedidoMapa.current) return;
        const lista: Ponto[] = Array.isArray(data?.points) ? data.points : [];
        setPontos(lista.filter((x) => Number.isFinite(x?.latitude) && Number.isFinite(x?.longitude)));
        setErroMapa('');
      })
      .catch((e) => {
        if (meu === pedidoMapa.current) setErroMapa(mensagemDeErro(e, 'Não foi possível carregar os pinos das propostas.'));
      });
  }, [bbox, status, kind, lote, versao]);

  const depoisDaAcao = () => {
    setVersao((v) => v + 1);
    recarregarResumo();
  };

  const aprovar = async (p: Proposta, payload?: Record<string, unknown>, note?: string): Promise<string | null> => {
    setOcupado(p.id);
    setAviso(null);
    setErrosCartao((m) => semChave(m, p.id));
    try {
      const corpo: Record<string, unknown> = {};
      if (note) corpo.note = note;
      if (payload) corpo.payload = payload;
      const { data } = await api.post(`/platform/data-proposals/${p.id}/approve`, corpo);
      setAviso({ tipo: 'ok', texto: typeof data?.message === 'string' && data.message ? data.message : `${KIND_LABEL[p.kind]}: aprovada.` });
      depoisDaAcao();
      return null;
    } catch (e) {
      const msg = mensagemDeErro(e, 'Não foi possível aprovar a proposta.');
      setErrosCartao((m) => ({ ...m, [p.id]: msg }));
      return msg;
    } finally {
      setOcupado(null);
    }
  };

  const rejeitar = async (p: Proposta, note: string) => {
    setOcupado(p.id);
    setAviso(null);
    setErrosCartao((m) => semChave(m, p.id));
    try {
      await api.post(`/platform/data-proposals/${p.id}/reject`, note ? { note } : {});
      setAviso({ tipo: 'ok', texto: `${KIND_LABEL[p.kind]}: rejeitada.` });
      depoisDaAcao();
    } catch (e) {
      setErrosCartao((m) => ({ ...m, [p.id]: mensagemDeErro(e, 'Não foi possível rejeitar a proposta.') }));
    } finally {
      setOcupado(null);
    }
  };

  const emLote = async (acao: 'approve' | 'reject') => {
    let ids = [...selecionadas];
    let fora = 0;
    if (acao === 'approve') {
      const prontas = ids.filter((id) => {
        const p = itens.find((x) => x.id === id);
        return p && !precisaEditar(p);
      });
      fora = ids.length - prontas.length;
      ids = prontas;
    }
    if (!ids.length) {
      setAviso({ tipo: 'erro', texto: 'As selecionadas precisam de edição antes de aprovar — use "Editar e aprovar" em cada uma.' });
      return;
    }
    ids = ids.slice(0, 200);
    setOcupado('lote');
    setAviso(null);
    try {
      const corpo: Record<string, unknown> = { ids, action: acao };
      if (notaLote.trim()) corpo.note = notaLote.trim();
      const { data } = await api.post('/platform/data-proposals/bulk', corpo);
      const resultados: Array<{ id: string; ok: boolean; message?: string }> = Array.isArray(data?.results) ? data.results : [];
      const ok = resultados.filter((r) => r.ok).length;
      const falhas = resultados.filter((r) => !r.ok);
      const nomeDe = (id: string) => {
        const p = itens.find((x) => x.id === id);
        return p ? `${KIND_LABEL[p.kind]} — ${p.community?.name ?? p.parish?.name ?? p.city ?? id}` : id;
      };
      setErrosCartao((m) => {
        const n = { ...m };
        for (const r of resultados) {
          if (r.ok) delete n[r.id];
          else n[r.id] = r.message || 'Não foi possível concluir.';
        }
        return n;
      });
      const verbo = acao === 'approve' ? 'aprovada' : 'rejeitada';
      setAviso({
        tipo: falhas.length ? 'erro' : 'ok',
        texto:
          `${num(ok)} ${verbo}${ok === 1 ? '' : 's'}` +
          (falhas.length ? `, ${num(falhas.length)} com erro` : '') +
          (fora ? ` · ${num(fora)} precisa${fora === 1 ? '' : 'm'} de edição e ficou${fora === 1 ? '' : 'aram'} de fora` : '') +
          '.',
        detalhes: falhas.map((f) => `${nomeDe(f.id)}: ${f.message || 'erro'}`),
      });
      setSelecionadas(new Set(falhas.map((f) => f.id)));
      setNotaLote('');
      depoisDaAcao();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDeErro(e, 'Não foi possível concluir a ação em lote.') });
    } finally {
      setOcupado(null);
    }
  };

  const salvarEdicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    const r = montarPayload(editando.p, editando.form);
    if ('erro' in r) {
      setEditando({ ...editando, erro: r.erro });
      return;
    }
    const msg = await aprovar(editando.p, r.payload, editando.nota.trim() || undefined);
    if (msg) setEditando((ed) => (ed ? { ...ed, erro: msg } : ed));
    else setEditando(null);
  };

  const pendentes = itens.filter((p) => p.status === 'PENDING');
  const todasMarcadas = pendentes.length > 0 && pendentes.every((p) => selecionadas.has(p.id));
  const paginas = Math.max(1, Math.ceil(total / TAMANHO));
  const nPendentes = resumo?.byStatus?.PENDING;
  const lotes = useMemo(() => [...(resumo?.byBatch ?? [])].sort((a, b) => b.pending - a.pending || a.batch.localeCompare(b.batch)), [resumo]);
  const filtroAtivo = !!(kind || lote || uf || cidadeAplicada);
  const comunidadeFora = comunidadeInfo && comunidadeInfo.lat != null && comunidadeInfo.lng != null && !pontos.some((x) => x.communityId === comunidadeInfo.id);

  const setForm = (mud: Partial<FormEdicao>) => setEditando((ed) => (ed ? { ...ed, form: { ...ed.form, ...mud }, erro: '' } : ed));
  const setHorario = (mud: Partial<FormHorario>) =>
    setEditando((ed) => (ed && ed.form.horario ? { ...ed, form: { ...ed.form, horario: { ...ed.form.horario, ...mud } }, erro: '' } : ed));

  return (
    <div className="platform-page dp">
      <p className="dp-explica">
        Horários e correções de cadastro que os agentes acharam em <strong>fonte oficial</strong> mas que não entraram sozinhos. Leia o trecho,
        abra o link se precisar e decida: <strong>Aprovar</strong> grava no cadastro; <strong>Editar e aprovar</strong> ajusta antes de gravar;{' '}
        <strong>Rejeitar</strong> descarta.
      </p>

      <section className="pf-filtros dp-filtros">
        <div className="pf-chips">
          {([
            ['PENDING', `Pendentes${nPendentes != null ? ` (${num(nPendentes)})` : ''}`],
            ['APPROVED', 'Aprovadas'],
            ['REJECTED', 'Rejeitadas'],
          ] as Array<[ProposalStatus, string]>).map(([valor, rotulo]) => (
            <button key={valor} type="button" className={`pf-chip${status === valor ? ' on' : ''}`} onClick={() => mudarFiltro(() => setStatus(valor))}>
              {rotulo}
            </button>
          ))}
        </div>
        <select value={kind} onChange={(e) => mudarFiltro(() => setKind(e.target.value))} aria-label="Tipo de proposta">
          <option value="">Todos os tipos</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
              {resumo?.byKind?.[k] != null ? ` (${num(resumo.byKind[k])})` : ''}
            </option>
          ))}
        </select>
        <select value={lote} onChange={(e) => mudarFiltro(() => setLote(e.target.value))} aria-label="Lote" className="pf-select-largo">
          <option value="">Todos os lotes</option>
          {lotes.map((l) => (
            <option key={l.batch} value={l.batch}>
              {l.batch} — {num(l.pending)} pendente{l.pending === 1 ? '' : 's'}
            </option>
          ))}
        </select>
        <select value={uf} onChange={(e) => mudarFiltro(() => setUf(e.target.value))} aria-label="Estado">
          <option value="">Todas as UFs</option>
          {UFS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <form
          className="pf-busca dp-cidade"
          onSubmit={(e) => {
            e.preventDefault();
            mudarFiltro(() => setCidadeAplicada(cidade.trim()));
          }}
        >
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Cidade" aria-label="Cidade" />
          <button type="submit">Filtrar</button>
        </form>
        {filtroAtivo && (
          <button
            type="button"
            className="pf-link"
            onClick={() =>
              mudarFiltro(() => {
                setKind('');
                setLote('');
                setUf('');
                setCidade('');
                setCidadeAplicada('');
              })
            }
          >
            limpar filtros
          </button>
        )}
      </section>

      {erro && <p className="pf-erro">{erro}</p>}

      <div className="dp-corpo">
        <aside className="dp-lista">
          {comunidade && (
            <div className="dp-comunidade">
              <div>
                <small>Propostas da comunidade</small>
                <strong>{comunidadeInfo?.name ?? 'Comunidade'}</strong>
                {comunidadeInfo?.parish && <small>{comunidadeInfo.parish}</small>}
                {filtroAtivo && <small className="dp-comunidade-obs">Tipo, lote, UF e cidade não se aplicam aqui: aparecem todas as desta comunidade.</small>}
              </div>
              <button type="button" className="pf-btn pf-btn-mini" onClick={() => abrirComunidade(null)}>
                ← Todas
              </button>
            </div>
          )}

          <div className="dp-lista-topo">
            {pendentes.length > 0 && (
              <label className="dp-marcar-todas">
                <input
                  type="checkbox"
                  checked={todasMarcadas}
                  onChange={() => setSelecionadas(todasMarcadas ? new Set() : new Set(pendentes.map((p) => p.id)))}
                />
                página
              </label>
            )}
            <span>
              <strong>{num(total)}</strong> proposta{total === 1 ? '' : 's'}
              {paginas > 1 && ` · página ${pagina} de ${paginas}`}
              {carregando && <span className="pf-mudo"> · carregando…</span>}
            </span>
          </div>

          <div className="dp-fixo">
          {selecionadas.size > 0 && (
            <div className="dp-lote">
              <strong>
                {num(selecionadas.size)} selecionada{selecionadas.size === 1 ? '' : 's'}
              </strong>
              <input value={notaLote} onChange={(e) => setNotaLote(e.target.value)} placeholder="Observação (opcional)" aria-label="Observação do lote" />
              <div className="pf-acoes">
                <button type="button" className="pf-btn pf-btn-mini pf-btn-ok" onClick={() => void emLote('approve')} disabled={!!ocupado}>
                  {ocupado === 'lote' ? 'Gravando…' : 'Aprovar selecionadas'}
                </button>
                <button type="button" className="pf-btn pf-btn-mini pf-btn-perigo" onClick={() => void emLote('reject')} disabled={!!ocupado}>
                  Rejeitar selecionadas
                </button>
                <button type="button" className="pf-link" onClick={() => setSelecionadas(new Set())}>
                  limpar
                </button>
              </div>
            </div>
          )}

          {aviso && (
            <div className={aviso.tipo === 'ok' ? 'dp-aviso-ok' : 'pf-erro'} role="status">
              {aviso.texto}
              {aviso.detalhes && aviso.detalhes.length > 0 && (
                <ul>
                  {aviso.detalhes.slice(0, 8).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
              <button type="button" className="dp-aviso-fechar" onClick={() => setAviso(null)} aria-label="Fechar aviso">
                ×
              </button>
            </div>
          )}
          </div>

          {!carregando && !erro && itens.length === 0 && (
            <p className="pf-vazio">
              {status === 'PENDING'
                ? comunidade
                  ? 'Nenhuma proposta pendente nesta comunidade.'
                  : 'Nenhuma proposta pendente com esse filtro.'
                : 'Nada por aqui com esse filtro.'}
            </p>
          )}

          <div className="dp-cartoes">
            {itens.map((p) => (
              <CartaoProposta
                key={p.id}
                p={p}
                selecionada={selecionadas.has(p.id)}
                ocupado={ocupado === p.id || ocupado === 'lote'}
                erro={errosCartao[p.id]}
                mostrarComunidade={!comunidade}
                onToggle={() =>
                  setSelecionadas((sel) => {
                    const n = new Set(sel);
                    if (n.has(p.id)) n.delete(p.id);
                    else n.add(p.id);
                    return n;
                  })
                }
                onAprovar={() => void aprovar(p)}
                onEditar={() => setEditando({ p, form: formInicial(p), nota: '', erro: '' })}
                onRejeitar={(nota) => void rejeitar(p, nota)}
                onAbrirComunidade={() => {
                  if (!p.communityId) return;
                  voouPara.current = '';
                  setComunidadeInfo({
                    id: p.communityId,
                    name: p.community?.name ?? 'Comunidade',
                    parish: p.community?.parish?.name ?? null,
                    lat: p.community?.latitude ?? null,
                    lng: p.community?.longitude ?? null,
                  });
                  abrirComunidade(p.communityId);
                }}
              />
            ))}
          </div>

          {paginas > 1 && (
            <div className="pf-paginacao">
              <button type="button" className="pf-btn pf-btn-mini" disabled={pagina <= 1 || carregando} onClick={() => setPagina((n) => n - 1)}>
                ← Anterior
              </button>
              <span className="pf-mudo">
                {pagina} de {paginas}
              </span>
              <button type="button" className="pf-btn pf-btn-mini" disabled={pagina >= paginas || carregando} onClick={() => setPagina((n) => n + 1)}>
                Próxima →
              </button>
            </div>
          )}
        </aside>

        <div className="dp-mapa">
          <MapContainer center={CENTRO_BRASIL} zoom={4} style={{ height: '100%', width: '100%' }}>
            <BaseMapLayers />
            <ObservadorDeRecorte onChange={setBbox} />
            <IrPara alvo={alvo} />
            {pontos.map((pt) => (
              <Marker
                key={pt.communityId}
                position={[pt.latitude, pt.longitude]}
                icon={iconeContador(pt.count, pt.communityId === comunidade)}
                zIndexOffset={pt.communityId === comunidade ? 1000 : 0}
                eventHandlers={{
                  click: () => {
                    voouPara.current = pt.communityId;
                    setComunidadeInfo({ id: pt.communityId, name: pt.name, lat: pt.latitude, lng: pt.longitude });
                    abrirComunidade(pt.communityId);
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -14]}>
                  <strong>{pt.name}</strong>
                  <br />
                  {num(pt.count)} proposta{pt.count === 1 ? '' : 's'}
                  {pt.kinds?.length ? `: ${pt.kinds.map((k) => KIND_LABEL[k as ProposalKind] ?? k).join(', ')}` : ''}
                </Tooltip>
              </Marker>
            ))}
            {comunidadeFora && comunidadeInfo && (
              <Marker position={[comunidadeInfo.lat as number, comunidadeInfo.lng as number]} icon={iconeContador(total, true)} zIndexOffset={1000}>
                <Tooltip direction="top" offset={[0, -16]}>
                  <strong>{comunidadeInfo.name}</strong>
                </Tooltip>
              </Marker>
            )}
          </MapContainer>
          <div className="dp-mapa-legenda">
            {erroMapa ? (
              <span className="dp-mapa-erro">{erroMapa}</span>
            ) : (
              <>
                {num(pontos.length)} comunidade{pontos.length === 1 ? '' : 's'} com proposta neste recorte · o número é a quantidade
                {(uf || cidadeAplicada) && ' · UF e cidade filtram só a lista'}
              </>
            )}
          </div>
        </div>
      </div>

      {editando && (
        <div className="module-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && ocupado !== editando.p.id && setEditando(null)}>
          <form className="module-modal dp-modal" onSubmit={salvarEdicao}>
            <h2>Editar e aprovar — {KIND_LABEL[editando.p.kind]}</h2>
            <p className="dp-modal-alvo">
              {editando.p.community?.name ?? editando.p.parish?.name ?? 'Nova comunidade'}
              {editando.p.city ? ` · ${editando.p.city}/${editando.p.state ?? ''}` : ''}
            </p>
            {(editando.p.evidenceQuote || editando.p.reason) && (
              <div className="dp-evidencia dp-evidencia-modal">
                {editando.p.evidenceQuote && <blockquote>“{editando.p.evidenceQuote}”</blockquote>}
                {editando.p.reason && (
                  <small>
                    <strong>Motivo:</strong> {editando.p.reason}
                  </small>
                )}
                {linkSeguro(editando.p.evidenceUrl) && (
                  <a href={linkSeguro(editando.p.evidenceUrl) as string} target="_blank" rel="noopener noreferrer">
                    {hostDe(editando.p.evidenceUrl as string)} ↗
                  </a>
                )}
              </div>
            )}
            {(editando.p.kind === 'SCHEDULE_UPDATE' || editando.p.kind === 'SCHEDULE_RECURRENCE') && (
              <p className="dp-modal-hoje">
                <strong>Hoje no cadastro:</strong> {horarioTexto(horarioAtual(editando.p))}
                {horarioAtual(editando.p)?.recurrence === 'WEEKLY' ? ' (toda semana)' : ''}
              </p>
            )}

            {editando.form.horario && (
              <>
                {editando.p.kind !== 'SCHEDULE_RECURRENCE' && (
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="dp-tipo">Tipo</label>
                      <select id="dp-tipo" value={editando.form.horario.type} onChange={(e) => setHorario({ type: e.target.value })}>
                        {TIPOS.map((t) => (
                          <option key={t} value={t}>
                            {TIPO_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="dp-hora">Hora</label>
                      <input id="dp-hora" type="time" value={editando.form.horario.time} onChange={(e) => setHorario({ time: e.target.value })} required />
                    </div>
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="dp-rec">Com que frequência</label>
                  <select
                    id="dp-rec"
                    value={editando.form.horario.recurrence}
                    onChange={(e) => setHorario({ recurrence: e.target.value as MassRecurrence })}
                  >
                    <option value="WEEKLY">Toda semana</option>
                    <option value="MONTHLY_NTH">Na Nª semana do mês (ex.: 1ª sexta, último domingo)</option>
                    <option value="MONTHLY_DAY">Em data fixa do mês (ex.: todo dia 13)</option>
                  </select>
                </div>
                {editando.form.horario.recurrence === 'MONTHLY_DAY' ? (
                  <div className="form-group">
                    <label htmlFor="dp-dia-mes">Dia do mês</label>
                    <input
                      id="dp-dia-mes"
                      type="number"
                      min={1}
                      max={31}
                      value={editando.form.horario.dayOfMonth}
                      onChange={(e) => setHorario({ dayOfMonth: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label htmlFor="dp-dia">Dia da semana</label>
                    <select id="dp-dia" value={editando.form.horario.dayOfWeek} onChange={(e) => setHorario({ dayOfWeek: Number(e.target.value) })}>
                      {DIAS_FORM.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {editando.form.horario.recurrence === 'MONTHLY_NTH' && (
                  <div className="form-group">
                    <label>Quais semanas do mês</label>
                    <div className="dp-semanas">
                      {SEMANAS_DO_MES.map(({ valor, rotulo }) => {
                        const h = editando.form.horario as FormHorario;
                        const marcada = h.weeksOfMonth.includes(valor);
                        return (
                          <label key={valor} className={`dp-semana${marcada ? ' on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() =>
                                setHorario({ weeksOfMonth: marcada ? h.weeksOfMonth.filter((n) => n !== valor) : [...h.weeksOfMonth, valor] })
                              }
                            />
                            {rotulo}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                {editando.p.kind !== 'SCHEDULE_RECURRENCE' && (
                  <div className="form-group">
                    <label htmlFor="dp-notas">Observação do horário</label>
                    <input
                      id="dp-notas"
                      value={editando.form.horario.notes}
                      onChange={(e) => setHorario({ notes: e.target.value })}
                      placeholder="Ex.: até 17h; com bênção do Santíssimo"
                    />
                  </div>
                )}
                <p className="dp-modal-previa">
                  Fica assim:{' '}
                  <strong>
                    {editando.p.kind === 'SCHEDULE_RECURRENCE'
                      ? quandoTexto(
                          {
                            recurrence: editando.form.horario.recurrence,
                            dayOfWeek: editando.form.horario.dayOfWeek,
                            weeksOfMonth: editando.form.horario.weeksOfMonth,
                            dayOfMonth: Number(editando.form.horario.dayOfMonth) || null,
                          },
                          true,
                        )
                      : horarioTexto({
                          ...editando.form.horario,
                          dayOfMonth: Number(editando.form.horario.dayOfMonth) || null,
                        })}
                  </strong>
                </p>
              </>
            )}

            {editando.p.kind === 'COMMUNITY_ADDRESS' && (
              <div className="form-group">
                <label htmlFor="dp-end">Endereço</label>
                <textarea id="dp-end" rows={2} value={editando.form.address ?? ''} onChange={(e) => setForm({ address: e.target.value })} />
              </div>
            )}

            {editando.p.kind === 'COMMUNITY_PARISH' && (
              <div className="form-group">
                <label htmlFor="dp-par">Identificador da paróquia</label>
                <input id="dp-par" value={editando.form.parishId ?? ''} onChange={(e) => setForm({ parishId: e.target.value })} />
                <small className="pf-mudo">
                  Proposta: {descrever(editando.p).para}. Troque o identificador só se a paróquia certa for outra.
                </small>
              </div>
            )}

            {editando.p.kind === 'COMMUNITY_CREATE' && (
              <>
                <div className="form-group">
                  <label htmlFor="dp-nome">Nome da comunidade</label>
                  <input id="dp-nome" value={editando.form.name ?? ''} onChange={(e) => setForm({ name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="dp-end2">Endereço</label>
                  <input id="dp-end2" value={editando.form.address ?? ''} onChange={(e) => setForm({ address: e.target.value })} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="dp-cid">Cidade</label>
                    <input id="dp-cid" value={editando.form.city ?? ''} onChange={(e) => setForm({ city: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="dp-uf">UF</label>
                    <select id="dp-uf" value={editando.form.state ?? ''} onChange={(e) => setForm({ state: e.target.value })}>
                      <option value="">—</option>
                      {UFS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {(editando.p.kind === 'COMMUNITY_WEBSITE' || editando.p.kind === 'PARISH_WEBSITE') && (
              <>
                <div className="form-group">
                  <label htmlFor="dp-site">Site</label>
                  <input
                    id="dp-site"
                    value={editando.form.website ?? ''}
                    onChange={(e) => setForm({ website: e.target.value })}
                    disabled={!!editando.form.apagarSite}
                    placeholder="https://"
                  />
                </div>
                <label className="form-check">
                  <input type="checkbox" checked={!!editando.form.apagarSite} onChange={(e) => setForm({ apagarSite: e.target.checked })} />
                  Apagar o site do cadastro (o atual está fora do ar ou é de outra paróquia)
                </label>
              </>
            )}

            <div className="form-group">
              <label htmlFor="dp-nota-rev">Observação da revisão (opcional)</label>
              <input id="dp-nota-rev" value={editando.nota} onChange={(e) => setEditando({ ...editando, nota: e.target.value })} />
            </div>

            {editando.erro && <p className="pf-erro">{editando.erro}</p>}

            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setEditando(null)} disabled={ocupado === editando.p.id}>
                Cancelar
              </button>
              <button type="submit" className="btn-submit dp-btn-aprovar" disabled={ocupado === editando.p.id}>
                {ocupado === editando.p.id ? 'Gravando…' : 'Aprovar com estes dados'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default TerritoryProposals;
