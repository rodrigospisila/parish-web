import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { trackOnce } from '../../services/analytics';
import PricingSection from './PricingSection';
import DemoRequestForm, { type DemoPrefill } from './DemoRequestForm';
import LandingFindParish from './LandingFindParish';
import { COMPARATIVO, GRATIS_PAROQUIA, PASSOS, PERGUNTAS, PLANO_COMPLETO } from './landingContent';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_LABEL, supportMailto, supportWhatsappUrl } from './LandingSupport';
import './LandingPage.css';

/**
 * Site do Parish em "/" (lançamento do plano grátis enxuto): "toda paróquia
 * tem o Parish de graça" + a vitrine do plano completo. Planos vêm de
 * GET /public/plans, as lojas de GET /public/app-config; "Encontre sua
 * paróquia" usa o mapa público e leva à reivindicação; "Pedir demonstração"
 * cria um Lead (POST /public/leads). Quem já está logado nem chega aqui — a
 * rota "/" manda direto para o painel. Os textos ficam em landingContent.ts.
 */

/** Leva a seção ao topo com rolagem suave e foco (teclado e leitor de tela). */
function irPara(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduz = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' });
  const foco = el.querySelector<HTMLElement>('h2, h3') ?? el;
  foco.setAttribute('tabindex', '-1');
  foco.focus({ preventScroll: true });
}

interface AppConfig {
  iosUrl?: string | null;
  androidUrl?: string | null;
}

