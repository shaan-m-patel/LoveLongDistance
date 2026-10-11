import type { User } from '@supabase/supabase-js';
import type { Session, UserProfile } from '@/types/domain';
import type { Tables } from '@/services/supabase/database.types';
import { isSupabaseConfigured, supabaseClient } from '@/services/supabase/client';

export async function loadProfileRow(userId: string): Promise<Tables<'profiles'> | null> {
  const sb = requireClient();
  const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data;
}

export function requireClient() {
  if (!supabaseClient) {
    throw new Error('Supabase client is not configured.');
  }
  return supabaseClient;
}

export async function signedAvatarUrl(path: string | null | undefined): Promise<string | undefined> {
  if (!path || !isSupabaseConfigured || !supabaseClient) {
    return undefined;
  }
  const signed = await trySignedUrlForBucketPath('avatars', path);
  return signed ?? undefined;
}

export async function mapUserProfile(user: User, row: Tables<'profiles'> | null): Promise<UserProfile> {
  const fromMeta = user.user_metadata as Record<string, unknown> | undefined;
  const metaFirst =
    typeof fromMeta?.first_name === 'string' ? fromMeta.first_name : undefined;
  return {
    id: user.id,
    firstName: row?.first_name?.trim() || metaFirst?.trim() || 'You',
    email: user.email ?? undefined,
    displayName: row?.display_name ?? (typeof fromMeta?.display_name === 'string' ? fromMeta.display_name : undefined),
    avatarUrl: await signedAvatarUrl(row?.avatar_storage_path ?? undefined),
    timeZone: row?.time_zone ?? null,
  };
}

export async function toSession(user: User, row: Tables<'profiles'> | null): Promise<Session> {
  return {
    user: await mapUserProfile(user, row),
    signedInAt: user.last_sign_in_at ?? new Date().toISOString(),
  };
}

export async function signedUrlForBucketPath(
  bucket: 'presence' | 'prompt_attachments' | 'avatars',
  path: string,
  expiresIn = 3600,
): Promise<string> {
  const sb = requireClient();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'Failed to create signed URL.');
  }
  return data.signedUrl;
}

/** Signed URL for one object. A missing or unreadable object returns null. */
export async function trySignedUrlForBucketPath(
  bucket: 'presence' | 'prompt_attachments' | 'avatars',
  path: string,
  expiresIn = 3600,
): Promise<string | null> {
  try {
    const sb = requireClient();
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      return null;
    }
    return data.signedUrl;
  } catch {
    return null;
  }
}

export function mapInviteFailure(code: string): string {
  const m: Record<string, string> = {
    missing_authorization: 'Sign in again, then retry the invite.',
    invalid_session: 'Sign in again, then retry the invite.',
    token_required: 'Add an invite code or open the full link your partner sent.',
    invite_not_found: 'This invite is not valid. Double-check the code or ask for a new link.',
    invite_already_used: 'This invite was already used.',
    invite_expired: 'This invite has expired. Ask your partner to send a new one.',
    cannot_accept_own_invite: 'Open this link on your partner’s device to finish pairing.',
    already_paired: 'You are already paired with someone.',
    already_member: 'You are already part of this couple.',
    couple_full: 'This invite was already used.',
    membership_failed: 'Could not join this couple. Try again or request a new invite.',
    couple_update_failed: 'Could not finish pairing. Try again.',
    members_load_failed: 'Could not load couple after pairing.',
    partner_not_found: 'Could not load partner profile.',
    internal_error: 'Something went wrong. Try again in a moment.',
  };
  return m[code] ?? 'Could not accept invite.';
}

export function todayYmdUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
