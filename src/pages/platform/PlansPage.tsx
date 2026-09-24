import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import TitleIcon from '../../components/TitleIcon';
import { StatTile } from '../../components/charts/Charts';
import api from '../../services/api';
import { confirm, notify } from '../../services/notification.service';
import {
  O_QUE_O_PLANO_LIBERA,
  PLAN_STATUSES,
  PLAN_STATUS_LABEL,
  PlanBadge,
  UFS,
  brl,
  campoParaCentavos,
  centavosParaCampo,
  dataBR,
  dataHoraBR,
  diasAte,
  hojeMais,
  mensagemDeErro,
  num,
  type PlanStatus,
} from './platformShared';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Planos por comunidade (SYSTEM_ADMIN). O plano é da COMUNIDADE: libera os
 * módulos de gestão para a equipe dela. Aqui se vê quem paga, quem está em
 * teste e quem atrasou, e se faz a gestão manual (teste, ativação, suspensão,
 * cancelamento, extensão), com o histórico de cada mudança. A aba "Faixas e
 * preços" edita a tabela de preços por tamanho de comunidade.
 */

type Cycle = 'MONTHLY' | 'YEARLY';
type Action = 'START_TRIAL' | 'ACTIVATE' | 'SUSPEND' | 'REACTIVATE' | 'CANCEL' | 'SET_FREE' | 'EXTEND';

interface Plan {
  status: PlanStatus;
  tierKey: string | null;
  billingCycle: Cycle | null;
  priceCents: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceDays: number | null;
  notes: string | null;
}

interface PlanRow {
  communityId: string;
  name: string;
  city: string;
  state: string;
  parish: { id: string; name: string } | null;
  diocese: { id: string; name: string } | null;
  membersWithAccount: number;
  plan: Plan | null;
  paidAccess: boolean;
}

interface Summary {
  byStatus: Partial<Record<PlanStatus, number>>;
  trialsEndingIn15d: number;
  pastDue: number;
  mrrCents: number;
}

interface Tier {
  key: string;
  name: string;
  description: string | null;
  maxMembers: number | null;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  isActive: boolean;
  sortOrder: number;
}

interface PlanEvent {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  byUserId: string | null;
  note: string | null;
  createdAt: string;
}

const LIMITE = 25;

const ACTION_LABEL: Record<Action, string> = {
  START_TRIAL: 'Iniciar teste',
  ACTIVATE: 'Ativar',
  SUSPEND: 'Suspender',
  REACTIVATE: 'Reativar',
  CANCEL: 'Cancelar',
  SET_FREE: 'Voltar ao grátis',
  EXTEND: 'Estender',
};

/** O que cada ação faz, em uma frase (aparece no formulário da ação). */
const ACTION_HELP: Record<Action, string> = {
  START_TRIAL: 'Libera os módulos pagos até a data escolhida, sem cobrança.',
  ACTIVATE: 'Plano pago: escolha a faixa, o ciclo e o preço combinado.',
  SUSPEND: 'Bloqueia os módulos pagos (os dados ficam guardados). Use em atraso prolongado.',
  REACTIVATE: 'Devolve o acesso de um plano suspenso ou em atraso.',
  CANCEL: 'Encerra o plano. Os módulos pagos deixam de estar disponíveis.',
  SET_FREE: 'Volta ao grátis: calendário, eventos, mapa e liturgia seguem liberados.',
  EXTEND: 'Empurra a data de fim (do teste ou do período pago).',
};

/** Ações que fazem sentido em cada situação (o servidor valida de novo). */
const ACOES_POR_STATUS: Record<PlanStatus, Action[]> = {
  FREE: ['START_TRIAL', 'ACTIVATE'],
  TRIAL: ['ACTIVATE', 'EXTEND', 'SET_FREE', 'CANCEL'],
  ACTIVE: ['EXTEND', 'SUSPEND', 'CANCEL', 'SET_FREE'],
  PAST_DUE: ['REACTIVATE', 'EXTEND', 'SUSPEND', 'CANCEL'],
  SUSPENDED: ['REACTIVATE', 'CANCEL', 'SET_FREE'],
  CANCELED: ['START_TRIAL', 'ACTIVATE', 'SET_FREE'],
};

const ACOES_PERIGOSAS: Action[] = ['SUSPEND', 'CANCEL', 'SET_FREE'];

const CYCLE_LABEL: Record<Cycle, string> = { MONTHLY: 'mensal', YEARLY: 'anual' };

