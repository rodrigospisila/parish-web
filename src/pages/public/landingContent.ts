/**
 * Conteúdo do site de vendas (lançamento do plano grátis enxuto, 11/11/2026).
 *
 * Regra de produto: a equipe da paróquia usa DE GRAÇA o cadastro de membros,
 * os horários fixos de missa e de confissão, o "não haverá" por data e a
 * localização das próprias comunidades. Todo o resto é do plano completo,
 * contratado por comunidade. O fiel nunca paga, mas os recursos pagos só
 * aparecem para ele quando a comunidade tem o plano.
 *
 * Cada frase daqui descreve uma tela que existe no painel ou no app: ao mudar
 * um recurso, confira o texto correspondente.
 */

export interface ItemGratis {
  icon: string;
  titulo: string;
  texto: string;
}

export const GRATIS_PAROQUIA: ItemGratis[] = [
  {
    icon: 'igreja',
    titulo: 'Sua paróquia no mapa',
    texto:
      'As igrejas da paróquia aparecem no mapa do app Parish, com endereço e rota, para quem procura missa perto de onde está.',
  },
  {
    icon: 'missa-proxima',
    titulo: 'Horários de missa em dia',
    texto:
      'A própria equipe cadastra e corrige os horários fixos: missa, celebração da Palavra, adoração e terço, toda semana, em sábados alternados ou num dia fixo do mês.',
  },
  {
    icon: 'confissao',
    titulo: 'Confissão "acontecendo agora"',
    texto:
      'Cadastre a confissão com hora de início e de fim. Durante esse horário o app mostra sozinho que há confissão acontecendo naquela igreja.',
  },
  {
    icon: 'calendario-liturgico',
    titulo: '"Não haverá" por data',
    texto:
      'Sem missa ou sem confissão num dia? Marque a data (ou o período) e o motivo. O fiel vê o aviso em vez de encontrar a porta fechada.',
  },
  {
    icon: 'membros',
    titulo: 'Cadastro de membros sem limite',
    texto:
      'Fichas de todos os membros, com cônjuge e responsável vinculados, busca rápida e exportação em planilha. Sem limite de pessoas.',
  },
  {
    icon: 'comunidade',
    titulo: 'Localização de cada igreja',
    texto:
      'Arraste o pino até a porta da igreja e corrija o endereço das suas comunidades. O mapa passa a levar o fiel ao lugar certo.',
  },
  {
    icon: 'usuarios',
    titulo: 'Equipe com acesso próprio',
    texto:
      'Convide secretaria e coordenadores por link. Cada pessoa entra com a própria conta, com verificação em duas etapas e registro do que foi alterado.',
  },
  {
    icon: 'biblia',
    titulo: 'Para o fiel, no app',
    texto:
      'Mapa das igrejas, horários de missa e confissão, favoritos com lembrete e a liturgia do dia. O fiel não paga nada.',
  },
];

export interface RecursoPago {
  titulo: string;
  pontos: string[];
}

export interface GrupoPago {
  id: string;
  icon: string;
  titulo: string;
  resumo: string;
  recursos: RecursoPago[];
}

