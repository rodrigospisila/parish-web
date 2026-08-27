import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import './DonatePage.css';

interface Props {
  kicker?: string;
  title: string;
  subtitle?: string | null;
  logoUrl?: string | null;
  children: React.ReactNode;
}

/** Moldura das páginas públicas de doação: faixa com identidade da paróquia + conteúdo + rodapé Parish. */
const PublicShell: React.FC<Props> = ({ kicker, title, subtitle, logoUrl, children }) => {
  const [logoBroken, setLogoBroken] = useState(false);
  const initial = title.trim().charAt(0).toUpperCase() || 'P';
  const showLogo = Boolean(logoUrl) && !logoBroken;

  return (
    <div className="donate-page">
      <header className="donate-hero">
        <div className="donate-hero-inner">
          {showLogo ? (
            <img className="donate-logo" src={logoUrl ?? undefined} alt="" onError={() => setLogoBroken(true)} />
          ) : (
            <div className="donate-logo donate-logo-fallback" aria-hidden="true">
              {initial}
            </div>
          )}
          <div className="donate-hero-text">
            {kicker && <div className="donate-hero-kicker">{kicker}</div>}
            <h1 className="donate-hero-title">{title}</h1>
            {subtitle && <div className="donate-hero-subtitle">{subtitle}</div>}
          </div>
        </div>
      </header>
      <main className="donate-main">{children}</main>
      <footer className="donate-footer">
        <img src="/brand/parish-logo-horizontal-cor.svg" alt="Parish" />
        <div>
          Ofertas online com segurança · <Link to="/privacidade">Privacidade</Link>
        </div>
      </footer>
    </div>
  );
};

export default PublicShell;
