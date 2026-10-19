import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import TitleIcon from '../components/TitleIcon';
import SearchSelect from '../components/SearchSelect';
import { useAuth } from '../contexts/AuthContext';
import api, { getErrorMessage } from '../services/api';
import { track, trackOnce } from '../services/analytics';
import { notify } from '../services/notification.service';
import { maskBrPhone, phoneForApi } from '../utils/phone';
import { isPagedResponse, useDebouncedValue } from '../utils/useDebouncedValue';
import type { AccessRule } from '../components/accessRules';
import { PlanBadge, brl, dataBR, diasAte, num, O_QUE_O_PLANO_LIBERA, UFS } from './platform/platformShared';
import { SUPPORT_EMAIL, supportMailto, supportWhatsappUrl } from './public/LandingSupport';
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_TONE,
  BILLING_TYPE_LABEL,
  type BillingAccount,
  type BillingAccountStatus,
  type BillingCycle,
  type BillingMe,
  isPilot,
  isValidDocument,
  maskCep,
  maskDocument,
  onlyDigits,
  parseBillingMe,
  paymentStatusLabel,
  suggestTier,
  tierPrice,
} from './MyPlanPage.billing';
import './modules/ModulePages.css';
import './MyPlanPage.css';

/**
 * "Meu plano" (saas-implantacao-07 / -03, eng-acessos-24): o plano de cada
 * comunidade da paróquia, as cobranças, os dados de faturamento e a
 * contratação online (fatura do Asaas da empresa — Pix, boleto ou cartão).
 * PARISH_ADMIN vê a própria paróquia; DIOCESAN/SYSTEM escolhem a paróquia.
 */