const LandingPage: React.FC = () => {
  const [menuAberto, setMenuAberto] = useState(false);
  const [prefill, setPrefill] = useState<DemoPrefill | null>(null);
  const [prefillKey, setPrefillKey] = useState(0);
  const [appLinks, setAppLinks] = useState<AppConfig | null>(null);
  const tituloAnterior = useRef<string>('');

  useEffect(() => {
    trackOnce('landing_view');
    // Título e descrição da página (o index.html é compartilhado com o painel)
    tituloAnterior.current = document.title;
    document.title = 'Parish · Grátis para toda paróquia: horários de missa, confissão e membros';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const criada = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    const descricaoAnterior = meta.content;
    meta.content =
      'Toda paróquia tem o Parish de graça: horários de missa e de confissão no mapa, cadastro de membros e localização das igrejas. O plano completo traz catequese, escalas, dízimo e sacramentos.';
    // Chegou com âncora (/#planos, /#demonstracao): rola depois de montar
    const hash = window.location.hash.replace('#', '');
    if (hash) window.setTimeout(() => irPara(hash), 50);
    return () => {
      document.title = tituloAnterior.current;
      if (criada) meta?.remove();
      else if (meta) meta.content = descricaoAnterior;
    };
  }, []);

  useEffect(() => {
    let ativo = true;
    api
      .get('/public/app-config', { timeout: 10_000 })
      .then(({ data }) => {
        if (!ativo || !data || typeof data !== 'object') return;
        const seguro = (u: unknown) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
        setAppLinks({ iosUrl: seguro(data.iosUrl), androidUrl: seguro(data.androidUrl) });
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);

  const navegar = useCallback((id: string) => {
    setMenuAberto(false);
    irPara(id);
  }, []);

  const pedirDemo = useCallback(() => navegar('demonstracao'), [navegar]);
  const encontrar = useCallback(() => navegar('encontre'), [navegar]);

  const escolherParoquia = useCallback(
    (p: DemoPrefill) => {
      setPrefill(p);
      setPrefillKey((k) => k + 1);
      navegar('demonstracao');
    },
    [navegar],
  );

  const whats = supportWhatsappUrl('Olá! Quero conhecer o Parish.');
  const ano = new Date().getFullYear();

  return (
    <div className="lp">
      <a className="lp-skip" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <Link to="/" className="lp-brand" aria-label="Parish — início">
            <img src="/brand/parish-logo-horizontal-branco.svg" alt="Parish" width={124} height={48} />
          </Link>
          <button
            type="button"
            className="lp-menu-btn"
            aria-expanded={menuAberto}
            aria-controls="lp-nav"
            onClick={() => setMenuAberto((v) => !v)}
          >
            <span aria-hidden="true">{menuAberto ? '×' : '☰'}</span>
            <span className="lp-sr">{menuAberto ? 'Fechar menu' : 'Abrir menu'}</span>
          </button>
          <nav id="lp-nav" className={`lp-nav${menuAberto ? ' aberto' : ''}`} aria-label="Seções do site">
            <button type="button" onClick={() => navegar('gratis')}>
              Grátis
            </button>
            <button type="button" onClick={() => navegar('recursos')}>
              Plano completo
            </button>
            <button type="button" onClick={() => navegar('planos')}>
              Preços
            </button>
            <button type="button" onClick={() => navegar('encontre')}>
              Encontre sua paróquia
            </button>
            <button type="button" onClick={() => navegar('perguntas')}>
              Dúvidas
            </button>
            <Link to="/login" className="lp-nav-entrar">
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      <main id="conteudo">
        <section className="lp-hero" aria-labelledby="lp-hero-titulo">
          <div className="lp-container lp-hero-inner">
            <div className="lp-hero-texto">
              <p className="lp-hero-tag">Comunidade, fé e serviço.</p>
              <h1 id="lp-hero-titulo">Toda paróquia tem o Parish de graça.</h1>
              <p className="lp-hero-sub">
                Sua paróquia já está no mapa. Assuma o cadastro e cuide você mesmo dos horários de missa e de
                confissão, do cadastro de membros e da localização de cada igreja. O fiel abre o app e vê a confissão
                acontecendo agora.
              </p>
              <div className="lp-hero-ctas">
                <button type="button" className="lp-btn lp-btn-gold" onClick={encontrar}>
                  Encontrar minha paróquia
                </button>
                <button type="button" className="lp-btn lp-btn-ghost" onClick={() => navegar('recursos')}>
                  Conhecer o plano completo
                </button>
              </div>
              <p className="lp-hero-nota">Grátis para a paróquia, sem prazo e sem cartão · o fiel nunca paga</p>
            </div>
            <div className="lp-hero-painel">
              <p className="lp-hero-painel-selo">Grátis para toda paróquia</p>
              <ul className="lp-hero-lista">
                <li>Sua paróquia no mapa do app</li>
                <li>Horários de missa cuidados pela equipe</li>
                <li>Confissão "acontecendo agora" para o fiel</li>
                <li>Cadastro de membros sem limite</li>
                <li>Localização de cada igreja ajustada por você</li>
              </ul>
              <p className="lp-hero-painel-rodape">
                Catequese, escalas, dízimo e sacramentos fazem parte do <strong>plano completo</strong>.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-section" id="gratis" aria-labelledby="lp-gratis-titulo">
          <div className="lp-container">
            <p className="lp-kicker">Grátis para toda paróquia</p>
            <h2 id="lp-gratis-titulo" className="lp-h2">
              O essencial da paróquia, sem pagar nada
            </h2>
            <p className="lp-lead">
              O mapa do Parish reúne os horários de missa de 53 mil comunidades do Brasil. Quem conhece os horários da
              sua igreja é a sua equipe: por isso cada paróquia cuida do próprio cadastro, de graça.
            </p>
            <ul className="lp-gratis-grid">
              {GRATIS_PAROQUIA.map((g) => (
                <li key={g.titulo} className="lp-card lp-gratis-item">
                  <span className="lp-icone-bolha" aria-hidden="true">
                    <img src={`/icons-color/${g.icon}.svg`} alt="" width={28} height={28} />
                  </span>
                  <div>
                    <h3 className="lp-h3">{g.titulo}</h3>
                    <p>{g.texto}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="lp-faixa-cta">
              <p>
                <strong>Comece hoje.</strong> Encontre a paróquia, peça o acesso e use o grátis assim que o pedido for
                conferido.
              </p>
              <button type="button" className="lp-btn lp-btn-primary" onClick={encontrar}>
                Encontrar minha paróquia
              </button>
            </div>
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="recursos" aria-labelledby="lp-recursos-titulo">
          <div className="lp-container">
            <p className="lp-kicker">Plano completo</p>
            <h2 id="lp-recursos-titulo" className="lp-h2">
              Tudo o que a paróquia faz, em um só sistema
            </h2>
            <p className="lp-lead">
              Contratado por comunidade, o plano completo abre todos os recursos abaixo para a equipe no painel e para
              o fiel no app. Dá para testar por 30 dias, quando quiser, pelo painel.
            </p>
            <nav className="lp-grupos-nav" aria-label="Grupos de recursos do plano completo">
              {PLANO_COMPLETO.map((g) => (
                <a
                  key={g.id}
                  href={`#grupo-${g.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    irPara(`grupo-${g.id}`);
                  }}
                >
                  {g.titulo}
                </a>
              ))}
            </nav>
            <div className="lp-grupos">
              {PLANO_COMPLETO.map((g) => (
                <article key={g.id} id={`grupo-${g.id}`} className="lp-grupo" aria-labelledby={`grupo-${g.id}-titulo`}>
                  <header className="lp-grupo-topo">
                    <span className="lp-icone-bolha lp-icone-bolha-g" aria-hidden="true">
                      <img src={`/icons-color/${g.icon}.svg`} alt="" width={34} height={34} />
                    </span>
                    <div>
                      <h3 id={`grupo-${g.id}-titulo`} className="lp-grupo-titulo">
                        {g.titulo}
                      </h3>
                      <p className="lp-grupo-resumo">{g.resumo}</p>
                    </div>
                  </header>
                  <ul className="lp-grupo-recursos">
                    {g.recursos.map((r) => (
                      <li key={r.titulo} className="lp-recurso">
                        <h4 className="lp-h4">{r.titulo}</h4>
                        <ul className="lp-pontos">
                          {r.pontos.map((pt) => (
                            <li key={pt}>{pt}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="comparativo" aria-labelledby="lp-comparativo-titulo">
          <div className="lp-container lp-estreito">
            <p className="lp-kicker">Grátis ou completo</p>
            <h2 id="lp-comparativo-titulo" className="lp-h2">
              O que cada plano tem
            </h2>
            <div className="lp-tabela-wrap">
              <table className="lp-tabela">
                <caption className="lp-sr">Comparação entre o plano grátis e o plano completo</caption>
                <thead>
                  <tr>
                    <th scope="col">Recurso</th>
                    <th scope="col">Grátis</th>
                    <th scope="col">Completo</th>
                  </tr>
                </thead>
                {COMPARATIVO.map((bloco) => (
                  <tbody key={bloco.grupo}>
                    <tr className="lp-tabela-grupo">
                      <th scope="rowgroup" colSpan={3}>
                        {bloco.grupo}
                      </th>
                    </tr>
                    {bloco.itens.map((it) => (
                      <tr key={it.nome}>
                        <th scope="row">{it.nome}</th>
                        <td>
                          {it.gratis ? (
                            <span className="lp-sim" role="img" aria-label="Incluído" />
                          ) : (
                            <span className="lp-nao" role="img" aria-label="Não incluído" />
                          )}
                        </td>
                        <td>
                          <span className="lp-sim" role="img" aria-label="Incluído" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
            <p className="lp-muted">
              O plano completo vale por comunidade: a paróquia escolhe quais comunidades contratam, e as outras
              continuam no grátis.
            </p>
          </div>
        </section>

        <PricingSection onRequestDemo={pedirDemo} onFindParish={encontrar} />

        <section className="lp-section" id="como-comecar" aria-labelledby="lp-passos-titulo">
          <div className="lp-container">
            <p className="lp-kicker">Como começar</p>
            <h2 id="lp-passos-titulo" className="lp-h2">
              Do mapa ao painel em quatro passos
            </h2>
            <ol className="lp-passos">
              {PASSOS.map((p, i) => (
                <li key={p.titulo} className="lp-passo">
                  <span className="lp-passo-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="lp-h3">{p.titulo}</h3>
                    <p>{p.texto}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="encontre" aria-labelledby="lp-encontre-titulo">
          <div className="lp-container lp-estreito">
            <p className="lp-kicker">Encontre sua paróquia</p>
            <h2 id="lp-encontre-titulo" className="lp-h2">
              Sua paróquia provavelmente já está no Parish
            </h2>
            <p className="lp-lead">
              Procure pela cidade e toque em "Esta paróquia é minha". Conferimos quem pediu e liberamos a gestão: a
              partir daí a sua equipe já usa o plano grátis.
            </p>
            <LandingFindParish onPick={escolherParoquia} appLinks={appLinks} />
          </div>
        </section>

        <section className="lp-section" id="demonstracao" aria-labelledby="lp-demo-titulo">
          <div className="lp-container lp-demo">
            <div className="lp-demo-texto">
              <p className="lp-kicker">Pedir demonstração</p>
              <h2 id="lp-demo-titulo" className="lp-h2">
                Quer ver o plano completo funcionando?
              </h2>
              <p className="lp-lead">
                Uma conversa de 30 minutos, por vídeo ou telefone. Mostramos o painel, o app do fiel e como trazer os
                cadastros que vocês já têm.
              </p>
              {prefill?.parishName && (
                <p className="lp-demo-paroquia">
                  Paróquia escolhida: <strong>{prefill.parishName}</strong>
                </p>
              )}
            </div>
            <DemoRequestForm prefill={prefill} prefillKey={prefillKey} />
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="perguntas" aria-labelledby="lp-faq-titulo">
          <div className="lp-container lp-estreito">
            <p className="lp-kicker">Dúvidas</p>
            <h2 id="lp-faq-titulo" className="lp-h2">
              Perguntas frequentes
            </h2>
            <div className="lp-faq">
              {PERGUNTAS.map((q) => (
                <details key={q.p}>
                  <summary>{q.p}</summary>
                  <p>{q.r}</p>
                </details>
              ))}
            </div>
            <p className="lp-muted">
              Os detalhes sobre dados pessoais estão na <Link to="/privacidade">Política de Privacidade</Link> e nos{' '}
              <Link to="/termos">Termos de uso</Link>.
            </p>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div>
            <img src="/brand/parish-logo-horizontal-branco.svg" alt="Parish" width={103} height={40} />
            <p className="lp-footer-tag">Comunidade, fé e serviço.</p>
          </div>
          <nav aria-label="Páginas do Parish" className="lp-footer-links">
            <Link to="/privacidade">Privacidade</Link>
            <Link to="/termos">Termos de uso</Link>
            <Link to="/suporte">Suporte</Link>
            <Link to="/login">Entrar no painel</Link>
          </nav>
          <div className="lp-footer-contato">
            <a href={supportMailto('Parish')}>{SUPPORT_EMAIL}</a>
            {whats && (
              <a href={whats} target="_blank" rel="noopener noreferrer">
                WhatsApp {SUPPORT_WHATSAPP_LABEL}
              </a>
            )}
          </div>
        </div>
        <p className="lp-footer-copy">© {ano} Parish</p>
      </footer>
    </div>
  );
};

/**
 * Rota "/": quem já está logado vai direto para o painel (como antes); quem
 * não está vê o site de vendas.
 */
export const LandingRoute: React.FC = () => {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (token) return <Navigate to="/admin" replace />;
  return <LandingPage />;
};

export default LandingPage;
