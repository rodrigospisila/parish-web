import React, { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../../services/api';
import { confirm, notify } from '../../services/notification.service';
import { formatPhoneDisplay } from '../../utils/phone';
import { InviteShareModal } from './InviteModal';
import {
  INVITE_STATUS_LABEL,
  httpStatus,
  inviteRoleLabel,
  inviteStatusOf,
  listInvites,
  resendInvite,
  revokeInvite,
  shortDate,
  type InviteRecord,
  type InviteShare,
  type InviteStatus,
} from './teamApi';
import './team.css';

const STATUS_TONE: Record<InviteStatus, string> = {
  PENDING: 'tone-pending',
  ACCEPTED: 'tone-ok',
  EXPIRED: 'tone-off',
  REVOKED: 'tone-off',
};

interface Props {
  /** Filtro de escopo (o backend aplica o escopo de quem pede de qualquer jeito) */
  parishId?: string;
  communityId?: string;
  /** Muda quando um convite novo é criado: recarrega a lista */
  refreshKey?: number;
  /** Nome das comunidades conhecidas pela tela (quando o convite não traz o nome) */
  communityNames?: Record<string, string>;
}

/** Lista "Convites" (C2): situação, reenviar e revogar. */
const InvitesPanel: React.FC<Props> = ({ parishId, communityId, refreshKey = 0, communityNames }) => {
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [status, setStatus] = useState<'' | InviteStatus>('PENDING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [share, setShare] = useState<{ share: InviteShare; invite: InviteRecord } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await listInvites({ parishId, communityId, status });
      setInvites(rows);
      setUnavailable(false);
    } catch (err) {
      // Servidor antigo (sem convites): a aba explica em vez de mostrar erro cru
      if (httpStatus(err) === 404) setUnavailable(true);
      else setError(getErrorMessage(err, 'Não foi possível carregar os convites'));
    } finally {
      setLoading(false);
    }
  }, [parishId, communityId, status]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const resend = async (invite: InviteRecord) => {
    setBusyId(invite.id);
    try {
      const result = await resendInvite(invite.id);
      if (!result?.url) {
        notify.error('O servidor não devolveu o link novo. Tente de novo.');
        return;
      }
      setShare({ share: result, invite });
      void load();
    } catch (err) {
      notify.error(getErrorMessage(err, 'Não foi possível reenviar o convite'));
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (invite: InviteRecord) => {
    const ok = await confirm.action(
      'Revogar convite',
      `O link enviado para ${invite.name || 'esta pessoa'} deixa de funcionar. Você pode convidar de novo depois.`,
      'Revogar',
    );
    if (!ok) return;
    setBusyId(invite.id);
    try {
      await revokeInvite(invite.id);
      notify.success('Convite revogado.');
      void load();
    } catch (err) {
      notify.error(getErrorMessage(err, 'Não foi possível revogar o convite'));
    } finally {
      setBusyId(null);
    }
  };

  const scopeName = (invite: InviteRecord) =>
    invite.community?.name ||
    (invite.communityId && communityNames?.[invite.communityId]) ||
    invite.parish?.name ||
    (invite.role === 'PARISH_ADMIN' ? 'Paróquia' : '—');

  return (
    <section className="team-invites" aria-labelledby="team-invites-title">
      <div className="team-invites__filters">
        <h2 id="team-invites-title" style={{ margin: 0, fontSize: '1.05rem', color: '#17324d', flex: 1 }}>
          Convites
        </h2>
        <label htmlFor="team-invites-status" className="team-hint">
          Situação
        </label>
        <select id="team-invites-status" value={status} onChange={(e) => setStatus(e.target.value as '' | InviteStatus)}>
          <option value="">Todas</option>
          {(Object.keys(INVITE_STATUS_LABEL) as InviteStatus[]).map((key) => (
            <option key={key} value={key}>
              {INVITE_STATUS_LABEL[key]}
            </option>
          ))}
        </select>
        <button type="button" className="team-btn is-small" onClick={() => void load()} disabled={loading}>
          Atualizar
        </button>
      </div>

      {unavailable ? (
        <p className="team-invites__empty">Os convites por link ainda não estão disponíveis neste servidor.</p>
      ) : error ? (
        <div className="team-error" role="alert">
          {error}{' '}
          <button type="button" className="team-btn is-small" onClick={() => void load()}>
            Tentar de novo
          </button>
        </div>
      ) : loading ? (
        <p className="team-invites__empty" role="status">
          Carregando convites…
        </p>
      ) : invites.length === 0 ? (
        <p className="team-invites__empty">
          {status === 'PENDING' ? 'Nenhum convite aguardando resposta.' : 'Nenhum convite nesta situação.'}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Pessoa</th>
              <th scope="col">Papel</th>
              <th scope="col">Onde</th>
              <th scope="col">Situação</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => {
              const current = inviteStatusOf(invite);
              const canAct = current === 'PENDING' || current === 'EXPIRED';
              const sentAt = invite.lastSentAt || invite.createdAt;
              return (
                <tr key={invite.id}>
                  <td>
                    <strong>{invite.name || 'Sem nome'}</strong>
                    <div className="team-hint">
                      {[formatPhoneDisplay(invite.phone), invite.email].filter(Boolean).join(' · ') || 'Sem contato'}
                    </div>
                  </td>
                  <td>{inviteRoleLabel(invite.role)}</td>
                  <td>{scopeName(invite)}</td>
                  <td>
                    <span className={`team-pill ${STATUS_TONE[current]}`}>{INVITE_STATUS_LABEL[current]}</span>
                    <div className="team-hint">
                      {current === 'ACCEPTED' && invite.acceptedAt
                        ? `em ${shortDate(invite.acceptedAt)}`
                        : current === 'PENDING'
                          ? `enviado ${shortDate(sentAt)} · vale até ${shortDate(invite.expiresAt)}`
                          : current === 'EXPIRED'
                            ? `venceu em ${shortDate(invite.expiresAt)}`
                            : invite.revokedAt
                              ? `em ${shortDate(invite.revokedAt)}`
                              : ''}
                    </div>
                  </td>
                  <td>
                    {canAct ? (
                      <div className="team-invites__actions">
                        <button
                          type="button"
                          className="team-btn is-small"
                          disabled={busyId === invite.id}
                          onClick={() => void resend(invite)}
                          aria-label={`Reenviar convite de ${invite.name || 'pessoa sem nome'}`}
                        >
                          Reenviar
                        </button>
                        {current === 'PENDING' && (
                          <button
                            type="button"
                            className="team-btn is-small is-danger"
                            disabled={busyId === invite.id}
                            onClick={() => void revoke(invite)}
                            aria-label={`Revogar convite de ${invite.name || 'pessoa sem nome'}`}
                          >
                            Revogar
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="team-hint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {share && (
        <InviteShareModal
          share={share.share}
          name={share.invite.name}
          phone={share.invite.phone}
          roleLabel={inviteRoleLabel(share.invite.role)}
          onClose={() => setShare(null)}
          title="Convite reenviado (link novo)"
        />
      )}
    </section>
  );
};

export default InvitesPanel;