export const PLANO_COMPLETO: GrupoPago[] = [
  {
    id: 'secretaria',
    icon: 'calice',
    titulo: 'Secretaria e sacramentos',
    resumo: 'Do pedido ao assento no livro, sem papel solto.',
    recursos: [
      {
        titulo: 'Processos sacramentais',
        pontos: [
          'Quadro por etapas: solicitado, documentos, preparação, agendado e celebrado.',
          'Batismo, Primeira Eucaristia, Crisma, Matrimônio, Ordem e Unção dos Enfermos.',
          'Lista de documentos de cada processo, com o andamento à vista.',
        ],
      },
      {
        titulo: 'Assentos e certidões',
        pontos: [
          'Assento com data, ministro, livro, folha e termo, guardado na ficha do membro.',
          'Assento lavrado não se apaga: a correção é feita por retificação, com o motivo registrado.',
          'Certidão em PDF pronta para imprimir e assinar.',
        ],
      },
    ],
  },
  {
    id: 'catequese',
    icon: 'catequese',
    titulo: 'Catequese',
    resumo: 'Da inscrição ao certificado, com a família por perto.',
    recursos: [
      {
        titulo: 'Inscrição pela família, no celular',
        pontos: [
          'Os pais inscrevem os filhos pelo app, enviam os documentos pedidos e aceitam o termo do responsável.',
          'A equipe confere, aprova ou pede correção, uma a uma ou em lote.',
          'Turmas por etapa, com vagas, período de inscrição e fila de espera.',
        ],
      },
      {
        titulo: 'Encontros e chamada',
        pontos: [
          'Agenda de encontros do ano gerada de uma vez, com os temas planejados.',
          'Chamada no painel ou no app do catequista: presente, atraso, falta e falta justificada.',
          'Folha de frequência da turma inteira em uma tela.',
        ],
      },
      {
        titulo: 'Famílias acompanhando',
        pontos: [
          'Os responsáveis veem no app a frequência, a agenda dos encontros e os avisos.',
          'Aviso para todas as famílias da turma ou para uma só, com notificação no celular.',
          'Conversa entre a família e a catequese, guardada por catequizando.',
        ],
      },
      {
        titulo: 'Documentos e fim de ano',
        pontos: [
          'Lista da turma, declaração de matrícula e certificados em PDF, individuais ou em lote.',
          'Taxas de material com controle de pagamentos e recibo.',
          'Passagem da turma para a etapa seguinte e criação das turmas do próximo ano.',
        ],
      },
    ],
  },
  {
    id: 'escalas',
    icon: 'escala',
    titulo: 'Pastorais, escalas e trocas',
    resumo: 'A escala montada, confirmada e trocada sem grupo de mensagens.',
    recursos: [
      {
        titulo: 'Pastorais e movimentos',
        pontos: [
          'Membros de cada pastoral com a função: coordenador, vice, secretário, tesoureiro e outras.',
          'Subgrupos com líder e pedidos de "quero participar" enviados pelo app.',
          'Reuniões e atividades da pastoral entram no calendário da comunidade.',
        ],
      },
      {
        titulo: 'Escalas de missa e de eventos',
        pontos: [
          'Escalas criadas a partir dos horários fixos e dos eventos, com as vagas de cada pastoral.',
          'Rodízio com prévia antes de gravar, mantendo casais juntos quando a pastoral quiser.',
          'Alerta de quem está escalado em dois lugares no mesmo horário e escala em PDF.',
        ],
      },
      {
        titulo: 'Confirmação pelo app',
        pontos: [
          'O voluntário vê a própria escala, confirma ou avisa que não pode.',
          'Cada um informa os dias em que está disponível.',
          'A coordenação acompanha as respostas e as vagas descobertas.',
        ],
      },
      {
        titulo: 'Trocas de escala',
        pontos: [
          'O voluntário pede a troca a um colega ou deixa aberta para a pastoral.',
          'O colega aceita ou recusa pelo app, e a escala se atualiza.',
        ],
      },
    ],
  },
  {
    id: 'dizimo',
    icon: 'dizimo',
    titulo: 'Dízimo, ofertas e financeiro',
    resumo: 'Contribuição simples para o fiel, prestação de contas clara para a paróquia.',
    recursos: [
      {
        titulo: 'Dízimo e oferta pelo app',
        pontos: [
          'Pix, cartão ou boleto, direto para a conta de recebimento da paróquia.',
          'Dízimo mensal automático para quem preferir.',
          'Recibo de cada contribuição e informe anual do dizimista.',
        ],
      },
      {
        titulo: 'Registro presencial',
        pontos: [
          'O agente do dízimo encontra o dizimista por nome, número ou telefone e lança na hora.',
          'Dinheiro, envelope, maquininha, Pix, transferência ou cheque.',
          'Comprovante em PDF para entregar ao fiel.',
        ],
      },
      {
        titulo: 'Campanhas e visitantes',
        pontos: [
          'Campanhas e fundos com meta, promessas e acompanhamento do arrecadado.',
          'Página pública de doação para quem não tem cadastro, com recibo por e-mail.',
          'Cartaz com QR Code em PDF para a porta da igreja.',
        ],
      },
      {
        titulo: 'Cuidado com o dizimista',
        pontos: [
          'Veja quem está em dia, quem está esfriando e quem se afastou.',
          'Registre o agradecimento, a ligação ou a visita feita a cada um.',
        ],
      },
      {
        titulo: 'Receitas, despesas e balancete',
        pontos: [
          'Lançamentos por categoria e centro de custo.',
          'Balancete mensal gerado pelo sistema, aprovado pelo conselho econômico e publicado no app.',
          'Exportação em PDF e planilha. Não substitui a contabilidade oficial.',
        ],
      },
    ],
  },
  {
    id: 'comunicacao',
    icon: 'sino',
    titulo: 'Comunicação com a comunidade',
    resumo: 'O que a paróquia tem a dizer chega ao celular de quem participa.',
    recursos: [
      {
        titulo: 'Eventos e calendário',
        pontos: [
          'Missas especiais, reuniões, retiros, formações e festas, com repetição semanal ou mensal.',
          'Limite de participantes, sala reservada e pastorais envolvidas no mesmo cadastro.',
          'O fiel vê no calendário do app, marca como favorito e recebe o lembrete.',
        ],
      },
      {
        titulo: 'Palavra do pároco',
        pontos: [
          'Mensagem com texto, assinatura e vídeo do YouTube.',
          'Para a paróquia inteira, uma comunidade, uma pastoral ou uma pessoa.',
          'Aparece em destaque no início do app.',
        ],
      },
      {
        titulo: 'Avisos por notificação',
        pontos: [
          'A equipe escalada, as famílias da catequese e quem recebe uma mensagem são avisados no celular.',
          'Cada pessoa tem a caixa de avisos no app, com o histórico.',
        ],
      },
      {
        titulo: 'Mural de oração',
        pontos: [
          'O fiel envia o pedido de oração pelo app, com ou sem o nome.',
          'A coordenação aprova antes de publicar.',
          'A comunidade toca em "rezar" e o pedido mostra quantos rezaram.',
        ],
      },
    ],
  },
  {
    id: 'organizacao',
    icon: 'espacos',
    titulo: 'Formação, espaços, visitação e documentos',
    resumo: 'A rotina que hoje fica em cadernos e planilhas.',
    recursos: [
      {
        titulo: 'Formação de agentes',
        pontos: [
          'Trilhas e cursos, com validade e indicação de quais são exigidos para cada função.',
          'Inscrição, conclusão e certificado em PDF.',
          'Lista de quem está com a formação pendente ou vencida.',
        ],
      },
      {
        titulo: 'Salas e espaços',
        pontos: [
          'Salas com capacidade e recursos, e agenda da semana.',
          'Pedido de reserva com aprovação.',
          'Dois usos no mesmo horário são barrados pelo sistema.',
        ],
      },
      {
        titulo: 'Visitação',
        pontos: [
          'Pedidos de visita a enfermos e famílias, com motivo, endereço e consentimento.',
          'Registro de cada visita: data, quem visitou e anotações de acesso restrito.',
        ],
      },
      {
        titulo: 'Documentos da paróquia',
        pontos: [
          'Atas, regimentos, ofícios e prestações de contas organizados por categoria.',
          'Validade com aviso de vencido e histórico de versões.',
          'O arquivo fica no serviço de nuvem da paróquia; o Parish guarda o link e a organização.',
        ],
      },
    ],
  },
  {
    id: 'planejamento',
    icon: 'planejamento',
    titulo: 'Planejamento e indicadores',
    resumo: 'Números para o pároco e o conselho decidirem.',
    recursos: [
      {
        titulo: 'Planejamento pastoral',
        pontos: [
          'Plano do ano por comunidade, com objetivos, metas e ações.',
          'Cada meta tem indicador e alvo; cada ação tem responsável, prazo e resultado.',
        ],
      },
      {
        titulo: 'Painel de indicadores',
        pontos: [
          'Pendências do dia: inscrições, chamadas não feitas, respostas de escala, trocas e pedidos.',
          'Frequência da catequese, escalas confirmadas, membros novos e eventos do mês.',
          'Gráficos por semana, por pastoral e por etapa, além de aniversariantes e vagas descobertas.',
        ],
      },
    ],
  },
];

