/**
 * Quem vê o quê no painel — fonte ÚNICA do menu (AdminLayout) e das guardas
 * de rota (App.tsx), para que item escondido no menu também não abra pela URL
 * (eng-acessos-25). O backend continua sendo quem decide; aqui é só a porta.
 */

export const COORDINATION_ROLES = [
  'SYSTEM_ADMIN',
  'DIOCESAN_ADMIN',
  'PARISH_ADMIN',
  'COMMUNITY_COORDINATOR',
  'PASTORAL_COORDINATOR',
] as const;

/** Coordenação de comunidade ou acima (financeiro, sacramentos, auditoria, usuários) */
export const COMMUNITY_MANAGEMENT_ROLES = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'] as const;

export const BASE_ROLES = ['VOLUNTEER', 'FAITHFUL'] as const;

type AccessUser = { role?: string | null; coordinatedPastoralIds?: string[] | null } | null | undefined;

/**
 * Coordena alguma pastoral pelo vínculo (coordinatedPastoralIds), mesmo com
 * papel de base (VOLUNTEER/FAITHFUL) — ux-dashboards-22.
 */
export function coordinatesAnyPastoral(user: AccessUser): boolean {
  return Array.isArray(user?.coordinatedPastoralIds) && user!.coordinatedPastoralIds!.length > 0;
}

export interface AccessRule {
  /** Papéis que entram (ausente = todos os logados) */
  roles?: readonly string[];
  /** Também entra quem coordena pastoral pelo vínculo, qualquer que seja o papel */
  pastoralCoordination?: boolean;
  /** Chave da matriz de módulos do SYSTEM_ADMIN (módulo desligado = sem acesso) */
  module?: string;
}

/** Regras por rota do painel (caminho relativo a /admin). */
export const ROUTE_ACCESS = {
  dashboard: { roles: COORDINATION_ROLES, pastoralCoordination: true },
  dioceses: { roles: ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN'], module: 'dioceses' },
  parishes: { roles: ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN'], module: 'parishes' },
  communities: { module: 'communities' },
  members: { roles: COORDINATION_ROLES, module: 'members' },
  events: { module: 'events' },
  'fixed-schedule': { roles: COORDINATION_ROLES, module: 'fixed-schedule' },
  schedules: { roles: COORDINATION_ROLES, module: 'schedules' },
  swaps: { module: 'swaps' },
  'clergy-messages': { module: 'clergy-messages' },
  saints: { module: 'saints' },
  'pastorals/community': { roles: COORDINATION_ROLES, module: 'pastorals' },
  'pastorals/my': { roles: ['PASTORAL_COORDINATOR'], module: 'my-pastorals' },
  'pastorals/global': { roles: ['SYSTEM_ADMIN'] },
  // Fiel/voluntário CATEQUISTA também entra: a página se limita às turmas dele
  catechesis: { roles: [...COORDINATION_ROLES, ...BASE_ROLES], module: 'catechesis' },
  planning: { roles: COORDINATION_ROLES, module: 'planning' },
  documents: { roles: COORDINATION_ROLES, module: 'documents' },
  formation: { roles: COORDINATION_ROLES, module: 'formation' },
  rooms: { roles: COORDINATION_ROLES, module: 'rooms' },
  visitation: { roles: COORDINATION_ROLES, module: 'visitation' },
  finance: { roles: COMMUNITY_MANAGEMENT_ROLES, module: 'finance' },
  'sacrament-processes': { roles: COMMUNITY_MANAGEMENT_ROLES, module: 'sacrament-processes' },
  users: { roles: COMMUNITY_MANAGEMENT_ROLES, module: 'users' },
  audit: { roles: COMMUNITY_MANAGEMENT_ROLES, module: 'audit' },
  settings: { roles: ['SYSTEM_ADMIN'] },
  map: { roles: ['SYSTEM_ADMIN'] },
  platform: { roles: ['SYSTEM_ADMIN'] },
} satisfies Record<string, AccessRule>;

export type RouteKey = keyof typeof ROUTE_ACCESS;

/** O papel (ou a coordenação de pastoral) passa na regra? Não olha a matriz de módulos. */
export function roleAllows(user: AccessUser, rule: AccessRule): boolean {
  if (!user) return false;
  if (!rule.roles) return true;
  if (rule.roles.includes(user.role ?? '')) return true;
  return !!rule.pastoralCoordination && coordinatesAnyPastoral(user);
}

/** Regra completa: papel + módulo ligado na matriz. */
export function canAccess(user: AccessUser, rule: AccessRule, modOn: (key: string) => boolean): boolean {
  return roleAllows(user, rule) && (!rule.module || modOn(rule.module));
}

/** Atalho por chave de rota (menu e links do Início). */
export function canOpen(user: AccessUser, key: RouteKey, modOn: (key: string) => boolean): boolean {
  return canAccess(user, ROUTE_ACCESS[key], modOn);
}
