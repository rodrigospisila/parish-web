import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { trackOnce } from '../../services/analytics';
import PricingSection from './PricingSection';
import DemoRequestForm, { type DemoPrefill } from './DemoRequestForm';
import LandingFindParish from './LandingFindParish';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_LABEL, supportMailto, supportWhatsappUrl } from './LandingSupport';
import './LandingPage.css';

/**
 * Site de vendas do Parish em "/" (saas-implantacao-14 / -20): o que é, para
 * quem, planos (GET /public/plans), "Encontre sua paróquia" (mapa público) e
 * "Pedir demonstração" (POST /public/leads). Quem já está logado nem chega
 * aqui — a rota "/" manda direto para o painel.
 */

const RECURSOS: Array<{ icon: string; titulo: string; texto: string }> = [
  {
    icon: 'membros',
    titulo: 'Secretaria sem planilha',
    texto: 'Cadastro de membros e famílias, sacramentos, documentos e certidões num só lugar, com busca rápida.',
  },
  {
    icon: 'catequese',
    titulo: 'Catequese do começo ao fim',
    texto: 'A família faz a inscrição pelo celular. Turmas, chamada, catequistas e avisos aos pais organizados.',
  },
  {
    icon: 'escala',
    titulo: 'Escalas que se confirmam',
    texto: 'Escalas de missa e de pastorais com confirmação pelo app e troca entre voluntários, sem grupo de mensagens lotado.',
  },
  {
    icon: 'dizimo',
    titulo: 'Dízimo e ofertas com Pix',
    texto: 'O fiel contribui pelo app, recebe o comprovante, e a paróquia acompanha o balancete do mês.',
  },
  {
    icon: 'comunidade',
    titulo: 'Mapa com 53 mil comunidades',
    texto: 'Horários de missa e confissão das igrejas do Brasil. O fiel encontra a igreja mais perto de onde está.',
  },
  {
    icon: 'sino',
    titulo: 'Comunicação com a comunidade',
    texto: 'Eventos, avisos e a palavra do pároco chegam como notificação no celular de quem participa.',
  },
];

const PUBLICO: Array<{ titulo: string; texto: string }> = [
  {
    titulo: 'Pároco',
    texto: 'Vê a paróquia inteira de um lugar só: comunidades, pastorais, catequese e finanças, com números para decidir.',
  },
  {
    titulo: 'Secretaria',
    texto: 'Cadastros, documentos e agenda sem papel solto. Importa as planilhas que já existem.',
  },
  {
    titulo: 'Coordenação',
    texto: 'Monta a escala, acompanha a turma e fala com a equipe sem depender de dez grupos de WhatsApp.',
  },
  {
    titulo: 'Fiel',
    texto: 'Horários de missa, a própria escala, inscrição na catequese e dízimo pelo celular. Sempre grátis.',
  },
];

const PASSOS: Array<{ titulo: string; texto: string }> = [
  { titulo: 'Encontre sua paróquia', texto: 'Ela provavelmente já está no mapa do Parish, com as comunidades e os horários.' },
  { titulo: 'Teste por 30 dias', texto: 'Liberamos o acesso da paróquia depois de conferir quem pediu. Não precisa de cartão.' },
  { titulo: 'Chame a equipe', texto: 'Convide secretaria e coordenadores por link e traga os cadastros das planilhas.' },
  { titulo: 'Contrate pelo painel', texto: 'Escolha as comunidades e a faixa, e pague por Pix, boleto ou cartão.' },
];

const PERGUNTAS: Array<{ p: string; r: string }> = [
  { p: 'O fiel paga alguma coisa?', r: 'Não. O app do fiel é gratuito. Quem contrata é a paróquia, por comunidade.' },
  {
    p: 'O que continua grátis se a paróquia não contratar?',
    r: 'Calendário e eventos, mapa e horários de missa e a liturgia do dia. Os demais recursos dependem do plano da comunidade.',
  },
  {
    p: 'E se o pagamento atrasar ou a paróquia desistir?',
    r: 'Os recursos do plano ficam suspensos, mas nenhum dado é apagado. A paróquia pode exportar os próprios dados quando quiser.',
  },
  {
    p: 'Dá para trazer os cadastros que já temos?',
    r: 'Sim. Membros e dizimistas podem vir de planilha, com uma prévia antes de gravar para conferir duplicados.',
  },
  {
    p: 'Quem na paróquia vê os dados de cada pessoa?',
    r: 'Cada pessoa da equipe vê só o que o papel dela permite (paróquia, comunidade ou pastoral). A gestão pode ligar a verificação em duas etapas no login.',
  },
  {
    p: 'Precisa instalar alguma coisa?',
    r: 'A equipe usa o painel no navegador, no computador ou no celular. Os fiéis usam o app Parish, disponível para iPhone e Android.',
  },
];

