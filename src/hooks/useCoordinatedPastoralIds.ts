import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const COORDINATOR_ROLE = /^(coordinator|coordenador)/i;

type UserLike =
  | { coordinatedPastoralIds?: string[]; pastorals?: { id: string; role?: string }[] }
  | null
  | undefined;

/**
 * Coordenação conhecida pela sessão, sem ir à rede: `coordinatedPastoralIds`
 * (backend novo — login, /users/me) ou, no servidor antigo, os vínculos com
 * papel de coordenador. Nunca `pastoralIds` (participação).
 */
function coordinatedFromSession(user: UserLike): string[] {
  if (Array.isArray(user?.coordinatedPastoralIds)) return user!.coordinatedPastoralIds;
  return (user?.pastorals ?? []).filter((p) => COORDINATOR_ROLE.test(p.role ?? '')).map((p) => p.id);
}

/** Versão assíncrona (para quem já carrega dados num efeito). */
export async function loadCoordinatedPastoralIds(user: UserLike): Promise<Set<string>> {
  const fromSession = coordinatedFromSession(user);
  try {
    // Coordenação vigente no banco (cobre mudanças feitas depois do login)
    const { data } = await api.get('/pastorals/community/coordinated-by-me');
    const current = (Array.isArray(data) ? data : [])
      .map((item: any) => item?.communityPastoral?.id ?? item?.id)
      .filter((id: unknown): id is string => typeof id === 'string');
    return new Set([...fromSession, ...current]);
  } catch {
    return new Set(fromSession);
  }
}

/**
 * Pastorais que o usuário COORDENA (não só participa): `coordinatedPastoralIds`
 * da sessão primeiro + coordenação vigente (/pastorals/community/coordinated-by-me).
 * O backend só aceita gestão nessas — `pastoralIds` é participação.
 * Devolve null enquanto carrega (a não ser que a sessão já traga a lista).
 */
export function useCoordinatedPastoralIds(): Set<string> | null {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<string> | null>(() =>
    Array.isArray(user?.coordinatedPastoralIds) ? new Set(user!.coordinatedPastoralIds) : null,
  );

  useEffect(() => {
    if (!user) {
      setIds(new Set());
      return;
    }
    let alive = true;
    loadCoordinatedPastoralIds(user).then((set) => {
      if (alive) setIds(set);
    });
    return () => {
      alive = false;
    };
  }, [user]);

  return ids;
}
