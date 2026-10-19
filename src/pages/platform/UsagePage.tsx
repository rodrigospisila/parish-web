import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TitleIcon from '../../components/TitleIcon';
import { CHART, ChartCard, HBars, StackedColumns, StatTile, type ChartSeries, type ColumnGroup } from '../../components/charts/Charts';
import api from '../../services/api';
import { mensagemDeErro, num } from './platformShared';
import { PLATFORM_LABEL, ROLE_LABEL, eventLabel } from './usageLabels';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Uso do produto (eng-qualidade-17): GET /platform/usage?days=N. Só agregados
 * por dia (ProductEvent) — nenhum id de pessoa. A resposta é lida de forma
 * tolerante: totais por evento, série diária e quebras por plataforma/papel
 * aparecem quando vêm.
 */

interface Row {
  name: string;
  count: number;
  uniques?: number | null;
}

interface Parsed {
  porEvento: Row[];
  porDia: Array<{ day: string; count: number }>;
  porPlataforma: Array<{ key: string; count: number }>;
  porPapel: Array<{ key: string; count: number }>;
  comunidades: Array<{ id: string; name: string; parishName: string | null; count: number }>;
  versoes: Array<{ version: string; count: number; uniques: number | null }>;
}

const num0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Soma linhas {chave, count} por chave. */
function somar(rows: any[], key: string): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const k = typeof r[key] === 'string' ? r[key] : '';
    m.set(k, (m.get(k) ?? 0) + num0(r.count));
  }
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

function parseUsage(data: any): Parsed {
  const vazio: Parsed = { porEvento: [], porDia: [], porPlataforma: [], porPapel: [], comunidades: [], versoes: [] };
  if (!data) return vazio;
  const linhas: any[] = Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : [];
  const totais: any[] = Array.isArray(data.totals)
    ? data.totals
    : Array.isArray(data.byName)
      ? data.byName
      : Array.isArray(data.events)
        ? data.events
        : [];
  const porEvento: Row[] = (totais.length ? totais : somar(linhas, 'name').map((r) => ({ name: r.key, count: r.count })))
    .filter((r: any) => r && typeof r.name === 'string')
    .map((r: any) => ({ name: r.name, count: num0(r.count), uniques: typeof r.uniques === 'number' ? r.uniques : null }))
    .sort((a: Row, b: Row) => b.count - a.count);

  const diarioBruto: any[] = Array.isArray(data.daily) ? data.daily : Array.isArray(data.byDay) ? data.byDay : linhas;
  const dias = new Map<string, number>();
  for (const r of diarioBruto) {
    const d = typeof r?.day === 'string' ? r.day.slice(0, 10) : typeof r?.date === 'string' ? r.date.slice(0, 10) : '';
    if (!d) continue;
    dias.set(d, (dias.get(d) ?? 0) + num0(r.count));
  }
  const porDia = [...dias.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));

  const porPlataforma = Array.isArray(data.byPlatform)
    ? data.byPlatform.map((r: any) => ({ key: String(r.platform ?? r.key ?? ''), count: num0(r.count) }))
    : somar(linhas, 'platform');
  const porPapel = Array.isArray(data.byRole)
    ? data.byRole.map((r: any) => ({ key: String(r.role ?? r.key ?? ''), count: num0(r.count) }))
    : somar(linhas, 'role');

  const comunidades = (Array.isArray(data.topCommunities) ? data.topCommunities : [])
    .filter((c: any) => c && typeof c.communityId === 'string')
    .map((c: any) => ({
      id: c.communityId,
      name: typeof c.name === 'string' ? c.name : 'Comunidade removida',
      parishName: typeof c.parishName === 'string' ? c.parishName : null,
      count: num0(c.count),
    }));
  const versoes = (Array.isArray(data.appVersions) ? data.appVersions : [])
    .filter((v: any) => v && typeof v === 'object')
    .map((v: any) => ({ version: typeof v.appVersion === 'string' && v.appVersion ? v.appVersion : 'não informada', count: num0(v.count), uniques: typeof v.uniques === 'number' ? v.uniques : null }));

  return { porEvento, porDia, porPlataforma, porPapel, comunidades, versoes };
}

const SERIE: ChartSeries[] = [{ key: 'count', label: 'eventos', color: CHART.series }];

const diaMes = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
};

const PERIODOS = [7, 30, 90];

