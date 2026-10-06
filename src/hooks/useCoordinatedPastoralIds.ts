import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const COORDINATOR_ROLE = /^(coordinator|coordenador)/i;

type UserLike = { pastorals?: { id: string; role?: string }[] } | null | undefined;

/** Versão assíncrona (para quem já carrega dados num efeito). */
export async function loadCoordinatedPastoralIds(user: UserLike): Promise<Set<string>> {
  const byRole = (user?.pastorals ?? []).filter((p) => COORDINATOR_ROLE.test(p.role ?? '')).map((p) => p.id);
  try {
    const { data } = await api.get('/pastorals/community/coordinated-by-me');
    const current = (Array.isArray(data) ? data : [])
      .map((item: any) => item?.communityPastoral?.id ?? item?.id)
      .filter((id: unknown): id is string => typeof id === 'string');
    return new Set([...byRole, ...current]);
  } catch {
    return new Set(byRole);
  }
}

/**
 * Pastorais que o usuário COORDENA (não só participa): vínculo com papel de
 * coordenador + coordenação vigente (/pastorals/community/coordinated-by-me).
 * O backend só aceita gestão nessas — `pastoralIds` é participação.
 * Devolve null enquanto carrega.
 */
export function useCoordinatedPastoralIds(): Set<string> | null {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<string> | null>(null);

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
