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
  /** Titular da paróquia (PARISH_ADMIN) — gerencia os outros administradores paroquiais */
  parishHolder?: boolean | null;
}

interface Target {
  id: string;
  role: string;
  dioceseId?: string | null;
  parishId?: string | null;
  communityId?: string | null;
  parishHolder?: boolean | null;
}

/**
 * Titular gerenciando um PAR (eng-acessos-03; backend canHolderManage): o
 * PARISH_ADMIN titular edita, desativa, remove e gera senha provisória dos
 * outros PARISH_ADMIN NÃO titulares da mesma paróquia — nunca a si mesmo nem
 * outro titular. (Redefinir o 2FA continua exigindo papel acima.)
 */
export function isHolderPeerTarget(actor: Actor | null | undefined, target: Target): boolean {
  return (
    actor?.role === 'PARISH_ADMIN' &&
    actor.parishHolder === true &&
    !!actor.parishId &&
    target.role === 'PARISH_ADMIN' &&
    target.parishId === actor.parishId &&
    target.id !== actor.id &&
    target.parishHolder !== true
  );
}

/**
 * Mesma regra do backend (assertUserScope): fora o administrador do sistema,
 * só se gerencia quem tem papel ESTRITAMENTE abaixo do seu e está no seu
 * escopo (diocese / paróquia / comunidade) — ou, para o titular, os outros
 * administradores paroquiais não titulares da paróquia (isHolderPeerTarget).
 * Vale para editar, desativar e gerar senha provisória.
 */
export function canManageUserTarget(actor: Actor | null | undefined, target: Target): boolean {
  if (!actor?.role || !USER_MANAGER_ROLES.includes(actor.role)) return false;
  if (actor.role === 'SYSTEM_ADMIN') return true;
  if (target.id === actor.id) return false;
  if (isHolderPeerTarget(actor, target)) return true;
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
