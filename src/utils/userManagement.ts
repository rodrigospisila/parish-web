import { scopeCommunityIdOf } from './userScope';

/** Hierarquia de papéis (1 = mais alto) — mesma ordem do backend. */
export const ROLE_LEVELS: Record<string, number> = {
  SYSTEM_ADMIN: 1,
  DIOCESAN_ADMIN: 2,
  PARISH_ADMIN: 3,
  COMMUNITY_COORDINATOR: 4,
  PASTORAL_COORDINATOR: 5,
  VOLUNTEER: 6,
  FAITHFUL: 7,
};

/** Papéis que gerenciam contas (GET/PATCH /users, reset de senha). */
export const USER_MANAGER_ROLES = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'];

interface Actor {
  id?: string;
  role?: string | null;
  dioceseId?: string | null;
  parishId?: string | null;
  communityId?: string | null;
  scopeCommunityId?: string | null;
}

interface Target {
  id: string;
  role: string;
  dioceseId?: string | null;
  parishId?: string | null;
  communityId?: string | null;
}

/**
 * Mesma regra do backend (assertUserScope): fora o administrador do sistema,
 * só se gerencia quem tem papel ESTRITAMENTE abaixo do seu e está no seu
 * escopo (diocese / paróquia / comunidade). Vale para editar, desativar,
 * redefinir 2FA e gerar senha provisória.
 */
export function canManageUserTarget(actor: Actor | null | undefined, target: Target): boolean {
  if (!actor?.role || !USER_MANAGER_ROLES.includes(actor.role)) return false;
  if (actor.role === 'SYSTEM_ADMIN') return true;
  if (target.id === actor.id) return false;
  const actorLevel = ROLE_LEVELS[actor.role];
  const targetLevel = ROLE_LEVELS[target.role];
  if (actorLevel === undefined || targetLevel === undefined || targetLevel <= actorLevel) return false;
  switch (actor.role) {
    case 'DIOCESAN_ADMIN':
      return !!actor.dioceseId && target.dioceseId === actor.dioceseId;
    case 'PARISH_ADMIN':
      return !!actor.parishId && target.parishId === actor.parishId;
    case 'COMMUNITY_COORDINATOR': {
      const scopeCommunityId = scopeCommunityIdOf(actor);
      return !!scopeCommunityId && target.communityId === scopeCommunityId;
    }
    default:
      return false;
  }
}

/**
 * Senha provisória: nunca para a própria conta — nem o administrador do
 * sistema (o reset encerra todas as sessões, inclusive a aberta). Para a
 * própria senha: tela de Segurança.
 */
export function canIssueTempPassword(actor: Actor | null | undefined, target: Target): boolean {
  if (!actor?.id || target.id === actor.id) return false;
  return canManageUserTarget(actor, target);
}
