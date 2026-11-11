import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api from '../../services/api';
import { notify } from '../../services/notification.service';
import { formatPhoneDisplay, whatsappNumber } from '../../utils/phone';
import { downloadCsv } from '../../utils/csvExport';
import { dataHoraBR, haQuanto, mensagemDeErro } from './platformShared';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Reivindicações de paróquia (contrato C1): "esta paróquia é minha". Sempre
 * aprovadas aqui pelo SYSTEM_ADMIN — o código no contato oficial da paróquia
 * é só evidência (VERIFIED). Na aprovação sem conta, o backend devolve o link
 * de convite para mandar por WhatsApp ou copiar.
 *
 * Aprovar NÃO inicia mais teste: a paróquia entra no plano grátis e pede o
 * teste de 30 dias pelo painel. Para volumes grandes (uma cidade inteira) há
 * a aprovação em lote: os pedidos marcados vão um a um, em sequência, pela
 * mesma rota da aprovação individual (PATCH /platform/claims/:id).
 *
 * Regras do lote: no máximo UM pedido por paróquia (o verificado; empatando, o
 * mais antigo) — os demais são pulados, porque a paróquia já recebeu titular
 * neste lote. O lote para se a pessoa sai da tela (com aviso antes de sair) e,
 * ao fim, os links de convite gerados podem ser copiados de uma vez ou
 * baixados em CSV.
 */

type ClaimStatus = 'PENDING' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'CANCELED';
type Filtro = 'OPEN' | ClaimStatus | '';

