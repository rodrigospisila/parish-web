import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { avatarColor, initials } from './SaintAvatar';

/** Evento disparado após trocar/remover a foto — os avatares re-buscam. */
export const AVATAR_UPDATED_EVENT = 'parish:avatar-updated';
export const announceAvatarUpdated = () => window.dispatchEvent(new Event(AVATAR_UPDATED_EVENT));

/**
 * Avatar com a foto de perfil do usuário (busca autenticada); sem foto (404)
 * cai nas iniciais coloridas de sempre.
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
    api
      .get(`/users/${userId}/avatar`, { responseType: 'blob', params: { t: version } })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
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
