import axios from 'axios';
import api from '../../services/api';

/**
 * Convites de equipe (contrato C2 da Onda 1) e utilidades compartilhadas pelas
 * telas de Usuários, Membros e pelas páginas públicas de convite/reivindicação.
 */

export type InviteRole = 'PARISH_ADMIN' | 'COMMUNITY_COORDINATOR' | 'PASTORAL_COORDINATOR' | 'VOLUNTEER' | 'FAITHFUL';
export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

/** Papéis que podem ser convidados, com o que cada um vê e faz (ux-web-13). */
export const INVITE_ROLE_OPTIONS: { value: InviteRole; label: string; description: string }[] = [
  {
    value: 'PARISH_ADMIN',
    label: 'Administração paroquial',
    description: 'Cuida de toda a paróquia: comunidades, equipe, membros, dízimo e financeiro.',
  },
  {
    value: 'COMMUNITY_COORDINATOR',
    label: 'Coordenação de comunidade',
    description: 'Cuida de uma comunidade: membros, pastorais, escalas e eventos dela.',
  },
  {
    value: 'PASTORAL_COORDINATOR',
    label: 'Coordenação de pastoral',
    description: 'Monta escalas e acompanha os membros das pastorais que coordena.',
  },
  {
    value: 'VOLUNTEER',
    label: 'Voluntário(a)',
    description: 'Vê as próprias escalas, confirma presença e pede trocas.',
  },
  {
    value: 'FAITHFUL',
    label: 'Fiel',
    description: 'Usa o app: horários de missa, avisos, dízimo e inscrições da família.',
  },
];

export const inviteRoleLabel = (role: string | null | undefined): string =>
  INVITE_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? String(role ?? '');

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  PENDING: 'Aguardando',
  ACCEPTED: 'Aceito',
  EXPIRED: 'Expirado',
  REVOKED: 'Revogado',
};

interface ActorLike {
  role?: string | null;
  parishHolder?: boolean | null;
}

/**
 * Papéis que quem está logado pode convidar — mesma regra do backend
 * (InvitesService.create + resolveCreationScope: papel estritamente abaixo do
 * seu). O titular da paróquia (`parishHolder`) também convida outros
 * administradores paroquiais.
 *
 * - Coordenação de PASTORAL não tem convite por link (o servidor sempre
 *   recusa): convida-se como voluntário(a) e nomeia-se a coordenação na pastoral.
 * - Convite ligado a um cadastro de membro (`memberId`) só vale para
 *   coordenação de comunidade, voluntário(a) ou fiel (MEMBER_ELIGIBLE_ROLES).
 */
export function invitableRoles(
  actor: ActorLike | null | undefined,
  opts: { forMember?: boolean } = {},
): InviteRole[] {
  let roles: InviteRole[];
  switch (actor?.role) {
    case 'SYSTEM_ADMIN':
    case 'DIOCESAN_ADMIN':
      roles = ['PARISH_ADMIN', 'COMMUNITY_COORDINATOR', 'VOLUNTEER', 'FAITHFUL'];
      break;
    case 'PARISH_ADMIN':
      roles = [...(actor.parishHolder ? (['PARISH_ADMIN'] as InviteRole[]) : []), 'COMMUNITY_COORDINATOR', 'VOLUNTEER', 'FAITHFUL'];
      break;
    case 'COMMUNITY_COORDINATOR':
      roles = ['VOLUNTEER', 'FAITHFUL'];
      break;
    default:
      roles = [];
  }
  return opts.forMember ? roles.filter((role) => MEMBER_INVITE_ROLES.includes(role)) : roles;
}

/** Papéis aceitos em convite ligado a um cadastro de membro (backend: MEMBER_ELIGIBLE_ROLES). */
export const MEMBER_INVITE_ROLES: InviteRole[] = ['COMMUNITY_COORDINATOR', 'VOLUNTEER', 'FAITHFUL'];

/** Quem pode marcar o convite de administrador como titular da paróquia. */
export const canGrantHolder = (actor: ActorLike | null | undefined): boolean =>
  actor?.role === 'SYSTEM_ADMIN' || (actor?.role === 'PARISH_ADMIN' && !!actor.parishHolder);

export interface InviteRecord {
  id: string;
  role: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  parishId?: string | null;
  communityId?: string | null;
  memberId?: string | null;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  lastSentAt?: string | null;
  createdAt?: string;
  status?: InviteStatus;
  community?: { id: string; name: string } | null;
  parish?: { id: string; name: string } | null;
  invitedBy?: { id: string; name: string } | null;
  invitedByName?: string | null;
}

export interface InviteShare {
  url: string;
  whatsappText?: string | null;
  expiresAt?: string | null;
  invite?: InviteRecord;
}

export interface CreateInviteInput {
  role: InviteRole;
  parishId?: string;
  communityId?: string;
  memberId?: string;
  name?: string;
  email?: string;
  phone?: string;
  holder?: boolean;
}

/** Situação do convite: a do servidor ou, sem ela, calculada pelas datas. */
export function inviteStatusOf(invite: InviteRecord, now = Date.now()): InviteStatus {
  if (invite.status && invite.status in INVITE_STATUS_LABEL) return invite.status;
  if (invite.revokedAt) return 'REVOKED';
  if (invite.acceptedAt) return 'ACCEPTED';
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < now) return 'EXPIRED';
  return 'PENDING';
}

export async function createInvite(input: CreateInviteInput): Promise<InviteShare> {
  const body: Record<string, unknown> = { role: input.role };
  (['parishId', 'communityId', 'memberId', 'name', 'email', 'phone'] as const).forEach((key) => {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) body[key] = value.trim();
  });
  if (input.holder) body.holder = true;
  const { data } = await api.post<InviteShare>('/invites', body);
  return data;
}

export async function listInvites(params: { parishId?: string; communityId?: string; status?: string }): Promise<InviteRecord[]> {
  const { data } = await api.get('/invites', {
    params: {
      parishId: params.parishId || undefined,
      communityId: params.communityId || undefined,
      status: params.status || undefined,
    },
  });
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export async function resendInvite(id: string): Promise<InviteShare> {
  const { data } = await api.post<InviteShare>(`/invites/${id}/resend`);
  return data;
}

export async function revokeInvite(id: string): Promise<void> {
  await api.delete(`/invites/${id}`);
}

// ===== Utilidades =====

/** Status HTTP de um erro do axios (undefined sem resposta). */
export const httpStatus = (error: unknown): number | undefined =>
  axios.isAxiosError(error) ? error.response?.status : undefined;

/** Mensagem do corpo de erro do servidor (sem fallback). */
export const serverMessage = (error: unknown): string | null => {
  if (!axios.isAxiosError(error)) return null;
  const message = error.response?.data?.message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' && message.trim() ? message : null;
};

/** Copia texto para a área de transferência; sem permissão, seleciona o campo indicado. */
export async function copyText(text: string, fallbackInputId?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const input = fallbackInputId ? (document.getElementById(fallbackInputId) as HTMLInputElement | null) : null;
    if (input) {
      input.focus();
      input.select();
      try {
        return document.execCommand?.('copy') ?? false;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** dd/mm/aaaa (fuso do navegador). */
export const shortDate = (value: string | null | undefined): string => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
};

/** dd/mm (fuso do navegador). */
export const dayMonth = (value: string | null | undefined): string => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
