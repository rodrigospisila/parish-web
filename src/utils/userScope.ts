/**
 * Comunidade de ESCOPO do usuário logado. O backend novo devolve em
 * `communityId` a comunidade de fé do gestor (só exibição) e o escopo real em
 * `scopeCommunityId`; no servidor antigo o campo não vem e vale `communityId`.
 */
export function scopeCommunityIdOf(
  user: { communityId?: string | null; scopeCommunityId?: string | null } | null | undefined,
): string | undefined {
  if (!user) return undefined;
  if (user.scopeCommunityId !== undefined) return user.scopeCommunityId ?? undefined;
  return user.communityId ?? undefined;
}