const statusDe = (row: PlanRow): PlanStatus => (row.plan?.status && row.plan.status in PLAN_STATUS_LABEL ? row.plan.status : 'FREE');

/** Próximo marco do plano: fim do teste ou do período pago. */
const Marco: React.FC<{ plan: Plan | null }> = ({ plan }) => {
  if (!plan || plan.status === 'FREE' || plan.status === 'CANCELED') return <span className="pf-mudo">—</span>;
  const data = plan.status === 'TRIAL' ? plan.trialEndsAt : plan.currentPeriodEnd;
  if (!data) return <span className="pf-mudo">—</span>;
  const dias = diasAte(data);
  if (plan.status === 'SUSPENDED') return <span className="pf-mudo">período terminou em {dataBR(data)}</span>;
  if (plan.status === 'PAST_DUE') return <span className="pf-urgente">venceu em {dataBR(data)}</span>;
  const prefixo = plan.status === 'TRIAL' ? 'teste até' : 'período até';
  const urgente = dias != null && dias >= 0 && dias <= 15;
  return (
    <span className={urgente ? 'pf-urgente' : undefined}>
      {prefixo} {dataBR(data)}
      {urgente && <small className="pf-sub">{dias === 0 ? 'vence hoje' : dias === 1 ? 'falta 1 dia' : `faltam ${dias} dias`}</small>}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Painel lateral: gestão do plano de uma comunidade
// ---------------------------------------------------------------------------

interface PainelProps {
  row: PlanRow;
  tiers: Tier[];
  onClose: () => void;
  onChanged: (row: PlanRow) => void;
}

const PainelDoPlano: React.FC<PainelProps> = ({ row, tiers, onClose, onChanged }) => {
  const [atual, setAtual] = useState<PlanRow>(row);
  const [eventos, setEventos] = useState<PlanEvent[] | null>(null);
  const [erroEventos, setErroEventos] = useState('');
  const [acao, setAcao] = useState<Action | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroAcao, setErroAcao] = useState('');
  // Campos do formulário da ação
  const [tierKey, setTierKey] = useState('');
  const [ciclo, setCiclo] = useState<Cycle>('MONTHLY');
  const [preco, setPreco] = useState('');
  const [ate, setAte] = useState('');
  const [nota, setNota] = useState('');

  useEffect(() => setAtual(row), [row]);

  const carregarEventos = useCallback(async () => {
    setErroEventos('');
    try {
      const { data } = await api.get(`/platform/plans/${row.communityId}/events`);
      setEventos(Array.isArray(data) ? data : []);
    } catch (e) {
      setEventos([]);
      setErroEventos(mensagemDeErro(e, 'Não foi possível carregar o histórico.'));
    }
  }, [row.communityId]);

  useEffect(() => {
    setEventos(null);
    setAcao(null);
    void carregarEventos();
  }, [carregarEventos]);

  // Esc fecha o painel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tiersAtivos = tiers.filter((t) => t.isActive || t.key === atual.plan?.tierKey);
  const tierDe = (key: string | null | undefined) => tiers.find((t) => t.key === key);
  const status = statusDe(atual);

  /** Preço sugerido: o da faixa no ciclo escolhido. */
  const precoDaFaixa = (key: string, c: Cycle) => {
    const t = tierDe(key);
    return t ? centavosParaCampo(c === 'YEARLY' ? t.yearlyPriceCents : t.monthlyPriceCents) : '';
  };

  const escolherAcao = (a: Action) => {
    setErroAcao('');
    setAcao(a);
    setNota('');
    const plano = atual.plan;
    const key = plano?.tierKey ?? tiersAtivos[0]?.key ?? '';
    const c: Cycle = plano?.billingCycle ?? 'MONTHLY';
    setTierKey(key);
    setCiclo(c);
    setPreco(plano?.priceCents != null ? centavosParaCampo(plano.priceCents) : precoDaFaixa(key, c));
    if (a === 'START_TRIAL') setAte(hojeMais(30));
    else if (a === 'EXTEND') {
      const base = status === 'TRIAL' ? plano?.trialEndsAt : plano?.currentPeriodEnd;
      const d = base ? new Date(base) : null;
      const inicio = d && !Number.isNaN(d.getTime()) && d.getTime() > Date.now() ? d.getTime() : Date.now();
      const alvo = new Date(inicio + 30 * 86_400_000);
      setAte(`${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(alvo.getDate()).padStart(2, '0')}`);
    } else setAte('');
  };

  const executar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acao) return;
    setErroAcao('');
    const body: Record<string, unknown> = { action: acao };
    if (nota.trim()) body.note = nota.trim();
    if (acao === 'START_TRIAL') {
      if (!ate) return setErroAcao('Informe até quando vai o teste.');
      body.until = ate;
      if (tierKey) body.tierKey = tierKey;
    }
    if (acao === 'EXTEND') {
      if (!ate) return setErroAcao('Informe a nova data de fim.');
      body.until = ate;
    }
    if (acao === 'ACTIVATE') {
      if (!tierKey) return setErroAcao('Escolha a faixa do plano.');
      const cents = campoParaCentavos(preco);
      if (cents == null) return setErroAcao('Informe o preço em reais (ex.: 49,90).');
      body.tierKey = tierKey;
      body.billingCycle = ciclo;
      body.priceCents = cents;
      if (ate) body.until = ate;
    }
    if (ACOES_PERIGOSAS.includes(acao)) {
      const ok = await confirm.action(
        `${ACTION_LABEL[acao]}?`,
        `${atual.name}: ${ACTION_HELP[acao]}`,
        ACTION_LABEL[acao],
        'Voltar',
      );
      if (!ok) return;
    }
    setSalvando(true);
    try {
      const { data } = await api.patch(`/platform/plans/${atual.communityId}`, body);
      // A resposta pode ser a linha inteira ({ plan, paidAccess, ... }) ou só o plano
      let novo: PlanRow = atual;
      if (data && typeof data === 'object') {
        if ('plan' in data || 'paidAccess' in data) novo = { ...atual, ...data };
        else if ('status' in data) novo = { ...atual, plan: { ...(atual.plan ?? ({} as Plan)), ...data } };
      }
      setAtual(novo);
      onChanged(novo);
      notify.success(`${ACTION_LABEL[acao]}: feito.`);
      setAcao(null);
      void carregarEventos();
    } catch (err) {
      setErroAcao(mensagemDeErro(err, 'Não foi possível aplicar a ação.'));
    } finally {
      setSalvando(false);
    }
  };

  const plano = atual.plan;
  const tier = tierDe(plano?.tierKey);

  return (
    <div className="pf-drawer-fundo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="pf-drawer" role="dialog" aria-modal="true" aria-labelledby="pf-drawer-titulo">
        <header className="pf-drawer-header">
          <div>
            <h2 id="pf-drawer-titulo">{atual.name}</h2>
            <small>
              {atual.city}/{atual.state}
              {atual.parish ? ` · ${atual.parish.name}` : ''}
              {atual.diocese ? ` · ${atual.diocese.name}` : ''}
            </small>
          </div>
          <button type="button" className="pf-drawer-fechar" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div className="pf-drawer-corpo">
          <section className="pf-caixa">
            <h3>Plano atual</h3>
            <div className="pf-plano-linha">
              <PlanBadge status={status} />
              {atual.paidAccess ? (
                <span className="pf-acesso on">módulos pagos liberados</span>
              ) : (
                <span className="pf-acesso">só o grátis</span>
              )}
            </div>
            <dl className="pf-dl">
              <dt>Faixa</dt>
              <dd>{tier ? tier.name : plano?.tierKey ?? '—'}</dd>
              <dt>Ciclo e preço</dt>
              <dd>
                {plano?.priceCents != null ? `${brl(plano.priceCents)}${plano.billingCycle ? ` · ${CYCLE_LABEL[plano.billingCycle]}` : ''}` : '—'}
              </dd>
              {plano?.trialEndsAt && (
                <>
                  <dt>Teste até</dt>
                  <dd>{dataBR(plano.trialEndsAt)}</dd>
                </>
              )}
              {plano?.currentPeriodEnd && (
                <>
                  <dt>Período pago até</dt>
                  <dd>{dataBR(plano.currentPeriodEnd)}</dd>
                </>
              )}
              {plano?.graceDays != null && (
                <>
                  <dt>Carência</dt>
                  <dd>{plano.graceDays} dia(s)</dd>
                </>
              )}
              <dt>Membros com conta</dt>
              <dd>
                {num(atual.membersWithAccount)}
                {tier?.maxMembers ? ` de ${num(tier.maxMembers)} da faixa` : ''}
              </dd>
              {plano?.notes && (
                <>
                  <dt>Observações</dt>
                  <dd>{plano.notes}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="pf-caixa">
            <h3>Ações</h3>
            <div className="pf-acoes-plano">
              {ACOES_POR_STATUS[status].map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`pf-btn pf-btn-mini${acao === a ? ' on' : ''}${ACOES_PERIGOSAS.includes(a) ? ' pf-btn-perigo' : ''}`}
                  onClick={() => escolherAcao(a)}
                  aria-pressed={acao === a}
                >
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>

            {acao && (
              <form className="pf-form-acao" onSubmit={executar}>
                <p className="pf-meta">{ACTION_HELP[acao]}</p>
                {(acao === 'ACTIVATE' || acao === 'START_TRIAL') && (
                  <label className="pf-campo">
                    Faixa{acao === 'START_TRIAL' ? ' (opcional)' : ''}
                    <select
                      value={tierKey}
                      onChange={(e) => {
                        setTierKey(e.target.value);
                        if (acao === 'ACTIVATE') setPreco(precoDaFaixa(e.target.value, ciclo));
                      }}
                    >
                      {acao === 'START_TRIAL' && <option value="">— sem faixa —</option>}
                      {tiersAtivos.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name} · {brl(t.monthlyPriceCents)}/mês · {brl(t.yearlyPriceCents)}/ano
                        </option>
                      ))}
                    </select>
                    {tiersAtivos.length === 0 && <small className="pf-urgente">Nenhuma faixa cadastrada: crie em “Faixas e preços”.</small>}
                  </label>
                )}
                {acao === 'ACTIVATE' && (
                  <div className="pf-form-linha">
                    <label className="pf-campo">
                      Ciclo
                      <select
                        value={ciclo}
                        onChange={(e) => {
                          const c = e.target.value as Cycle;
                          setCiclo(c);
                          setPreco(precoDaFaixa(tierKey, c));
                        }}
                      >
                        <option value="MONTHLY">Mensal</option>
                        <option value="YEARLY">Anual</option>
                      </select>
                    </label>
                    <label className="pf-campo">
                      Preço (R$)
                      <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder="49,90" />
                    </label>
                  </div>
                )}
                {(acao === 'START_TRIAL' || acao === 'EXTEND' || acao === 'ACTIVATE') && (
                  <label className="pf-campo">
                    {acao === 'START_TRIAL' ? 'Teste até' : acao === 'EXTEND' ? 'Nova data de fim' : 'Período pago até (opcional)'}
                    <input type="date" value={ate} min={hojeMais(0)} onChange={(e) => setAte(e.target.value)} />
                  </label>
                )}
                <label className="pf-campo">
                  Nota (opcional, fica no histórico)
                  <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={500} placeholder="Ex.: combinado com o pároco por telefone" />
                </label>
                {erroAcao && <p className="pf-erro">{erroAcao}</p>}
                <div className="pf-acoes">
                  <button type="button" className="pf-btn" onClick={() => setAcao(null)} disabled={salvando}>
                    Voltar
                  </button>
                  <button
                    type="submit"
                    className={`pf-btn ${ACOES_PERIGOSAS.includes(acao) ? 'pf-btn-perigo-cheio' : 'pf-btn-primario'}`}
                    disabled={salvando}
                  >
                    {salvando ? 'Aplicando…' : ACTION_LABEL[acao]}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className="pf-caixa">
            <h3>Histórico</h3>
            {eventos === null && <p className="pf-mudo">Carregando…</p>}
            {erroEventos && <p className="pf-erro">{erroEventos}</p>}
            {eventos && eventos.length === 0 && !erroEventos && <p className="pf-mudo">Nenhuma mudança registrada.</p>}
            {eventos && eventos.length > 0 && (
              <ol className="pf-historico">
                {eventos.map((ev) => (
                  <li key={ev.id}>
                    <div className="pf-historico-topo">
                      <strong>{ACTION_LABEL[ev.action as Action] ?? ev.action}</strong>
                      <span className="pf-mudo">{dataHoraBR(ev.createdAt)}</span>
                    </div>
                    {(ev.fromStatus || ev.toStatus) && (
                      <div className="pf-historico-status">
                        <PlanBadge status={ev.fromStatus} /> <span aria-hidden="true">→</span> <PlanBadge status={ev.toStatus} />
                      </div>
                    )}
                    {ev.note && <p className="pf-historico-nota">{ev.note}</p>}
                    <small className="pf-mudo">{ev.byUserId ? 'por um administrador' : 'automático (sistema)'}</small>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Faixas e preços
// ---------------------------------------------------------------------------

interface TierForm {
  key: string;
  name: string;
  description: string;
  maxMembers: string;
  monthly: string;
  yearly: string;
  isActive: boolean;
  sortOrder: string;
}

const tierParaForm = (t?: Tier): TierForm => ({
  key: t?.key ?? '',
  name: t?.name ?? '',
  description: t?.description ?? '',
  maxMembers: t?.maxMembers != null ? String(t.maxMembers) : '',
  monthly: centavosParaCampo(t?.monthlyPriceCents),
  yearly: centavosParaCampo(t?.yearlyPriceCents),
  isActive: t?.isActive ?? true,
  sortOrder: t ? String(t.sortOrder) : '',
});

const FaixasEPrecos: React.FC<{ tiers: Tier[]; erro: string; carregando: boolean; onSaved: () => void }> = ({ tiers, erro, carregando, onSaved }) => {
  const [editando, setEditando] = useState<{ nova: boolean; form: TierForm } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');

  const abrir = (t?: Tier) => {
    setErroForm('');
    const form = tierParaForm(t);
    if (!t) form.sortOrder = String((tiers.reduce((m, x) => Math.max(m, x.sortOrder), 0) || 0) + 10);
    setEditando({ nova: !t, form });
  };
  const set = (campo: keyof TierForm, valor: string | boolean) =>
    setEditando((e) => (e ? { ...e, form: { ...e.form, [campo]: valor } } : e));

  const salvar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!editando) return;
    const f = editando.form;
    const key = f.key.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(key)) return setErroForm('Chave: só letras, números, "-" e "_" (ex.: ate-100).');
    if (!f.name.trim()) return setErroForm('Dê um nome à faixa.');
    const mensal = campoParaCentavos(f.monthly);
    const anual = campoParaCentavos(f.yearly);
    if (mensal == null || anual == null) return setErroForm('Informe os preços mensal e anual em reais.');
    const max = f.maxMembers.trim() ? Number(f.maxMembers) : null;
    if (max != null && (!Number.isInteger(max) || max <= 0)) return setErroForm('Limite de membros: número inteiro, ou vazio para sem limite.');
    setSalvando(true);
    setErroForm('');
    try {
      await api.put(`/platform/tiers/${encodeURIComponent(key)}`, {
        key,
        name: f.name.trim(),
        description: f.description.trim() || null,
        maxMembers: max,
        monthlyPriceCents: mensal,
        yearlyPriceCents: anual,
        isActive: f.isActive,
        sortOrder: Number(f.sortOrder) || 0,
      });
      notify.success('Faixa salva.');
      setEditando(null);
      onSaved();
    } catch (e) {
      setErroForm(mensagemDeErro(e, 'Não foi possível salvar a faixa.'));
    } finally {
      setSalvando(false);
    }
  };

  const ordenadas = [...tiers].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section className="pf-secao">
      <div className="pf-secao-cabeca">
        <div>
          <h2 className="pf-secao-titulo">Faixas e preços</h2>
          <p className="pf-meta">Preço por tamanho da comunidade (membros com conta). Mudar o preço não altera planos já ativos.</p>
        </div>
        <button type="button" className="pf-btn pf-btn-primario" onClick={() => abrir()}>
          Nova faixa
        </button>
      </div>
      {erro && <p className="pf-erro">{erro}</p>}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Faixa</th>
              <th className="pf-num">Até (membros)</th>
              <th className="pf-num">Mensal</th>
              <th className="pf-num">Anual</th>
              <th>Situação</th>
              <th className="pf-num">Ordem</th>
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {carregando && ordenadas.length === 0 && (
              <tr>
                <td colSpan={7} className="pf-vazio">Carregando…</td>
              </tr>
            )}
            {!carregando && ordenadas.length === 0 && (
              <tr>
                <td colSpan={7} className="pf-vazio">Nenhuma faixa cadastrada.</td>
              </tr>
            )}
            {ordenadas.map((t) => (
              <tr key={t.key} className={t.isActive ? undefined : 'pf-inativa'}>
                <td>
                  <strong className="pf-nome">{t.name}</strong>
                  <small className="pf-sub">
                    {t.key}
                    {t.description ? ` · ${t.description}` : ''}
                  </small>
                </td>
                <td className="pf-num">{t.maxMembers ? num(t.maxMembers) : 'sem limite'}</td>
                <td className="pf-num">{brl(t.monthlyPriceCents)}</td>
                <td className="pf-num">{brl(t.yearlyPriceCents)}</td>
                <td>
                  <span className={`status-badge ${t.isActive ? 'green' : 'gray'}`}>{t.isActive ? 'Ativa' : 'Inativa'}</span>
                </td>
                <td className="pf-num pf-mudo">{t.sortOrder}</td>
                <td className="pf-direita">
                  <button type="button" className="pf-btn pf-btn-mini" onClick={() => abrir(t)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <div className="module-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setEditando(null)}>
          <form className="module-modal pf-modal-faixa" onSubmit={salvar}>
            <h2>{editando.nova ? 'Nova faixa' : `Editar faixa “${editando.form.name}”`}</h2>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pf-tier-key">Chave</label>
                <input
                  id="pf-tier-key"
                  value={editando.form.key}
                  onChange={(e) => set('key', e.target.value)}
                  disabled={!editando.nova}
                  placeholder="ate-100"
                />
              </div>
              <div className="form-group">
                <label htmlFor="pf-tier-nome">Nome</label>
                <input id="pf-tier-nome" value={editando.form.name} onChange={(e) => set('name', e.target.value)} placeholder="Até 100 membros" />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="pf-tier-desc">Descrição</label>
              <textarea id="pf-tier-desc" rows={2} value={editando.form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pf-tier-max">Limite de membros com conta</label>
                <input
                  id="pf-tier-max"
                  inputMode="numeric"
                  value={editando.form.maxMembers}
                  onChange={(e) => set('maxMembers', e.target.value.replace(/\D/g, ''))}
                  placeholder="vazio = sem limite"
                />
              </div>
              <div className="form-group">
                <label htmlFor="pf-tier-ordem">Ordem na lista</label>
                <input id="pf-tier-ordem" inputMode="numeric" value={editando.form.sortOrder} onChange={(e) => set('sortOrder', e.target.value.replace(/[^\d-]/g, ''))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pf-tier-mensal">Preço mensal (R$)</label>
                <input id="pf-tier-mensal" inputMode="decimal" value={editando.form.monthly} onChange={(e) => set('monthly', e.target.value)} placeholder="49,90" />
              </div>
              <div className="form-group">
                <label htmlFor="pf-tier-anual">Preço anual (R$)</label>
                <input id="pf-tier-anual" inputMode="decimal" value={editando.form.yearly} onChange={(e) => set('yearly', e.target.value)} placeholder="499,00" />
              </div>
            </div>
            <label className="form-check">
              <input type="checkbox" checked={editando.form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              Faixa ativa (aparece na hora de ativar um plano)
            </label>
            {erroForm && <p className="pf-erro">{erroForm}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setEditando(null)} disabled={salvando}>
                Cancelar
              </button>
              <button type="submit" className="btn-submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar faixa'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

const PlansPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [aba, setAba] = useState<'comunidades' | 'faixas'>(searchParams.get('tab') === 'faixas' ? 'faixas' : 'comunidades');

  const [resumo, setResumo] = useState<Summary | null>(null);
  const [erroResumo, setErroResumo] = useState('');
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [erroTiers, setErroTiers] = useState('');
  const [carregandoTiers, setCarregandoTiers] = useState(true);

  const [status, setStatus] = useState<PlanStatus | ''>(() => {
    const s = searchParams.get('status');
    return s && s in PLAN_STATUS_LABEL ? (s as PlanStatus) : '';
  });
  const [uf, setUf] = useState(searchParams.get('state') ?? '');
  const [dioceseId, setDioceseId] = useState('');
  const [dioceses, setDioceses] = useState<Array<{ id: string; name: string }>>([]);
  const [busca, setBusca] = useState(searchParams.get('search') ?? '');
  const [buscaAplicada, setBuscaAplicada] = useState(searchParams.get('search') ?? '');
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aberta, setAberta] = useState<PlanRow | null>(null);
  // Comunidade pedida pela URL (?community=, vindo de "Ver plano" no Crescimento)
  const alvoRef = useRef<string | null>(searchParams.get('community'));
  const pedidoRef = useRef(0);

  const carregarResumo = useCallback(async () => {
    setErroResumo('');
    try {
      const { data } = await api.get('/platform/plans/summary');
      setResumo(data && typeof data === 'object' ? data : null);
    } catch (e) {
      setResumo(null);
      setErroResumo(mensagemDeErro(e, 'Não foi possível carregar o resumo dos planos.'));
    }
  }, []);

  const carregarTiers = useCallback(async () => {
    setCarregandoTiers(true);
    setErroTiers('');
    try {
      const { data } = await api.get('/platform/tiers');
      setTiers(Array.isArray(data) ? data : []);
    } catch (e) {
      setTiers([]);
      setErroTiers(mensagemDeErro(e, 'Não foi possível carregar as faixas.'));
    } finally {
      setCarregandoTiers(false);
    }
  }, []);

  const carregar = useCallback(async () => {
    const meu = ++pedidoRef.current;
    setCarregando(true);
    setErro('');
    try {
      const params: Record<string, string | number> = { limit: LIMITE, offset };
      if (status) params.status = status;
      if (uf) params.state = uf;
      if (dioceseId) params.dioceseId = dioceseId;
      if (buscaAplicada) params.search = buscaAplicada;
      const { data } = await api.get('/platform/plans', { params });
      if (meu !== pedidoRef.current) return;
      const lista: PlanRow[] = Array.isArray(data?.items) ? data.items : [];
      setRows(lista);
      setTotal(Number(data?.total) || 0);
      if (alvoRef.current) {
        const alvo = lista.find((r) => r.communityId === alvoRef.current);
        if (alvo) setAberta(alvo);
        alvoRef.current = null;
      }
    } catch (e) {
      if (meu !== pedidoRef.current) return;
      setRows([]);
      setTotal(0);
      setErro(mensagemDeErro(e, 'Não foi possível carregar os planos.'));
    } finally {
      if (meu === pedidoRef.current) setCarregando(false);
    }
  }, [status, uf, dioceseId, buscaAplicada, offset]);

  useEffect(() => {
    void carregarResumo();
    void carregarTiers();
  }, [carregarResumo, carregarTiers]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Dioceses do filtro: mesma fonte do mapa do território (só o SYSTEM_ADMIN chega aqui)
  useEffect(() => {
    api
      .get('/communities/map/dioceses', { params: uf ? { uf } : {} })
      .then((r) => setDioceses(Array.isArray(r.data) ? r.data : []))
      .catch(() => setDioceses([]));
    setDioceseId('');
  }, [uf]);

  // Filtro novo volta para a primeira página
  const mudarFiltro = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setOffset(0);
  };

  const trocarAba = (a: 'comunidades' | 'faixas') => {
    setAba(a);
    const p = new URLSearchParams(searchParams);
    if (a === 'faixas') p.set('tab', 'faixas');
    else p.delete('tab');
    setSearchParams(p, { replace: true });
  };

  const aoMudarPlano = (novo: PlanRow) => {
    setRows((atual) => atual.map((r) => (r.communityId === novo.communityId ? novo : r)));
    void carregarResumo();
    // A linha pode ter saído do filtro de status; recarrega a página atual
    void carregar();
  };

  const tierNome = useMemo(() => Object.fromEntries(tiers.map((t) => [t.key, t.name])), [tiers]);
  const by = resumo?.byStatus ?? {};
  const fim = Math.min(offset + rows.length, total);

  return (
    <div className="module-page platform-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="dizimo" /> Planos
        </h1>
      </div>

      <div className="pf-libera">
        <strong>O que o plano libera:</strong> {O_QUE_O_PLANO_LIBERA}
      </div>

      {/* Mesma causa (ex.: rota ainda não publicada) não aparece duas vezes */}
      {erroResumo && erroResumo !== erro && <p className="pf-erro">{erroResumo}</p>}
      {resumo && (
        <>
          <section className="pf-kpis pf-kpis-5" aria-label="Resumo dos planos">
            <StatTile label="Pagantes" value={num(by.ACTIVE ?? 0)} hint="planos ativos" onClick={() => mudarFiltro(setStatus)('ACTIVE')} />
            <StatTile label="Em teste" value={num(by.TRIAL ?? 0)} hint="teste gratuito em curso" onClick={() => mudarFiltro(setStatus)('TRIAL')} />
            <StatTile
              label="Teste vence em 15 dias"
              value={num(resumo.trialsEndingIn15d)}
              delta={resumo.trialsEndingIn15d > 0 ? { text: 'hora de conversar', tone: 'neutral' } : null}
              onClick={() => mudarFiltro(setStatus)('TRIAL')}
            />
            <StatTile
              label="Em atraso"
              value={num(resumo.pastDue)}
              delta={resumo.pastDue > 0 ? { text: 'cobrança pendente', tone: 'bad' } : null}
              onClick={() => mudarFiltro(setStatus)('PAST_DUE')}
            />
            <StatTile label="Receita mensal recorrente" value={brl(resumo.mrrCents)} hint="planos pagos, anual dividido por 12" />
          </section>
          <p className="pf-meta pf-resumo-linha">
            {PLAN_STATUSES.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && ' · '}
                {PLAN_STATUS_LABEL[s]}: <strong>{num(by[s] ?? 0)}</strong>
              </React.Fragment>
            ))}
          </p>
        </>
      )}

      <div className="module-tabs">
        <button type="button" className={`tab-btn${aba === 'comunidades' ? ' active' : ''}`} onClick={() => trocarAba('comunidades')}>
          Comunidades
        </button>
        <button type="button" className={`tab-btn${aba === 'faixas' ? ' active' : ''}`} onClick={() => trocarAba('faixas')}>
          Faixas e preços
        </button>
      </div>

      {aba === 'faixas' ? (
        <FaixasEPrecos tiers={tiers} erro={erroTiers} carregando={carregandoTiers} onSaved={() => void carregarTiers()} />
      ) : (
        <section>
          <div className="pf-filtros">
            <select value={status} onChange={(e) => mudarFiltro(setStatus)(e.target.value as PlanStatus | '')} aria-label="Situação do plano">
              <option value="">Todas as situações</option>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PLAN_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select value={uf} onChange={(e) => mudarFiltro(setUf)(e.target.value)} aria-label="Estado">
              <option value="">Todos os estados</option>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {dioceses.length > 0 && (
              <select value={dioceseId} onChange={(e) => mudarFiltro(setDioceseId)(e.target.value)} aria-label="Diocese" className="pf-select-largo">
                <option value="">Todas as dioceses</option>
                {dioceses.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            <form
              className="pf-busca"
              onSubmit={(e) => {
                e.preventDefault();
                setBuscaAplicada(busca.trim());
                setOffset(0);
              }}
            >
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar comunidade, cidade ou paróquia" />
              <button type="submit">Buscar</button>
              {buscaAplicada && (
                <button
                  type="button"
                  className="pf-link"
                  onClick={() => {
                    setBusca('');
                    setBuscaAplicada('');
                    setOffset(0);
                  }}
                >
                  limpar
                </button>
              )}
            </form>
          </div>

          {erro && (
            <p className="pf-erro">
              {erro}{' '}
              <button type="button" className="pf-link" onClick={() => void carregar()}>
                tentar de novo
              </button>
            </p>
          )}

          <div className="table-container">
            <table className="data-table pf-tabela-planos">
              <thead>
                <tr>
                  <th>Comunidade</th>
                  <th>Cidade/UF</th>
                  <th className="pf-num">Com conta</th>
                  <th>Plano</th>
                  <th className="pf-num">Valor</th>
                  <th>Próximo marco</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {!carregando && !erro && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="pf-vazio">
                      Nenhuma comunidade com esse filtro.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.communityId} className={aberta?.communityId === r.communityId ? 'pf-linha-on' : undefined}>
                    <td>
                      <strong className="pf-nome">{r.name}</strong>
                      <small className="pf-sub">
                        {r.parish?.name ?? '—'}
                        {r.diocese ? ` · ${r.diocese.name}` : ''}
                      </small>
                    </td>
                    <td>
                      {r.city}/{r.state}
                    </td>
                    <td className="pf-num">{num(r.membersWithAccount)}</td>
                    <td>
                      <PlanBadge status={r.plan?.status} />
                      {r.plan?.tierKey && <small className="pf-sub">{tierNome[r.plan.tierKey] ?? r.plan.tierKey}</small>}
                    </td>
                    <td className="pf-num">
                      {r.plan?.priceCents != null && r.plan.status !== 'FREE' ? (
                        <>
                          {brl(r.plan.priceCents)}
                          {r.plan.billingCycle && <small className="pf-sub">{CYCLE_LABEL[r.plan.billingCycle]}</small>}
                        </>
                      ) : (
                        <span className="pf-mudo">—</span>
                      )}
                    </td>
                    <td>
                      <Marco plan={r.plan} />
                    </td>
                    <td className="pf-direita">
                      <button type="button" className="pf-btn pf-btn-mini" onClick={() => setAberta(r)}>
                        Gerenciar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pf-paginacao">
            <span className="pf-mudo">
              {carregando ? 'Carregando…' : total > 0 ? `${num(offset + 1)}–${num(fim)} de ${num(total)}` : ''}
            </span>
            <div className="pf-acoes">
              <button type="button" className="pf-btn pf-btn-mini" disabled={offset === 0 || carregando} onClick={() => setOffset(Math.max(offset - LIMITE, 0))}>
                ← Anterior
              </button>
              <button type="button" className="pf-btn pf-btn-mini" disabled={fim >= total || carregando} onClick={() => setOffset(offset + LIMITE)}>
                Próxima →
              </button>
            </div>
          </div>
        </section>
      )}

      {aberta && <PainelDoPlano row={aberta} tiers={tiers} onClose={() => setAberta(null)} onChanged={aoMudarPlano} />}
    </div>
  );
};

export default PlansPage;