/** Regra de acesso da rota (usada no App.tsx e no menu). */
export const MY_PLAN_ACCESS: AccessRule = { roles: ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN'] };

interface ParishOption {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  diocese?: { name?: string | null } | null;
}

type AccountForm = {
  legalName: string;
  document: string;
  email: string;
  phone: string;
  responsibleName: string;
  municipalRegistration: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

const EMPTY_FORM: AccountForm = {
  legalName: '',
  document: '',
  email: '',
  phone: '',
  responsibleName: '',
  municipalRegistration: '',
  zipCode: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
};

const formFromAccount = (a: BillingAccount | null): AccountForm =>
  a
    ? {
        legalName: a.legalName ?? '',
        document: maskDocument(a.document),
        email: a.email ?? '',
        phone: maskBrPhone(a.phone ?? ''),
        responsibleName: a.responsibleName ?? '',
        municipalRegistration: a.municipalRegistration ?? '',
        zipCode: maskCep(a.zipCode),
        street: a.street ?? '',
        number: a.number ?? '',
        complement: a.complement ?? '',
        neighborhood: a.neighborhood ?? '',
        city: a.city ?? '',
        state: a.state ?? '',
      }
    : EMPTY_FORM;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const CYCLE_LABEL: Record<BillingCycle, string> = { MONTHLY: 'mensal', YEARLY: 'anual' };

const MyPlanPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const escolheParoquia = role === 'SYSTEM_ADMIN' || role === 'DIOCESAN_ADMIN';
  // Contratar, salvar dados e cancelar: PARISH_ADMIN da paróquia ou SYSTEM_ADMIN (diocese só consulta)
  const podeGerir = role === 'PARISH_ADMIN' || role === 'SYSTEM_ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const parishId = escolheParoquia ? searchParams.get('parish') ?? '' : user?.parishId ?? '';

  // ── Seletor de paróquia (DIOCESAN/SYSTEM): busca paginada no escopo ──
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebouncedValue(busca.trim(), 350);
  const [opcoes, setOpcoes] = useState<ParishOption[]>([]);
  const [escolhida, setEscolhida] = useState<ParishOption | null>(null);
  useEffect(() => {
    if (!escolheParoquia) return;
    let ativo = true;
    api
      .get('/parishes', { params: { page: 1, pageSize: 20, search: buscaDebounced || undefined } })
      .then(({ data }) => {
        if (!ativo) return;
        setOpcoes(isPagedResponse<ParishOption>(data) ? data.items : Array.isArray(data) ? data.slice(0, 200) : []);
      })
      .catch(() => ativo && setOpcoes([]));
    return () => {
      ativo = false;
    };
  }, [escolheParoquia, buscaDebounced]);
  const opcoesSelect = useMemo(() => {
    const list = [...opcoes];
    if (escolhida && !list.some((p) => p.id === escolhida.id)) list.unshift(escolhida);
    return list.map((p) => ({
      value: p.id,
      label: p.name,
      sublabel: [p.city && p.state ? `${p.city}/${p.state}` : p.city, p.diocese?.name].filter(Boolean).join(' · ') || undefined,
    }));
  }, [opcoes, escolhida]);

  // ── Dados do plano ──
  const [dados, setDados] = useState<BillingMe | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!parishId) {
      setDados(null);
      return;
    }
    setCarregando(true);
    setErro('');
    try {
      const { data } = await api.get('/billing/me', { params: { parishId } });
      setDados(parseBillingMe(data));
    } catch (e) {
      setDados(null);
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      setErro(
        status === 404 && !(axios.isAxiosError(e) && typeof e.response?.data?.message === 'string' && !/^Cannot /.test(e.response.data.message))
          ? 'Esta função ainda não está no ar no servidor. Tente de novo mais tarde.'
          : getErrorMessage(e, 'Não foi possível carregar o plano da paróquia.'),
      );
    } finally {
      setCarregando(false);
    }
  }, [parishId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    trackOnce('web_billing');
  }, []);

  // ── Contratação: comunidades escolhidas, faixa por comunidade e ciclo ──
  const [ciclo, setCiclo] = useState<BillingCycle>('MONTHLY');
  const [selecao, setSelecao] = useState<Record<string, string>>({}); // communityId -> tierKey
  const contrataveis = useMemo(() => (dados?.communities ?? []).filter((c) => !isPilot(c)), [dados]);

  // Assinatura viva: o checkout ALTERA a assinatura e ela passa a cobrir exatamente as marcadas
  const assinaturaViva = !!dados?.billingAccount && ['PENDING', 'ACTIVE', 'PAST_DUE'].includes(String(dados.billingAccount.status ?? ''));

  useEffect(() => {
    // Ao carregar: com assinatura viva, marca as comunidades que ela já cobre
    // (desmarcar = tirar da assinatura); sem assinatura, marca quem não tem plano pago
    if (!dados) return;
    const contaId = dados.billingAccount?.id ?? null;
    const viva = !!dados.billingAccount && ['PENDING', 'ACTIVE', 'PAST_DUE'].includes(String(dados.billingAccount.status ?? ''));
    const inicial: Record<string, string> = {};
    for (const c of dados.communities) {
      if (isPilot(c)) continue;
      const naAssinatura = !!contaId && c.plan?.billingAccountId === contaId;
      const st = c.plan?.status ?? 'FREE';
      if (viva ? naAssinatura : naAssinatura || st !== 'ACTIVE') {
        inicial[c.id] = suggestTier(dados.tiers, c.plan?.activeMembers, c.plan?.tierKey);
      }
    }
    setSelecao(inicial);
    if (dados.billingAccount?.billingCycle === 'YEARLY') setCiclo('YEARLY');
  }, [dados]);

  const tierByKey = useMemo(() => new Map((dados?.tiers ?? []).map((t) => [t.key, t])), [dados]);
  const itens = Object.entries(selecao).filter(([, k]) => !!k);
  const total = itens.reduce((acc, [, k]) => acc + (tierPrice(tierByKey.get(k), ciclo) ?? 0), 0);
  const algumSemPreco = itens.some(([, k]) => tierPrice(tierByKey.get(k), ciclo) === null);

  const alternar = (communityId: string, activeMembers: number | null | undefined, tierKey: string | null | undefined) => {
    setSelecao((prev) => {
      const next = { ...prev };
      if (next[communityId] !== undefined) delete next[communityId];
      else next[communityId] = suggestTier(dados?.tiers ?? [], activeMembers, tierKey);
      return next;
    });
  };

  // ── Checkout ──
  const [contratando, setContratando] = useState(false);
  const [fatura, setFatura] = useState<{ invoiceUrl: string; valueCents: number | null; nextDueDate: string | null } | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);

  const contratar = async () => {
    if (!dados || !parishId) return;
    if (!dados.billingAccount) {
      notify.warning('Preencha e salve os dados de faturamento antes de contratar.');
      document.getElementById('myplan-faturamento')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (itens.length === 0) {
      notify.warning('Escolha ao menos uma comunidade.');
      return;
    }
    setContratando(true);
    setFatura(null);
    track('checkout_started');
    try {
      const { data } = await api.post('/billing/checkout', {
        parishId,
        cycle: ciclo,
        items: itens.map(([communityId, tierKey]) => ({ communityId, tierKey })),
      });
      const url = typeof data?.invoiceUrl === 'string' && /^https:\/\//i.test(data.invoiceUrl) ? data.invoiceUrl : '';
      const avisos: string[] = Array.isArray(data?.warnings) ? data.warnings.filter((w: unknown) => typeof w === 'string') : [];
      avisos.forEach((w) => notify.warning(w));
      if (!url) {
        // Alteração de assinatura sem cobrança em aberto: o novo valor vale na próxima fatura
        notify.success(
          data?.created === false
            ? `Assinatura atualizada${typeof data?.valueCents === 'number' ? ` para ${brl(data.valueCents)}` : ''}. O novo valor vale a partir da próxima cobrança.`
            : 'Assinatura criada. A fatura aparece em "Cobranças" em instantes; atualize a página se não aparecer.',
        );
      } else {
        setFatura({
          invoiceUrl: url,
          valueCents: typeof data?.valueCents === 'number' ? data.valueCents : null,
          nextDueDate: typeof data?.nextDueDate === 'string' ? data.nextDueDate : null,
        });
        // Abre em nova aba (o bloqueador de pop-up pode impedir: o link fica na tela)
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      void carregar();
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      const code = axios.isAxiosError(e) ? e.response?.data?.code : undefined;
      if (status === 503 && code === 'CHECKOUT_UNAVAILABLE') {
        setIndisponivel(true);
      } else {
        notify.error(getErrorMessage(e, 'Não foi possível criar a cobrança.'));
      }
    } finally {
      setContratando(false);
    }
  };

  // ── Dados de faturamento ──
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [editandoConta, setEditandoConta] = useState(false);
  const [salvandoConta, setSalvandoConta] = useState(false);
  const [erroConta, setErroConta] = useState('');
  useEffect(() => {
    // Sem conta ainda: começa com o nome, o CNPJ e a cidade da paróquia
    const p = dados?.parish;
    setForm(
      dados?.billingAccount
        ? formFromAccount(dados.billingAccount)
        : {
            ...EMPTY_FORM,
            legalName: p?.name ?? '',
            document: maskDocument(p?.cnpj ?? ''),
            city: p?.city ?? '',
            state: p?.state ?? '',
          },
    );
    setEditandoConta(!dados?.billingAccount);
    setErroConta('');
  }, [dados]);
  const setCampo = (k: keyof AccountForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const salvarConta = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroConta('');
    if (form.legalName.trim().length < 3) return setErroConta('Informe a razão social ou o nome do responsável pelo pagamento.');
    if (!isValidDocument(form.document)) return setErroConta('CNPJ ou CPF inválido. Confira os números.');
    if (!EMAIL_RE.test(form.email.trim())) return setErroConta('Informe um e-mail válido para receber as faturas.');
    const cep = onlyDigits(form.zipCode);
    if (cep && cep.length !== 8) return setErroConta('O CEP tem 8 dígitos.');
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    setSalvandoConta(true);
    try {
      await api.put('/billing/account', {
        parishId,
        legalName: form.legalName.trim(),
        document: onlyDigits(form.document),
        email: form.email.trim(),
        phone: phoneForApi(form.phone) || undefined,
        responsibleName: opt(form.responsibleName),
        municipalRegistration: opt(form.municipalRegistration),
        zipCode: cep || undefined,
        street: opt(form.street),
        number: opt(form.number),
        complement: opt(form.complement),
        neighborhood: opt(form.neighborhood),
        city: opt(form.city),
        state: form.state || undefined,
      });
      notify.success('Dados de faturamento salvos.');
      await carregar();
    } catch (err) {
      setErroConta(getErrorMessage(err, 'Não foi possível salvar os dados de faturamento.'));
    } finally {
      setSalvandoConta(false);
    }
  };

  // ── Cancelamento ──
  const [cancelarAberto, setCancelarAberto] = useState(false);
  const [entendi, setEntendi] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [erroCancelar, setErroCancelar] = useState('');
  const conta = dados?.billingAccount ?? null;
  const contaStatus = (conta?.status ?? 'NONE') as BillingAccountStatus;
  const podeCancelar = !!conta && ['PENDING', 'ACTIVE', 'PAST_DUE'].includes(contaStatus);

  const cancelar = async () => {
    setCancelando(true);
    setErroCancelar('');
    try {
      await api.post('/billing/cancel', { parishId });
      notify.success('Assinatura cancelada. Os planos seguem ativos até o fim do período já pago.');
      setCancelarAberto(false);
      setEntendi(false);
      await carregar();
    } catch (e) {
      setErroCancelar(getErrorMessage(e, 'Não foi possível cancelar a assinatura.'));
    } finally {
      setCancelando(false);
    }
  };

  const whatsSuporte = supportWhatsappUrl(
    `Olá! Quero contratar o Parish para a ${dados?.parish?.name ?? 'minha paróquia'}.`,
  );
  const checkoutFechado = indisponivel || dados?.checkoutAvailable === false;

  return (
    <div className="module-page myplan-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="dizimo" /> Meu plano
        </h1>
        <div className="header-actions">
          <button type="button" className="btn-secondary" onClick={() => void carregar()} disabled={carregando || !parishId}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {escolheParoquia && (
        <div className="myplan-seletor">
          <span className="myplan-rotulo">Paróquia</span>
          <SearchSelect
            options={opcoesSelect}
            value={parishId}
            onChange={(id) => {
              setEscolhida(opcoes.find((p) => p.id === id) ?? null);
              const next = new URLSearchParams(searchParams);
              if (id) next.set('parish', id);
              else next.delete('parish');
              setSearchParams(next, { replace: true });
            }}
            placeholder="Escolha a paróquia"
            searchPlaceholder="Buscar paróquia ou cidade..."
            onSearchChange={setBusca}
          />
        </div>
      )}

      {!parishId && (
        <p className="myplan-vazio">
          {escolheParoquia ? 'Escolha uma paróquia para ver os planos.' : 'Sua conta não está ligada a uma paróquia.'}
        </p>
      )}

      {erro && (
        <p className="myplan-erro" role="alert">
          {erro}{' '}
          <button type="button" className="myplan-link" onClick={() => void carregar()}>
            tentar de novo
          </button>
        </p>
      )}
      {carregando && !dados && parishId && <p className="myplan-vazio">Carregando…</p>}

      {dados && (
        <>
          <p className="myplan-libera">
            <strong>O plano libera, por comunidade:</strong> {O_QUE_O_PLANO_LIBERA}
          </p>

          {/* ── Assinatura ── */}
          <section className="myplan-card" aria-labelledby="myplan-assinatura">
            <div className="myplan-card-topo">
              <h2 id="myplan-assinatura">Assinatura {dados.parish?.name ? `· ${dados.parish.name}` : ''}</h2>
              <span className={`status-badge ${ACCOUNT_STATUS_TONE[contaStatus] ?? 'gray'}`}>
                {ACCOUNT_STATUS_LABEL[contaStatus] ?? contaStatus}
              </span>
            </div>
            {conta && contaStatus !== 'NONE' ? (
              <dl className="myplan-dl">
                <dt>Ciclo</dt>
                <dd>{conta.billingCycle ? CYCLE_LABEL[conta.billingCycle] : '—'}</dd>
                <dt>Valor por ciclo</dt>
                <dd>{brl(conta.valueCents)}</dd>
                <dt>Próximo vencimento</dt>
                <dd>{dataBR(conta.nextDueDate)}</dd>
              </dl>
            ) : (
              <p className="myplan-meta">
                Nenhuma assinatura contratada. As comunidades novas da paróquia têm {dados.trialDays} dias de teste.
              </p>
            )}
            {contaStatus === 'PAST_DUE' && (
              <p className="myplan-alerta">
                Há cobrança vencida. Pague pela fatura em "Cobranças" para manter os recursos do plano. Nenhum dado é
                apagado.
              </p>
            )}
            {podeCancelar && podeGerir && (
              <div className="myplan-acoes">
                <button type="button" className="btn-small danger" onClick={() => setCancelarAberto(true)}>
                  Cancelar assinatura
                </button>
              </div>
            )}
          </section>

          {/* ── Comunidades ── */}
          <section className="myplan-card" aria-labelledby="myplan-comunidades">
            <h2 id="myplan-comunidades">Comunidades</h2>
            <p className="myplan-meta">
              Marque as comunidades que vão entrar na assinatura e escolha a faixa de cada uma. Membros ativos contam
              também quem entrou pelo app.
            </p>
            <div className="table-container">
              <table className="data-table myplan-tabela">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="myplan-sr">Contratar</span>
                    </th>
                    <th scope="col">Comunidade</th>
                    <th scope="col">Situação</th>
                    <th scope="col" className="myplan-num">
                      Membros ativos
                    </th>
                    <th scope="col">Teste até / vencimento</th>
                    <th scope="col">Faixa</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.communities.length === 0 && (
                    <tr>
                      <td colSpan={6} className="myplan-vazio">
                        Nenhuma comunidade ativa nesta paróquia.
                      </td>
                    </tr>
                  )}
                  {dados.communities.map((c) => {
                    const p = c.plan;
                    const piloto = isPilot(c);
                    const marcado = selecao[c.id] !== undefined;
                    const ativos = p?.activeMembers ?? null;
                    const limite = p?.maxMembers ?? null;
                    const passou = limite !== null && ativos !== null && ativos > limite;
                    const dias = p?.status === 'TRIAL' ? diasAte(p.trialEndsAt) : null;
                    const tierEscolhida = tierByKey.get(selecao[c.id] ?? '');
                    const cabe = !tierEscolhida || tierEscolhida.maxMembers === null || ativos === null || ativos <= tierEscolhida.maxMembers;
                    return (
                      <tr key={c.id} className={marcado ? 'myplan-linha-on' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Incluir ${c.name} na contratação`}
                            checked={marcado}
                            disabled={piloto || !podeGerir}
                            onChange={() => alternar(c.id, ativos, p?.tierKey)}
                          />
                        </td>
                        <td>
                          <strong>{c.name}</strong>
                          {p?.tierName && <span className="myplan-sub">Faixa atual: {p.tierName}</span>}
                        </td>
                        <td>
                          {piloto ? <span className="status-badge green">Acesso de piloto</span> : <PlanBadge status={p?.status ?? null} />}
                        </td>
                        <td className="myplan-num">
                          <span className={passou ? 'myplan-urgente' : undefined}>
                            {num(ativos)}
                            {limite !== null ? ` / ${num(limite)}` : ''}
                          </span>
                        </td>
                        <td>
                          {p?.status === 'TRIAL' ? (
                            <>
                              {dataBR(p.trialEndsAt)}
                              {dias !== null && dias >= 0 && (
                                <span className={`myplan-sub${dias <= 7 ? ' myplan-urgente' : ''}`}>
                                  {dias === 0 ? 'termina hoje' : dias === 1 ? 'falta 1 dia' : `faltam ${dias} dias`}
                                </span>
                              )}
                            </>
                          ) : p?.currentPeriodEnd ? (
                            dataBR(p.currentPeriodEnd)
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {marcado ? (
                            <>
                              <select
                                aria-label={`Faixa de ${c.name}`}
                                value={selecao[c.id]}
                                onChange={(e) => setSelecao((prev) => ({ ...prev, [c.id]: e.target.value }))}
                              >
                                {dados.tiers.map((t) => (
                                  <option key={t.key} value={t.key}>
                                    {t.name} · {brl(tierPrice(t, ciclo))}/{ciclo === 'MONTHLY' ? 'mês' : 'ano'}
                                  </option>
                                ))}
                              </select>
                              {!cabe && <span className="myplan-sub myplan-urgente">A comunidade já passa do limite desta faixa.</span>}
                            </>
                          ) : piloto ? (
                            <span className="myplan-sub">Sem cobrança</span>
                          ) : (
                            <span className="myplan-sub">{p?.priceCents ? `${brl(p.priceCents)}` : '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Contratar ── */}
            {contrataveis.length > 0 && !podeGerir && (
              <p className="myplan-meta">A contratação é feita pela administração da paróquia.</p>
            )}
            {contrataveis.length > 0 && podeGerir && (
              <div className="myplan-checkout">
                <div className="myplan-ciclo" role="group" aria-label="Ciclo de pagamento">
                  <button type="button" className={ciclo === 'MONTHLY' ? 'on' : ''} aria-pressed={ciclo === 'MONTHLY'} onClick={() => setCiclo('MONTHLY')}>
                    Mensal
                  </button>
                  <button type="button" className={ciclo === 'YEARLY' ? 'on' : ''} aria-pressed={ciclo === 'YEARLY'} onClick={() => setCiclo('YEARLY')}>
                    Anual (paga 10 meses)
                  </button>
                </div>
                <div className="myplan-total" aria-live="polite">
                  <span>
                    {itens.length} {itens.length === 1 ? 'comunidade' : 'comunidades'} · total estimado {ciclo === 'MONTHLY' ? 'por mês' : 'por ano'}
                  </span>
                  <strong>{algumSemPreco ? 'sob consulta' : brl(total)}</strong>
                </div>
                {checkoutFechado ? (
                  <div className="myplan-indisponivel" role="status">
                    <strong>Contratação online em breve.</strong> Fale com o Parish para ativar o plano:{' '}
                    <a href={supportMailto(`Contratar o Parish — ${dados.parish?.name ?? ''}`)}>{SUPPORT_EMAIL}</a>
                    {whatsSuporte && (
                      <>
                        {' · '}
                        <a href={whatsSuporte} target="_blank" rel="noopener noreferrer">
                          WhatsApp
                        </a>
                      </>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void contratar()}
                    disabled={contratando || itens.length === 0}
                    aria-busy={contratando}
                  >
                    {contratando ? 'Gerando a fatura…' : assinaturaViva ? 'Atualizar assinatura' : 'Contratar'}
                  </button>
                )}
                {assinaturaViva && (
                  <p className="myplan-meta">
                    Já existe uma assinatura: ao atualizar, ela passa a cobrir exatamente as comunidades marcadas. Quem
                    for desmarcado segue com o plano até o fim do período já pago.
                  </p>
                )}
                <p className="myplan-meta">
                  A fatura abre na página do Asaas, o parceiro de pagamentos do Parish. Dá para pagar por Pix, boleto ou
                  cartão. Quando o pagamento é confirmado, os planos ficam ativos sozinhos (Pix em minutos; boleto em
                  até 3 dias úteis). A cobrança é sempre por aqui, nunca dentro do app.
                </p>
                {fatura && (
                  <div className="myplan-fatura" role="status">
                    <p>
                      Fatura gerada{fatura.valueCents !== null ? ` de ${brl(fatura.valueCents)}` : ''}
                      {fatura.nextDueDate ? `, vencimento ${dataBR(fatura.nextDueDate)}` : ''}. Se ela não abriu numa
                      nova aba, use o botão:
                    </p>
                    <a className="btn-primary" href={fatura.invoiceUrl} target="_blank" rel="noopener noreferrer">
                      Abrir a fatura
                    </a>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Cobranças ── */}
          <section className="myplan-card" aria-labelledby="myplan-cobrancas">
            <h2 id="myplan-cobrancas">Cobranças</h2>
            {dados.payments.length === 0 ? (
              <p className="myplan-meta">Nenhuma cobrança ainda.</p>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Vencimento</th>
                      <th scope="col" className="myplan-num">
                        Valor
                      </th>
                      <th scope="col">Situação</th>
                      <th scope="col">Forma</th>
                      <th scope="col">Pago em</th>
                      <th scope="col">Documentos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.payments.map((pg) => {
                      const st = paymentStatusLabel(pg.status);
                      return (
                        <tr key={pg.id}>
                          <td>{dataBR(pg.dueDate)}</td>
                          <td className="myplan-num">{brl(pg.valueCents)}</td>
                          <td>
                            <span className={`status-badge ${st.tone}`}>{st.label}</span>
                          </td>
                          <td>{pg.billingType ? BILLING_TYPE_LABEL[pg.billingType] ?? pg.billingType : '—'}</td>
                          <td>{dataBR(pg.paidAt)}</td>
                          <td className="myplan-docs">
                            {pg.invoiceUrl && /^https:\/\//i.test(pg.invoiceUrl) && (
                              <a href={pg.invoiceUrl} target="_blank" rel="noopener noreferrer">
                                Fatura
                              </a>
                            )}
                            {pg.nfseUrl && /^https:\/\//i.test(pg.nfseUrl) && (
                              <a href={pg.nfseUrl} target="_blank" rel="noopener noreferrer">
                                Nota fiscal
                              </a>
                            )}
                            {!pg.invoiceUrl && !pg.nfseUrl && '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Dados de faturamento ── */}
          <section className="myplan-card" id="myplan-faturamento" aria-labelledby="myplan-fat-titulo">
            <div className="myplan-card-topo">
              <h2 id="myplan-fat-titulo">Dados de faturamento</h2>
              {conta && !editandoConta && podeGerir && (
                <button type="button" className="btn-secondary" onClick={() => setEditandoConta(true)}>
                  Editar
                </button>
              )}
            </div>
            {!conta && !podeGerir ? (
              <p className="myplan-meta">A paróquia ainda não informou os dados de faturamento.</p>
            ) : (conta && !editandoConta) || !podeGerir ? (
              <dl className="myplan-dl">
                <dt>Razão social / nome</dt>
                <dd>{conta?.legalName}</dd>
                <dt>CNPJ / CPF</dt>
                <dd>{maskDocument(conta?.document)}</dd>
                <dt>E-mail das faturas</dt>
                <dd>{conta?.email}</dd>
                {conta?.responsibleName && (
                  <>
                    <dt>Responsável</dt>
                    <dd>{conta.responsibleName}</dd>
                  </>
                )}
                {(conta?.city || conta?.street) && (
                  <>
                    <dt>Endereço</dt>
                    <dd>
                      {[conta?.street, conta?.number, conta?.complement, conta?.neighborhood].filter(Boolean).join(', ')}
                      {conta?.city ? ` — ${conta.city}${conta.state ? `/${conta.state}` : ''}` : ''}
                      {conta?.zipCode ? ` · CEP ${maskCep(conta.zipCode)}` : ''}
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <form className="myplan-form" onSubmit={salvarConta} noValidate>
                <p className="myplan-meta">
                  Quem paga é a paróquia. Use o CNPJ da paróquia (ou da mitra) e o e-mail que deve receber as faturas.
                </p>
                <div className="myplan-grid">
                  <label className="myplan-campo myplan-largo">
                    <span>Razão social ou nome *</span>
                    <input value={form.legalName} onChange={(e) => setCampo('legalName', e.target.value)} maxLength={150} />
                  </label>
                  <label className="myplan-campo">
                    <span>CNPJ ou CPF *</span>
                    <input
                      inputMode="numeric"
                      value={form.document}
                      onChange={(e) => setCampo('document', maskDocument(e.target.value))}
                      placeholder="00.000.000/0000-00"
                    />
                  </label>
                  <label className="myplan-campo">
                    <span>Inscrição municipal</span>
                    <input value={form.municipalRegistration} onChange={(e) => setCampo('municipalRegistration', e.target.value)} maxLength={30} />
                  </label>
                  <label className="myplan-campo">
                    <span>E-mail das faturas *</span>
                    <input type="email" value={form.email} onChange={(e) => setCampo('email', e.target.value)} maxLength={160} />
                  </label>
                  <label className="myplan-campo">
                    <span>Telefone</span>
                    <input type="tel" value={form.phone} onChange={(e) => setCampo('phone', maskBrPhone(e.target.value))} placeholder="(42) 99999-8888" />
                  </label>
                  <label className="myplan-campo myplan-largo">
                    <span>Responsável (nome)</span>
                    <input value={form.responsibleName} onChange={(e) => setCampo('responsibleName', e.target.value)} maxLength={120} />
                  </label>
                  <label className="myplan-campo">
                    <span>CEP</span>
                    <input inputMode="numeric" value={form.zipCode} onChange={(e) => setCampo('zipCode', maskCep(e.target.value))} placeholder="00000-000" />
                  </label>
                  <label className="myplan-campo myplan-largo">
                    <span>Rua</span>
                    <input value={form.street} onChange={(e) => setCampo('street', e.target.value)} maxLength={150} />
                  </label>
                  <label className="myplan-campo">
                    <span>Número</span>
                    <input value={form.number} onChange={(e) => setCampo('number', e.target.value)} maxLength={20} />
                  </label>
                  <label className="myplan-campo">
                    <span>Complemento</span>
                    <input value={form.complement} onChange={(e) => setCampo('complement', e.target.value)} maxLength={80} />
                  </label>
                  <label className="myplan-campo">
                    <span>Bairro</span>
                    <input value={form.neighborhood} onChange={(e) => setCampo('neighborhood', e.target.value)} maxLength={80} />
                  </label>
                  <label className="myplan-campo">
                    <span>Cidade</span>
                    <input value={form.city} onChange={(e) => setCampo('city', e.target.value)} maxLength={80} />
                  </label>
                  <label className="myplan-campo">
                    <span>UF</span>
                    <select value={form.state} onChange={(e) => setCampo('state', e.target.value)}>
                      <option value="">—</option>
                      {UFS.map((uf) => (
                        <option key={uf} value={uf}>
                          {uf}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {erroConta && (
                  <p className="myplan-erro" role="alert">
                    {erroConta}
                  </p>
                )}
                <div className="myplan-acoes">
                  {conta && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setForm(formFromAccount(conta));
                        setEditandoConta(false);
                        setErroConta('');
                      }}
                      disabled={salvandoConta}
                    >
                      Cancelar
                    </button>
                  )}
                  <button type="submit" className="btn-primary" disabled={salvandoConta}>
                    {salvandoConta ? 'Salvando…' : 'Salvar dados de faturamento'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </>
      )}

      {cancelarAberto && (
        <div className="module-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !cancelando && setCancelarAberto(false)}>
          <div className="module-modal myplan-modal" role="dialog" aria-modal="true" aria-labelledby="myplan-cancelar-titulo">
            <h2 id="myplan-cancelar-titulo">Cancelar a assinatura?</h2>
            <p>
              As próximas cobranças deixam de ser geradas. As comunidades seguem com o plano até o fim do período já pago
              {conta?.nextDueDate ? ` (próximo vencimento: ${dataBR(conta.nextDueDate)})` : ''}. Depois disso, pastorais,
              escalas, catequese e os demais recursos do plano ficam suspensos; calendário, mapa e liturgia continuam
              liberados.
            </p>
            <p>
              <strong>Nenhum dado é apagado.</strong> Você pode contratar de novo quando quiser.
            </p>
            <label className="form-check">
              <input type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} />
              Entendi e quero cancelar a assinatura da paróquia.
            </label>
            {erroCancelar && (
              <p className="myplan-erro" role="alert">
                {erroCancelar}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setCancelarAberto(false);
                  setEntendi(false);
                }}
                disabled={cancelando}
              >
                Voltar
              </button>
              <button type="button" className="btn-submit myplan-btn-perigo" onClick={() => void cancelar()} disabled={!entendi || cancelando}>
                {cancelando ? 'Cancelando…' : 'Cancelar assinatura'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyPlanPage;
