import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TitleIcon from '../../components/TitleIcon';
import { CHART, ChartCard, StackedColumns, StatTile, fmtInt, type ChartSeries, type ColumnGroup } from '../../components/charts/Charts';
import api from '../../services/api';
import { PlanBadge, mensagemDeErro, num } from './platformShared';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Crescimento da plataforma — só números agregados (quantos fiéis novos, onde
 * a base cresce). Nada de lista de pessoas: a conversa comercial é com a
 * comunidade/paróquia, nunca com o fiel.
 */

interface Growth {
  newFaithful7d: number;
  newFaithful30d: number;
  prev30d: number;
  activeUsers30d: number;
  weekly: Array<{ weekStart: string; count: number }>;
  topCommunities: Array<{
    communityId: string;
    name: string;
    city: string;
    state: string;
    newCount: number;
    planStatus: string | null;
  }>;
}

const SERIE: ChartSeries[] = [{ key: 'count', label: 'fiéis novos', color: CHART.series }];

/** Variação percentual com sinal tipográfico; sem base, não inventa número. */
const variacao = (atual: number, anterior: number, rotulo: string) => {
  if (!(anterior > 0)) return atual > 0 ? { text: `sem base ${rotulo}`, tone: 'neutral' as const } : null;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  return {
    text: `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${fmtInt(Math.abs(pct))}% ${rotulo}`,
    tone: pct > 0 ? ('good' as const) : pct < 0 ? ('bad' as const) : ('neutral' as const),
  };
};

const diaMes = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
};

const GrowthPage: React.FC = () => {
  const navigate = useNavigate();
  const [dados, setDados] = useState<Growth | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/platform/growth', { params: { days: 30 } });
      setDados(data && typeof data === 'object' ? data : null);
    } catch (e) {
      setDados(null);
      setErro(mensagemDeErro(e, 'Não foi possível carregar os números de crescimento.'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Últimas 12 semanas, da mais antiga para a mais recente; a última é a semana em curso
  const semanas = useMemo(
    () =>
      [...(dados?.weekly ?? [])]
        .filter((w) => w && typeof w.count === 'number')
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        .slice(-12),
    [dados],
  );
  const grupos: ColumnGroup[] = semanas.map((w, i) => ({
    label: diaMes(w.weekStart),
    values: { count: w.count },
    highlight: i === semanas.length - 1,
    note: i === semanas.length - 1 ? 'semana em curso (parcial)' : `semana de ${diaMes(w.weekStart)}`,
  }));

  const n7 = dados?.newFaithful7d ?? 0;
  const n30 = dados?.newFaithful30d ?? 0;
  const prev30 = dados?.prev30d ?? 0;
  // O 7 dias é comparado com a média semanal dos 30 dias anteriores (a API não manda os 7 anteriores)
  const mediaSemanalAnterior = (prev30 * 7) / 30;
  const top = dados?.topCommunities ?? [];

  return (
    <div className="module-page platform-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="membros" /> Crescimento
        </h1>
        <div className="header-actions">
          <button type="button" className="pf-btn" onClick={() => void carregar()} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>
      <p className="pf-nota">
        Números agregados; a abordagem comercial é com a comunidade/paróquia. Nenhum dado de fiel aparece aqui.
      </p>

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
          <section className="pf-kpis" aria-label="Indicadores">
            <StatTile
              label="Fiéis novos · 7 dias"
              value={num(n7)}
              delta={variacao(n7, mediaSemanalAnterior, 'vs. média semanal anterior')}
              hint="cadastros de fiel nos últimos 7 dias"
            />
            <StatTile
              label="Fiéis novos · 30 dias"
              value={num(n30)}
              delta={variacao(n30, prev30, 'vs. 30 dias anteriores')}
              hint={`${num(prev30)} nos 30 dias anteriores`}
              trend={semanas.map((w) => w.count)}
            />
            <StatTile label="Usuários ativos · 30 dias" value={num(dados.activeUsers30d)} hint="entraram no app ou no painel no período" />
          </section>

          <ChartCard
            title="Fiéis novos por semana"
            subtitle="Últimas 12 semanas · a coluna destacada é a semana em curso, ainda parcial"
            empty={grupos.length ? null : 'Sem dados semanais ainda.'}
            table={{
              columns: ['Semana de', 'Fiéis novos'],
              rows: semanas.map((w) => [diaMes(w.weekStart), fmtInt(w.count)]),
            }}
            className="pf-grafico"
          >
            <StackedColumns groups={grupos} series={SERIE} height={240} ariaLabel="Fiéis novos por semana nas últimas 12 semanas" />
          </ChartCard>

          <section className="pf-secao">
            <h2 className="pf-secao-titulo">Comunidades em alta</h2>
            <p className="pf-meta">Onde mais entraram fiéis nos últimos 30 dias, com a situação do plano da comunidade.</p>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="pf-num">#</th>
                    <th>Comunidade</th>
                    <th>Cidade/UF</th>
                    <th className="pf-num">Fiéis novos</th>
                    <th>Plano</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {top.length === 0 && (
                    <tr>
                      <td colSpan={6} className="pf-vazio">
                        Nenhuma comunidade com fiéis novos no período.
                      </td>
                    </tr>
                  )}
                  {top.map((c, i) => (
                    <tr key={c.communityId}>
                      <td className="pf-num pf-mudo">{i + 1}</td>
                      <td>
                        <strong className="pf-nome">{c.name}</strong>
                      </td>
                      <td>
                        {c.city}/{c.state}
                      </td>
                      <td className="pf-num">
                        <strong>{num(c.newCount)}</strong>
                      </td>
                      <td>
                        <PlanBadge status={c.planStatus} />
                      </td>
                      <td className="pf-direita">
                        <button
                          type="button"
                          className="pf-btn pf-btn-mini"
                          onClick={() =>
                            navigate(
                              `/admin/platform/plans?community=${encodeURIComponent(c.communityId)}&search=${encodeURIComponent(c.name)}&state=${encodeURIComponent(c.state)}`,
                            )
                          }
                        >
                          Ver plano
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default GrowthPage;
