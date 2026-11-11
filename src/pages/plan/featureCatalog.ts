import type { RouteKey } from '../../components/accessRules';

/**
 * Catálogo dos recursos do plano completo (a "vitrine" dentro do painel).
 * As chaves são as de `PAID_FEATURES` do backend (plan-rules.ts), na mesma
 * ordem do contrato; os textos descrevem o que as telas do painel e do app
 * realmente fazem.
 */
export interface PlanFeatureInfo {
  /** Chave do recurso no backend (vem em `paidFeatures` e no 403 PLAN_REQUIRED) */
  key: string;
  /** Nome do recurso (o mesmo do menu) */
  name: string;
  /** Frase de valor: o que a paróquia ganha */
  tagline: string;
  /** O que o recurso faz (3 a 5 itens) */
  bullets: string[];
  /** Ícone em /icons e /title-icons */
  icon: string;
  /** Telas do painel deste recurso, em ordem de preferência (a primeira que o papel abrir) */
  routes: RouteKey[];
  /** Onde o recurso é usado quando não tem tela própria no painel */
  where?: string;
}

export const FEATURE_CATALOG: PlanFeatureInfo[] = [
  {
    key: 'pastorals',
    name: 'Pastorais',
    tagline: 'Cada pastoral com a sua equipe, as suas reuniões e os pedidos de quem quer participar.',
    bullets: [
      'Ative as pastorais de cada comunidade e defina quem coordena.',
      'Cadastre os membros com a função de cada um (coordenador, secretário, catequista…).',
      'Monte sub-grupos e equipes — o coral, a equipe do sábado — para escalar o grupo inteiro de uma vez.',
      'Agende reuniões e atividades da pastoral.',
      'Receba pelo app os pedidos de "quero participar" e aprove com um toque.',
    ],
    icon: 'pastoral',
    routes: ['pastorals/community', 'pastorals/my'],
  },
  {
    key: 'schedules',
    name: 'Escalas',
    tagline: 'A escala de cada missa montada em minutos, com a confirmação de quem vai servir.',
    bullets: [
      'Gere as escalas a partir dos horários fixos e dos eventos, com as vagas de cada pastoral.',
      'Cada pessoa escalada recebe o aviso no celular e confirma ou recusa.',
      'Veja as vagas descobertas e quem está sobrecarregado antes do fim de semana.',
      'Escale grupos inteiros (coral, equipe de liturgia) e marque a presença no dia.',
      'Cada voluntário acompanha a própria escala em "Minha Escala" e no app.',
    ],
    icon: 'escala',
    routes: ['schedules'],
  },
  {
    key: 'swaps',
    name: 'Trocas de Escala',
    tagline: 'Quem não pode servir resolve a troca sem precisar ligar para a coordenação.',
    bullets: [
      'O voluntário pede a troca pelo app ou pelo painel.',
      'Pode convidar um colega específico ou deixar a vaga aberta para a pastoral.',
      'A coordenação acompanha tudo e decide as trocas pendentes.',
      'A escala é atualizada sozinha quando a troca é aceita.',
    ],
    icon: 'trocas-escala',
    routes: ['swaps'],
  },
  {
    key: 'catechesis',
    name: 'Catequese',
    tagline: 'Da inscrição à conclusão: turmas, chamada e contato com as famílias em um só lugar.',
    bullets: [
      'Organize etapas e turmas, com catequistas, vagas e fila de espera.',
      'Abra as inscrições online: a família preenche e envia os documentos pelo app.',
      'Faça a chamada de cada encontro e veja a frequência e o risco de evasão.',
      'Troque mensagens com as famílias e registre a autorização de uso de imagem.',
      'Encerre o ano em lote: conclusões, promoção para a etapa seguinte e panorama da paróquia.',
    ],
    icon: 'catequese',
    routes: ['catechesis'],
  },
  {
    key: 'formation',
    name: 'Formação',
    tagline: 'Cursos e trilhas de formação para os agentes de pastoral, com inscrições organizadas.',
    bullets: [
      'Crie trilhas de formação e os cursos de cada uma.',
      'Inscreva os agentes de pastoral em cada curso e acompanhe a situação de cada um.',
      'Registre a conclusão e emita o certificado em PDF.',
      'Veja as formações vencidas ou pendentes de renovação.',
    ],
    icon: 'biblia',
    routes: ['formation'],
  },
  {
    key: 'rooms',
    name: 'Espaços',
    tagline: 'Salão, salas e capela reservados sem conflito de horário.',
    bullets: [
      'Cadastre os espaços da comunidade.',
      'As pastorais pedem a reserva e a coordenação aprova ou recusa.',
      'Veja a agenda de cada espaço antes de marcar.',
      'Escolha o espaço ao criar um evento da comunidade.',
    ],
    icon: 'espacos',
    routes: ['rooms'],
  },
  {
    key: 'visitation',
    name: 'Visitação',
    tagline: 'Nenhum doente ou idoso esquecido: cada pedido de visita com acompanhamento até o fim.',
    bullets: [
      'Registre os pedidos de visita a doentes, idosos e famílias.',
      'Agende a visita e defina quem vai.',
      'Registre o que foi feito e mantenha o histórico de acompanhamento de cada pessoa.',
      'Veja de relance o que está aberto, agendado e realizado.',
    ],
    icon: 'visitacao',
    routes: ['visitation'],
  },
  {
    key: 'documents',
    name: 'Documentos',
    tagline: 'Os documentos da comunidade guardados com versão, à mão de quem precisa.',
    bullets: [
      'Guarde atas, regimentos, ofícios, comunicados e formulários em um só lugar.',
      'Envie uma nova versão sem perder as anteriores.',
      'Organize por categoria e por comunidade, com data de validade quando houver.',
    ],
    icon: 'documento',
    routes: ['documents'],
  },
  {
    key: 'events',
    name: 'Eventos',
    tagline: 'O calendário da comunidade — festas, retiros, reuniões — publicado para os fiéis.',
    bullets: [
      'Crie eventos com data, local, tipo e repetição (semanal, mensal…).',
      'Veja tudo em calendário ou em lista, junto dos horários fixos.',
      'Duplique um evento para reaproveitar o que já está pronto.',
      'Os eventos publicados aparecem no app dos fiéis e alimentam as escalas.',
    ],
    icon: 'calendario-liturgico',
    routes: ['events'],
  },
  {
    key: 'news',
    name: 'Notícias e avisos',
    tagline: 'Os avisos da missa chegando ao celular dos fiéis durante a semana.',
    bullets: [
      'Publique notícias e avisos da comunidade, com imagem.',
      'Marque o aviso como urgente para ele ganhar destaque.',
      'Os fiéis leem no app, na área da própria comunidade.',
    ],
    icon: 'sino',
    routes: [],
    where: 'Usado pelo aplicativo Parish, na área da comunidade.',
  },
  {
    key: 'prayer-requests',
    name: 'Mural de orações',
    tagline: 'A comunidade rezando pelas intenções uns dos outros, com moderação da coordenação.',
    bullets: [
      'Os fiéis enviam pedidos de oração pelo app, com nome ou de forma anônima.',
      'A coordenação lê cada pedido e publica ou recusa antes de ir ao mural.',
      'Os pedidos são organizados por intenção: saúde, família, trabalho, estudos.',
      'A comunidade acompanha o mural e reza pelas intenções.',
    ],
    icon: 'oracao',
    routes: ['dashboard'],
    where: 'Os fiéis usam pelo aplicativo; a moderação fica no Início do painel.',
  },
  {
    key: 'clergy-messages',
    name: 'Palavra Pastoral',
    tagline: 'A palavra do padre e do bispo chegando a cada fiel, em texto ou em vídeo.',
    bullets: [
      'Publique mensagens em texto ou com vídeo do YouTube.',
      'Escolha o alcance: a diocese inteira, a paróquia, uma comunidade ou uma pastoral.',
      'Envie também mensagens pessoais.',
      'Os fiéis recebem no app e encontram todas as mensagens em um só lugar.',
    ],
    icon: 'sacerdote',
    routes: ['clergy-messages'],
  },
  {
    key: 'planning',
    name: 'Planejamento',
    tagline: 'O plano pastoral saindo do papel: metas, ações e responsáveis acompanhados o ano todo.',
    bullets: [
      'Monte o plano pastoral da paróquia com os objetivos do período.',
      'Desdobre cada objetivo em metas e ações, com responsável e prazo.',
      'Acompanhe o andamento: planejada, em andamento, concluída.',
      'Guarde os planos de anos anteriores para consulta.',
    ],
    icon: 'planejamento',
    routes: ['planning'],
  },
  {
    key: 'sacraments',
    name: 'Registro de sacramentos',
    tagline: 'A vida sacramental de cada membro registrada, com certidão quando for preciso.',
    bullets: [
      'Registre batismo, primeira eucaristia, crisma e matrimônio na ficha do membro.',
      'Guarde livro, folha e termo de cada assento.',
      'Emita a certidão ou a declaração em PDF.',
      'Separe o que é assento do livro paroquial do que foi apenas informado pela família.',
    ],
    icon: 'calice',
    routes: ['members'],
    where: 'Fica na ficha de cada membro, em Membros.',
  },
  {
    key: 'sacrament-processes',
    name: 'Processos de sacramentos',
    tagline: 'Batizados, casamentos e crismas acompanhados do pedido até a celebração.',
    bullets: [
      'Abra o processo e siga as etapas: solicitado, documentos, preparação, agendado, celebrado.',
      'Confira os documentos com um checklist por processo.',
      'Agende a celebração e, depois dela, lavre o assento com livro, folha e termo.',
      'Emita a certidão em PDF direto do processo.',
    ],
    icon: 'cruz',
    routes: ['sacrament-processes'],
  },
  {
    key: 'finance',
    name: 'Financeiro',
    tagline: 'Entradas e saídas da comunidade lançadas e o balancete pronto para prestar contas.',
    bullets: [
      'Lance receitas e despesas por comunidade, com categoria e centro de custo.',
      'Acompanhe os totais do período e o saldo.',
      'Feche o balancete do mês, com aprovação e publicação para a prestação de contas.',
    ],
    icon: 'igreja',
    routes: ['finance'],
  },
  {
    key: 'tithe',
    name: 'Dízimo',
    tagline: 'Dízimo e ofertas por Pix, com os dizimistas acompanhados de perto.',
    bullets: [
      'Cadastre os dizimistas e lance as contribuições presenciais.',
      'Receba dízimo e ofertas por Pix, pelo app ou pela página de doação da paróquia.',
      'Crie campanhas com meta e acompanhe a arrecadação.',
      'Veja quem deixou de contribuir e retome o contato.',
      'Aceite a oferta de visitantes, sem precisar de cadastro.',
    ],
    icon: 'dizimo',
    routes: ['finance'],
    where: 'Fica dentro do Financeiro.',
  },
  {
    key: 'dashboard',
    name: 'Painel da coordenação',
    tagline: 'O Início com tudo o que precisa de você hoje — e os números da comunidade.',
    bullets: [
      'Pendências em um só lugar: inscrições, respostas de escala, trocas e pedidos de participação.',
      'Indicadores com tendência: frequência na catequese, escalas confirmadas, novos membros.',
      'Agenda dos próximos 7 dias e as vagas de escala ainda descobertas.',
      'Aniversariantes da semana e alertas de sobrecarga e de evasão.',
    ],
    icon: 'planejamento',
    routes: ['dashboard'],
  },
];

const BY_KEY = new Map(FEATURE_CATALOG.map((feature) => [feature.key, feature]));

/** Recurso do catálogo pela chave do backend (desconhecida = undefined). */
export const featureInfo = (key: string | null | undefined): PlanFeatureInfo | undefined => (key ? BY_KEY.get(key) : undefined);

/** O que o plano grátis inclui para a equipe da paróquia (decisão de produto de 11/11/2026). */
export const FREE_PLAN_ITEMS: string[] = [
  'Cadastro de membros, sem limite',
  'Importação de planilha',
  'Horários fixos de missa',
  'Horários de confissão',
  'Marcar "não haverá" em uma data',
  'Endereço e pino das suas comunidades no mapa',
  'Usuários e convites da equipe',
];

/** O que o fiel de uma comunidade no plano grátis tem no aplicativo. */
export const FREE_PLAN_FAITHFUL_ITEMS: string[] = [
  'Mapa das igrejas e horários',
  'Confissão "acontecendo agora"',
  'Favoritos com lembrete',
  'Liturgia diária',
];

/** Dias do teste pedido pelo botão (uma vez por paróquia). */
export const TRIAL_DAYS = 30;
