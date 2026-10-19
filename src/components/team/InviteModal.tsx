import React, { useEffect, useMemo, useRef, useState } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { scopeCommunityIdOf } from '../../utils/userScope';
import { maskBrPhone, phoneForApi, phoneInputValue, whatsappNumber } from '../../utils/phone';
import {
  INVITE_ROLE_OPTIONS,
  canGrantHolder,
  copyText,
  createInvite,
  invitableRoles,
  inviteRoleLabel,
  shortDate,
  type InviteRole,
  type InviteShare,
} from './teamApi';
import '../../pages/modules/ModulePages.css';
import './team.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Option {
  id: string;
  name: string;
}

export interface InvitePreset {
  /** Cadastro (Member) que a conta vai assumir ao aceitar */
  memberId?: string;
  name?: string;
  phone?: string | null;
  email?: string | null;
  role?: InviteRole;
  /** Comunidade já definida (ex.: a do membro): o escopo fica travado nela */
  communityId?: string;
  communityName?: string;
  parishId?: string;
}

/** Fecha com Esc (exceto durante o envio). */
function useEscape(onClose: () => void, disabled: boolean) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disabled) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, disabled]);
}

/* =====================================================================
 * Resultado do convite: link + Copiar + WhatsApp (sem depender de SMS/e-mail)
 * ===================================================================== */

interface ShareViewProps {
  share: InviteShare;
  name?: string | null;
  phone?: string | null;
  roleLabel?: string;
}

export const InviteShareView: React.FC<ShareViewProps> = ({ share, name, phone, roleLabel }) => {
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  const firstName = (name ?? '').trim().split(/\s+/)[0] || '';
  const expires = shortDate(share.expiresAt ?? share.invite?.expiresAt);
  const message =
    share.whatsappText?.trim() ||
    `${firstName ? `Olá, ${firstName}! ` : 'Olá! '}Você foi convidado(a) para o Parish${roleLabel ? ` como ${roleLabel}` : ''}. ` +
      `Crie seu acesso por este link: ${share.url}`;
  const waNumber = whatsappNumber(phone);
  const whatsappUrl = `https://wa.me/${waNumber ?? ''}?text=${encodeURIComponent(message)}`;

  const copy = async (what: 'link' | 'text') => {
    const ok = await copyText(what === 'link' ? share.url : message, what === 'link' ? 'invite-share-url' : undefined);
    setCopied(ok ? what : null);
    if (ok) setTimeout(() => setCopied(null), 2500);
  };

  return (
    <div>
      <p className="team-modal__lead" style={{ marginBottom: '0.75rem' }}>
        {name ? (
          <>
            Convite pronto para <strong>{name}</strong>
            {roleLabel ? ` (${roleLabel})` : ''}.
          </>
        ) : (
          'Convite pronto.'
        )}{' '}
        Envie o link abaixo: ele {expires ? `vale até ${expires} e ` : ''}só pode ser usado uma vez.
      </p>
      <label htmlFor="invite-share-url" className="team-hint" style={{ display: 'block', marginBottom: 4 }}>
        Link do convite
      </label>
      <div className="team-share__row">
        <input id="invite-share-url" readOnly value={share.url} onFocus={(e) => e.target.select()} />
        <button type="button" className="team-btn is-primary" onClick={() => void copy('link')}>
          {copied === 'link' ? 'Copiado!' : 'Copiar link'}
        </button>
      </div>
      <div className="team-share__actions">
        <a className="team-btn is-whatsapp" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          Enviar por WhatsApp{waNumber && phone ? ` para ${maskBrPhone(phone)}` : ''}
        </a>
        <button type="button" className="team-btn" onClick={() => void copy('text')}>
          {copied === 'text' ? 'Mensagem copiada!' : 'Copiar mensagem'}
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'Copiado para a área de transferência' : ''}
      </span>
      {!waNumber && (
        <p className="team-hint" style={{ margin: '0 0 0.6rem' }}>
          Sem celular no convite: o WhatsApp abre para você escolher o contato.
        </p>
      )}
      <div className="team-info">
        A pessoa abre o link, confere o convite, cria a própria senha e aceita os termos. Ninguém precisa digitar senha
        por ela.
      </div>
    </div>
  );
};

