import React from 'react';
import { useNavigate } from 'react-router-dom';
import './ErrorBoundary.css';

export type AccessDeniedReason = 'role' | 'module';

const TEXTS: Record<AccessDeniedReason, string> = {
  role: 'Esta página é de quem tem outra função na comunidade. Se você precisa dela, fale com a coordenação da sua comunidade ou com a secretaria paroquial.',
  module: 'Este recurso está desligado para a sua função neste painel. Se você precisa dele, fale com a secretaria paroquial.',
};

/**
 * "Sem acesso a esta página" (eng-acessos-25 / ux-acesso-30): explica em uma
 * frase e sempre oferece a saída para o Início.
 */
const AccessDenied: React.FC<{ reason?: AccessDeniedReason }> = ({ reason = 'role' }) => {
  const navigate = useNavigate();
  return (
    <div className="access-denied" role="alert">
      <div className="access-denied__card">
        <h2 className="access-denied__title">Sem acesso a esta página</h2>
        <p className="access-denied__text">{TEXTS[reason]}</p>
        <p className="access-denied__text">Mudou de função há pouco? A página volta a abrir assim que o seu acesso for atualizado.</p>
        <div className="access-denied__actions">
          <button type="button" className="access-denied__btn access-denied__btn--primary" onClick={() => navigate('/admin', { replace: true })}>
            Voltar ao início
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccessDenied;
