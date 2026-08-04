import React from 'react';
import { Link } from 'react-router-dom';

const UPDATED = '23 de julho de 2026';
// TODO: troque pelo e-mail de suporte real antes de submeter à Apple/Google.
const SUPPORT_EMAIL = 'suporte@parish.app';

const shell: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '40px 20px 80px',
  color: '#222',
  fontFamily: '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  lineHeight: 1.65,
};
const h1: React.CSSProperties = { fontSize: 28, fontWeight: 800, margin: '8px 0 4px' };
const muted: React.CSSProperties = { color: '#777', fontSize: 13 };
const back: React.CSSProperties = { color: '#075AA9', textDecoration: 'none', fontWeight: 600, fontSize: 14 };

const Layout: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={shell}>
    <Link to="/login" style={back}>← Voltar</Link>
    <h1 style={h1}>{title}</h1>
    <p style={muted}>Parish — Gestão paroquial · Última atualização: {UPDATED}</p>
    {children}
    <hr style={{ margin: '40px 0 16px', border: 'none', borderTop: '1px solid #eee' }} />
    <p style={muted}>
      Dúvidas? <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#075AA9' }}>{SUPPORT_EMAIL}</a>
    </p>
  </div>
);

export const PrivacyPage: React.FC = () => (
  <Layout title="Política de Privacidade">
    <p>
      O <strong>Parish</strong> é uma plataforma de gestão para dioceses, paróquias e comunidades
      católicas. Esta política descreve como tratamos seus dados, em conformidade com a Lei Geral de
      Proteção de Dados (LGPD, Lei nº 13.709/2018).
    </p>

    <h2>Dados que coletamos</h2>
    <ul>
      <li><strong>Cadastro:</strong> nome, e-mail, telefone e a comunidade/paróquia à qual você se vincula.</li>
      <li><strong>Uso:</strong> participação em eventos, escalas, pastorais e demais registros que você cria no app.</li>
      <li>
        <strong>Localização (opcional):</strong> ao usar a função <em>"Missas por perto"</em>, sua
        localização é usada <strong>apenas no momento da consulta, no seu aparelho</strong>, para
        encontrar comunidades próximas. Ela <strong>não é enviada nem armazenada</strong> em nossos
        servidores.
      </li>
    </ul>

    <h2>Como usamos</h2>
    <p>
      Para autenticar seu acesso, exibir a agenda e as informações da sua comunidade, organizar
      escalas e pastorais e enviar comunicados da sua paróquia. Não vendemos seus dados.
    </p>

    <h2>Compartilhamento</h2>
    <p>
      Seus dados ficam visíveis aos responsáveis pela sua paróquia/comunidade conforme o seu papel na
      plataforma. Utilizamos provedores de infraestrutura (hospedagem e banco de dados) apenas para
      operar o serviço.
    </p>

    <h2>Seus direitos (LGPD)</h2>
    <p>
      Você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados, bem como revogar
      consentimentos, escrevendo para <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
    </p>

    <h2>Retenção e segurança</h2>
    <p>
      Mantemos os dados enquanto sua conta estiver ativa. Adotamos medidas técnicas para proteger as
      informações (senhas com hash, comunicação criptografada e controle de acesso por papel).
    </p>
  </Layout>
);

export const TermsPage: React.FC = () => (
  <Layout title="Termos de Uso">
    <p>
      Ao usar o <strong>Parish</strong>, você concorda com estes termos. O app destina-se à gestão e à
      participação em atividades de dioceses, paróquias e comunidades católicas.
    </p>

    <h2>Conta e responsabilidade</h2>
    <ul>
      <li>Você é responsável por manter a confidencialidade das suas credenciais.</li>
      <li>Os conteúdos que você cadastra devem ser verdadeiros e respeitar terceiros e a legislação.</li>
      <li>O acesso a funções administrativas depende do papel atribuído pela sua paróquia/diocese.</li>
    </ul>

    <h2>Uso aceitável</h2>
    <p>
      É proibido usar a plataforma para fins ilícitos, enviar conteúdo ofensivo ou tentar acessar
      dados de terceiros sem autorização.
    </p>

    <h2>Disponibilidade</h2>
    <p>
      O serviço é fornecido "no estado em que se encontra". Podemos atualizar, suspender ou encerrar
      funcionalidades, buscando sempre comunicar mudanças relevantes.
    </p>

    <h2>Contato</h2>
    <p>
      Fale conosco em <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
    </p>
  </Layout>
);

export const SupportPage: React.FC = () => (
  <Layout title="Suporte">
    <p>Precisa de ajuda com o <strong>Parish</strong>? Estamos à disposição.</p>

    <h2>Fale conosco</h2>
    <p>
      E-mail: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a><br />
      Respondemos, em geral, em até 2 dias úteis.
    </p>

    <h2>Perguntas frequentes</h2>
    <ul>
      <li><strong>Como entro no app?</strong> Use o e-mail e a senha cadastrados pela sua paróquia/comunidade.</li>
      <li><strong>Esqueci minha senha.</strong> Use a opção "Esqueci minha senha" na tela de login.</li>
      <li>
        <strong>Não encontro minha comunidade.</strong> Escreva para o suporte informando sua
        paróquia — nós ajudamos a vincular.
      </li>
    </ul>
  </Layout>
);