interface Claim {
  id: string;
  parishId: string;
  parish?: {
    id?: string;
    name?: string;
    city?: string | null;
    state?: string | null;
    diocese?: { name?: string | null } | string | null;
    managedAt?: string | null;
    officialPhone?: string | null;
    officialEmail?: string | null;
    activeParishAdmins?: number;
  } | null;
  /** Conta de quem pediu (quando pediu logado) */
  account?: { id: string; name?: string | null; email?: string | null; role?: string | null } | null;
  /** Convite gerado na aprovação (sem conta) */
  invite?: { id: string; status?: string | null; expiresAt?: string | null; lastSentAt?: string | null } | null;
  parishName?: string | null;
  managed?: boolean;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  message?: string | null;
  evidenceUrl?: string | null;
  method?: string | null;
  codeSentTo?: string | null;
  verifiedAt?: string | null;
  status: ClaimStatus;
  userId?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

interface ApproveResult {
  inviteUrl?: string;
  whatsappText?: string;
  inviteEmailSent?: boolean;
}

const STATUS_LABEL: Record<ClaimStatus, string> = {
  PENDING: 'Aguardando',
  VERIFIED: 'Contato oficial confirmado',
  APPROVED: 'Aprovada',
  REJECTED: 'Recusada',
  CANCELED: 'Cancelada',
};
const STATUS_TONE: Record<ClaimStatus, string> = {
  PENDING: 'yellow',
  VERIFIED: 'blue',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELED: 'gray',
};
const METHOD_LABEL: Record<string, string> = {
  PHONE_CODE: 'código no telefone oficial',
  EMAIL_CODE: 'código no e-mail oficial',
  DOCUMENT: 'documento enviado',
  MANUAL: 'revisão manual',
};

const FILTROS: Array<{ key: Filtro; label: string }> = [
  { key: 'OPEN', label: 'A revisar' },
  { key: 'APPROVED', label: 'Aprovadas' },
  { key: 'REJECTED', label: 'Recusadas' },
  { key: '', label: 'Todas' },
];

const asList = (data: any): Claim[] => {
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return arr.filter((c: any) => c && typeof c.id === 'string');
};

const dioceseNome = (d: unknown): string =>
  typeof d === 'string' ? d : d && typeof d === 'object' && typeof (d as { name?: unknown }).name === 'string' ? (d as { name: string }).name : '';

interface Lote {
  total: number;
  feitos: number;
  aprovados: number;
  comConvite: number;
  falhas: Array<{ id: string; paroquia: string; erro: string }>;
  /** Pedidos marcados que não foram enviados: a paróquia já recebeu titular neste lote */
  pulados: Array<{ id: string; paroquia: string; solicitante: string }>;
  /** Convites gerados neste lote (para copiar todos / baixar CSV) */
  convites: Array<{ id: string; paroquia: string; solicitante: string; email: string; link: string }>;
  rodando: boolean;
  interrompido: boolean;
}

const MOTIVO_PULADO = 'pulado: paróquia já recebeu titular neste lote';

const estaAberta = (c: Claim) => c.status === 'PENDING' || c.status === 'VERIFIED';
const jaGerida = (c: Claim) => c.managed ?? !!c.parish?.managedAt;
const nomeParoquia = (c: Claim) => c.parish?.name ?? c.parishName ?? c.parishId;
/** Verificadas (contato oficial confirmado) antes das demais abertas */
const pesoStatus = (c: Claim) => (c.status === 'VERIFIED' ? 0 : c.status === 'PENDING' ? 1 : 2);

/**
 * No lote, um titular por paróquia: fica o pedido VERIFICADO (contato oficial
 * confirmado); empatando, o mais antigo. Devolve a fila e os pulados.
 */
function umPorParoquia(marcados: Claim[]): { fila: Claim[]; pulados: Claim[] } {
  const ordenados = [...marcados].sort((x, y) => pesoStatus(x) - pesoStatus(y) || x.createdAt.localeCompare(y.createdAt));
  const vistas = new Set<string>();
  const fila: Claim[] = [];
  const pulados: Claim[] = [];
  for (const c of ordenados) {
    if (vistas.has(c.parishId)) pulados.push(c);
    else {
      vistas.add(c.parishId);
      fila.push(c);
    }
  }
  return { fila, pulados };
}

const lerConvite = (data: any): ApproveResult => ({
  inviteUrl: typeof data?.inviteUrl === 'string' ? data.inviteUrl : undefined,
  whatsappText: typeof data?.whatsappText === 'string' ? data.whatsappText : undefined,
  inviteEmailSent: data?.inviteEmailSent === true,
});

/** URL externa só se for http(s) — evita javascript: vindo do formulário público. */
const urlSegura = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

const ClaimsPage: React.FC = () => {
  const [filtro, setFiltro] = useState<Filtro>('OPEN');
  const [lista, setLista] = useState<Claim[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [confirmando, setConfirmando] = useState<{ id: string; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [convites, setConvites] = useState<Record<string, ApproveResult>>({});
  const [uf, setUf] = useState('');
  const [cidade, setCidade] = useState('');
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set());
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [lote, setLote] = useState<Lote | null>(null);
  const pararLote = useRef(false);
  const loteAtivo = useRef(false);

  // Saiu da tela: o lote para depois do pedido em andamento (não segue aprovando "às cegas")
  useEffect(
    () => () => {
      pararLote.current = true;
    },
    [],
  );

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    setSelecionados(new Set());
    setConfirmandoLote(false);
    try {
      if (filtro === 'OPEN') {
        const [a, b] = await Promise.all([
          api.get('/platform/claims', { params: { status: 'PENDING' } }),
          api.get('/platform/claims', { params: { status: 'VERIFIED' } }),
        ]);
        // Verificadas primeiro (têm mais evidência), depois as mais antigas
        setLista(
          [...asList(b.data), ...asList(a.data)].sort((x, y) =>
            x.status === y.status ? x.createdAt.localeCompare(y.createdAt) : x.status === 'VERIFIED' ? -1 : 1,
          ),
        );
      } else {
        const { data } = await api.get('/platform/claims', { params: filtro ? { status: filtro } : {} });
        // Em "Todas", o que ainda espera decisão vem antes (verificadas primeiro)
        setLista(
          asList(data).sort((x, y) => pesoStatus(x) - pesoStatus(y) || y.createdAt.localeCompare(x.createdAt)),
        );
      }
    } catch (e) {
      setLista([]);
      setErro(mensagemDeErro(e, 'Não foi possível carregar as reivindicações.'));
    } finally {
      setCarregando(false);
    }
  }, [filtro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const decidir = async (claim: Claim, action: 'APPROVE' | 'REJECT') => {
    const note = (notas[claim.id] ?? '').trim();
    if (action === 'REJECT' && note.length < 3) {
      notify.warning('Escreva o motivo da recusa (a pessoa recebe esta nota).');
      return;
    }
    setEnviando(claim.id);
    try {
      const { data } = await api.patch(`/platform/claims/${encodeURIComponent(claim.id)}`, { action, ...(note ? { note } : {}) });
      setConfirmando(null);
      if (action === 'APPROVE') {
        const invite = lerConvite(data);
        if (invite.inviteUrl) {
          setConvites((prev) => ({ ...prev, [claim.id]: invite }));
          notify.success('Reivindicação aprovada. Envie o link de acesso para quem pediu.');
        } else {
          notify.success('Reivindicação aprovada. A conta de quem pediu já tem a gestão da paróquia.');
        }
      } else if (typeof data?.warning === 'string' && data.warning) {
        // Aprovação desfeita: a conta que já recebeu a gestão NÃO é rebaixada sozinha
        notify.warning(data.warning);
      } else {
        notify.success(claim.status === 'APPROVED' ? 'Aprovação desfeita. O convite pendente foi revogado.' : 'Reivindicação recusada.');
      }
      // Atualiza a linha sem perder o link do convite da tela
      // (aprovou: os outros pedidos da mesma paróquia passam a ser de paróquia que já tem gestão)
      setLista((prev) =>
        prev.map((c) =>
          c.id === claim.id
            ? { ...c, status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewNote: note || c.reviewNote }
            : action === 'APPROVE' && c.parishId === claim.parishId
              ? { ...c, managed: true }
              : c,
        ),
      );
    } catch (e) {
      notify.error(mensagemDeErro(e, 'Não foi possível registrar a decisão.'));
    } finally {
      setEnviando(null);
    }
  };

  // ── Filtro por UF/cidade (os dados vêm da paróquia de cada pedido) ──
  const ufs = useMemo(
    () => [...new Set(lista.map((c) => c.parish?.state ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [lista],
  );
  const cidades = useMemo(
    () =>
      [...new Set(lista.filter((c) => !uf || c.parish?.state === uf).map((c) => c.parish?.city ?? '').filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
    [lista, uf],
  );
  // Filtro que deixou de existir na lista (recarga, troca de situação) é ignorado
  const ufAtiva = ufs.includes(uf) ? uf : '';
  const cidadeAtiva = cidades.includes(cidade) ? cidade : '';
  const visiveis = useMemo(
    () => lista.filter((c) => (!ufAtiva || c.parish?.state === ufAtiva) && (!cidadeAtiva || c.parish?.city === cidadeAtiva)),
    [lista, ufAtiva, cidadeAtiva],
  );

  // ── Aprovação em lote ──
  // Paróquia que já tem gestão fica fora do lote: pede conferência com a equipe atual, uma a uma.
  const selecionaveis = useMemo(() => visiveis.filter((c) => estaAberta(c) && !jaGerida(c)), [visiveis]);
  const marcados = useMemo(() => selecionaveis.filter((c) => selecionados.has(c.id)), [selecionaveis, selecionados]);
  // Um titular por paróquia no lote: os demais pedidos marcados da mesma paróquia são pulados
  const { fila: filaLote, pulados: puladosLote } = useMemo(() => umPorParoquia(marcados), [marcados]);
  const loteRodando = lote?.rodando === true;

  // Lote rodando: avisa antes de fechar/recarregar a aba e antes de sair pelo menu
  // (os links de convite gerados só existem nesta tela)
  useEffect(() => {
    if (!loteRodando) return;
    const aoFechar = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const aoClicarLink = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const href = link.getAttribute('href') ?? '';
      if (/^(mailto:|tel:|#)/i.test(href)) return;
      const sair = window.confirm(
        'A aprovação em lote está em andamento. Sair desta tela interrompe o lote e os links de convite já gerados se perdem.\n\nSair mesmo assim?',
      );
      if (!sair) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', aoFechar);
    document.addEventListener('click', aoClicarLink, true);
    return () => {
      window.removeEventListener('beforeunload', aoFechar);
      document.removeEventListener('click', aoClicarLink, true);
    };
  }, [loteRodando]);

  const alternar = (id: string) =>
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const marcarTodos = (apenasVerificados: boolean) => {
    setConfirmandoLote(false);
    setSelecionados(new Set(selecionaveis.filter((c) => !apenasVerificados || c.status === 'VERIFIED').map((c) => c.id)));
  };

  const aprovarLote = async () => {
    const fila = filaLote;
    if (fila.length === 0 || loteRodando || loteAtivo.current) return;
    loteAtivo.current = true;
    setConfirmandoLote(false);
    setConfirmando(null);
    pararLote.current = false;
    const andamento: Lote = {
      total: fila.length,
      feitos: 0,
      aprovados: 0,
      comConvite: 0,
      falhas: [],
      pulados: [],
      convites: [],
      rodando: true,
      interrompido: false,
    };
    setLote({ ...andamento });
    const candidatosAPular = puladosLote;
    // Defesa: paróquia que já recebeu titular neste lote não recebe outro
    const comTitular = new Set<string>();
    // Um a um, em sequência: a mesma rota e a mesma regra da aprovação individual
    for (const claim of fila) {
      if (pararLote.current) {
        andamento.interrompido = true;
        break;
      }
      if (comTitular.has(claim.parishId)) {
        andamento.pulados = [...andamento.pulados, { id: claim.id, paroquia: nomeParoquia(claim), solicitante: claim.name }];
        andamento.feitos += 1;
        setLote({ ...andamento });
        continue;
      }
      try {
        const { data } = await api.patch(`/platform/claims/${encodeURIComponent(claim.id)}`, { action: 'APPROVE' });
        const invite = lerConvite(data);
        andamento.aprovados += 1;
        comTitular.add(claim.parishId);
        if (invite.inviteUrl) {
          andamento.comConvite += 1;
          andamento.convites = [
            ...andamento.convites,
            { id: claim.id, paroquia: nomeParoquia(claim), solicitante: claim.name, email: claim.email, link: invite.inviteUrl },
          ];
          setConvites((prev) => ({ ...prev, [claim.id]: invite }));
        }
        // A paróquia passou a ter gestão: os outros pedidos dela saem do lote (e da seleção)
        setLista((prev) =>
          prev.map((c) =>
            c.id === claim.id ? { ...c, status: 'APPROVED' } : c.parishId === claim.parishId ? { ...c, managed: true } : c,
          ),
        );
        setSelecionados((prev) => {
          const next = new Set(prev);
          next.delete(claim.id);
          return next;
        });
      } catch (e) {
        andamento.falhas = [
          ...andamento.falhas,
          { id: claim.id, paroquia: nomeParoquia(claim), erro: mensagemDeErro(e, 'Não foi possível aprovar.') },
        ];
      }
      andamento.feitos += 1;
      setLote({ ...andamento });
    }
    // Pulados de verdade: só os de paróquia que RECEBEU titular neste lote (se a aprovação
    // do escolhido falhou ou o lote parou antes, o outro pedido segue marcado para nova tentativa)
    const pulados = candidatosAPular.filter((c) => comTitular.has(c.parishId));
    if (pulados.length > 0) {
      andamento.pulados = [...andamento.pulados, ...pulados.map((c) => ({ id: c.id, paroquia: nomeParoquia(c), solicitante: c.name }))];
      const ids = new Set(pulados.map((c) => c.id));
      setSelecionados((prev) => new Set([...prev].filter((id) => !ids.has(id))));
    }
    andamento.rodando = false;
    loteAtivo.current = false;
    setLote({ ...andamento });
    if (andamento.falhas.length === 0 && !andamento.interrompido) {
      notify.success(`${andamento.aprovados} ${andamento.aprovados === 1 ? 'reivindicação aprovada' : 'reivindicações aprovadas'}.`);
    } else {
      notify.warning('A aprovação em lote terminou com pendências. Veja o resumo no topo da lista.');
    }
  };

  const copiarLinksDoLote = async () => {
    if (!lote || lote.convites.length === 0) return;
    const texto = lote.convites.map((c) => `${c.paroquia} — ${c.solicitante}: ${c.link}`).join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      notify.success(`${lote.convites.length} ${lote.convites.length === 1 ? 'link copiado' : 'links copiados'}.`);
    } catch {
      notify.info('Não deu para copiar automaticamente: baixe o CSV ou copie os links dos cartões.');
    }
  };

  const baixarLinksDoLote = () => {
    if (!lote || lote.convites.length === 0) return;
    downloadCsv(
      'parish_convites_lote',
      ['Paróquia', 'Solicitante', 'E-mail', 'Link do convite'],
      lote.convites.map((c) => [c.paroquia, c.solicitante, c.email, c.link]),
    );
  };

  const fecharResumo = () => {
    if (
      lote &&
      lote.convites.length > 0 &&
      !window.confirm('Os links de convite deste lote deixam de aparecer no resumo. Já copiou ou baixou o CSV?')
    ) {
      return;
    }
    setLote(null);
  };

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      notify.success('Link copiado.');
    } catch {
      notify.info('Não deu para copiar automaticamente: selecione o link e copie.');
    }
  };

  return (
    <div className="module-page platform-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="paroquia" /> Reivindicações
        </h1>
        <div className="header-actions">
          <button type="button" className="pf-btn" onClick={() => void carregar()} disabled={carregando || loteRodando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>
      <p className="pf-nota">
        Pedidos de gestão de paróquia. A aprovação é sempre daqui; o código no contato oficial é só evidência. Aprovar
        dá a gestão da paróquia no plano grátis; o teste de 30 dias do plano completo é pedido depois, pelo painel da
        paróquia.
      </p>

      <div className="pf-filtros">
        <div className="pf-chips" role="group" aria-label="Situação">
          {FILTROS.map((f) => (
            <button
              key={f.key || 'todas'}
              type="button"
              className={`pf-chip${filtro === f.key ? ' on' : ''}`}
              aria-pressed={filtro === f.key}
              onClick={() => setFiltro(f.key)}
              disabled={loteRodando}
            >
              {f.label}
            </button>
          ))}
        </div>
        {ufs.length > 0 && (
          <>
            <span className="pf-sep" aria-hidden="true" />
            <select
              aria-label="Filtrar por UF"
              value={ufAtiva}
              disabled={loteRodando}
              onChange={(e) => {
                setUf(e.target.value);
                setCidade('');
                setConfirmandoLote(false);
              }}
            >
              <option value="">Todas as UFs</option>
              {ufs.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por cidade"
              className="pf-select-largo"
              value={cidadeAtiva}
              disabled={loteRodando}
              onChange={(e) => {
                setCidade(e.target.value);
                setConfirmandoLote(false);
              }}
            >
              <option value="">Todas as cidades</option>
              {cidades.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {(selecionaveis.length > 0 || lote) && (
        <div className="pf-caixa pf-lote">
          {selecionaveis.length > 0 && !loteRodando && (
            <>
              <div className="pf-acoes pf-lote-barra">
                <strong className="pf-lote-conta" aria-live="polite">
                  {marcados.length} de {selecionaveis.length} {selecionaveis.length === 1 ? 'pedido marcado' : 'pedidos marcados'}
                </strong>
                <button type="button" className="pf-btn pf-btn-mini" onClick={() => marcarTodos(false)}>
                  Marcar todos
                </button>
                {selecionaveis.some((c) => c.status === 'VERIFIED') && (
                  <button type="button" className="pf-btn pf-btn-mini" onClick={() => marcarTodos(true)}>
                    Só os verificados
                  </button>
                )}
                {marcados.length > 0 && (
                  <button
                    type="button"
                    className="pf-btn pf-btn-mini"
                    onClick={() => {
                      setSelecionados(new Set());
                      setConfirmandoLote(false);
                    }}
                  >
                    Limpar
                  </button>
                )}
                {!confirmandoLote && (
                  <button type="button" className="pf-btn pf-btn-mini pf-btn-ok" disabled={marcados.length === 0} onClick={() => setConfirmandoLote(true)}>
                    Aprovar selecionados
                  </button>
                )}
              </div>
              {confirmandoLote && marcados.length > 0 && (
                <div className="pf-acoes pf-confirma pf-lote-confirma">
                  <span className="pf-meta">
                    Aprovar {filaLote.length} {filaLote.length === 1 ? 'pedido' : 'pedidos'}? Cada pessoa recebe a gestão da
                    paróquia que pediu, no plano grátis. A aprovação em lote não leva nota.
                    {puladosLote.length > 0 &&
                      ` Atenção: ${puladosLote.length} ${puladosLote.length === 1 ? 'pedido marcado é de paróquia que já tem outro pedido no lote e será pulado' : 'pedidos marcados são de paróquias que já têm outro pedido no lote e serão pulados'} — o lote dá um titular por paróquia (o verificado; empatando, o mais antigo).`}
                  </span>
                  <button type="button" className="pf-btn pf-btn-mini" onClick={() => setConfirmandoLote(false)}>
                    Voltar
                  </button>
                  <button type="button" className="pf-btn pf-btn-mini pf-btn-ok" onClick={() => void aprovarLote()}>
                    Sim, aprovar {filaLote.length}
                  </button>
                </div>
              )}
              <p className="pf-meta">
                Pedidos de paróquia que já tem gestão ficam fora do lote: aprove um a um, depois de conferir com a equipe
                atual.
              </p>
            </>
          )}
          {lote && (
            <div className="pf-lote-andamento" role="status" aria-live="polite">
              <div className="pf-acoes pf-lote-barra">
                <strong className="pf-lote-conta">
                  {lote.rodando
                    ? `Aprovando ${Math.min(lote.feitos + 1, lote.total)} de ${lote.total}…`
                    : `${lote.interrompido ? 'Lote interrompido' : 'Lote concluído'}: ${lote.aprovados} de ${lote.total} ${lote.aprovados === 1 ? 'aprovado' : 'aprovados'}`}
                </strong>
                {lote.rodando ? (
                  <button
                    type="button"
                    className="pf-btn pf-btn-mini pf-btn-perigo"
                    onClick={() => {
                      pararLote.current = true;
                    }}
                  >
                    Parar depois deste
                  </button>
                ) : (
                  <button type="button" className="pf-btn pf-btn-mini" onClick={fecharResumo}>
                    Fechar resumo
                  </button>
                )}
              </div>
              <progress className="pf-lote-progresso" max={lote.total} value={lote.feitos} aria-label="Andamento da aprovação em lote" />
              {lote.rodando && (
                <p className="pf-meta">
                  Fique nesta tela até o fim: sair interrompe o lote e os links de convite gerados se perdem.
                </p>
              )}
              {!lote.rodando && lote.convites.length > 0 && (
                <>
                  <p className="pf-meta">
                    {lote.convites.length} {lote.convites.length === 1 ? 'aprovação gerou' : 'aprovações geraram'} link de
                    acesso. Guarde agora: os links só existem nesta tela (também estão nos cartões abaixo, até a lista ser
                    atualizada).
                  </p>
                  <div className="pf-acoes">
                    <button type="button" className="pf-btn pf-btn-mini pf-btn-ok" onClick={() => void copiarLinksDoLote()}>
                      Copiar todos os links
                    </button>
                    <button type="button" className="pf-btn pf-btn-mini" onClick={baixarLinksDoLote}>
                      Baixar CSV
                    </button>
                  </div>
                </>
              )}
              {lote.pulados.length > 0 && (
                <>
                  <p className="pf-meta">
                    {lote.pulados.length} {lote.pulados.length === 1 ? 'pedido não foi enviado' : 'pedidos não foram enviados'} (
                    {MOTIVO_PULADO}). Eles continuam na lista para revisão individual:
                  </p>
                  <ul className="pf-lote-falhas">
                    {lote.pulados.map((p) => (
                      <li key={p.id}>
                        <strong>{p.paroquia}</strong>: pedido de {p.solicitante} — {MOTIVO_PULADO}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {lote.falhas.length > 0 && (
                <>
                  <p className="pf-erro">
                    {lote.falhas.length} {lote.falhas.length === 1 ? 'pedido não foi aprovado e continua marcado' : 'pedidos não foram aprovados e continuam marcados'}:
                  </p>
                  <ul className="pf-lote-falhas">
                    {lote.falhas.map((f) => (
                      <li key={f.id}>
                        <strong>{f.paroquia}</strong>: {f.erro}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {erro && (
        <p className="pf-erro">
          {erro}{' '}
          <button type="button" className="pf-link" onClick={() => void carregar()}>
            tentar de novo
          </button>
        </p>
      )}
      {carregando && lista.length === 0 && <p className="pf-vazio">Carregando…</p>}
      {!carregando && !erro && lista.length === 0 && <p className="pf-vazio">Nenhuma reivindicação nesta situação.</p>}
      {!carregando && !erro && lista.length > 0 && visiveis.length === 0 && (
        <p className="pf-vazio">Nenhuma reivindicação nesta cidade/UF.</p>
      )}

      <ul className="pf-cards">
        {visiveis.map((c) => {
          const paroquia = nomeParoquia(c);
          const local = [c.parish?.city && c.parish?.state ? `${c.parish.city}/${c.parish.state}` : c.parish?.city, dioceseNome(c.parish?.diocese)]
            .filter(Boolean)
            .join(' · ');
          const gerida = jaGerida(c);
          const aberta = estaAberta(c);
          const marcavel = aberta && !gerida;
          const conv = convites[c.id];
          const wa = whatsappNumber(c.phone);
          const evid = urlSegura(c.evidenceUrl);
          const conf = confirmando?.id === c.id ? confirmando.action : null;
          return (
            <li key={c.id} className="pf-caixa pf-claim">
              <div className="pf-claim-topo">
                <div className="pf-claim-titulo">
                  {marcavel && (
                    <input
                      type="checkbox"
                      className="pf-claim-check"
                      checked={selecionados.has(c.id)}
                      disabled={loteRodando}
                      onChange={() => {
                        setConfirmandoLote(false);
                        alternar(c.id);
                      }}
                      aria-label={`Marcar o pedido de ${c.name} para ${paroquia}`}
                    />
                  )}
                  <div>
                    <strong className="pf-nome">{paroquia}</strong>
                    {local && <span className="pf-sub">{local}</span>}
                  </div>
                </div>
                <span className={`status-badge ${STATUS_TONE[c.status] ?? 'gray'}`}>{STATUS_LABEL[c.status] ?? c.status}</span>
              </div>
              {gerida && aberta && (
                <p className="pf-alerta">Esta paróquia já tem gestão no Parish. Confira com a equipe atual antes de aprovar.</p>
              )}
              <dl className="pf-dl">
                <dt>Quem pediu</dt>
                <dd>
                  {c.name} · {c.role}
                  {c.userId ? ` (já tem conta${c.account?.email && c.account.email !== c.email ? `: ${c.account.email}` : ''})` : ''}
                </dd>
                <dt>Contato</dt>
                <dd>
                  <a href={`mailto:${c.email}`}>{c.email}</a>
                  {c.phone && (
                    <>
                      {' · '}
                      {wa ? (
                        <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
                          {formatPhoneDisplay(c.phone)}
                        </a>
                      ) : (
                        formatPhoneDisplay(c.phone)
                      )}
                    </>
                  )}
                </dd>
                <dt>Verificação</dt>
                <dd>
                  {c.verifiedAt
                    ? `confirmada por ${METHOD_LABEL[c.method ?? ''] ?? 'código'} em ${dataHoraBR(c.verifiedAt)}`
                    : c.codeSentTo
                      ? `código enviado para ${c.codeSentTo}, ainda não confirmado`
                      : 'sem código; só revisão manual'}
                </dd>
                {(c.parish?.officialPhone || c.parish?.officialEmail) && (
                  <>
                    <dt>Contato oficial</dt>
                    <dd>
                      {[c.parish?.officialPhone ? formatPhoneDisplay(c.parish.officialPhone) : '', c.parish?.officialEmail ?? '']
                        .filter(Boolean)
                        .join(' · ')}
                    </dd>
                  </>
                )}
                {typeof c.parish?.activeParishAdmins === 'number' && c.parish.activeParishAdmins > 0 && (
                  <>
                    <dt>Gestão atual</dt>
                    <dd>
                      {c.parish.activeParishAdmins} {c.parish.activeParishAdmins === 1 ? 'administrador ativo' : 'administradores ativos'}
                    </dd>
                  </>
                )}
                {c.invite && (
                  <>
                    <dt>Convite</dt>
                    <dd>
                      {c.invite.status === 'ACCEPTED'
                        ? 'aceito'
                        : c.invite.status === 'EXPIRED'
                          ? 'vencido (reenvie pela tela de Usuários da paróquia)'
                          : c.invite.status === 'REVOKED'
                            ? 'revogado'
                            : `pendente${c.invite.expiresAt ? `, vale até ${dataHoraBR(c.invite.expiresAt)}` : ''}`}
                    </dd>
                  </>
                )}
                {evid && (
                  <>
                    <dt>Evidência</dt>
                    <dd>
                      <a href={evid} target="_blank" rel="noopener noreferrer nofollow">
                        abrir o link enviado
                      </a>
                    </dd>
                  </>
                )}
                <dt>Pedido</dt>
                <dd title={dataHoraBR(c.createdAt)}>{haQuanto(c.createdAt)} ({dataHoraBR(c.createdAt)})</dd>
              </dl>
              {c.message && <p className="pf-mensagem">{c.message}</p>}
              {c.reviewNote && !aberta && <p className="pf-historico-nota">Nota da revisão: {c.reviewNote}</p>}

              {conv?.inviteUrl && (
                <div className="pf-convite" role="status">
                  <strong>Link de acesso para {c.name}</strong>
                  <p className="pf-meta">
                    Vale por 7 dias e só pode ser usado uma vez.
                    {conv.inviteEmailSent ? ' Também enviamos por e-mail.' : ' O e-mail não foi enviado: mande o link por WhatsApp ou copie.'}
                  </p>
                  <input readOnly value={conv.inviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Link do convite" />
                  <div className="pf-acoes">
                    <button type="button" className="pf-btn pf-btn-mini" onClick={() => void copiar(conv.inviteUrl!)}>
                      Copiar link
                    </button>
                    <a
                      className="pf-btn pf-btn-mini pf-btn-ok"
                      href={`https://wa.me/${wa ?? ''}?text=${encodeURIComponent(conv.whatsappText ?? `Seu acesso ao Parish: ${conv.inviteUrl}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Enviar por WhatsApp
                    </a>
                    <a
                      className="pf-btn pf-btn-mini"
                      href={`mailto:${c.email}?subject=${encodeURIComponent('Seu acesso ao Parish')}&body=${encodeURIComponent(conv.whatsappText ?? conv.inviteUrl!)}`}
                    >
                      Enviar por e-mail
                    </a>
                  </div>
                </div>
              )}

              {(aberta || c.status === 'APPROVED') && (
                <div className="pf-revisao">
                  <label className="pf-campo">
                    Nota {conf === 'REJECT' ? '(obrigatória na recusa — a pessoa recebe)' : '(opcional)'}
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={notas[c.id] ?? ''}
                      onChange={(e) => setNotas((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                  </label>
                  {conf ? (
                    <div className="pf-acoes pf-confirma">
                      <span className="pf-meta">
                        {conf === 'APPROVE'
                          ? `Aprovar dá a gestão de ${paroquia} a ${c.name}, no plano grátis. Confirma?`
                          : `Recusar o pedido de ${c.name}?`}
                      </span>
                      <button type="button" className="pf-btn pf-btn-mini" onClick={() => setConfirmando(null)} disabled={enviando === c.id}>
                        Voltar
                      </button>
                      <button
                        type="button"
                        className={`pf-btn pf-btn-mini ${conf === 'APPROVE' ? 'pf-btn-ok' : 'pf-btn-perigo-cheio'}`}
                        onClick={() => void decidir(c, conf)}
                        disabled={enviando === c.id}
                      >
                        {enviando === c.id ? 'Enviando…' : conf === 'APPROVE' ? 'Sim, aprovar' : 'Sim, recusar'}
                      </button>
                    </div>
                  ) : (
                    <div className="pf-acoes">
                      {aberta ? (
                        <>
                          <button type="button" className="pf-btn pf-btn-mini pf-btn-ok" disabled={loteRodando} onClick={() => setConfirmando({ id: c.id, action: 'APPROVE' })}>
                            Aprovar
                          </button>
                          <button type="button" className="pf-btn pf-btn-mini pf-btn-perigo" disabled={loteRodando} onClick={() => setConfirmando({ id: c.id, action: 'REJECT' })}>
                            Recusar
                          </button>
                        </>
                      ) : (
                        <button type="button" className="pf-btn pf-btn-mini pf-btn-perigo" onClick={() => setConfirmando({ id: c.id, action: 'REJECT' })}>
                          Desfazer aprovação
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ClaimsPage;