/** Linhas da tabela comparativa. `gratis` = disponível sem contratar. */
export interface LinhaComparativo {
  grupo: string;
  itens: Array<{ nome: string; gratis: boolean }>;
}

export const COMPARATIVO: LinhaComparativo[] = [
  {
    grupo: 'Presença e cadastro',
    itens: [
      { nome: 'Paróquia e comunidades no mapa do app', gratis: true },
      { nome: 'Horários fixos de missa, adoração e terço', gratis: true },
      { nome: 'Horários de confissão com "acontecendo agora"', gratis: true },
      { nome: '"Não haverá" por data', gratis: true },
      { nome: 'Cadastro de membros sem limite', gratis: true },
      { nome: 'Ajuste da localização e do endereço das igrejas', gratis: true },
      { nome: 'Usuários, convites e registro de alterações', gratis: true },
      { nome: 'Liturgia do dia no app do fiel', gratis: true },
    ],
  },
  {
    grupo: 'Secretaria e catequese',
    itens: [
      { nome: 'Processos sacramentais, assentos e certidões', gratis: false },
      { nome: 'Catequese: inscrição, turmas, chamada e certificados', gratis: false },
      { nome: 'Documentos da paróquia', gratis: false },
    ],
  },
  {
    grupo: 'Pastorais e voluntários',
    itens: [
      { nome: 'Pastorais e movimentos', gratis: false },
      { nome: 'Escalas com confirmação pelo app', gratis: false },
      { nome: 'Trocas de escala', gratis: false },
      { nome: 'Formação de agentes', gratis: false },
    ],
  },
  {
    grupo: 'Dízimo e financeiro',
    itens: [
      { nome: 'Dízimo e ofertas por Pix, cartão e boleto', gratis: false },
      { nome: 'Campanhas e doação de visitantes', gratis: false },
      { nome: 'Receitas, despesas e balancete', gratis: false },
    ],
  },
  {
    grupo: 'Comunicação e gestão',
    itens: [
      { nome: 'Eventos e calendário da comunidade', gratis: false },
      { nome: 'Palavra do pároco e avisos por notificação', gratis: false },
      { nome: 'Mural de oração', gratis: false },
      { nome: 'Salas e espaços', gratis: false },
      { nome: 'Visitação', gratis: false },
      { nome: 'Planejamento pastoral e painel de indicadores', gratis: false },
    ],
  },
];

