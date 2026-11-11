import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatTile, fmtInt } from '../../components/charts/Charts';
import { COMMUNITY_MANAGEMENT_ROLES, canAccess, canOpen, type AccessRule } from '../../components/accessRules';
import { useAuth } from '../../contexts/AuthContext';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import api from '../../services/api';
import { PLAN_FEATURES_PATH, planFeaturePath } from '../../services/planErrors';
import { isPagedResponse } from '../../utils/useDebouncedValue';
import { FEATURE_CATALOG } from './featureCatalog';
import '../modules/ModulePages.css';
import '../DashboardPage.css';
import './plan.css';

/**
 * Início do PLANO GRÁTIS (o recurso `dashboard` está bloqueado): saudação, os
 * números do que é grátis, próximos passos e a faixa do plano completo.
 * Só chama rotas grátis — nunca `/dashboard/coordinator` (daria PLAN_REQUIRED).
 */

interface FreeNumbers {
  /** Membros cadastrados no escopo (null = não carregou / sem acesso) */
  members: number | null;
  schedules: { total: number; mass: number; confession: number } | null;
  locations: { total: number; verified: number; missing: number } | null;
}

const EMPTY: FreeNumbers = { members: null, schedules: null, locations: null };

const IMPORT_RULE: AccessRule = { roles: COMMUNITY_MANAGEMENT_ROLES, module: 'members' };

