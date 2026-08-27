import React, { useState, useEffect, useCallback, useRef } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import { useAuth } from '../../contexts/AuthContext';
import CampaignsTab from './finance/CampaignsTab';
import PresentialTab from './finance/PresentialTab';
import StatementsTab from './finance/StatementsTab';
import { formatBRL, httpStatus, friendlyError, plural, downloadBlob } from './finance/financeShared';
import './ModulePages.css';

interface Transaction {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  category: string;
  amount: number;
  description?: string | null;
  date: string;
  /** Centro de custo (agrupa receitas e despesas no balancete mensal) */
  costCenter?: string | null;
}

interface Summary {
  income: number;
  expense: number;
  balance: number;
  count: number;
}

interface Tither {
  id: string;
  registrationNumber?: string | null;
  status: string;
  member: { id: string; fullName: string };
  _count?: { contributions: number };
}

interface Contribution {
  contributionId: string;
  member: { id: string; name: string };
  amount: number;
  method: string;
  date: string;
}

interface Community {
  id: string;
  name: string;
  parishId?: string;
}

interface Member {
  id: string;
  fullName: string;
}

const METHODS = ['Dinheiro', 'PIX', 'Cartão', 'Transferência', 'Envelope'];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

interface ProviderSetupResult {
  pixKeyReady: boolean;
  pixKey?: string | null;
  webhookRegistered: boolean;
  webhookId?: string | null;
  notes: string[];
}

interface OnlineIntent {
  id: string;
  /** id null = oferta anônima (sem fiel vinculado) */
  member: { id: string | null; fullName: string; community: string | null };
  amount: number;
  referenceMonth: string;
  kind: 'TITHE' | 'OFFERING';
  status: 'CREATED' | 'DECLARED' | 'CONFIRMED' | 'CANCELLED';
  txid: string;
  note?: string | null;
  amountPaid?: number | null;
  anonymous?: boolean;
  contestNote?: string | null;
  contestedAt?: string | null;
  canReopen?: boolean;
  declaredAt?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  /** PIX_STATIC = fiel paga na chave da paróquia e a tesouraria confere; GATEWAY = cobrança no provedor (webhook/consulta confirmam) */
  method: 'PIX_STATIC' | 'GATEWAY';
  providerStatus: string | null;
  providerRef: string | null;
  chargedAmount: number | null;
  feeAmount: number;
  /** Meio escolhido pelo fiel; cartão e boleto só existem com o Asaas (confirmação por webhook) */
  paymentMethod: 'PIX' | 'CARD' | 'BOLETO';
  /** Página de pagamento do Asaas (cartão/boleto); null no Pix e nas ofertas anônimas */
  paymentUrl: string | null;
}

interface ReportRow {
  communityId: string;
  community: string;
  kind: string;
  method: string;
  count: number;
  total: number;
}

interface TitheConfig {
  id: string;
  name: string;
  titheEnabled: boolean;
  pixKey?: string | null;
  pixKeyType?: string | null;
  pixMerchantName?: string | null;
  pixMerchantCity?: string | null;
  titheMessage?: string | null;
  brCodePreview?: string | null;
  lastChange?: { at: string; byName: string | null } | null;
  cancelledOpenIntents?: number;
  // Provedor (D3)
  paymentProvider?: string | null;
  providerEnv?: string | null;
  providerConfigured?: boolean;
  providerWebhookToken?: string | null;
  providerWebhookSecretSet?: boolean;
  /** true = Mercado Pago: a assinatura secreta vem do painel deles, não geramos token */
  providerWebhookSecretByAdmin?: boolean;
  webhookUrl?: string | null;
  paymentsCryptoReady?: boolean;
  /** Motivo exato quando a criptografia das chaves não está pronta (null = ok) */
  paymentsCryptoProblem?: string | null;
  /** Resultado do cadastro automático na conta Asaas (vem no PATCH e na rotação do token) */
  providerSetup?: ProviderSetupResult | null;
  feePolicy?: string;
  feeFixed?: number;
  feePercent?: number;
}

const INTENT_STATUS: Record<string, { label: string; color: string }> = {
  CREATED: { label: 'Cobrança gerada', color: 'gray' },
  DECLARED: { label: 'Aguardando conferência', color: 'yellow' },
  CONFIRMED: { label: 'Confirmado', color: 'green' },
  CANCELLED: { label: 'Cancelado', color: 'red' },
};

// Situação no provedor (Asaas/Mercado Pago), traduzida para a tesouraria
const PROVIDER_STATUS_LABEL: Record<string, string> = {
  pending: 'aguardando pagamento',
  confirmed: 'pago no provedor',
  received: 'pago no provedor',
  paid: 'pago no provedor',
  overdue: 'vencido no provedor (ainda pagável)',
  refunded: 'estornado',
  cancelled: 'cancelado no provedor',
  mismatch: 'divergência de valor — conciliar',
  in_review: 'cartão em análise',
  disputed: 'estorno/chargeback em disputa',
};
const providerStatusLabel = (status: string | null | undefined): string | null =>
  status ? PROVIDER_STATUS_LABEL[status.toLowerCase()] ?? status : null;

// Meio de pagamento no relatório mensal — aceita tanto o rótulo já em pt-BR quanto o código do provedor
const REPORT_METHOD_LABEL: Record<string, string> = {
  CARD: 'Cartão',
  BOLETO: 'Boleto',
};
const reportMethodLabel = (method: string): string => REPORT_METHOD_LABEL[method.toUpperCase()] ?? method;

// Meio não-Pix na tabela de intents (cartão/boleto via Asaas)
const PAYMENT_METHOD_BADGE: Record<string, string> = {
  CARD: '💳 Cartão',
  BOLETO: '📄 Boleto',
};
// Nome do meio para textos curtos ("Pix não localizado", "Cartão · R$ 50,00")
const PAYMENT_METHOD_NAME: Record<string, string> = { PIX: 'Pix', CARD: 'Cartão', BOLETO: 'Boleto' };
const methodName = (intent: OnlineIntent): string => PAYMENT_METHOD_NAME[intent.paymentMethod] ?? 'Pagamento';

const isOpenIntent = (intent: OnlineIntent) => intent.status === 'DECLARED' || intent.status === 'CREATED';
// Provedor apontou pagamento com valor/ref diferente do declarado: só conciliação individual
const isMismatch = (intent: OnlineIntent) => intent.method === 'GATEWAY' && intent.providerStatus === 'mismatch';
// Cobrança do provedor em aberto é confirmada pelo webhook/consulta — a tesouraria só
// mexe manualmente no Pix estático, quando o provedor apontou divergência de valor ou
// quando a cobrança nem chegou a existir no provedor (sem providerRef)
const needsManualCheck = (intent: OnlineIntent) =>
  isOpenIntent(intent) && (intent.method !== 'GATEWAY' || isMismatch(intent) || !intent.providerRef);
// Lote só para conferência simples; divergência de valor exige olhar item a item
const canBatchConfirm = (intent: OnlineIntent) => needsManualCheck(intent) && !isMismatch(intent);
// Consulta ao provedor: em aberto (webhook pode ter atrasado) ou já confirmada (detectar estorno/chargeback)
const canSyncProvider = (intent: OnlineIntent) =>
  intent.method === 'GATEWAY' && !!intent.providerRef && (intent.status === 'CONFIRMED' || (isOpenIntent(intent) && !isMismatch(intent)));


const EMPTY_TX_FORM = { type: 'INCOME', category: '', amount: '', description: '', date: '', communityId: '', costCenter: '' };
const EMPTY_CONFIG_FORM = {
  titheEnabled: false,
  pixKeyType: 'CNPJ',
  pixKey: '',
  pixMerchantName: '',
  pixMerchantCity: '',
  titheMessage: '',
};
const EMPTY_PROVIDER_FORM = {
  paymentProvider: '',
  providerEnv: 'sandbox',
  providerApiKey: '',
  providerWebhookSecret: '',
  feePolicy: 'ABSORB',
  feeFixed: '1.99',
  feePercent: '0',
};

