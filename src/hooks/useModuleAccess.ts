import { useEffect, useState } from 'react';
import api from '../services/api';

/**
 * Matriz de módulos do SYSTEM_ADMIN (Configurações): módulos desligados por
 * papel. Fonte única do menu (AdminLayout) e das guardas de rota (App.tsx) —
 * o que some do menu também não abre pela URL.
 *
 * A última matriz do papel fica na sessão (o menu abre certo no F5) e em
 * memória por alguns minutos (as guardas de cada rota não refazem a consulta).
 */
const SESSION_KEY = 'parish:module-access:';
const MEMORY_TTL_MS = 5 * 60_000;

const memory = new Map<string, { at: number; keys: Set<string> }>();
const inflight = new Map<string, Promise<Set<string>>>();

export function readCachedDisabled(role: string | undefined): Set<string> | null {
  if (!role) return null;
  const mem = memory.get(role);
  if (mem) return mem.keys;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY + role);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

/** Módulos desligados para o papel (consulta compartilhada; falha = nada desligado). */
export function loadDisabledModules(role: string, force = false): Promise<Set<string>> {
  const mem = memory.get(role);
  if (!force && mem && Date.now() - mem.at < MEMORY_TTL_MS) return Promise.resolve(mem.keys);
  const running = inflight.get(role);
  if (running) return running;
  const request = api
    .get('/settings/module-access')
    .then((res) => {
      const keys: string[] = (res.data?.disabled ?? [])
        .filter((d: { role: string }) => d.role === role)
        .map((d: { moduleKey: string }) => d.moduleKey);
      const set = new Set(keys);
      memory.set(role, { at: Date.now(), keys: set });
      try {
        sessionStorage.setItem(SESSION_KEY + role, JSON.stringify(keys));
      } catch {
        // sessão indisponível: só perde o atalho do próximo carregamento
      }
      return set;
    })
    // Falhou a consulta: vale o último conhecido ou o menu completo do papel
    .catch(() => readCachedDisabled(role) ?? new Set<string>())
    .finally(() => inflight.delete(role));
  inflight.set(role, request);
  return request;
}

/**
 * `modOn(key)`: o módulo está ligado para o papel. SYSTEM_ADMIN sempre vê
 * tudo. Enquanto a matriz não chega (sem cache), `ready` é false e os itens
 * controlados por ela ficam escondidos (antes "piscavam").
 */
export function useModuleAccess(role: string | undefined) {
  const isSystemAdmin = role === 'SYSTEM_ADMIN';
  const [disabled, setDisabled] = useState<Set<string> | null>(() => (isSystemAdmin ? new Set() : readCachedDisabled(role)));

  useEffect(() => {
    if (!role) return;
    if (isSystemAdmin) {
      setDisabled(new Set());
      return;
    }
    let alive = true;
    setDisabled(readCachedDisabled(role));
    loadDisabledModules(role).then((set) => {
      if (alive) setDisabled(set);
    });
    return () => {
      alive = false;
    };
  }, [role, isSystemAdmin]);

  const modOn = (key: string) => isSystemAdmin || (disabled !== null && !disabled.has(key));
  return { modOn, ready: isSystemAdmin || disabled !== null };
}