const greetingFor = (hour: number) => (hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite');
const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** Recursos em destaque na faixa do plano completo (os que mais pesam no dia a dia). */
const HIGHLIGHTS = ['schedules', 'catechesis', 'pastorals', 'tithe', 'events', 'sacrament-processes'];

const FreeHome: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { modOn, ready: modulesReady } = useModuleAccess(user?.role);

  const canMembers = canOpen(user, 'members', modOn);
  const canSchedules = canOpen(user, 'fixed-schedule', modOn);
  const canLocation = canOpen(user, 'minha-localizacao', modOn);
  const canUsers = canOpen(user, 'users', modOn);
  const canImport = canAccess(user, IMPORT_RULE, modOn);

  const [numbers, setNumbers] = useState<FreeNumbers>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Cada número falha sozinho (o cartão mostra "—"); nenhuma destas rotas é do plano
    const [members, schedules, locations] = await Promise.all([
      canMembers
        ? api
            .get('/members', { params: { page: 1, pageSize: 1 } })
            .then((res) => (isPagedResponse(res.data) ? res.data.total : Array.isArray(res.data) ? res.data.length : null))
            .catch(() => null)
        : Promise.resolve(null),
      canSchedules
        ? api
            .get('/mass-schedules/managed')
            .then((res) => {
              const list: Array<{ type?: string }> = Array.isArray(res.data) ? res.data : [];
              return {
                total: list.length,
                mass: list.filter((s) => s.type === 'MASS').length,
                confession: list.filter((s) => s.type === 'CONFESSION').length,
              };
            })
            .catch(() => null)
        : Promise.resolve(null),
      canLocation
        ? api
            .get('/communities/my-locations')
            .then((res) => {
              const list: Array<{ latitude?: number | null; longitude?: number | null; geoVerifiedAt?: string | null; geoPrecision?: string | null }> =
                Array.isArray(res.data) ? res.data : Array.isArray(res.data?.items) ? res.data.items : [];
              const hasPin = (c: (typeof list)[number]) => typeof c.latitude === 'number' && typeof c.longitude === 'number';
              return {
                total: list.length,
                // Mesmo critério da tela "Minha localização": pino conferido por uma pessoa
                verified: list.filter((c) => hasPin(c) && (!!c.geoVerifiedAt || c.geoPrecision === 'MANUAL')).length,
                missing: list.filter((c) => !hasPin(c)).length,
              };
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    setNumbers({ members, schedules, locations });
    setLoading(false);
  }, [canMembers, canSchedules, canLocation]);

  useEffect(() => {
    // Espera a matriz de módulos: sem ela os "can*" ainda são falsos
    if (!modulesReady) return;
    void load();
  }, [load, modulesReady]);

  const now = new Date();
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] || 'coordenação';
  const dash = (value: number | null | undefined) => (value === null || value === undefined ? '—' : fmtInt(value));
  const loc = numbers.locations;
  const sch = numbers.schedules;

  // Próximos passos: o que falta fazer com o que é grátis (cada um leva à tela)
  const steps: { key: string; title: string; text: string; to: string; done: boolean }[] = [
    ...(canMembers
      ? [
          {
            key: 'members',
            title: numbers.members ? 'Manter o cadastro de membros em dia' : 'Cadastrar os membros',
            text: canImport ? 'Cadastre um a um ou traga a planilha que a secretaria já usa.' : 'Cadastre as pessoas da comunidade.',
            to: numbers.members || !canImport ? '/admin/members' : '/admin/importar',
            done: (numbers.members ?? 0) > 0,
          },
        ]
      : []),
    ...(canSchedules
      ? [
          {
            key: 'schedules',
            title: 'Conferir os horários de missa e de confissão',
            text: 'É o que os fiéis veem no mapa e no app. Se um dia não houver, marque "não haverá".',
            to: '/admin/fixed-schedule',
            done: (sch?.total ?? 0) > 0,
          },
        ]
      : []),
    ...(canLocation
      ? [
          {
            key: 'location',
            title: 'Conferir a localização das comunidades',
            text: 'Coloque o pino em cima da igreja para os fiéis chegarem ao lugar certo.',
            to: '/admin/minha-localizacao',
            done: !!loc && loc.total > 0 && loc.verified >= loc.total,
          },
        ]
      : []),
    ...(canUsers
      ? [
          {
            key: 'team',
            title: 'Convidar a equipe',
            text: 'Secretaria e coordenadores entram com o próprio acesso.',
            to: '/admin/users',
            done: false,
          },
        ]
      : []),
  ];

  const highlights = HIGHLIGHTS.map((key) => FEATURE_CATALOG.find((f) => f.key === key)).filter((f): f is (typeof FEATURE_CATALOG)[number] => !!f);

  return (
    <div className={`module-page dash-root planv-home${loading ? ' is-loading' : ''}`}>
      <header className="dash-head">
        <div className="dash-head__intro">
          <p className="dash-head__eyebrow">{capitalize(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
          <h1 className="dash-head__title">
            {greetingFor(now.getHours())}, {firstName}
          </h1>
          <p className="dash-head__scope">
            <span className="planv-badge planv-badge--free">Plano grátis</span> Membros, horários de missa e confissão e a localização das
            suas comunidades.
          </p>
        </div>
        <div className="dash-head__actions">
          <button type="button" className="btn-small dash-refresh" onClick={() => void load()} disabled={loading}>
            ↻ Atualizar
          </button>
        </div>
      </header>

      {(canMembers || canSchedules || canLocation) && (
        <section className="dash-kpis" aria-label="Números da comunidade" aria-busy={loading}>
          {canMembers && (
            <StatTile
              label="Membros cadastrados"
              value={loading && numbers.members === null ? '…' : dash(numbers.members)}
              hint={numbers.members === 0 ? 'nenhum ainda — comece pelo cadastro' : 'sem limite no plano grátis'}
              onClick={() => navigate('/admin/members')}
            />
          )}
          {canSchedules && (
            <StatTile
              label="Horários fixos"
              value={loading && !sch ? '…' : dash(sch?.total)}
              hint={sch ? `${fmtInt(sch.mass)} de missa · ${fmtInt(sch.confession)} de confissão` : 'missas e confissões da semana'}
              onClick={() => navigate('/admin/fixed-schedule')}
            />
          )}
          {canLocation && (
            <StatTile
              label="Localização conferida"
              value={loading && !loc ? '…' : loc ? `${fmtInt(loc.verified)} de ${fmtInt(loc.total)}` : '—'}
              hint={
                !loc
                  ? 'comunidades com o pino conferido'
                  : loc.missing > 0
                    ? `${fmtInt(loc.missing)} sem pino no mapa`
                    : loc.verified >= loc.total
                      ? 'todas as comunidades conferidas'
                      : `${loc.total === 1 ? 'comunidade' : 'comunidades'} com o pino conferido`
              }
              meter={loc && loc.total > 0 ? { value: Math.round((loc.verified / loc.total) * 100) } : null}
              onClick={() => navigate('/admin/minha-localizacao')}
            />
          )}
        </section>
      )}


      {steps.length > 0 && (
        <section className="dash-panel" aria-labelledby="planv-steps-title">
          <header className="dash-panel__head">
            <h2 id="planv-steps-title" className="dash-panel__title">
              Próximos passos
            </h2>
          </header>
          <ul className="planv-steps">
            {steps.map((step) => (
              <li key={step.key}>
                <Link to={step.to} className={`planv-step${step.done ? ' is-done' : ''}`}>
                  <span className="planv-step__check" aria-hidden="true">
                    {step.done ? '✓' : ''}
                  </span>
                  <span className="planv-step__body">
                    <span className="planv-step__title">
                      {step.title}
                      {step.done && <span className="planv-sr"> (feito)</span>}
                    </span>
                    <span className="planv-step__text">{step.text}</span>
                  </span>
                  <span className="planv-step__arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Faixa do plano completo */}
      <section className="planv-band" aria-labelledby="planv-band-title">
        <div className="planv-band__text">
          <span className="planv-band__eyebrow">Plano completo</span>
          <h2 id="planv-band-title" className="planv-band__title">
            Conheça o plano completo
          </h2>
          <p className="planv-band__lead">
            Escalas com confirmação pelo celular, catequese com inscrição online, pastorais, dízimo por Pix, eventos e muito mais —
            por comunidade.
          </p>
          <ul className="planv-band__chips" aria-label="Alguns recursos do plano completo">
            {highlights.map((feature) => (
              <li key={feature.key}>
                <Link to={planFeaturePath(feature.key)} className="planv-chip">
                  {feature.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="planv-band__actions">
          <Link to={PLAN_FEATURES_PATH} className="planv-btn planv-btn--gold">
            Ver todos os recursos
          </Link>
        </div>
      </section>
    </div>
  );
};

export default FreeHome;
