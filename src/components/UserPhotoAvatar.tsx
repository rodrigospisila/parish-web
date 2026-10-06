import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { avatarColor, initials } from './SaintAvatar';

/** Evento disparado após trocar/remover a foto — os avatares re-buscam. */
export const AVATAR_UPDATED_EVENT = 'parish:avatar-updated';
export const announceAvatarUpdated = () => window.dispatchEvent(new Event(AVATAR_UPDATED_EVENT));

/**
 * Busca compartilhada entre os avatares (achado B50). ?optional=1 faz o backend
 * responder 204 quando não há foto (o 404 sujava o console a cada avatar), e o
 * "sem foto" fica lembrado na sessão: a mesma pessoa em 20 linhas de uma lista,
 * ou em cada troca de tela, não gera 20 requisições. Fotos não ficam aqui (o
 * cache HTTP de 1 h do backend já atende) — só a busca em andamento e o "sem foto".
 */
let avatarVersion = 0;
const avatarLookups = new Map<string, Promise<Blob | null>>();

const fetchAvatar = (userId: string): Promise<Blob | null> => {
  const cached = avatarLookups.get(userId);
  if (cached) return cached;
  const lookup = api
    .get<Blob>(`/users/${userId}/avatar`, {
      responseType: 'blob',
      params: { t: avatarVersion, optional: 1 },
    })
    .then((res) => (res.status === 204 || !res.data?.size ? null : res.data))
    .catch(() => null) // 404 de backend antigo ou falha de rede: iniciais
    .then((blob) => {
      if (blob) avatarLookups.delete(userId); // só o "sem foto" fica lembrado
      return blob;
    });
  avatarLookups.set(userId, lookup);
  return lookup;
};

// Registrado no carregamento do módulo, antes dos listeners dos componentes:
// quando eles re-buscam, o cache já foi limpo e a versão (?t=) já mudou.
if (typeof window !== 'undefined') {
  window.addEventListener(AVATAR_UPDATED_EVENT, () => {
    avatarVersion += 1;
    avatarLookups.clear();
  });
}

/**
 * Avatar com a foto de perfil do usuário (busca autenticada); sem foto cai nas
 * iniciais coloridas de sempre.
 */
const UserPhotoAvatar: React.FC<{
  userId?: string | null;
  name: string;
  size?: number;
  className?: string;
}> = ({ userId, name, size = 40, className }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(AVATAR_UPDATED_EVENT, bump);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void fetchAvatar(userId).then((blob) => {
      if (cancelled) return;
      objectUrl = blob ? URL.createObjectURL(blob) : null;
      setSrc(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId, version]);

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    background: avatarColor(name),
    color: '#fff',
    fontWeight: 700,
    fontSize: size * 0.4,
  };

  return (
    <span className={className} style={style}>
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        initials(name)
      )}
    </span>
  );
};

export default UserPhotoAvatar;
