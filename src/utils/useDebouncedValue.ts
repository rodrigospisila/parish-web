import { useEffect, useState } from 'react';

/** Valor "atrasado": só muda depois de `delay` ms sem novas alterações (busca no servidor). */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Resposta paginada do servidor (GET /communities e /parishes com `page`). */
export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A resposta veio paginada? (servidor antigo ignora `page` e devolve a lista inteira) */
export function isPagedResponse<T>(data: unknown): data is PagedResponse<T> {
  return !!data && typeof data === 'object' && Array.isArray((data as PagedResponse<T>).items);
}
