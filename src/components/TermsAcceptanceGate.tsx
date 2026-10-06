import React, { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../services/notification.service';

interface TermsStatus {
  termsAcceptanceRequired?: boolean;
  termsVersion?: string;
}

/**
 * Aviso BLOQUEANTE de aceite dos termos de uso e da política de privacidade
 * (achados M3/M4 da auditoria): contas criadas pela gestão, cadastros antigos
 * ou aceite de versão anterior veem o aviso no primeiro acesso e só seguem
 * depois de aceitar. Pergunta ao GET /users/me (servidor antigo, sem o campo,
 * não bloqueia ninguém).
 */
const TermsAcceptanceGate: React.FC = () => {
  const { token, user, logout } = useAuth();
  // Troca de senha obrigatória vem antes: com ela pendente, a API só libera
  // trocar a senha (o aceite volta a ser conferido logo depois)
  const passwordChangePending = !!user?.forcePasswordChange;
  const [status, setStatus] = useState<TermsStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<TermsStatus>('/users/me');
      setStatus({ termsAcceptanceRequired: data?.termsAcceptanceRequired, termsVersion: data?.termsVersion });
    } catch {
      // Sessão inválida é tratada pelo interceptor; sem resposta, não bloqueia
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (token && !passwordChangePending) void load();
    else setStatus(null);
  }, [token, passwordChangePending, load]);

  if (!token || passwordChangePending || !status?.termsAcceptanceRequired) return null;

  const accept = async () => {
    if (!checked) return;
    setBusy(true);
    try {
      await api.post('/users/me/accept-terms', { version: status.termsVersion });
      setStatus({ ...status, termsAcceptanceRequired: false });
      notify.success('Aceite registrado. Obrigado!');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível registrar o aceite agora'));
      // Termos atualizados enquanto a tela estava aberta: busca a versão nova
      await load();
      setChecked(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5000,
        background: 'rgba(11, 28, 44, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#fff',
          color: '#1f2d3d',
          borderRadius: 14,
          maxWidth: 520,
          width: '100%',
          padding: '1.5rem 1.6rem',
          boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
        }}
      >
        <h2 id="terms-gate-title" style={{ margin: '0 0 0.6rem', fontSize: '1.3rem', color: '#0b1c2c' }}>
          Termos de uso e privacidade
        </h2>
        <p style={{ margin: '0 0 0.8rem', lineHeight: 1.5 }}>
          Para continuar usando o Parish, leia e aceite os termos de uso e a política de privacidade. Eles
          explicam quais dados pessoais tratamos, para quê e como você exerce os seus direitos (LGPD).
        </p>
        <p style={{ margin: '0 0 1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <a href="/termos" target="_blank" rel="noopener noreferrer" style={{ color: '#0b4a8a', fontWeight: 600 }}>
            Termos de uso
          </a>
          <a href="/privacidade" target="_blank" rel="noopener noreferrer" style={{ color: '#0b4a8a', fontWeight: 600 }}>
            Política de privacidade
          </a>
        </p>
        <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginBottom: '1.2rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>Li e aceito os termos de uso e a política de privacidade.</span>
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            style={{
              background: 'transparent',
              border: '1px solid #c5d0dc',
              borderRadius: 8,
              padding: '0.55rem 1rem',
              color: '#3b4a5a',
              cursor: 'pointer',
            }}
          >
            Sair
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={!checked || busy}
            style={{
              background: checked ? '#0b4a8a' : '#9fb3c8',
              border: 'none',
              borderRadius: 8,
              padding: '0.55rem 1.1rem',
              color: '#fff',
              fontWeight: 700,
              cursor: checked && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Registrando...' : 'Aceitar e continuar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TermsAcceptanceGate;
