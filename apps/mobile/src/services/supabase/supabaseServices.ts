import type { PromoRedeemResult, ServiceRegistry } from '@/services/ports';
import { getPathFromRef, parseDeepLink } from '@/lib/deepLinking/deepLinkService';
import { isValidIanaTimeZone } from '@/lib/userTimeZone';
import { weekMetaFromMondayYmd } from '@/features/weeklyRecap/recapCandidateFilter';
import { isSupabaseConfigured, supabaseClient } from '@/services/supabase/client';
import { loadProfileRow, requireClient, toSession } from '@/services/supabase/helpers';
import * as backend from '@/services/supabase/supabaseBackend';
import type { Session } from '@/types/domain';

const FOLLOW_UP_SUGGESTIONS = [
  'What was going through your mind in that moment?',
  'I love that you shared this—what do you want to do more of together?',
  'Should we make this a new little tradition for us?',
];

function suggestFollowUpsRotated(input: {
  imageUri: string;
  promptQuestion: string;
  partnerName?: string;
}): string[] {
  void input.partnerName;
  const n = (input.imageUri.length + input.promptQuestion.length) % FOLLOW_UP_SUGGESTIONS.length;
  return [0, 1, 2].map((i) => FOLLOW_UP_SUGGESTIONS[(n + i) % FOLLOW_UP_SUGGESTIONS.length]);
}

async function refreshSession(): Promise<Session> {
  const sb = requireClient();
  const { data: sessionData, error: sessErr } = await sb.auth.getSession();
  if (sessErr || !sessionData.session?.user) {
    throw new Error(sessErr?.message ?? 'Not signed in');
  }
  const user = sessionData.session.user;
  const profile = await loadProfileRow(user.id);
  return await toSession(user, profile);
}