const UsagePage: React.FC = () => {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Parsed | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/platform/usage', { params: { days: dias } });
      setDados(parseUsage(data));
    } catch (e) {
      setDados(null);
      setErro(mensagemDeErro(e, 'Não foi possível carregar o uso.'));
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const total = useMemo(() => (dados?.porEvento ?? []).reduce((a, r) => a + r.count, 0), [dados]);
  const grupos: ColumnGroup[] = (dados?.porDia ?? []).map((d) => ({ label: diaMes(d.day), values: { count: d.count }, note: diaMes(d.day) }));

  return (
    <div className="module-page platform-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="planejamento" /> Uso do produto
        </h1>
        <div className="header-actions">
          <div className="pf-chips" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p} type="button" className={`pf-chip${dias === p ? ' on' : ''}`} aria-pressed={dias === p} onClick={() => setDias(p)}>
                {p} dias
              </button>
            ))}
          </div>
          <button type="button" className="pf-btn" onClick={() => void carregar()} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>
      <p className="pf-nota">Contagens agregadas por dia, sem identificar pessoas. O papel vem do login; "sem login" é visitante.</p>

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
            <StatTile label={`Eventos · ${dias} dias`} value={num(total)} />
            <StatTile label="Tipos de evento" value={num(dados.porEvento.length)} />
            {dados.porPlataforma.map((p) => (
              <StatTile key={p.key || 'x'} label={PLATFORM_LABEL[p.key] ?? (p.key || 'Outra')} value={num(p.count)} />
            ))}
          </section>

          {grupos.length > 0 && (
            <ChartCard
              title="Eventos por dia"
              empty={null}
              table={{ columns: ['Dia', 'Eventos'], rows: (dados.porDia ?? []).map((d) => [diaMes(d.day), num(d.count)]) }}
              className="pf-grafico"
            >
              <StackedColumns groups={grupos} series={SERIE} height={220} ariaLabel={`Eventos por dia nos últimos ${dias} dias`} />
            </ChartCard>
          )}

          <div className="pf-ov-duas">
            <ChartCard
              title="Por evento"
              empty={dados.porEvento.length ? null : 'Nenhum evento no período.'}
              table={{
                columns: ['Evento', 'Quantidade', 'Pessoas (aprox.)'],
                rows: dados.porEvento.map((r) => [eventLabel(r.name), num(r.count), r.uniques != null ? num(r.uniques) : '—']),
              }}
            >
              <HBars
                rows={dados.porEvento.slice(0, 20).map((r) => ({
                  label: eventLabel(r.name),
                  sub: r.name,
                  values: { count: r.count },
                }))}
                series={SERIE}
                ariaLabel="Eventos por nome"
              />
            </ChartCard>

            <section className="pf-caixa" aria-labelledby="pf-uso-papel">
              <h3 id="pf-uso-papel">Por papel</h3>
              {dados.porPapel.length === 0 ? (
                <p className="pf-vazio">Sem quebra por papel.</p>
              ) : (
                <table className="data-table">
                  <tbody>
                    {dados.porPapel.map((r) => (
                      <tr key={r.key || 'anon'}>
                        <td>{ROLE_LABEL[r.key] ?? r.key}</td>
                        <td className="pf-num">{num(r.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <div className="pf-ov-duas">
            <section className="pf-caixa" aria-labelledby="pf-uso-com">
              <h3 id="pf-uso-com">Comunidades com mais uso</h3>
              {dados.comunidades.length === 0 ? (
                <p className="pf-vazio">Nenhum evento ligado a comunidade no período.</p>
              ) : (
                <table className="data-table">
                  <tbody>
                    {dados.comunidades.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong className="pf-nome">{c.name}</strong>
                          {c.parishName && <span className="pf-sub">{c.parishName}</span>}
                        </td>
                        <td className="pf-num">{num(c.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="pf-caixa" aria-labelledby="pf-uso-ver">
              <h3 id="pf-uso-ver">Versões do app em uso</h3>
              {dados.versoes.length === 0 ? (
                <p className="pf-vazio">Sem aberturas do app no período.</p>
              ) : (
                <table className="data-table">
                  <tbody>
                    {dados.versoes.map((v) => (
                      <tr key={v.version}>
                        <td>{v.version}</td>
                        <td className="pf-num">
                          {num(v.count)} aberturas
                          {v.uniques != null && <span className="pf-sub">~{num(v.uniques)} pessoas</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
};

export default UsagePage;