/** Modal só com o resultado (reenvio de convite). */
export const InviteShareModal: React.FC<ShareViewProps & { onClose: () => void; title?: string }> = ({
  onClose,
  title = 'Convite reenviado',
  ...rest
}) => {
  useEscape(onClose, false);
  return (
    <div className="module-modal-overlay">
      <div className="module-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="invite-share-title">
        <h2 id="invite-share-title" className="team-modal__title">
          {title}
        </h2>
        <InviteShareView {...rest} />
        <div className="team-actions">
          <button type="button" className="team-btn is-primary" onClick={onClose} autoFocus>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

/* =====================================================================
 * Formulário de convite
 * ===================================================================== */

interface InviteModalProps {
  onClose: () => void;
  /** Chamado depois de criar (para recarregar listas) */
  onCreated?: (share: InviteShare) => void;
  preset?: InvitePreset;
  title?: string;
}

const InviteModal: React.FC<InviteModalProps> = ({ onClose, onCreated, preset, title }) => {
  const { user } = useAuth();
  const actor = user as (typeof user & { parishHolder?: boolean }) | null;
  const roles = useMemo(() => invitableRoles(actor, { forMember: Boolean(preset?.memberId) }), [actor, preset?.memberId]);
  const wideScope = actor?.role === 'SYSTEM_ADMIN' || actor?.role === 'DIOCESAN_ADMIN';
  const actorCommunityId = scopeCommunityIdOf(actor);
  const lockedCommunity = Boolean(preset?.communityId);

  const initialRole: InviteRole =
    preset?.role && roles.includes(preset.role) ? preset.role : roles.includes('FAITHFUL') ? 'FAITHFUL' : roles[0] ?? 'FAITHFUL';

  const [role, setRole] = useState<InviteRole>(initialRole);
  const [name, setName] = useState(preset?.name ?? '');
  const [phone, setPhone] = useState(phoneInputValue(preset?.phone));
  const [email, setEmail] = useState(preset?.email ?? '');
  const [holder, setHolder] = useState(false);

  const [dioceses, setDioceses] = useState<Option[]>([]);
  const [parishes, setParishes] = useState<Option[]>([]);
  const [communities, setCommunities] = useState<Option[]>([]);
  const [dioceseId, setDioceseId] = useState(actor?.role === 'DIOCESAN_ADMIN' ? actor.dioceseId ?? '' : '');
  const [parishId, setParishId] = useState(preset?.parishId ?? (wideScope ? '' : actor?.parishId ?? ''));
  const [communityId, setCommunityId] = useState(
    preset?.communityId ?? (actor?.role === 'COMMUNITY_COORDINATOR' ? actorCommunityId ?? '' : ''),
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [share, setShare] = useState<InviteShare | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEscape(onClose, submitting);

  const needsParishOnly = role === 'PARISH_ADMIN';
  const needsCommunity = !needsParishOnly;
  const showCommunityPicker = needsCommunity && !lockedCommunity && actor?.role !== 'COMMUNITY_COORDINATOR';
  const showParishPicker = wideScope && !lockedCommunity;

  // Escopo amplo: dioceses (só o administrador do sistema escolhe)
  useEffect(() => {
    if (!wideScope || lockedCommunity || actor?.role !== 'SYSTEM_ADMIN') return;
    let cancelled = false;
    api
      .get('/dioceses')
      .then((res) => {
        if (!cancelled) setDioceses((Array.isArray(res.data) ? res.data : []).map((d: any) => ({ id: d.id, name: d.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wideScope, lockedCommunity, actor?.role]);

  // ... paróquias da diocese
  useEffect(() => {
    if (!wideScope || lockedCommunity || !dioceseId) {
      setParishes([]);
      return;
    }
    let cancelled = false;
    api
      .get('/parishes', { params: { dioceseId } })
      .then((res) => {
        if (!cancelled) setParishes((Array.isArray(res.data) ? res.data : []).map((p: any) => ({ id: p.id, name: p.name })));
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, 'Não foi possível carregar as paróquias'));
      });
    return () => {
      cancelled = true;
    };
  }, [wideScope, lockedCommunity, dioceseId]);

  // ... comunidades da paróquia (escopo amplo e administração paroquial)
  useEffect(() => {
    if (lockedCommunity || actor?.role === 'COMMUNITY_COORDINATOR' || !parishId) {
      setCommunities([]);
      return;
    }
    let cancelled = false;
    api
      .get('/communities', { params: { parishId } })
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.items) ? res.data.items : [];
        setCommunities(
          rows
            .filter((c: any) => !c.parishId || c.parishId === parishId)
            .map((c: any) => ({ id: c.id, name: c.name }))
            .sort((a: Option, b: Option) => a.name.localeCompare(b.name)),
        );
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, 'Não foi possível carregar as comunidades'));
      });
    return () => {
      cancelled = true;
    };
  }, [lockedCommunity, actor?.role, parishId]);

  // Uma comunidade só: já vem escolhida
  useEffect(() => {
    if (!lockedCommunity && communities.length === 1 && !communityId) setCommunityId(communities[0].id);
  }, [communities, communityId, lockedCommunity]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (!name.trim()) {
      setError('Informe o nome de quem você está convidando.');
      nameRef.current?.focus();
      return;
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setError('Confira o e-mail digitado.');
      return;
    }
    const phoneValue = phoneForApi(phone);
    if (phone.trim() && !whatsappNumber(phone)) {
      setError('Confira o celular: use o DDD e o número (ex.: (42) 99999-8888).');
      return;
    }
    const effectiveParishId = parishId || actor?.parishId || preset?.parishId || '';
    if (needsParishOnly && !effectiveParishId) {
      setError('Escolha a paróquia do novo administrador.');
      return;
    }
    if (needsCommunity && !communityId) {
      setError('Escolha a comunidade da pessoa convidada.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createInvite({
        role,
        parishId: effectiveParishId || undefined,
        communityId: needsCommunity ? communityId : undefined,
        memberId: preset?.memberId,
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phoneValue || undefined,
        holder: role === 'PARISH_ADMIN' && holder ? true : undefined,
      });
      if (!result?.url) {
        setError('O servidor não devolveu o link do convite. Tente de novo.');
        return;
      }
      setShare(result);
      onCreated?.(result);
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível criar o convite'));
    } finally {
      setSubmitting(false);
    }
  };

  if (roles.length === 0) {
    return (
      <div className="module-modal-overlay">
        <div className="module-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
          <h2 id="invite-title" className="team-modal__title">
            Convidar
          </h2>
          <p className="team-modal__lead">O seu papel não permite convidar pessoas. Peça à administração da paróquia.</p>
          <div className="team-actions">
            <button type="button" className="team-btn is-primary" onClick={onClose} autoFocus>
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="module-modal-overlay">
      <div className="module-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <h2 id="invite-title" className="team-modal__title">
          {share ? 'Convite criado' : title ?? 'Convidar para o Parish'}
        </h2>

        {share ? (
          <>
            <InviteShareView share={share} name={name} phone={phone} roleLabel={inviteRoleLabel(role)} />
            <div className="team-actions">
              <button type="button" className="team-btn is-primary" onClick={onClose} autoFocus>
                Concluir
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <p className="team-modal__lead">
              A pessoa recebe um link (válido por 7 dias, uso único), cria a própria senha e já entra com o acesso certo.
            </p>
            {error && (
              <div className="team-error" role="alert">
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="invite-name">Nome *</label>
              <input
                id="invite-name"
                ref={nameRef}
                type="text"
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="invite-phone">Celular (WhatsApp)</label>
                <input
                  id="invite-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="(00) 90000-0000"
                  value={phone}
                  onChange={(e) => setPhone(maskBrPhone(e.target.value))}
                  aria-describedby="invite-phone-hint"
                />
                <span id="invite-phone-hint" className="team-hint">
                  Preenche o WhatsApp do convite.
                </span>
              </div>
              <div className="form-group">
                <label htmlFor="invite-email">E-mail (opcional)</label>
                <input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <fieldset className="team-roles">
              <legend>Papel *</legend>
              {INVITE_ROLE_OPTIONS.filter((option) => roles.includes(option.value)).map((option) => (
                <label key={option.value} className={`team-role${role === option.value ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="invite-role"
                    value={option.value}
                    checked={role === option.value}
                    onChange={() => setRole(option.value)}
                  />
                  <span>
                    <span className="team-role__label">{option.label}</span>
                    <br />
                    <span className="team-role__desc">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <p className="team-hint" style={{ margin: '0 0 0.75rem' }}>
              Coordenação de pastoral: convide a pessoa como <strong>voluntário(a)</strong> e, depois que ela aceitar,
              nomeie a coordenação em <strong>Pastorais</strong>.
            </p>

            {lockedCommunity && needsCommunity && (
              <p className="team-hint" style={{ margin: '0 0 0.75rem' }}>
                Comunidade: <strong>{preset?.communityName ?? 'a do cadastro'}</strong>
              </p>
            )}

            {showParishPicker && actor?.role === 'SYSTEM_ADMIN' && (
              <div className="form-group">
                <label htmlFor="invite-diocese">Diocese *</label>
                <select
                  id="invite-diocese"
                  value={dioceseId}
                  onChange={(e) => {
                    setDioceseId(e.target.value);
                    setParishId('');
                    setCommunityId('');
                  }}
                >
                  <option value="">Selecione</option>
                  {dioceses.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showParishPicker && (
              <div className="form-group">
                <label htmlFor="invite-parish">Paróquia *</label>
                <select
                  id="invite-parish"
                  value={parishId}
                  disabled={!dioceseId}
                  onChange={(e) => {
                    setParishId(e.target.value);
                    setCommunityId('');
                  }}
                >
                  <option value="">{dioceseId ? 'Selecione' : 'Escolha a diocese primeiro'}</option>
                  {parishes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showCommunityPicker && (
              <div className="form-group">
                <label htmlFor="invite-community">Comunidade *</label>
                <select
                  id="invite-community"
                  value={communityId}
                  disabled={!parishId}
                  onChange={(e) => setCommunityId(e.target.value)}
                >
                  <option value="">{parishId ? 'Selecione' : 'Escolha a paróquia primeiro'}</option>
                  {communities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {role === 'PARISH_ADMIN' && canGrantHolder(actor) && (
              <label className="form-check">
                <input type="checkbox" checked={holder} onChange={(e) => setHolder(e.target.checked)} />
                <span>
                  Será o <strong>titular</strong> da paróquia (responsável pela conta: exporta dados, contrata o plano e
                  gerencia os outros administradores).
                </span>
              </label>
            )}

            <div className="team-actions">
              <button type="button" className="team-btn" onClick={onClose} disabled={submitting}>
                Cancelar
              </button>
              <button type="submit" className="team-btn is-primary" disabled={submitting} aria-busy={submitting}>
                {submitting ? 'Criando…' : 'Criar convite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default InviteModal;
