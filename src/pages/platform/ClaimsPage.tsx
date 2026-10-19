import React, { useCallback, useEffect, useState } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api from '../../services/api';
import { notify } from '../../services/notification.service';
import { formatPhoneDisplay, whatsappNumber } from '../../utils/phone';
import { dataHoraBR, haQuanto, mensagemDeErro } from './platformShared';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Reivindicações de paróquia (contrato C1): "esta paróquia é minha". Sempre
 * aprovadas aqui pelo SYSTEM_ADMIN — o código no contato oficial da paróquia
 * é só evidência (VERIFIED). Na aprovação sem conta, o backend devolve o link
 * de convite para mandar por WhatsApp ou copiar.
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

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
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
        setLista(asList(data).sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
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
        const invite: ApproveResult = {
          inviteUrl: typeof data?.inviteUrl === 'string' ? data.inviteUrl : undefined,
          whatsappText: typeof data?.whatsappText === 'string' ? data.whatsappText : undefined,
          inviteEmailSent: data?.inviteEmailSent === true,
        };
        if (invite.inviteUrl) {
          setConvites((prev) => ({ ...prev, [claim.id]: invite }));
          notify.success('Reivindicação aprovada. Envie o link de acesso para quem pediu.');
        } else {
          notify.success('Reivindicação aprovada. A conta de quem pediu já tem a gestão da paróquia.');
        }
      } else {
        notify.success('Reivindicação recusada.');
      }
      // Atualiza a linha sem perder o link do convite da tela
      setLista((prev) =>
        prev.map((c) =>
          c.id === claim.id ? { ...c, status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewNote: note || c.reviewNote } : c,
        ),
      );
    } catch (e) {
      notify.error(mensagemDeErro(e, 'Não foi possível registrar a decisão.'));
    } finally {
      setEnviando(null);
    }
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
          <button type="button" className="pf-btn" onClick={() => void carregar()} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>
      <p className="pf-nota">
        Pedidos de gestão de paróquia. A aprovação é sempre daqui; o código no contato oficial é só evidência. Aprovar
        dá 30 dias de teste às comunidades sem plano.
      </p>

      <div className="pf-filtros">
        <div className="pf-chips" role="group" aria-label="Situação">
          {FILTROS.map((f) => (
            <button key={f.key || 'todas'} type="button" className={`pf-chip${filtro === f.key ? ' on' : ''}`} aria-pressed={filtro === f.key} onClick={() => setFiltro(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

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

      <ul className="pf-cards">
        {lista.map((c) => {
          const paroquia = c.parish?.name ?? c.parishName ?? c.parishId;
          const local = [c.parish?.city && c.parish?.state ? `${c.parish.city}/${c.parish.state}` : c.parish?.city, dioceseNome(c.parish?.diocese)]
            .filter(Boolean)
            .join(' · ');
          const gerida = c.managed ?? !!c.parish?.managedAt;
          const aberta = c.status === 'PENDING' || c.status === 'VERIFIED';
          const conv = convites[c.id];
          const wa = whatsappNumber(c.phone);
          const evid = urlSegura(c.evidenceUrl);
          const conf = confirmando?.id === c.id ? confirmando.action : null;
          return (
            <li key={c.id} className="pf-caixa pf-claim">
              <div className="pf-claim-topo">
                <div>
                  <strong className="pf-nome">{paroquia}</strong>
                  {local && <span className="pf-sub">{local}</span>}
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

              {aberta && (
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
                          ? `Aprovar dá a gestão de ${paroquia} a ${c.name} e 30 dias de teste. Confirma?`
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
                      <button type="button" className="pf-btn pf-btn-mini pf-btn-ok" onClick={() => setConfirmando({ id: c.id, action: 'APPROVE' })}>
                        Aprovar
                      </button>
                      <button type="button" className="pf-btn pf-btn-mini pf-btn-perigo" onClick={() => setConfirmando({ id: c.id, action: 'REJECT' })}>
                        Recusar
                      </button>
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