/** Leva a seção ao topo com rolagem suave e foco (teclado e leitor de tela). */
function irPara(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduz = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' });
  const foco = el.querySelector<HTMLElement>('h2') ?? el;
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
    document.title = 'Parish · Gestão paroquial: catequese, escalas, dízimo e horários';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const criada = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    const descricaoAnterior = meta.content;
    meta.content =
      'Parish organiza a paróquia: secretaria, catequese, escalas, dízimo com Pix e o mapa com os horários de 53 mil comunidades. Teste grátis por 30 dias.';
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
            <button type="button" onClick={() => navegar('recursos')}>
              Recursos
            </button>
            <button type="button" onClick={() => navegar('planos')}>
              Planos
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
              <h1 id="lp-hero-titulo">A paróquia organizada, e no celular de cada fiel.</h1>
              <p className="lp-hero-sub">
                Secretaria, catequese, escalas, dízimo com Pix e os horários de missa de 53 mil comunidades, num só
                lugar. Feito para a rotina da paróquia, simples para quem não é da informática.
              </p>
              <div className="lp-hero-ctas">
                <button type="button" className="lp-btn lp-btn-gold" onClick={pedirDemo}>
                  Pedir demonstração
                </button>
                <button type="button" className="lp-btn lp-btn-ghost" onClick={() => navegar('planos')}>
                  Ver planos e preços
                </button>
              </div>
              <p className="lp-hero-nota">30 dias de teste grátis · sem cartão · o fiel nunca paga</p>
            </div>
            <div className="lp-hero-arte" aria-hidden="true">
              <img src="/brand/parish-simbolo-cor.svg" alt="" />
            </div>
          </div>
        </section>

        <section className="lp-section" id="recursos" aria-labelledby="lp-recursos-titulo">
          <div className="lp-container">
            <p className="lp-kicker">O que é</p>
            <h2 id="lp-recursos-titulo" className="lp-h2">
              Tudo o que a paróquia faz, em um só sistema
            </h2>
            <ul className="lp-grid-3">
              {RECURSOS.map((r) => (
                <li key={r.titulo} className="lp-card lp-recurso">
                  <img src={`/icons-color/${r.icon}.svg`} alt="" className="lp-recurso-icone" width={40} height={40} />
                  <h3 className="lp-h3">{r.titulo}</h3>
                  <p>{r.texto}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="para-quem" aria-labelledby="lp-publico-titulo">
          <div className="lp-container">
            <p className="lp-kicker">Para quem</p>
            <h2 id="lp-publico-titulo" className="lp-h2">
              Cada pessoa vê o que precisa
            </h2>
            <ul className="lp-grid-4">
              {PUBLICO.map((p) => (
                <li key={p.titulo} className="lp-card lp-publico">
                  <h3 className="lp-h3">{p.titulo}</h3>
                  <p>{p.texto}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" id="como-comecar" aria-labelledby="lp-passos-titulo">
          <div className="lp-container">
            <p className="lp-kicker">Como começar</p>
            <h2 id="lp-passos-titulo" className="lp-h2">
              Da primeira conversa ao uso em poucos dias
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

        <PricingSection onRequestDemo={pedirDemo} />

        <section className="lp-section" id="encontre" aria-labelledby="lp-encontre-titulo">
          <div className="lp-container lp-estreito">
            <p className="lp-kicker">Encontre sua paróquia</p>
            <h2 id="lp-encontre-titulo" className="lp-h2">
              Sua paróquia provavelmente já está no Parish
            </h2>
            <p className="lp-lead">
              O mapa do Parish tem as paróquias e comunidades do Brasil. Procure pela cidade e diga que a paróquia é sua:
              conferimos o pedido e liberamos o teste.
            </p>
            <LandingFindParish onPick={escolherParoquia} appLinks={appLinks} />
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="demonstracao" aria-labelledby="lp-demo-titulo">
          <div className="lp-container lp-demo">
            <div className="lp-demo-texto">
              <p className="lp-kicker">Pedir demonstração</p>
              <h2 id="lp-demo-titulo" className="lp-h2">
                Vamos mostrar o Parish com a sua paróquia
              </h2>
              <p className="lp-lead">
                Uma conversa de 30 minutos, por vídeo ou telefone. Mostramos o painel, o app do fiel e como trazer os
                dados que vocês já têm.
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

        <section className="lp-section" id="perguntas" aria-labelledby="lp-faq-titulo">
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