export const PASSOS: Array<{ titulo: string; texto: string }> = [
  {
    titulo: 'Encontre a paróquia no mapa',
    texto: 'Busque pela cidade. A paróquia e as comunidades provavelmente já estão cadastradas.',
  },
  {
    titulo: 'Peça o acesso',
    texto: 'Diga quem você é na paróquia. Conferimos quem pediu antes de liberar a gestão.',
  },
  {
    titulo: 'Já use o grátis',
    texto: 'Horários de missa e confissão, membros e localização das igrejas, sem pagar e sem prazo.',
  },
  {
    titulo: 'Teste ou contrate o completo',
    texto: 'Pelo painel, quando quiser: 30 dias de teste do plano completo ou a contratação por comunidade.',
  },
];

export const PERGUNTAS: Array<{ p: string; r: string }> = [
  {
    p: 'O que a paróquia usa de graça?',
    r: 'O cadastro de membros (sem limite), os horários fixos de missa e de confissão, o aviso de "não haverá" por data e o ajuste da localização das próprias igrejas. Também são livres os usuários e convites da equipe e o registro de alterações. Não tem prazo e não pede cartão.',
  },
  {
    p: 'O que faz parte do plano completo?',
    r: 'Todo o resto: sacramentos e certidões, catequese, pastorais, escalas e trocas, dízimo e financeiro, eventos, palavra do pároco, mural de oração, formação, salas, visitação, documentos, planejamento e o painel de indicadores. O plano é contratado por comunidade.',
  },
  {
    p: 'O fiel paga alguma coisa?',
    r: 'Nunca. O app é gratuito para o fiel. Mapa, horários de missa e confissão, favoritos com lembrete e liturgia do dia funcionam em qualquer igreja. Escala, catequese, dízimo e os demais recursos aparecem para o fiel quando a comunidade dele tem o plano completo.',
  },
  {
    p: 'Como funciona o teste do plano completo?',
    r: 'O teste não começa sozinho. Quando a paróquia quiser, o administrador pede pelo painel e todas as comunidades ficam com o plano completo por 30 dias, sem cartão. O teste vale uma vez por paróquia.',
  },
  {
    p: 'E se a paróquia não contratar depois do teste?',
    r: 'A comunidade volta para o plano grátis e continua usando membros, horários e localização. O que foi cadastrado nos recursos do plano completo fica guardado e reaparece se a paróquia contratar.',
  },
  {
    p: 'E se o pagamento atrasar?',
    r: 'Avisamos antes. Se o pagamento não for regularizado, os recursos do plano completo ficam suspensos naquela comunidade e o grátis continua funcionando. Nenhum dado é apagado.',
  },
  {
    p: 'Como vocês conferem quem pede o acesso da paróquia?',
    r: 'Todo pedido passa pela equipe do Parish. Olhamos o cargo informado, o contato e, quando existe, o documento enviado. Quem pede pode confirmar um código enviado ao telefone ou e-mail oficial da paróquia, o que agiliza a análise.',
  },
  {
    p: 'De quem são os dados e quem pode vê-los?',
    r: 'Os dados são da paróquia. Cada pessoa da equipe vê só o que o papel dela permite (paróquia, comunidade ou pastoral), e a paróquia pode exportar os próprios dados quando quiser.',
  },
  {
    p: 'E a LGPD?',
    r: 'O Parish trata os dados para a paróquia e segue a Lei Geral de Proteção de Dados. O fiel pode ver, exportar e pedir a exclusão dos próprios dados pelo app ou pelo painel, e a catequese de menores tem o termo do responsável. Os detalhes estão na Política de Privacidade.',
  },
  {
    p: 'Precisa instalar alguma coisa?',
    r: 'A equipe usa o painel no navegador, no computador ou no celular. Os fiéis usam o app Parish, para iPhone e Android.',
  },
];
