import React, { useEffect, useRef, useState } from 'react';
import SearchSelect, { type SearchSelectOption } from '../SearchSelect';
import api, { getErrorMessage } from '../../services/api';
import { isPagedResponse } from '../../utils/useDebouncedValue';
import { maskBrPhone, phoneForApi, whatsappNumber } from '../../utils/phone';
import '../../pages/modules/ModulePages.css';
import './team.css';

/**
 * Cadastro rápido no balcão (ux-web-05): nome + celular + comunidade, com
 * checagem de duplicado antes de gravar. A ficha completa continua em
 * "Novo membro".
 */

interface Duplicate {
  id: string;
  fullName: string;
  communityName?: string;
  reason: string;
}

export interface QuickMemberCreated {
  id: string;
  fullName: string;
  phone?: string | null;
  communityId: string;
  communityName?: string;
}

interface Props {
  communityOptions: SearchSelectOption[];
  defaultCommunityId?: string;
  /** Quem pode convidar vê o atalho "Convidar para o app" depois de cadastrar */
  canInvite: boolean;
  onClose: () => void;
  onCreated: (member: QuickMemberCreated) => void;
  onOpenMember: (memberId: string) => void;
  onInvite: (member: QuickMemberCreated) => void;
}

const QuickMemberModal: React.FC<Props> = ({
  communityOptions,
  defaultCommunityId,
  canInvite,
  onClose,
  onCreated,
  onOpenMember,
  onInvite,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [communityId, setCommunityId] = useState(defaultCommunityId ?? (communityOptions.length === 1 ? communityOptions[0].value : ''));
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<QuickMemberCreated | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const dirty = Boolean(fullName.trim() || phone.trim());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Esc só fecha sem dados digitados (não apaga o que a pessoa escreveu)
      if (event.key === 'Escape' && !busy && (!dirty || created)) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy, dirty, created]);

  /** Mesmo nome (check-duplicates) e mesmo celular (busca por dígitos no servidor novo). */
  const findDuplicates = async (): Promise<Duplicate[]> => {
    const found = new Map<string, Duplicate>();
    const phoneValue = phoneForApi(phone);
    const [byName, byPhone] = await Promise.allSettled([
      api.get('/members/check-duplicates', { params: { fullName: fullName.trim(), phone: phoneValue || undefined } }),
      whatsappNumber(phone)
        ? api.get('/members', { params: { page: 1, pageSize: 5, search: phoneValue.replace(/\D/g, '').slice(2) } })
        : Promise.resolve(null),
    ]);
    if (byName.status === 'fulfilled' && Array.isArray(byName.value.data)) {
      byName.value.data.forEach((item: any) =>
        found.set(item.id, {
          id: item.id,
          fullName: item.fullName,
          communityName: item.community?.name,
          reason: Array.isArray(item.reasons) ? item.reasons.join(', ') : 'mesmo nome',
        }),
      );
    }
    // Só a resposta paginada filtra no servidor (a antiga devolveria a lista inteira)
    if (byPhone.status === 'fulfilled' && byPhone.value && isPagedResponse<any>(byPhone.value.data)) {
      const digits = phoneValue.replace(/\D/g, '');
      byPhone.value.data.items.forEach((item: any) => {
        if (found.has(item.id)) return;
        if (String(item.phone ?? '').replace(/\D/g, '').endsWith(digits.slice(-8))) {
          found.set(item.id, { id: item.id, fullName: item.fullName, communityName: item.community?.name, reason: 'mesmo celular' });
        }
      });
    }
    return [...found.values()];
  };

  const save = async (force: boolean) => {
    setError('');
    if (fullName.trim().length < 3) {
      setError('Informe o nome completo.');
      nameRef.current?.focus();
      return;
    }
    if (phone.trim() && !whatsappNumber(phone)) {
      setError('Confira o celular: DDD + número.');
      return;
    }
    if (!communityId) {
      setError('Escolha a comunidade.');
      return;
    }
    setBusy(true);
    try {
      if (!force) {
        const list = await findDuplicates();
        if (list.length > 0) {
          setDuplicates(list);
          return;
        }
      }
      const { data } = await api.post('/members', {
        fullName: fullName.trim(),
        phone: phoneForApi(phone) || undefined,
        communityId,
        status: 'ACTIVE',
      });
      const member: QuickMemberCreated = {
        id: data?.id,
        fullName: data?.fullName ?? fullName.trim(),
        phone: data?.phone ?? phoneForApi(phone),
        communityId,
        communityName: communityOptions.find((option) => option.value === communityId)?.label,
      };
      setCreated(member);
      setDuplicates(null);
      onCreated(member);
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível cadastrar'));
    } finally {
      setBusy(false);
    }
  };

  const another = () => {
    setCreated(null);
    setFullName('');
    setPhone('');
    setDuplicates(null);
    setError('');
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  return (
    <div className="module-modal-overlay">
      <div className="module-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="quick-member-title">
        <h2 id="quick-member-title" className="team-modal__title">
          Cadastro rápido
        </h2>

        {created ? (
          <>
            <div className="team-info" role="status">
              <strong>{created.fullName}</strong> cadastrado(a){created.communityName ? ` em ${created.communityName}` : ''}.
            </div>
            <div className="team-actions" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="team-btn" onClick={onClose}>
                Fechar
              </button>
              {canInvite && created.id && (
                <button type="button" className="team-btn" onClick={() => onInvite(created)}>
                  Convidar para o app
                </button>
              )}
              <button type="button" className="team-btn is-primary" onClick={another} autoFocus>
                Cadastrar outra pessoa
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(false);
            }}
            noValidate
          >
            <p className="team-modal__lead">Nome, celular e comunidade. O restante da ficha pode ser completado depois.</p>
            {error && (
              <div className="team-error" role="alert">
                {error}
              </div>
            )}
            <div className="form-group">
              <label htmlFor="quick-name">Nome completo *</label>
              <input
                id="quick-name"
                ref={nameRef}
                autoFocus
                maxLength={150}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setDuplicates(null);
                }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="quick-phone">Celular</label>
              <input
                id="quick-phone"
                type="tel"
                inputMode="tel"
                placeholder="(00) 90000-0000"
                value={phone}
                onChange={(e) => {
                  setPhone(maskBrPhone(e.target.value));
                  setDuplicates(null);
                }}
              />
            </div>
            <div className="form-group">
              <span id="quick-community-label" style={{ fontSize: '0.9rem', color: '#555', fontWeight: 600 }}>
                Comunidade *
              </span>
              <div aria-labelledby="quick-community-label" role="group">
                <SearchSelect
                  options={communityOptions}
                  value={communityId}
                  onChange={setCommunityId}
                  placeholder="Selecione a comunidade"
                  searchPlaceholder="Buscar comunidade..."
                />
              </div>
            </div>

            {duplicates && duplicates.length > 0 && (
              <div className="team-warning" role="alert">
                <strong>Talvez esta pessoa já esteja cadastrada:</strong>
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                  {duplicates.map((dup) => (
                    <li key={dup.id} style={{ marginBottom: 4 }}>
                      {dup.fullName}
                      {dup.communityName ? ` (${dup.communityName})` : ''} — {dup.reason}.{' '}
                      <button type="button" className="team-btn is-small" onClick={() => onOpenMember(dup.id)}>
                        Abrir ficha
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="team-actions">
              <button type="button" className="team-btn" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              {duplicates && duplicates.length > 0 ? (
                <button type="button" className="team-btn is-primary" onClick={() => void save(true)} disabled={busy}>
                  {busy ? 'Salvando…' : 'Cadastrar mesmo assim'}
                </button>
              ) : (
                <button type="submit" className="team-btn is-primary" disabled={busy} aria-busy={busy}>
                  {busy ? 'Conferindo…' : 'Cadastrar'}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default QuickMemberModal;