const FinancePage: React.FC = () => {
  const { user } = useAuth();
  const canConfigureTithe = ['PARISH_ADMIN', 'DIOCESAN_ADMIN', 'SYSTEM_ADMIN'].includes(user?.role ?? '');
  const [tab, setTab] = useState<'transactions' | 'tithe' | 'presential' | 'online' | 'campaigns' | 'statements'>('transactions');

  // Dízimo online (Pix da paróquia)
  const [onlineIntents, setOnlineIntents] = useState<OnlineIntent[]>([]);
  const [onlineStatus, setOnlineStatus] = useState('DECLARED');
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [busyIntent, setBusyIntent] = useState<string | null>(null);
  const [titheConfig, setTitheConfig] = useState<TitheConfig | null>(null);
  const [configForm, setConfigForm] = useState(EMPTY_CONFIG_FORM);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  // Conferência (um ou vários) num modal — nada de window.prompt
  const [confirmTargets, setConfirmTargets] = useState<OnlineIntent[] | null>(null);
  const [confirmForm, setConfirmForm] = useState({ date: '', receiptNumber: '', amountPaid: '', referenceMonth: '' });
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  // Relatório do mês, QR institucional e extrato anual
  const [reportMonth, setReportMonth] = useState(currentMonth());
  const [reportCommunity, setReportCommunity] = useState('');
  const [report, setReport] = useState<{ referenceMonth: string; rows: ReportRow[]; totals: { count: number; total: number } } | null>(null);
  const [institutionalQr, setInstitutionalQr] = useState<{ qrDataUrl: string; brCode: string } | null>(null);
  const [statementMember, setStatementMember] = useState('');
  const [statementYear, setStatementYear] = useState(String(new Date().getFullYear()));
  // Troca de chave Pix: senha atual num modal (nunca em texto claro)
  const [pwdModal, setPwdModal] = useState(false);
  const [pwd, setPwd] = useState('');
  const [providerForm, setProviderForm] = useState(EMPTY_PROVIDER_FORM);
  const [providerPwdModal, setProviderPwdModal] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [rotatingToken, setRotatingToken] = useState(false);
  // Resultado do setup automático na conta do provedor (chave Pix + webhook)
  const [providerSetup, setProviderSetup] = useState<ProviderSetupResult | null>(null);
  const [checkingSetup, setCheckingSetup] = useState(false);

  // DIOCESAN/SYSTEM_ADMIN não têm paróquia própria: escolhem qual configurar
  const [parishOptions, setParishOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [configParishId, setConfigParishId] = useState<string>(user?.parishId ?? '');
  // Contador de requisição: a resposta atrasada da paróquia/filtro anterior não sobrescreve a atual
  const onlineRequestRef = useRef(0);
  useEffect(() => {
    // Trocar de paróquia zera o que era da anterior (inclusive formulários e seleção)
    setInstitutionalQr(null);
    setTitheConfig(null);
    setConfigError(null);
    setConfigForm(EMPTY_CONFIG_FORM);
    setProviderForm(EMPTY_PROVIDER_FORM);
    setProviderSetup(null);
    setSelectedIds({});
  }, [configParishId]);
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filters, setFilters] = useState({ communityId: '', from: '', to: '' });

  const [tithers, setTithers] = useState<Tither[]>([]);
  const [referenceMonth, setReferenceMonth] = useState(currentMonth());
  const [contributions, setContributions] = useState<Contribution[]>([]);

  const [showTxModal, setShowTxModal] = useState(false);
  const [txForm, setTxForm] = useState({ ...EMPTY_TX_FORM });
  // Centros de custo já usados na paróquia (sugestões do <datalist>; o campo continua livre)
  const [costCenters, setCostCenters] = useState<string[]>([]);

  const [showTitherModal, setShowTitherModal] = useState(false);
  const [titherForm, setTitherForm] = useState({ memberId: '', registrationNumber: '' });

  const [showContributionModal, setShowContributionModal] = useState(false);
  const [contributionForm, setContributionForm] = useState({
    titherId: '',
    amount: '',
    date: '',
    referenceMonth: currentMonth(),
    method: 'PIX',
    receiptNumber: '',
  });

  const fetchFinance = useCallback(async () => {
    try {
      const params = {
        communityId: filters.communityId || undefined,
        from: filters.from ? new Date(filters.from).toISOString() : undefined,
        to: filters.to ? new Date(filters.to).toISOString() : undefined,
      };
      const [summaryRes, txRes] = await Promise.all([
        api.get('/finance/summary', { params }),
        api.get('/finance/transactions', { params }),
      ]);
      setSummary(summaryRes.data);
      setTransactions(txRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar dados financeiros'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchTithe = useCallback(async () => {
    try {
      const [tithersRes, contributionsRes] = await Promise.all([
        api.get('/finance/tithers'),
        api.get('/finance/tithe/contributions', { params: { referenceMonth } }),
      ]);
      setTithers(tithersRes.data);
      setContributions(contributionsRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar dízimo'));
    }
  }, [referenceMonth]);

  useEffect(() => {
    fetchFinance();
  }, [fetchFinance]);

  useEffect(() => {
    if (tab === 'tithe') fetchTithe();
  }, [tab, fetchTithe]);

  const fetchOnline = useCallback(async () => {
    const requestId = ++onlineRequestRef.current;
    const isCurrent = () => requestId === onlineRequestRef.current;
    type ConfigLoad = { data: TitheConfig | null; error: string | null };
    setOnlineLoading(true);
    try {
      const [intentsRes, configRes] = await Promise.all([
        api.get('/tithe/intents', { params: { status: onlineStatus } }),
        canConfigureTithe && (configParishId || user?.parishId)
          ? api
              .get('/tithe/config', { params: configParishId ? { parishId: configParishId } : undefined })
              .then((res): ConfigLoad => ({ data: res.data, error: null }))
              .catch((error): ConfigLoad => ({ data: null, error: friendlyError(error, 'Não foi possível carregar a configuração do Pix') }))
          : Promise.resolve<ConfigLoad>({ data: null, error: null }),
      ]);
      // Resposta atrasada de outra paróquia/filtro: descarta em vez de sobrescrever a atual
      if (!isCurrent()) return;
      setOnlineIntents(intentsRes.data ?? []);
      if (configRes.error) {
        setConfigError(configRes.error);
        setTitheConfig(null);
      } else if (configRes.data) {
        const cfg = configRes.data;
        setConfigError(null);
        setTitheConfig(cfg);
        setConfigForm({
          titheEnabled: !!cfg.titheEnabled,
          pixKeyType: cfg.pixKeyType ?? 'CNPJ',
          pixKey: cfg.pixKey ?? '',
          pixMerchantName: cfg.pixMerchantName ?? '',
          pixMerchantCity: cfg.pixMerchantCity ?? '',
          titheMessage: cfg.titheMessage ?? '',
        });
        setProviderForm({
          paymentProvider: cfg.paymentProvider ?? '',
          providerEnv: cfg.providerEnv ?? 'sandbox',
          providerApiKey: '',
          providerWebhookSecret: '',
          feePolicy: cfg.feePolicy ?? 'ABSORB',
          feeFixed: String(cfg.feeFixed ?? 1.99),
          feePercent: String(cfg.feePercent ?? 0),
        });
      }
    } catch (error) {
      if (!isCurrent()) return;
      notify.error(friendlyError(error, 'Erro ao carregar o dízimo online'));
    } finally {
      if (isCurrent()) setOnlineLoading(false);
    }
  }, [onlineStatus, canConfigureTithe, configParishId, user?.parishId]);

  useEffect(() => {
    if (tab === 'online') {
      void fetchOnline();
      void fetchTithe();
    }
  }, [tab, fetchOnline, fetchTithe]);

  useEffect(() => {
    if ((tab === 'online' || tab === 'campaigns' || tab === 'statements') && canConfigureTithe && !user?.parishId && parishOptions.length === 0) {
      api
        .get('/parishes')
        .then((res) => {
          const list = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
          setParishOptions(list.map((parish: any) => ({ id: parish.id, name: parish.name })));
        })
        .catch(() => setParishOptions([]));
    }
  }, [tab, canConfigureTithe, user?.parishId, parishOptions.length]);

  const loadReport = async () => {
    try {
      const res = await api.get('/tithe/report', {
        params: { referenceMonth: reportMonth, communityId: reportCommunity || undefined },
      });
      setReport(res.data);
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao carregar o relatório'));
    }
  };

  const openConfirm = (targets: OnlineIntent[]) => {
    if (!targets.length) return;
    const first = targets[0];
    setConfirmForm({
      date: new Date(first.declaredAt ?? first.createdAt).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
      receiptNumber: '',
      amountPaid: targets.length === 1 ? String(first.amount) : '',
      referenceMonth: targets.length === 1 ? first.referenceMonth : '',
    });
    setConfirmTargets(targets);
  };

  const submitConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmTargets) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmForm.date)) {
      notify.error('Informe a data em que o pagamento caiu no extrato');
      return;
    }
    setBusyIntent('batch');
    // Item a item, sem abortar na primeira falha: um Pix que já foi confirmado por
    // outra pessoa (ou pelo webhook) não trava o resto do lote
    let done = 0;
    let alreadyClosed = 0;
    const failures: string[] = [];
    for (const intent of confirmTargets) {
      try {
        await api.post(`/tithe/intents/${intent.id}/confirm`, {
          date: confirmForm.date,
          receiptNumber: confirmForm.receiptNumber.trim() || undefined,
          amountPaid: confirmTargets.length === 1 && confirmForm.amountPaid ? Number(confirmForm.amountPaid) : undefined,
          referenceMonth: confirmForm.referenceMonth || undefined,
        });
        done += 1;
      } catch (error) {
        const message = getErrorMessage(error, '');
        if (httpStatus(error) === 400 && /já (foi )?confirmad|cancelad|encerrad/i.test(message)) {
          alreadyClosed += 1;
        } else {
          failures.push(`${intent.member.fullName}: ${friendlyError(error, 'erro ao confirmar')}`);
        }
      }
    }
    setBusyIntent(null);
    const summary =
      `${done} ${plural(done, 'confirmado', 'confirmados')}; ` +
      `${alreadyClosed} ${plural(alreadyClosed, 'já estava confirmado/encerrado', 'já estavam confirmados/encerrados')}`;
    if (failures.length > 0) {
      notify.error(`${summary}; ${failures.length} com erro — ${failures[0]}`);
    } else if (alreadyClosed === 0) {
      notify.success(done === 1 ? 'Contribuição confirmada e lançada no Financeiro' : `${done} contribuições confirmadas`);
    } else if (done === 0) {
      notify.warning(summary);
    } else {
      notify.success(summary);
    }
    setConfirmTargets(null);
    setSelectedIds({});
    await fetchOnline();
    if (done > 0) fetchFinance();
  };

  const rejectIntent = async (intent: OnlineIntent) => {
    const mismatch = isMismatch(intent);
    // Divergência: o provedor consta pago — encerrar sem lançar precisa de aviso explícito
    if (
      mismatch &&
      !window.confirm(
        `Atenção: o provedor consta este pagamento como PAGO${intent.note ? ` (${intent.note})` : ''}. ` +
          'Encerrar sem lançar no Financeiro? O valor recebido não será contabilizado nesta contribuição.',
      )
    ) {
      return;
    }
    const typed = window.prompt(
      'Motivo (o fiel recebe o aviso e pode contestar):',
      mismatch ? 'Divergência de valor com o provedor — encerrado sem lançamento' : `${methodName(intent)} não localizado no extrato`,
    );
    if (typed === null) return;
    setBusyIntent(intent.id);
    try {
      await api.post(`/tithe/intents/${intent.id}/reject`, { reason: typed.trim() || undefined });
      notify.success(mismatch ? 'Encerrado sem lançamento no Financeiro' : `${methodName(intent)} marcado como não localizado`);
      await fetchOnline();
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao processar'));
    } finally {
      setBusyIntent(null);
    }
  };

  const reopenIntent = async (intent: OnlineIntent) => {
    setBusyIntent(intent.id);
    try {
      await api.post(`/tithe/intents/${intent.id}/reopen`, {});
      notify.success('Contribuição reaberta — volta para a fila de conferência');
      await fetchOnline();
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao reabrir'));
    } finally {
      setBusyIntent(null);
    }
  };

  /**
   * Cobrança do provedor: consulta a situação lá e troca o item da lista pelo retorno.
   * Em aberto, cobre webhook atrasado; já confirmada, detecta estorno/chargeback (o backend reverte a contribuição).
   */
  const syncIntent = async (intent: OnlineIntent) => {
    setBusyIntent(intent.id);
    try {
      const res = await api.post(`/tithe/intents/${intent.id}/sync`, {});
      const updated: OnlineIntent | undefined = res.data && res.data.id ? res.data : undefined;
      if (!updated) {
        await fetchOnline();
        return;
      }
      setOnlineIntents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      const wasConfirmed = intent.status === 'CONFIRMED';
      const providerStatus = updated.providerStatus?.toLowerCase() ?? null;
      if (updated.status === 'CANCELLED' && providerStatus === 'refunded') {
        notify.warning('Estornado pelo provedor — contribuição revertida');
        fetchFinance();
      } else if (updated.status === 'CONFIRMED' && providerStatus === 'disputed') {
        notify.warning('Estorno/chargeback em disputa no provedor — se for concluído, a contribuição será revertida');
      } else if (updated.status === 'CONFIRMED') {
        if (wasConfirmed) {
          notify.info('Sem estorno — pagamento segue confirmado no provedor');
        } else {
          notify.success('Pago no provedor — confirmado');
          fetchFinance();
        }
      } else if (updated.status === 'CANCELLED') {
        notify.warning(updated.note ? `Encerrado no provedor — ${updated.note}` : 'Encerrado no provedor');
        if (wasConfirmed) fetchFinance();
      } else if (providerStatus === 'mismatch') {
        notify.warning(
          updated.note ? `Divergência de valor no provedor (${updated.note}) — concilie manualmente` : 'Divergência de valor no provedor — concilie manualmente',
        );
      } else if (providerStatus === 'in_review') {
        notify.info('Cartão em análise de risco no provedor — aguarde a liberação');
      } else {
        notify.info('Ainda aguardando pagamento no provedor');
      }
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao consultar o provedor'));
    } finally {
      setBusyIntent(null);
    }
  };

  const submitConfig = async (currentPassword?: string) => {
    setSavingConfig(true);
    try {
      const res = await api.patch('/tithe/config', {
        parishId: configParishId || undefined,
        currentPassword,
        titheEnabled: configForm.titheEnabled,
        pixKeyType: configForm.pixKeyType,
        pixKey: configForm.pixKey.trim() || null,
        pixMerchantName: configForm.pixMerchantName.trim() || null,
        pixMerchantCity: configForm.pixMerchantCity.trim() || null,
        titheMessage: configForm.titheMessage.trim() || null,
      });
      setTitheConfig(res.data);
      setConfigForm((current) => ({
        ...current,
        pixKey: res.data?.pixKey ?? '',
        pixKeyType: res.data?.pixKeyType ?? current.pixKeyType,
        pixMerchantName: res.data?.pixMerchantName ?? '',
        pixMerchantCity: res.data?.pixMerchantCity ?? '',
      }));
      notify.success(res.data?.titheEnabled ? 'Dízimo pelo app ATIVO para os fiéis' : 'Configuração salva (dízimo pelo app desativado)');
      if (res.data?.cancelledOpenIntents > 0) {
        notify.success(`${res.data.cancelledOpenIntents} Pix em aberto foram cancelados — os fiéis geram um novo código`);
      }
      setPwdModal(false);
      setPwd('');
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao salvar a configuração'));
    } finally {
      setSavingConfig(false);
    }
  };

  const submitProvider = async (currentPassword?: string) => {
    setSavingProvider(true);
    try {
      const res = await api.patch('/tithe/config', {
        parishId: configParishId || undefined,
        currentPassword,
        paymentProvider: providerForm.paymentProvider || null,
        providerEnv: providerForm.providerEnv,
        providerApiKey: providerForm.providerApiKey.trim() || undefined,
        feePolicy: providerForm.feePolicy,
        feeFixed: Number(providerForm.feeFixed) || 0,
        feePercent: Number(providerForm.feePercent) || 0,
        // Assinatura secreta só existe no Mercado Pago (gerada no painel deles)
        providerWebhookSecret:
          providerForm.paymentProvider === 'MERCADOPAGO' && providerForm.providerWebhookSecret.trim()
            ? providerForm.providerWebhookSecret.trim()
            : undefined,
      });
      const saved: TitheConfig | null = res.data ?? null;
      const setup = saved?.providerSetup ?? null;
      setTitheConfig(saved);
      setProviderSetup(setup);
      setProviderForm((current) => ({ ...current, providerApiKey: '', providerWebhookSecret: '' }));
      if (!saved?.providerConfigured) {
        notify.success('Configuração do provedor salva');
      } else if (saved.paymentProvider !== 'ASAAS' || (setup?.pixKeyReady && setup?.webhookRegistered)) {
        notify.success('Provedor configurado — confirmação automática ativa');
      } else {
        // O bloco de status abaixo do formulário mostra o detalhe de cada pendência
        const pending = [setup?.pixKeyReady ? null : 'chave Pix', setup?.webhookRegistered ? null : 'webhook'].filter(Boolean);
        notify.warning(`Provedor salvo, mas a conta Asaas ainda tem pendência: ${pending.join(' e ')} — veja os detalhes abaixo`);
      }
      setProviderPwdModal(false);
      setPwd('');
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao salvar o provedor'));
    } finally {
      setSavingProvider(false);
    }
  };

  const saveProvider = (e: React.FormEvent) => {
    e.preventDefault();
    // Chave, assinatura, provedor ou ambiente: o backend exige a senha atual em todos (sandbox → produção inclusive)
    const sensitive =
      providerForm.providerApiKey.trim().length > 0 ||
      providerForm.providerWebhookSecret.trim().length > 0 ||
      (providerForm.paymentProvider || null) !== (titheConfig?.paymentProvider ?? null) ||
      providerForm.providerEnv !== (titheConfig?.providerEnv ?? 'sandbox');
    if (sensitive) {
      setPwd('');
      setProviderPwdModal(true);
      return;
    }
    void submitProvider();
  };

  const checkProviderSetup = async () => {
    if (checkingSetup) return;
    setCheckingSetup(true);
    try {
      const res = await api.post('/tithe/config/provider-setup', { parishId: configParishId || undefined });
      setProviderSetup(res.data);
      notify.success(res.data?.pixKeyReady && res.data?.webhookRegistered ? 'Conta do provedor pronta para receber' : 'Verificação concluída — veja as pendências abaixo');
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao verificar a conta do provedor'));
    } finally {
      setCheckingSetup(false);
    }
  };

  const rotateWebhookToken = async () => {
    if (rotatingToken) return;
    if (!window.confirm('Gerar um novo token do webhook? O token anterior deixa de valer.')) return;
    setRotatingToken(true);
    try {
      const res = await api.post('/tithe/config/webhook-token', { parishId: configParishId || undefined });
      const setup: ProviderSetupResult | null = res.data?.providerSetup ?? null;
      setTitheConfig((current) => (current ? { ...current, providerWebhookToken: res.data.providerWebhookToken, providerSetup: setup } : current));
      setProviderSetup(setup);
      if (setup?.webhookRegistered) {
        notify.success('Novo token gerado e webhook do Asaas atualizado');
      } else {
        notify.warning('Token gerado, mas não foi possível atualizar o webhook no Asaas — verifique a conta');
      }
    } catch (error) {
      notify.error(friendlyError(error, 'Erro ao gerar o token'));
    } finally {
      setRotatingToken(false);
    }
  };

  const saveTitheConfig = (e: React.FormEvent) => {
    e.preventDefault();
    // Qualquer mudança de chave/tipo (inclusive a primeira) pede a senha atual
    const keyChanged =
      configForm.pixKey.trim() !== (titheConfig?.pixKey ?? '') ||
      configForm.pixKeyType !== (titheConfig?.pixKeyType ?? configForm.pixKeyType);
    if (keyChanged) {
      setPwd('');
      setPwdModal(true);
      return;
    }
    void submitConfig();
  };

  const closePwdModals = () => {
    setPwdModal(false);
    setProviderPwdModal(false);
    setPwd('');
  };

  // Escape fecha os modais de senha (e descarta a senha digitada)
  useEffect(() => {
    if (!pwdModal && !providerPwdModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPwdModal(false);
      setProviderPwdModal(false);
      setPwd('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pwdModal, providerPwdModal]);

  const isMercadoPago = providerForm.paymentProvider === 'MERCADOPAGO';
  // Só o que está na lista atual E pode ir em lote conta na seleção (divergências de valor ficam de fora)
  const selectedTargets = onlineIntents.filter((intent) => selectedIds[intent.id] && canBatchConfirm(intent));

  useEffect(() => {
    api.get('/communities').then((res) => setCommunities(res.data)).catch(() => undefined);
    api.get('/members').then((res) => setMembers(res.data)).catch(() => undefined);
  }, []);

  // Sugestões de centro de custo: carrega ao abrir o formulário (um centro novo entra na lista na próxima abertura)
  const fetchCostCenters = useCallback(async () => {
    try {
      const res = await api.get('/finance/statements/cost-centers', { params: { parishId: configParishId || undefined } });
      setCostCenters(Array.isArray(res.data) ? res.data : []);
    } catch {
      // sugestões são opcionais: o campo continua aceitando texto livre
    }
  }, [configParishId]);

  useEffect(() => {
    if (showTxModal) void fetchCostCenters();
  }, [showTxModal, fetchCostCenters]);

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/transactions', {
        type: txForm.type,
        category: txForm.category,
        amount: Number(txForm.amount),
        description: txForm.description || undefined,
        date: new Date(txForm.date).toISOString(),
        communityId: txForm.communityId || undefined,
        costCenter: txForm.costCenter.trim() || undefined,
      });
      notify.success('Lançamento registrado!');
      setShowTxModal(false);
      setTxForm({ ...EMPTY_TX_FORM });
      fetchFinance();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar lançamento'));
    }
  };

  const handleRegisterTither = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/tithers', {
        memberId: titherForm.memberId,
        registrationNumber: titherForm.registrationNumber || undefined,
      });
      notify.success('Dizimista cadastrado!');
      setShowTitherModal(false);
      setTitherForm({ memberId: '', registrationNumber: '' });
      fetchTithe();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao cadastrar dizimista'));
    }
  };

  const handleAddContribution = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/tithe/contributions', {
        titherId: contributionForm.titherId,
        amount: Number(contributionForm.amount),
        date: new Date(contributionForm.date).toISOString(),
        referenceMonth: contributionForm.referenceMonth,
        method: contributionForm.method,
        receiptNumber: contributionForm.receiptNumber || undefined,
      });
      notify.success('Contribuição lançada — transação "Dízimo" gerada!');
      setShowContributionModal(false);
      setContributionForm({ titherId: '', amount: '', date: '', referenceMonth: currentMonth(), method: 'PIX', receiptNumber: '' });
      fetchTithe();
      fetchFinance();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao lançar contribuição'));
    }
  };

  const formatDate = (value: string) => new Date(value).toLocaleDateString('pt-BR');
  // Admin diocesano/sistema recebe comunidades de todas as paróquias: só as da paróquia escolhida servem para campanhas e balancetes
  const campaignCommunities = configParishId ? communities.filter((c) => !c.parishId || c.parishId === configParishId) : communities;
  const monthTotal = contributions.reduce((sum, c) => sum + c.amount, 0);

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="dizimo" /> Financeiro</h1>
        <div className="header-actions">
          {tab === 'transactions' ? (
            <button className="btn-primary" onClick={() => setShowTxModal(true)}>+ Lançamento</button>
          ) : tab === 'campaigns' || tab === 'presential' || tab === 'statements' ? null : (
            <>
              <button className="btn-secondary" onClick={() => setShowTitherModal(true)}>+ Dizimista</button>
              <button className="btn-primary" onClick={() => setShowContributionModal(true)}>+ Contribuição</button>
            </>
          )}
        </div>
      </div>

      <div className="privacy-note">
        Gestão pastoral de receitas e despesas — não substitui a contabilidade oficial da paróquia.
        Dados individuais de dízimo são restritos à coordenação (LGPD).
      </div>

      <div className="module-tabs">
        <button className={`tab-btn ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}>
          Receitas e Despesas
        </button>
        <button className={`tab-btn ${tab === 'tithe' ? 'active' : ''}`} onClick={() => setTab('tithe')}>
          Dízimo
        </button>
        <button className={`tab-btn ${tab === 'presential' ? 'active' : ''}`} onClick={() => setTab('presential')}>
          Registro presencial
        </button>
        <button className={`tab-btn ${tab === 'online' ? 'active' : ''}`} onClick={() => setTab('online')}>
          Dízimo online
        </button>
        <button className={`tab-btn ${tab === 'campaigns' ? 'active' : ''}`} onClick={() => setTab('campaigns')}>
          Campanhas
        </button>
        <button className={`tab-btn ${tab === 'statements' ? 'active' : ''}`} onClick={() => setTab('statements')}>
          Balancete
        </button>
      </div>

      {tab === 'transactions' && (
        <>
          <div className="filters">
            <select className="filter-select" value={filters.communityId} onChange={(e) => setFilters({ ...filters, communityId: e.target.value })}>
              <option value="">Todo o escopo</option>
              {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="date" className="filter-input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <input type="date" className="filter-input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>

          {summary && (
            <div className="summary-cards">
              <div className="summary-card"><div className="label">Receitas</div><div className="value positive">{formatBRL(summary.income)}</div></div>
              <div className="summary-card"><div className="label">Despesas</div><div className="value negative">{formatBRL(summary.expense)}</div></div>
              <div className="summary-card"><div className="label">Saldo</div><div className={`value ${summary.balance >= 0 ? 'positive' : 'negative'}`}>{formatBRL(summary.balance)}</div></div>
              <div className="summary-card"><div className="label">Lançamentos</div><div className="value">{summary.count}</div></div>
            </div>
          )}

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Categoria</th>
                  <th>Centro de custo</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.date)}</td>
                    <td>
                      {tx.type === 'INCOME'
                        ? <span className="status-badge green">Receita</span>
                        : <span className="status-badge red">Despesa</span>}
                    </td>
                    <td>{tx.category}</td>
                    <td>{tx.costCenter ? <span className="status-badge gray">{tx.costCenter}</span> : '—'}</td>
                    <td>{tx.description || '—'}</td>
                    <td style={{ fontWeight: 600, color: tx.type === 'INCOME' ? '#0f5132' : '#842029' }}>
                      {tx.type === 'INCOME' ? '+' : '−'} {formatBRL(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length === 0 && <div className="empty-state">Nenhum lançamento no período.</div>}
          </div>
        </>
      )}

      {tab === 'online' && (
        <>
          {canConfigureTithe && (
            <div className="filters-bar" style={{ display: 'block', marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.3rem', color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>
                Pix da paróquia {titheConfig ? `· ${titheConfig.name}` : ''}
              </h4>
              {!user?.parishId && (
                <div className="form-group" style={{ maxWidth: 420 }}>
                  <label>Paróquia</label>
                  <select className="filter-select" value={configParishId} onChange={(e) => setConfigParishId(e.target.value)}>
                    <option value="">Escolha a paróquia...</option>
                    {parishOptions.map((parish) => (
                      <option key={parish.id} value={parish.id}>{parish.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {configError && <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{configError}</p>}
              {!titheConfig && !configError && (configParishId || user?.parishId) && (
                <p style={{ color: '#666', fontSize: '0.85rem' }}>Carregando a configuração...</p>
              )}
              <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.8rem' }}>
                O app gera um Pix “copia e cola” com a chave abaixo, o valor e um identificador. O fiel paga no próprio
                banco e avisa; você confere no extrato e confirma aqui. Sem gateway, sem taxa.
              </p>
              {titheConfig && (
              <form onSubmit={saveTitheConfig}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Tipo da chave</label>
                    <select className="filter-select" value={configForm.pixKeyType} onChange={(e) => setConfigForm({ ...configForm, pixKeyType: e.target.value })}>
                      <option value="CNPJ">CNPJ da paróquia</option>
                      <option value="CPF">CPF (conta pessoal — evite)</option>
                      <option value="EMAIL">E-mail</option>
                      <option value="PHONE">Telefone (+55…)</option>
                      <option value="RANDOM">Chave aleatória</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Chave Pix</label>
                    <input type="text" maxLength={77} autoCapitalize="off" autoCorrect="off" spellCheck={false} value={configForm.pixKey} onChange={(e) => setConfigForm({ ...configForm, pixKey: e.target.value })} placeholder="CPF só números · CNPJ pode ter letras · e-mail em minúsculas" />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Nome do recebedor (até 25, sem acento)</label>
                    <input type="text" maxLength={25} value={configForm.pixMerchantName} onChange={(e) => setConfigForm({ ...configForm, pixMerchantName: e.target.value })} placeholder="PAROQUIA SANTA RITA" />
                  </div>
                  <div className="form-group">
                    <label>Cidade (até 15)</label>
                    <input type="text" maxLength={15} value={configForm.pixMerchantCity} onChange={(e) => setConfigForm({ ...configForm, pixMerchantCity: e.target.value })} placeholder="PONTA GROSSA" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Mensagem ao fiel (opcional)</label>
                  <input type="text" maxLength={500} value={configForm.titheMessage} onChange={(e) => setConfigForm({ ...configForm, titheMessage: e.target.value })} placeholder="Seu dízimo sustenta a missão da paróquia…" />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '0.6rem' }}>
                  <input type="checkbox" checked={configForm.titheEnabled} onChange={(e) => setConfigForm({ ...configForm, titheEnabled: e.target.checked })} />
                  Ativar o dízimo pelo app para os fiéis desta paróquia
                </label>
                <button type="submit" className="btn-small success" disabled={savingConfig}>{savingConfig ? 'Salvando...' : 'Salvar configuração'}</button>
                {titheConfig?.lastChange && (
                  <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.6rem' }}>
                    🔐 Última troca da chave: {new Date(titheConfig.lastChange.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {titheConfig.lastChange.byName ? ` por ${titheConfig.lastChange.byName}` : ''}. Não reconhece? Desative o dízimo agora e fale com a diocese.
                  </p>
                )}
                {titheConfig?.brCodePreview && (
                  <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.6rem', wordBreak: 'break-all' }}>
                    Prévia do código: {titheConfig.brCodePreview}
                  </p>
                )}
              </form>
              )}
              {titheConfig?.titheEnabled && (
                <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn-small"
                    onClick={async () => {
                      try {
                        const res = await api.get('/tithe/config/institutional-qr', { params: configParishId ? { parishId: configParishId } : undefined });
                        setInstitutionalQr(res.data);
                      } catch (error) {
                        notify.error(friendlyError(error, 'Erro ao gerar o QR'));
                      }
                    }}
                  >
                    📱 Ver QR da paróquia (sem valor)
                  </button>
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => downloadBlob('/tithe/config/institutional-qr.pdf', 'pix-paroquia.pdf', configParishId ? { parishId: configParishId } : undefined)}
                  >
                    🖨 Cartaz do QR (PDF)
                  </button>
                  {institutionalQr && (
                    <img src={institutionalQr.qrDataUrl} alt="QR Pix da paróquia" style={{ width: 160, height: 160, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  )}
                </div>
              )}

              {titheConfig && (
                <div style={{ marginTop: '1.4rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                  <h4 style={{ margin: '0 0 0.3rem', color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>
                    Provedor de pagamento (confirmação automática e dízimo automático)
                  </h4>
                  <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.8rem' }}>
                    Com um provedor, o Pix do fiel é confirmado sozinho (sem conferir extrato) e o dízimo pode ser
                    automático (Pix Automático). Recomendado: <strong>Asaas</strong> (CNPJ da paróquia, sem mensalidade).
                    {titheConfig.paymentsCryptoReady === false && (
                      <span style={{ color: '#b91c1c' }}> {titheConfig.paymentsCryptoProblem ?? 'Servidor sem PAYMENTS_ENCRYPTION_KEY'} — peça ao administrador do sistema para configurar antes de cadastrar a chave.</span>
                    )}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.8rem' }}>
                    Com o Asaas, o fiel também pode pagar por cartão (página segura do Asaas) e boleto — taxas do Asaas
                    por meio; a política de taxa acima é uma estimativa única para os três.
                  </p>
                  <form onSubmit={saveProvider}>
                    <div className="form-row">
                      <div className="form-group">
                        <label htmlFor="provider-name">Provedor</label>
                        <select id="provider-name" className="filter-select" value={providerForm.paymentProvider} onChange={(e) => setProviderForm({ ...providerForm, paymentProvider: e.target.value })}>
                          <option value="">Nenhum (só Pix estático)</option>
                          <option value="ASAAS">Asaas</option>
                          <option value="MERCADOPAGO">Mercado Pago (só cobrança avulsa)</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label htmlFor="provider-env">Ambiente</label>
                        <select id="provider-env" className="filter-select" value={providerForm.providerEnv} onChange={(e) => setProviderForm({ ...providerForm, providerEnv: e.target.value })}>
                          <option value="sandbox">Sandbox (testes)</option>
                          <option value="production">Produção</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label htmlFor="provider-api-key">Chave de API {titheConfig.providerConfigured ? '(já cadastrada — preencha só para trocar)' : ''}</label>
                        <input id="provider-api-key" type="password" autoComplete="off" value={providerForm.providerApiKey} onChange={(e) => setProviderForm({ ...providerForm, providerApiKey: e.target.value })} placeholder={titheConfig.providerConfigured ? '••••••••' : 'Cole a chave do painel do provedor'} />
                      </div>
                    </div>
                    {isMercadoPago && (
                      <div className="form-group">
                        <label htmlFor="provider-webhook-secret">
                          Assinatura secreta do webhook {titheConfig.providerWebhookSecretSet ? '(já cadastrada — preencha só para trocar)' : ''}
                        </label>
                        <input
                          id="provider-webhook-secret"
                          type="password"
                          autoComplete="off"
                          value={providerForm.providerWebhookSecret}
                          onChange={(e) => setProviderForm({ ...providerForm, providerWebhookSecret: e.target.value })}
                          placeholder={titheConfig.providerWebhookSecretSet ? '••••••••' : 'Cole a assinatura secreta do painel do Mercado Pago'}
                        />
                        <div style={{ fontSize: '0.78rem', color: '#666', marginTop: '0.25rem' }}>
                          Copie em Mercado Pago → Suas integrações → Webhooks → Assinatura secreta
                        </div>
                      </div>
                    )}
                    <div className="form-row">
                      <div className="form-group">
                        <label htmlFor="provider-fee-policy">Taxa do provedor</label>
                        <select id="provider-fee-policy" className="filter-select" value={providerForm.feePolicy} onChange={(e) => setProviderForm({ ...providerForm, feePolicy: e.target.value })}>
                          <option value="ABSORB">A paróquia absorve</option>
                          <option value="PASS_THROUGH">O fiel cobre a taxa (soma ao Pix)</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label htmlFor="provider-fee-fixed">Taxa fixa por Pix (R$)</label>
                        <input id="provider-fee-fixed" type="number" step="0.01" min="0" max="50" value={providerForm.feeFixed} onChange={(e) => setProviderForm({ ...providerForm, feeFixed: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label htmlFor="provider-fee-percent">Taxa percentual (%)</label>
                        <input id="provider-fee-percent" type="number" step="0.01" min="0" max="10" value={providerForm.feePercent} onChange={(e) => setProviderForm({ ...providerForm, feePercent: e.target.value })} />
                      </div>
                    </div>
                    <button type="submit" className="btn-small success" disabled={savingProvider || titheConfig.paymentsCryptoReady === false}>
                      {savingProvider ? 'Salvando...' : 'Salvar provedor'}
                    </button>
                  </form>
                  {titheConfig.providerConfigured && titheConfig.webhookUrl && (
                    <div style={{ marginTop: '0.8rem', fontSize: '0.85rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
                      <div><strong>Webhook</strong> — cadastre no painel do provedor:</div>
                      <div style={{ wordBreak: 'break-all' }}>URL: <code>{titheConfig.webhookUrl}</code></div>
                      {/* Decide pelo provedor salvo (config), não pelo formulário ainda não salvo */}
                      {titheConfig.providerWebhookSecretByAdmin ? (
                        <>
                          <div style={{ marginTop: '0.3rem', fontWeight: 600, color: titheConfig.providerWebhookSecretSet ? '#0f6e56' : '#b45309' }}>
                            {titheConfig.providerWebhookSecretSet ? 'Assinatura cadastrada ✓' : 'Assinatura pendente — o webhook será recusado até cadastrar'}
                          </div>
                          <div style={{ color: '#666', marginTop: '0.3rem' }}>
                            Mercado Pago: Suas integrações → Webhooks → URL acima, evento “Pagamentos”; a assinatura secreta que o painel gera vai no campo “Assinatura secreta do webhook” acima.
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ wordBreak: 'break-all' }}>Token de autenticação: <code>{titheConfig.providerWebhookToken ?? '—'}</code></div>
                          <div style={{ color: '#666', marginTop: '0.3rem' }}>
                            O Parish cadastra sozinho na conta Asaas a chave Pix aleatória e o webhook (URL, token e eventos) ao salvar a chave de API. Para conferir no painel: Integrações → Webhooks.
                          </div>
                          {providerSetup && (
                            <div style={{ marginTop: '0.4rem' }}>
                              <div style={{ fontWeight: 600, color: providerSetup.pixKeyReady ? '#0f6e56' : '#b45309' }}>
                                {providerSetup.pixKeyReady
                                  ? `Chave Pix na conta Asaas ✓${providerSetup.pixKey ? ` (${providerSetup.pixKey})` : ''}`
                                  : 'Chave Pix da conta Asaas pendente — sem ela o QR não é emitido'}
                              </div>
                              <div style={{ fontWeight: 600, color: providerSetup.webhookRegistered ? '#0f6e56' : '#b45309' }}>
                                {providerSetup.webhookRegistered ? 'Webhook cadastrado no Asaas ✓' : 'Webhook não cadastrado no Asaas'}
                              </div>
                              {providerSetup.notes?.length ? <div style={{ color: '#666', marginTop: '0.2rem' }}>{providerSetup.notes.join(' · ')}</div> : null}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            <button type="button" className="btn-small" disabled={checkingSetup} onClick={() => void checkProviderSetup()}>
                              {checkingSetup ? 'Verificando...' : '🔎 Verificar conta no Asaas'}
                            </button>
                            <button type="button" className="btn-small" disabled={rotatingToken} onClick={() => void rotateWebhookToken()}>
                              {rotatingToken ? 'Gerando...' : '↻ Gerar novo token'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="filters-bar">
            {selectedTargets.length > 0 && (
              <button
                className="btn-small success"
                disabled={busyIntent !== null}
                onClick={() => openConfirm(selectedTargets)}
              >
                ✓ Confirmar selecionados ({selectedTargets.length})
              </button>
            )}
            <select className="filter-select" value={onlineStatus} onChange={(e) => setOnlineStatus(e.target.value)}>
              <option value="DECLARED">Aguardando conferência</option>
              <option value="CREATED">Gerados (não informados)</option>
              <option value="CONFIRMED">Confirmados</option>
              <option value="CANCELLED">Cancelados / não localizados</option>
              <option value="ALL">Todos</option>
            </select>
            <button className="btn-small" onClick={() => void fetchOnline()} disabled={onlineLoading}>↻ Atualizar</button>
          </div>

          {onlineLoading && <div className="loading">Carregando...</div>}
          {!onlineLoading && onlineIntents.length === 0 && (
            <p style={{ color: '#666' }}>
              {onlineStatus === 'DECLARED' ? 'Nenhum pagamento aguardando conferência.' : 'Nada por aqui.'}
            </p>
          )}
          {!onlineLoading && onlineIntents.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        title="Selecionar todos os aguardando conferência manual (cobranças do provedor e divergências de valor ficam de fora)"
                        onChange={(e) => {
                          const next: Record<string, boolean> = {};
                          if (e.target.checked) onlineIntents.filter(canBatchConfirm).forEach((i) => { next[i.id] = true; });
                          setSelectedIds(next);
                        }}
                      />
                    </th>
                    <th>Fiel</th>
                    <th>Comunidade</th>
                    <th>Tipo</th>
                    <th>Referência</th>
                    <th>Valor</th>
                    <th>Identificador (txid)</th>
                    <th>Informado em</th>
                    <th>Situação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {onlineIntents.map((intent) => (
                    <tr key={intent.id} style={isMismatch(intent) ? { background: '#fffbeb' } : undefined}>
                      <td>
                        {canBatchConfirm(intent) && (
                          <input type="checkbox" checked={!!selectedIds[intent.id]} onChange={(e) => setSelectedIds({ ...selectedIds, [intent.id]: e.target.checked })} />
                        )}
                      </td>
                      <td>
                        {intent.member.fullName}
                        {intent.contestNote && <div style={{ fontSize: '0.78rem', color: '#b45309' }}>💬 Contestação: {intent.contestNote}</div>}
                      </td>
                      <td>{intent.member.community ?? '—'}</td>
                      <td>{intent.kind === 'TITHE' ? 'Dízimo' : 'Oferta'}</td>
                      <td>{intent.referenceMonth}</td>
                      <td>
                        {formatBRL(intent.amount)}
                        {intent.amountPaid != null && intent.amountPaid !== intent.amount && (
                          <div style={{ fontSize: '0.78rem', color: '#666' }}>pago {formatBRL(intent.amountPaid)}</div>
                        )}
                        {intent.chargedAmount != null && Math.round(intent.chargedAmount * 100) !== Math.round(intent.amount * 100) && (
                          <div style={{ fontSize: '0.78rem', color: '#666' }}>
                            cobrado {formatBRL(intent.chargedAmount)} (taxa {formatBRL(intent.feeAmount ?? Math.max(0, intent.chargedAmount - intent.amount))})
                          </div>
                        )}
                      </td>
                      <td>
                        <code>{intent.txid}</code>
                        {intent.paymentMethod && intent.paymentMethod !== 'PIX' && (
                          <div style={{ fontSize: '0.72rem', color: '#555' }}>
                            {PAYMENT_METHOD_BADGE[intent.paymentMethod] ?? intent.paymentMethod}
                            {/* Oferta anônima (sem fiel) não tem página de cobrança para reabrir */}
                            {intent.paymentUrl && intent.member.id && isOpenIntent(intent) ? (
                              <>
                                {' · '}
                                <a href={intent.paymentUrl} target="_blank" rel="noreferrer">abrir cobrança</a>
                              </>
                            ) : null}
                          </div>
                        )}
                        {intent.method === 'GATEWAY' && (
                          <div style={{ fontSize: '0.72rem', color: intent.providerStatus === 'mismatch' ? '#b45309' : '#0f6e56' }}>
                            via provedor
                            {providerStatusLabel(intent.providerStatus) ? ` · ${providerStatusLabel(intent.providerStatus)}` : ''}
                            {intent.providerRef ? <span style={{ color: '#888' }}> · ref. {intent.providerRef}</span> : null}
                          </div>
                        )}
                      </td>
                      <td>{intent.declaredAt ? new Date(intent.declaredAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td>
                        <span className={`status-badge ${INTENT_STATUS[intent.status]?.color ?? 'gray'}`}>{INTENT_STATUS[intent.status]?.label ?? intent.status}</span>
                        {intent.note && intent.status === 'CANCELLED' ? <div style={{ fontSize: '0.75rem', color: '#888' }}>{intent.note}</div> : null}
                        {isMismatch(intent) && intent.note ? (
                          <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600 }}>⚠ Provedor informou: {intent.note}</div>
                        ) : null}
                      </td>
                      <td className="actions-cell">
                        {needsManualCheck(intent) && (
                          <>
                            <button className="btn-small success" disabled={busyIntent !== null} onClick={() => openConfirm([intent])}>Confirmar</button>
                            <button
                              className="btn-small"
                              disabled={busyIntent !== null}
                              title={isMismatch(intent) ? 'O provedor consta pago com outro valor; encerra sem lançar no Financeiro' : undefined}
                              onClick={() => void rejectIntent(intent)}
                            >
                              {isMismatch(intent) ? 'Encerrar sem lançar' : 'Não localizado'}
                            </button>
                          </>
                        )}
                        {canSyncProvider(intent) && (
                          <button
                            className="btn-small"
                            disabled={busyIntent !== null}
                            title={
                              intent.status === 'CONFIRMED'
                                ? 'Consulta o provedor para detectar estorno ou chargeback; se houver, a contribuição é revertida'
                                : 'O provedor confirma sozinho; consulte se o webhook atrasou'
                            }
                            onClick={() => void syncIntent(intent)}
                          >
                            {busyIntent === intent.id ? 'Consultando...' : intent.status === 'CONFIRMED' ? 'Verificar estorno' : 'Consultar provedor'}
                          </button>
                        )}
                        {/* Reabrir: a regra vem do backend (canReopen), sem condição local extra */}
                        {intent.canReopen && (
                          <button className="btn-small" disabled={busyIntent !== null} onClick={() => void reopenIntent(intent)}>Reabrir</button>
                        )}
                        {intent.status === 'CONFIRMED' && intent.member.id && (
                          <button className="btn-small" onClick={() => downloadBlob(`/tithe/intents/${intent.id}/receipt.pdf`, 'comprovante.pdf')}>🧾</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem', marginTop: '1.6rem' }}>Relatório do mês por comunidade</h4>
          <div className="filters-bar">
            <input type="month" className="filter-input" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} />
            <select className="filter-select" value={reportCommunity} onChange={(e) => setReportCommunity(e.target.value)}>
              <option value="">Todas as comunidades do escopo</option>
              {communities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="btn-small" onClick={() => void loadReport()}>Gerar</button>
            <button className="btn-small" onClick={() => downloadBlob('/tithe/report.csv', `dizimo-${reportMonth}.csv`, { referenceMonth: reportMonth, ...(reportCommunity ? { communityId: reportCommunity } : {}) })}>⬇ CSV</button>
          </div>
          {report && (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Comunidade</th><th>Tipo</th><th>Meio</th><th>Qtde</th><th>Total</th></tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={`${r.communityId}-${r.kind}-${r.method}`}><td>{r.community}</td><td>{r.kind}</td><td>{reportMethodLabel(r.method)}</td><td>{r.count}</td><td>{formatBRL(r.total)}</td></tr>
                  ))}
                  <tr><td colSpan={3}><strong>Total {report.referenceMonth}</strong></td><td><strong>{report.totals.count}</strong></td><td><strong>{formatBRL(report.totals.total)}</strong></td></tr>
                </tbody>
              </table>
            </div>
          )}

          <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem', marginTop: '1.6rem' }}>Extrato anual do dizimista</h4>
          <div className="filters-bar">
            <select className="filter-select" value={statementMember} onChange={(e) => setStatementMember(e.target.value)}>
              <option value="">Escolha o dizimista...</option>
              {tithers.map((t: any) => (
                <option key={t.id} value={t.member?.id ?? t.memberId}>{t.member?.fullName ?? t.memberId}</option>
              ))}
            </select>
            <input type="number" className="filter-input" style={{ width: 110 }} value={statementYear} onChange={(e) => setStatementYear(e.target.value)} />
            <button className="btn-small" disabled={!statementMember} onClick={() => downloadBlob(`/tithe/tithers/${statementMember}/statement.pdf`, `extrato-${statementYear}.pdf`, { year: statementYear })}>🖨 Extrato (PDF)</button>
          </div>

          {providerPwdModal && (
            <div className="module-modal-overlay" onClick={closePwdModals}>
              <div className="module-modal" role="dialog" aria-modal="true" aria-labelledby="provider-pwd-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
                <h2 id="provider-pwd-title">🔐 Confirmar provedor de pagamento</h2>
                <p style={{ fontSize: '0.88rem', color: '#666' }}>
                  Trocar o provedor, o ambiente ou a chave de API muda para onde o dinheiro do dízimo vai. Trocar provedor ou
                  ambiente encerra as cobranças e dízimos automáticos em aberto no provedor anterior. Confirme com a sua senha atual.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!pwd.trim()) {
                      notify.error('Informe sua senha atual');
                      return;
                    }
                    void submitProvider(pwd);
                  }}
                >
                  <div className="form-group">
                    <label htmlFor="provider-pwd-input">Senha atual</label>
                    <input id="provider-pwd-input" type="password" autoComplete="current-password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn-cancel" onClick={closePwdModals}>Cancelar</button>
                    <button type="submit" className="btn-submit" disabled={savingProvider}>{savingProvider ? 'Salvando...' : 'Confirmar e salvar'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {pwdModal && (
            <div className="module-modal-overlay" onClick={closePwdModals}>
              <div className="module-modal" role="dialog" aria-modal="true" aria-labelledby="pix-pwd-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
                <h2 id="pix-pwd-title">🔐 Confirmar troca da chave Pix</h2>
                <p style={{ fontSize: '0.88rem', color: '#666' }}>
                  Você está alterando a chave Pix da paróquia. Os Pix ainda não informados serão cancelados e os outros
                  administradores serão avisados. Confirme com a sua senha atual.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!pwd.trim()) {
                      notify.error('Informe sua senha atual');
                      return;
                    }
                    void submitConfig(pwd);
                  }}
                >
                  <div className="form-group">
                    <label htmlFor="pix-pwd-input">Senha atual</label>
                    <input id="pix-pwd-input" type="password" autoComplete="current-password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn-cancel" onClick={closePwdModals}>Cancelar</button>
                    <button type="submit" className="btn-submit" disabled={savingConfig}>{savingConfig ? 'Salvando...' : 'Confirmar e salvar'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {confirmTargets && (
            <div className="module-modal-overlay" onClick={() => setConfirmTargets(null)}>
              <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
                <h2>{confirmTargets.length === 1 ? 'Confirmar pagamento' : `Confirmar ${confirmTargets.length} pagamentos`}</h2>
                <p style={{ fontSize: '0.85rem', color: '#666' }}>
                  {confirmTargets.length === 1
                    ? `${confirmTargets[0].member.fullName} · ${methodName(confirmTargets[0])} · ${formatBRL(confirmTargets[0].amount)} · id ${confirmTargets[0].txid}`
                    : 'A mesma data vale para todos; valor pago e mês só podem ser ajustados um a um.'}
                </p>
                {confirmTargets.length === 1 && isMismatch(confirmTargets[0]) && confirmTargets[0].note ? (
                  <p style={{ fontSize: '0.85rem', color: '#b45309', fontWeight: 600 }}>
                    ⚠ Provedor informou: {confirmTargets[0].note} — confira o valor que caiu antes de lançar.
                  </p>
                ) : null}
                <form onSubmit={submitConfirm}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Data em que caiu no extrato *</label>
                      <input type="date" required value={confirmForm.date} onChange={(e) => setConfirmForm({ ...confirmForm, date: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Nº no extrato (opcional)</label>
                      <input type="text" value={confirmForm.receiptNumber} onChange={(e) => setConfirmForm({ ...confirmForm, receiptNumber: e.target.value })} />
                    </div>
                  </div>
                  {confirmTargets.length === 1 && (
                    <div className="form-row">
                      <div className="form-group">
                        <label>Valor que caiu (R$)</label>
                        <input type="number" step="0.01" min="1" value={confirmForm.amountPaid} onChange={(e) => setConfirmForm({ ...confirmForm, amountPaid: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Mês de referência</label>
                        <input type="month" value={confirmForm.referenceMonth} onChange={(e) => setConfirmForm({ ...confirmForm, referenceMonth: e.target.value })} />
                      </div>
                    </div>
                  )}
                  <div className="modal-actions">
                    <button type="button" className="btn-cancel" onClick={() => setConfirmTargets(null)}>Cancelar</button>
                    <button type="submit" className="btn-submit" disabled={busyIntent !== null}>{busyIntent ? 'Confirmando...' : 'Confirmar e lançar'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'campaigns' && (
        <>
          {canConfigureTithe && !user?.parishId && (
            <div className="filters" style={{ marginBottom: '1rem' }}>
              <select className="filter-select" value={configParishId} onChange={(e) => setConfigParishId(e.target.value)}>
                <option value="">Escolha a paróquia...</option>
                {parishOptions.map((parish) => (
                  <option key={parish.id} value={parish.id}>{parish.name}</option>
                ))}
              </select>
            </div>
          )}
          <CampaignsTab
            communities={campaignCommunities}
            parishIdParam={configParishId}
            parishReady={!!(configParishId || user?.parishId)}
            userRole={user?.role ?? ''}
            userCommunityId={user?.communityId}
            onDataChanged={fetchFinance}
          />
        </>
      )}

      {tab === 'statements' && (
        <>
          {canConfigureTithe && !user?.parishId && (
            <div className="filters" style={{ marginBottom: '1rem' }}>
              <select className="filter-select" value={configParishId} onChange={(e) => setConfigParishId(e.target.value)}>
                <option value="">Escolha a paróquia...</option>
                {parishOptions.map((parish) => (
                  <option key={parish.id} value={parish.id}>{parish.name}</option>
                ))}
              </select>
            </div>
          )}
          <StatementsTab
            communities={campaignCommunities}
            parishIdParam={configParishId}
            parishReady={!!(configParishId || user?.parishId)}
            userRole={user?.role ?? ''}
            userCommunityId={user?.communityId}
          />
        </>
      )}

      {tab === 'presential' && (
        <PresentialTab parishIdParam={configParishId} onDataChanged={fetchFinance} />
      )}

      {tab === 'tithe' && (
        <>
          <div className="summary-cards">
            <div className="summary-card"><div className="label">Dizimistas cadastrados</div><div className="value">{tithers.length}</div></div>
            <div className="summary-card"><div className="label">Contribuições em {referenceMonth}</div><div className="value">{contributions.length}</div></div>
            <div className="summary-card"><div className="label">Total do mês</div><div className="value positive">{formatBRL(monthTotal)}</div></div>
          </div>

          <div className="filters">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#555' }}>
              Mês de referência:
              <input type="month" className="filter-input" value={referenceMonth} onChange={(e) => setReferenceMonth(e.target.value)} />
            </label>
          </div>

          <div className="detail-section" style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>Contribuições de {referenceMonth}</h4>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Dizimista</th><th>Valor</th><th>Forma</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {contributions.map((c) => (
                    <tr key={c.contributionId}>
                      <td><strong>{c.member.name}</strong></td>
                      <td>{formatBRL(c.amount)}</td>
                      <td>{c.method}</td>
                      <td>{formatDate(c.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {contributions.length === 0 && <div className="empty-state">Nenhuma contribuição lançada neste mês.</div>}
            </div>
          </div>

          <div className="detail-section">
            <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>Dizimistas</h4>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Nome</th><th>Registro/Envelope</th><th>Status</th><th>Contribuições</th></tr>
                </thead>
                <tbody>
                  {tithers.map((tither) => (
                    <tr key={tither.id}>
                      <td><strong>{tither.member.fullName}</strong></td>
                      <td>{tither.registrationNumber || '—'}</td>
                      <td>
                        {tither.status === 'ACTIVE'
                          ? <span className="status-badge green">Ativo</span>
                          : <span className="status-badge gray">Inativo</span>}
                      </td>
                      <td>{tither._count?.contributions ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tithers.length === 0 && <div className="empty-state">Nenhum dizimista cadastrado.</div>}
            </div>
          </div>
        </>
      )}

      {showTxModal && (
        <div className="module-modal-overlay" onClick={() => setShowTxModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Lançamento</h2>
            <form onSubmit={handleCreateTransaction}>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value })}>
                    <option value="INCOME">Receita</option>
                    <option value="EXPENSE">Despesa</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Valor (R$) *</label>
                  <input type="number" step="0.01" min="0.01" required value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Categoria *</label>
                  <input type="text" required placeholder="Ex.: Coleta, Festa, Energia" value={txForm.category} onChange={(e) => setTxForm({ ...txForm, category: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Data *</label>
                  <input type="date" required value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="tx-community">Comunidade (opcional)</label>
                  <select id="tx-community" value={txForm.communityId} onChange={(e) => setTxForm({ ...txForm, communityId: e.target.value })}>
                    <option value="">Paróquia</option>
                    {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="tx-cost-center">Centro de custo (opcional)</label>
                  <input
                    id="tx-cost-center"
                    type="text"
                    list="tx-cost-center-options"
                    maxLength={60}
                    autoComplete="off"
                    placeholder="Ex.: Pastoral, Manutenção, Secretaria"
                    value={txForm.costCenter}
                    onChange={(e) => setTxForm({ ...txForm, costCenter: e.target.value })}
                  />
                  <datalist id="tx-cost-center-options">
                    {costCenters.map((name) => <option key={name} value={name} />)}
                  </datalist>
                  <small style={{ color: '#888' }}>Agrupa receitas e despesas no balancete mensal</small>
                </div>
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <input type="text" value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowTxModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTitherModal && (
        <div className="module-modal-overlay" onClick={() => setShowTitherModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Cadastrar Dizimista</h2>
            <form onSubmit={handleRegisterTither}>
              <div className="form-group">
                <label>Membro *</label>
                <select required value={titherForm.memberId} onChange={(e) => setTitherForm({ ...titherForm, memberId: e.target.value })}>
                  <option value="">Selecione</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Nº de registro / envelope</label>
                <input type="text" value={titherForm.registrationNumber} onChange={(e) => setTitherForm({ ...titherForm, registrationNumber: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowTitherModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Cadastrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showContributionModal && (
        <div className="module-modal-overlay" onClick={() => setShowContributionModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Lançar Contribuição</h2>
            <div className="privacy-note" style={{ marginBottom: '1rem' }}>
              Atendendo o fiel no balcão? Use o <strong>Registro presencial</strong>: busca por nome, nº de dizimista, CPF ou telefone,
              comprovante em PDF e opção de desfazer em 48 h.{' '}
              <button
                type="button"
                className="btn-small"
                style={{ marginLeft: '0.4rem' }}
                onClick={() => {
                  setShowContributionModal(false);
                  setTab('presential');
                }}
              >
                Ir para o Registro presencial
              </button>
            </div>
            <form onSubmit={handleAddContribution}>
              <div className="form-group">
                <label>Dizimista *</label>
                <select required value={contributionForm.titherId} onChange={(e) => setContributionForm({ ...contributionForm, titherId: e.target.value })}>
                  <option value="">Selecione</option>
                  {tithers.map((t) => <option key={t.id} value={t.id}>{t.member.fullName}{t.registrationNumber ? ` (${t.registrationNumber})` : ''}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Valor (R$) *</label>
                  <input type="number" step="0.01" min="0.01" required value={contributionForm.amount} onChange={(e) => setContributionForm({ ...contributionForm, amount: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Data *</label>
                  <input type="date" required value={contributionForm.date} onChange={(e) => setContributionForm({ ...contributionForm, date: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Mês de referência *</label>
                  <input type="month" required value={contributionForm.referenceMonth} onChange={(e) => setContributionForm({ ...contributionForm, referenceMonth: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Forma *</label>
                  <select value={contributionForm.method} onChange={(e) => setContributionForm({ ...contributionForm, method: e.target.value })}>
                    {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Nº do recibo (opcional)</label>
                <input type="text" value={contributionForm.receiptNumber} onChange={(e) => setContributionForm({ ...contributionForm, receiptNumber: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowContributionModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Lançar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancePage;
