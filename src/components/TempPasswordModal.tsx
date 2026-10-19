import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../services/api';
import { maskBrPhone, whatsappNumber } from '../utils/phone';

interface Props {
  /** Conta (User) que recebe a senha provisória */
  userId: string;
  userName: string;
  /** Celular da pessoa, se houver — preenche o link do WhatsApp */
  phone?: string | null;
  onClose: () => void;
}

type Step = 'confirm' | 'loading' | 'done';

/**
 * Senha provisória gerada pela secretaria (ux-acesso-04).
 *
 * POST /users/:id/reset-password gera a senha, liga a troca obrigatória no
 * próximo acesso e derruba as sessões abertas. A confirmação fica no próprio
 * modal; a senha aparece uma vez só, com Copiar e "Enviar por WhatsApp".
 */
const TempPasswordModal: React.FC<Props> = ({ userId, userName, phone, onClose }) => {
  const [step, setStep] = useState<Step>('confirm');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && step !== 'loading') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  const firstName = userName.trim().split(/\s+/)[0] || userName;

  const generate = async () => {
    setStep('loading');
    setError('');
    try {
      const { data } = await api.post<{ tempPassword?: string }>(`/users/${userId}/reset-password`);
      if (!data?.tempPassword) {
        setError('O servidor não devolveu a senha provisória. Tente de novo.');
        setStep('confirm');
        return;
      }
      setPassword(data.tempPassword);
      setStep('done');
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível gerar a senha provisória'));
      setStep('confirm');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
    } catch {
      // Navegador sem permissão de área de transferência: seleciona para Ctrl+C
      const input = document.getElementById('temp-password-value') as HTMLInputElement | null;
      input?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const message =
    `Olá, ${firstName}! Sua senha provisória do Parish é: ${password}\n` +
    'Entre no app (ou no painel) com seu e-mail ou celular e essa senha. ' +
    'No primeiro acesso você vai criar uma senha nova.';
  const waNumber = whatsappNumber(phone);
  const whatsappUrl = `https://wa.me/${waNumber ?? ''}?text=${encodeURIComponent(message)}`;

  return (
    <div className="modal-overlay" onClick={() => step !== 'loading' && onClose()}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label={`Senha provisória de ${userName}`}
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Senha provisória</h2>

        {step !== 'done' ? (
          <>
            <p style={{ marginTop: 0 }}>
              Gerar uma senha provisória para <strong>{userName}</strong>?
            </p>
            <ul style={{ paddingLeft: '1.2rem', color: '#555', fontSize: '0.9rem', lineHeight: 1.5 }}>
              <li>A senha atual deixa de funcionar e a pessoa sai de todos os aparelhos.</li>
              <li>No primeiro acesso com a senha provisória, ela cria uma senha nova.</li>
              <li>A senha aparece só agora — copie ou envie pelo WhatsApp em seguida.</li>
            </ul>
            {error && (
              <div className="error-message" role="alert" style={{ color: '#b42318', marginBottom: '0.75rem' }}>
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={onClose} disabled={step === 'loading'}>
                Cancelar
              </button>
              <button type="button" className="btn-submit" onClick={generate} disabled={step === 'loading'}>
                {step === 'loading' ? 'Gerando…' : 'Gerar senha provisória'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Senha provisória de <strong>{userName}</strong>:
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: '0.75rem' }}>
              <input
                id="temp-password-value"
                readOnly
                value={password}
                aria-label="Senha provisória"
                onFocus={(e) => e.target.select()}
                style={{
                  flex: 1,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '1.4rem',
                  letterSpacing: '0.06em',
                  padding: '10px 12px',
                  textAlign: 'center',
                }}
              />
              <button type="button" className="btn-submit" onClick={copy} style={{ whiteSpace: 'nowrap' }}>
                {copied ? 'Copiada!' : 'Copiar'}
              </button>
            </div>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-submit"
              style={{
                display: 'inline-block',
                background: '#1f9d55',
                color: '#fff',
                textDecoration: 'none',
                padding: '8px 14px',
                borderRadius: 8,
                marginBottom: '0.75rem',
              }}
            >
              Enviar por WhatsApp{waNumber && phone ? ` para ${maskBrPhone(phone)}` : ''}
            </a>
            {!waNumber && (
              <p style={{ fontSize: '0.8rem', color: '#777', margin: '0 0 0.75rem' }}>
                Esta conta não tem celular cadastrado: o WhatsApp abre para você escolher o contato.
              </p>
            )}
            <div
              className="privacy-note"
              style={{ fontSize: '0.85rem', background: '#fff8e6', border: '1px solid #f2d59b', borderRadius: 8, padding: '8px 10px', color: '#6b4e00' }}
            >
              A pessoa troca a senha no primeiro acesso. Esta senha não será mostrada de novo — se perder, gere outra.
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TempPasswordModal;