export const supabaseServices: ServiceRegistry = {
  auth: {
    async getSession() {
      if (!isSupabaseConfigured || !supabaseClient) return null;
      const { data, error } = await supabaseClient.auth.getSession();
      if (error || !data.session?.user) {
        return null;
      }
      const profile = await loadProfileRow(data.session.user.id);
      return await toSession(data.session.user, profile);
    },
    async signIn({ email, password }) {
      const sb = requireClient();
      const trimmed = email.trim();
      if (!trimmed || !password) {
        throw new Error('Email and password are required');
      }
      const { data, error } = await sb.auth.signInWithPassword({ email: trimmed, password });
      if (error || !data.user) {
        const msg = error?.message ?? 'Sign in failed';
        if (/email not confirmed|confirm your email/i.test(msg)) {
          throw new Error('Please confirm your email before signing in.');
        }
        throw new Error(msg);
      }
      const profile = await loadProfileRow(data.user.id);
      return await toSession(data.user, profile);
    },
    async signUp({ email, password, firstName }) {
      const sb = requireClient();
      const trimmed = email.trim();
      if (!trimmed || !password) {
        throw new Error('Email and password are required');
      }
      if (!firstName?.trim()) {
        throw new Error('First name is required');
      }
      const { data, error } = await sb.auth.signUp({
        email: trimmed,
        password,
        options: { data: { first_name: firstName.trim() } },
      });
      if (error || !data.user) {
        const raw = error?.message ?? 'Sign up failed';
        if (/email rate limit exceeded|rate limit.*email/i.test(raw)) {
          throw new Error(
            'Too many signup emails were sent from this project recently. Wait an hour and try again, or set up custom SMTP in the Supabase dashboard (Authentication → Emails).',
          );
        }
        throw new Error(raw);
      }
      if (!data.session) {
        throw new Error(
          'Check your email to confirm your account, then sign in. You are not signed in yet.',
        );
      }
      const profile = await loadProfileRow(data.user.id);
      return await toSession(data.user, profile);
    },
    async updateProfile(partial) {
      const sb = requireClient();
      const { data: userData } = await sb.auth.getUser();
      const user = userData.user;
      if (!user) {
        throw new Error('Not signed in');
      }
      const patch: { first_name?: string; display_name?: string | null; time_zone?: string | null } = {};
      if (partial.firstName !== undefined) {
        patch.first_name = partial.firstName.trim();
      }
      if (partial.displayName !== undefined) {
        const d = partial.displayName.trim();
        patch.display_name = d.length ? d : null;
      }
      if (partial.timeZone !== undefined) {
        const z = partial.timeZone?.trim();
        if (z && z.length) {
          if (!isValidIanaTimeZone(z)) {
            throw new Error('Choose a valid time zone.');
          }
          patch.time_zone = z;
        } else {
          patch.time_zone = null;
        }
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await sb.from('profiles').update(patch).eq('id', user.id);
        if (error) {
          throw new Error(error.message);
        }
      }
      return refreshSession();
    },
    async uploadProfilePhoto(localUri: string, contentType?: string) {
      const sb = requireClient();
      const { data: userData } = await sb.auth.getUser();
      const user = userData.user;
      if (!user) {
        throw new Error('Not signed in');
      }
      const res = await fetch(localUri);
      if (!res.ok) {
        throw new Error('Could not read image');
      }
      const buf = await res.arrayBuffer();
      const lower = localUri.toLowerCase();
      const mime =
        contentType ??
        (lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await sb.storage.from('avatars').upload(path, buf, {
        contentType: mime,
        upsert: true,
      });
      if (upErr) {
        throw new Error(upErr.message);
      }
      const { error: patchErr } = await sb
        .from('profiles')
        .update({ avatar_storage_path: path })
        .eq('id', user.id);
      if (patchErr) {
        throw new Error(patchErr.message);
      }
      return refreshSession();
    },
    async signOut() {
      const sb = requireClient();
      const { error } = await sb.auth.signOut();
      if (error) {
        throw new Error(error.message);
      }
    },
  },
  couple: {
    getCouple: () => backend.loadCompleteCoupleProfile(),
    createInviteLink: () => backend.createInviteLinkRpc(),
    acceptInvite: (token) => backend.acceptInviteWithEdge(token),
    updateReunionDates: (input) => backend.updateReunionDates(input),
  },
  prompt: {
    getTodayPrompt: () => backend.getTodayPrompt(),
    getPromptById: (id) => backend.getPromptById(id),
    submitPromptAnswer: (promptId, input) => backend.submitPromptAnswer(promptId, input),
    reactToPrompt: (promptId, emoji) => backend.reactToPrompt(promptId, emoji),
    getHomeEngagementStreak: (anchor, tz) => backend.getHomeEngagementStreak(anchor, tz),
  },
  threadInteraction: {
    getThreadActivity: (promptId) => backend.getThreadActivity(promptId),
    addThreadReply: (input) => backend.addThreadReply(input),
    reactToThreadReply: (input) => backend.reactToThreadReply(input),
  },
  presence: {
    getLatestPosts: () => backend.getLatestPosts(),
    sharePost: (input) => backend.sharePost(input),
    reactToPost: (postId) => backend.reactToPost(postId),
  },
  habits: {
    getHabitsForMonth: (monthKey) => backend.getHabitsForMonth(monthKey),
    getHabitById: (habitId) => backend.getHabitById(habitId),
    toggleHabitCompletion: (habitId, date) => backend.toggleHabitCompletion(habitId, date),
  },
  rituals: {
    logRitualSignal: (kind, body) => backend.logRitualSignal(kind, body),
    listRecentRitualSignals: (limit) => backend.listRecentRitualSignals(limit),
  },
  timeline: {
    listMemories: (filter) => backend.listMemories(filter),
    getMemoryById: (id) => backend.getMemoryById(id),
    setMemoryFavorite: (id, fav) => backend.setMemoryFavorite(id, fav),
  },
  followUpSuggestions: {
    suggestForReceivedPhoto: async (input) => suggestFollowUpsRotated(input),
  },
  notificationPrefs: {
    getPreferences: () => backend.getPreferences(),
    updatePreferences: (prefs) => backend.updatePreferences(prefs),
  },
  notificationInbox: {
    listInbox: (limit) => backend.listInbox(limit),
    markRead: (ids) => backend.markRead(ids),
    markAllRead: () => backend.markAllRead(),
  },
  pushTokens: {
    upsertExpoPushToken: (token, platform) => backend.upsertExpoPushToken(token, platform),
  },
  userSettings: {
    getPrivacy: () => backend.getPrivacy(),
    updatePrivacy: (partial) => backend.updatePrivacy(partial),
    getAppLock: () => backend.getAppLock(),
    updateAppLock: (partial) => backend.updateAppLock(partial),
  },
  deepLinks: {
    parseUrl: parseDeepLink,
    toPath: getPathFromRef,
  },
  relationshipDashboard: {
    getSnapshot: () => backend.getRelationshipDashboardSnapshot(),
  },
  subscription: {
    async getSubscription() {
      const sb = requireClient();
      const { data: userData } = await sb.auth.getUser();
      const user = userData.user;
      if (!user) {
        return { tier: 'free' as const, renewsAtIso: null, source: 'store' as const };
      }
      const row = await loadProfileRow(user.id);
      const tier = row?.subscription_tier === 'premium' ? ('premium' as const) : ('free' as const);
      return { tier, renewsAtIso: null, source: 'store' as const };
    },
    async redeemPromoCode(code: string): Promise<PromoRedeemResult> {
      const sb = requireClient();
      const { data, error } = await sb.rpc('redeem_plus_promo', { p_code: code });
      if (error) {
        throw new Error(error.message);
      }
      const row = data as { ok?: boolean; error?: string } | null;
      if (!row || typeof row.ok !== 'boolean') {
        throw new Error('Unexpected redeem response');
      }
      if (row.ok) {
        return { ok: true };
      }
      if (row.error === 'invalid_code' || row.error === 'couple_required') {
        return { ok: false, error: row.error };
      }
      return { ok: false, error: 'invalid_code' };
    },
  },
  weeklyRecap: {
    listPhotoCandidatesForWeek: (anchorIso) => backend.listPhotoCandidatesForWeek(anchorIso),
    async buildRecapDraft({ weekStartYmd, selectedPhotoIds }) {
      const uniq = [...new Set(selectedPhotoIds)].slice(0, 5);
      if (uniq.length === 0) {
        throw new Error('Pick at least one photo for your recap.');
      }
      const week = weekMetaFromMondayYmd(weekStartYmd);
      const pool = await backend.getLatestPosts();
      const byId = new Map(pool.map((p) => [p.id, p]));
      const selectedPhotos = uniq.map((id) => {
        const p = byId.get(id);
        if (!p) {
          throw new Error(`Unknown photo: ${id}`);
        }
        return p;
      });
      return {
        week,
        selectedPhotos,
        bestQuestion: { status: 'placeholder' as const },
        bestMoment: { status: 'placeholder' as const },
      };
    },
  },
};
