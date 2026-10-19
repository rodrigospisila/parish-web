import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TitleIcon from '../../components/TitleIcon';
import { CHART, ChartCard, HBars, StatTile, type ChartSeries } from '../../components/charts/Charts';
import api from '../../services/api';
import { brl, dataHoraBR, haQuanto, mensagemDeErro, num } from './platformShared';
import { eventLabel } from './usageLabels';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Visão geral da plataforma (ux-dashboards-24 / saas-implantacao-16): a home
 * do SYSTEM_ADMIN. Filas da operação (reivindicações, leads), situação dos
 * planos, receita recorrente, uso dos últimos 7 dias e saúde dos jobs — cada
 * número leva à tela onde se age sobre ele. Nada de dado pessoal aqui.
 */

interface Overview {
  parishesManaged: number;
  claimsPending: number;
  leadsNew: number;
  plans: { trial: number; active: number; pastDue: number; suspended: number };
  mrrCents: number;
  trialsEndingIn7d: number;
  usage7d: Array<{ name: string; count: number }>;
  jobs: Array<{ name: string; lastStatus: string | null; lastStartedAt: string | null; lastError: string | null }>;
  enforcement30d: unknown;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parseOverview(data: any): Overview | null {
  if (!data || typeof data !== 'object') return null;
  return {
    parishesManaged: n(data.parishesManaged),
    claimsPending: n(data.claimsPending),
    leadsNew: n(data.leadsNew),
    plans: {
      trial: n(data.plans?.trial),
      active: n(data.plans?.active),
      pastDue: n(data.plans?.pastDue),
      suspended: n(data.plans?.suspended),
    },
    mrrCents: n(data.mrrCents),
    trialsEndingIn7d: n(data.trialsEndingIn7d),
    usage7d: Array.isArray(data.usage7d) ? data.usage7d.filter((u: any) => u && typeof u.name === 'string') : [],
    jobs: Array.isArray(data.jobs) ? data.jobs.filter((j: any) => j && typeof j.name === 'string') : [],
    enforcement30d: data.enforcement30d,
  };
}

/** "O que os bloqueios fariam" (30 dias): número ou objeto de contagens → total. */
function totalBloqueios(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.total === 'number') return obj.total;
    const nums = Object.values(obj).filter((x): x is number => typeof x === 'number');
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }
  return null;
}

const JOB_TONE: Record<string, string> = { OK: 'green', RUNNING: 'blue', SKIPPED: 'gray', ERROR: 'red' };
const JOB_LABEL: Record<string, string> = { OK: 'OK', RUNNING: 'Rodando', SKIPPED: 'Pulado', ERROR: 'Erro' };

const SERIE: ChartSeries[] = [{ key: 'count', label: 'eventos', color: CHART.series }];

const OverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const [dados, setDados] = useState<Overview | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/platform/overview');
      setDados(parseOverview(data));
    } catch (e) {
      setDados(null);
      setErro(mensagemDeErro(e, 'Não foi possível carregar a visão geral.'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const bloqueios = dados ? totalBloqueios(dados.enforcement30d) : null;
  const usoTop = [...(dados?.usage7d ?? [])].sort((a, b) => b.count - a.count).slice(0, 10);
  const jobsComErro = (dados?.jobs ?? []).filter((j) => j.lastStatus === 'ERROR').length;

  return (
    <div className="module-page platform-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="planejamento" /> Visão geral
        </h1>
        <div className="header-actions">
          <button type="button" className="pf-btn" onClick={() => void carregar()} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>
      <p className="pf-nota">Filas, planos, receita e saúde da operação. Clique num número para agir sobre ele.</p>

      {erro && (
        <p className="pf-erro">
          {erro}{' '}
          <button type="button" className="pf-link" onClick={() => void carregar()}>
            tentar de novo
          </button>
        </p>
      )}
      {carregando && !dados && <p className="pf-vazio">Carregando…</p>}

      {dados && (
        <>
          <h2 className="pf-secao-titulo pf-ov-titulo">Para fazer agora</h2>
          <section className="pf-kpis" aria-label="Filas da operação">
            <StatTile
              label="Reivindicações a revisar"
              value={num(dados.claimsPending)}
              hint="pedidos de gestão de paróquia"
              onClick={() => navigate('/admin/platform/claims')}
            />
            <StatTile
              label="Leads novos"
              value={num(dados.leadsNew)}
              hint="demonstrações e contatos sem resposta"
              onClick={() => navigate('/admin/platform/leads?status=NEW')}
            />
            <StatTile
              label="Testes acabando em 7 dias"
              value={num(dados.trialsEndingIn7d)}
              hint="comunidades para conversar"
              onClick={() => navigate('/admin/platform/plans?status=TRIAL')}
            />
            <StatTile
              label="Planos em atraso"
              value={num(dados.plans.pastDue)}
              hint="cobrança vencida"
              onClick={() => navigate('/admin/platform/plans?status=PAST_DUE')}
            />
          </section>

          <h2 className="pf-secao-titulo pf-ov-titulo">Clientes e receita</h2>
          <section className="pf-kpis pf-kpis-5" aria-label="Planos e receita">
            <StatTile label="Receita recorrente (MRR)" value={brl(dados.mrrCents)} hint="planos pagos, por mês" onClick={() => navigate('/admin/platform/plans?status=ACTIVE')} />
            <StatTile label="Comunidades pagantes" value={num(dados.plans.active)} onClick={() => navigate('/admin/platform/plans?status=ACTIVE')} />
            <StatTile label="Em teste" value={num(dados.plans.trial)} onClick={() => navigate('/admin/platform/plans?status=TRIAL')} />
            <StatTile label="Suspensas" value={num(dados.plans.suspended)} onClick={() => navigate('/admin/platform/plans?status=SUSPENDED')} />
            <StatTile label="Paróquias com gestão" value={num(dados.parishesManaged)} hint="reivindicadas e aprovadas" onClick={() => navigate('/admin/parishes')} />
          </section>
          {bloqueios !== null && (
            <p className="pf-meta">
              Bloqueios de plano registrados nos últimos 30 dias (modo de registro, nada foi bloqueado):{' '}
              <Link to="/admin/platform/plans">{num(bloqueios)}</Link>
            </p>
          )}

          <div className="pf-ov-duas">
            <ChartCard
              title="Uso nos últimos 7 dias"
              subtitle="Eventos agregados por nome, sem dado de pessoa"
              empty={usoTop.length ? null : 'Nenhum evento registrado ainda.'}
              table={{ columns: ['Evento', 'Quantidade'], rows: usoTop.map((u) => [eventLabel(u.name), num(u.count)]) }}
              action={
                <Link to="/admin/platform/usage" className="pf-btn pf-btn-mini">
                  Ver uso
                </Link>
              }
            >
              <HBars rows={usoTop.map((u) => ({ label: eventLabel(u.name), values: { count: u.count } }))} series={SERIE} ariaLabel="Eventos dos últimos 7 dias" />
            </ChartCard>

            <section className="pf-caixa pf-ov-jobs" aria-labelledby="pf-ov-jobs">
              <h3 id="pf-ov-jobs">Rotinas automáticas {jobsComErro > 0 && <span className="status-badge red">{jobsComErro} com erro</span>}</h3>
              {dados.jobs.length === 0 ? (
                <p className="pf-vazio">Nenhuma execução registrada.</p>
              ) : (
                <ul className="pf-historico">
                  {dados.jobs.map((j) => (
                    <li key={j.name}>
                      <div className="pf-historico-topo">
                        <strong>{j.name}</strong>
                        <span className={`status-badge ${JOB_TONE[j.lastStatus ?? ''] ?? 'gray'}`}>
                          {JOB_LABEL[j.lastStatus ?? ''] ?? j.lastStatus ?? '—'}
                        </span>
                      </div>
                      <small className="pf-mudo" title={dataHoraBR(j.lastStartedAt)}>
                        {j.lastStartedAt ? `última: ${haQuanto(j.lastStartedAt)} (${dataHoraBR(j.lastStartedAt)})` : 'nunca rodou'}
                      </small>
                      {j.lastError && <p className="pf-historico-nota">{j.lastError.slice(0, 240)}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="pf-ov-atalhos" aria-label="Atalhos">
            <Link to="/admin/platform/announcements" className="pf-btn">
              Avisos aos clientes
            </Link>
            <Link to="/admin/platform/suggestions" className="pf-btn">
              Sugestões dos fiéis
            </Link>
            <Link to="/admin/platform/growth" className="pf-btn">
              Crescimento
            </Link>
            <Link to="/admin/map" className="pf-btn">
              Mapa do território
            </Link>
          </section>
        </>
      )}
    </div>
  );
};

export default OverviewPage;
