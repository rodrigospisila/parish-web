/**
 * Nomes dos eventos de uso (ProductEvent) em português. Evento sem rótulo
 * aparece com o nome técnico — a lista branca de verdade é a do backend.
 */
const LABELS: Record<string, string> = {
  // App (lista branca do backend: product-event-names.ts)
  app_open: 'Abriu o app',
  screen_home: 'App: início',
  screen_liturgy: 'App: liturgia do dia',
  screen_nearby: 'App: missas perto / mapa',
  screen_community: 'App: página da comunidade',
  screen_schedule: 'App: minhas escalas',
  screen_catechesis: 'App: catequese',
  screen_tithe: 'App: dízimo',
  screen_events: 'App: agenda e eventos',
  screen_profile: 'App: perfil',
  // Painel web
  web_login: 'Login no painel',
  web_dashboard: 'Painel: início',
  web_members: 'Painel: membros',
  web_schedules: 'Painel: escalas',
  web_catechesis: 'Painel: catequese',
  web_finance: 'Painel: financeiro',
  web_pastorals: 'Painel: pastorais',
  web_onboarding: 'Painel: implantação',
  web_billing: 'Painel: meu plano',
  // Funil de implantação e venda
  invite_sent: 'Convite de equipe enviado',
  invite_accepted: 'Convite aceito',
  import_done: 'Importação concluída',
  checkout_started: 'Contratação iniciada',
  claim_started: 'Reivindicação iniciada',
  landing_view: 'Visitou o site',
  demo_request_sent: 'Pediu demonstração',
};

export const eventLabel = (name: string) => LABELS[name] ?? name;

export const PLATFORM_LABEL: Record<string, string> = { web: 'Painel web', app: 'App' };

export const ROLE_LABEL: Record<string, string> = {
  '': 'Sem login',
  SYSTEM_ADMIN: 'Administrador do sistema',
  DIOCESAN_ADMIN: 'Administração diocesana',
  PARISH_ADMIN: 'Administração paroquial',
  COMMUNITY_COORDINATOR: 'Coordenação de comunidade',
  PASTORAL_COORDINATOR: 'Coordenação de pastoral',
  VOLUNTEER: 'Voluntário(a)',
  FAITHFUL: 'Fiel',
};
