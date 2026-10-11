import type { ServiceRegistry } from '@/services/ports';
import type {
  NotificationInboxItem,
  PresencePost,
  RitualSignalEntry,
  Session,
  SubscriptionTier,
  TimelineMemoryFilter,
  UserProfile,
} from '@/types/domain';
import {
  cloneThreadActivity,
  initialAppLock,
  initialPresencePosts,
  initialPrefs,
  initialSubscription,
  initialPrivacy,
  initialNotificationInbox,
  initialRitualSignals,
  mockDb,
  mockRelationshipDashboardSnapshot,
  mockMe,
  mockPartner,
  refreshRevealState,
  resetThreadActivityToInitial,
  upsertPromptPhotoFusionMemory,
} from '@/services/mock/mockData';
import {
  addUtcDays,
  computeEngagementStreakDays,
  graceUtcYmdsInInclusiveWindow,
  mergeSatisfiedUtcYmds,
  mutualPresenceUtcYmds,
} from '@/features/home/homeEngagementStreak';
import { getPathFromRef, parseDeepLink } from '@/lib/deepLinking/deepLinkService';
import { addLocalDays, formatYmdLocal } from '@/lib/calendarDates';
import {
  reunionEndOfDayIsoFromYmdInZone,
  reunionIsoFromYmdInZone,
} from '@/features/rituals/ritualTimePresentation';
import { resolveUserTimeZone } from '@/lib/userTimeZone';
import { isUserAllowedToToggleHabit } from '@/features/habits/habitPolicy';
import {
  filterPresencePostsInWeek,
  weekMetaFromMondayYmd,
} from '@/features/weeklyRecap/recapCandidateFilter';

async function withLatency<T>(result: T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return result;
}

/** Recap week filter sees fixture posts even if `mockDb.posts` was replaced during dev. */
function recapPostPool(): PresencePost[] {
  const m = new Map<string, PresencePost>();
  for (const p of initialPresencePosts) {
    m.set(p.id, p);
  }
  for (const p of mockDb.posts) {
    m.set(p.id, p);
  }
  return [...m.values()];
}

function userIdFromEmail(email: string): string {
  const slug = email
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `u-${slug || 'user'}`;
}

function buildUserFromInput(email: string, firstName: string, displayName?: string): UserProfile {
  return {
    id: userIdFromEmail(email),
    firstName: firstName.trim() || 'You',
    email: email.toLowerCase().trim(),
    displayName: displayName?.trim() || undefined,
  };
}

function buildSessionFromUser(user: UserProfile): Session {
  return { user, signedInAt: new Date().toISOString() };
}

/** Matches tokens produced by createInviteLink (also accepted on a fresh mock DB for two-device testing). */
function isMockStyleInviteToken(token: string): boolean {
  return /^inv-[a-z0-9]+-[a-z0-9]+$/i.test(token) && token.length >= 8;
}

const FOLLOW_UP_SUGGESTIONS = [
  'What was going through your mind in that moment?',
  'I love that you shared this—what do you want to do more of together?',
  'Should we make this a new little tradition for us?',
];

function suggestFollowUpsRotated(
  input: { imageUri: string; promptQuestion: string; partnerName?: string },
): string[] {
  const n = (input.imageUri.length + input.promptQuestion.length) % FOLLOW_UP_SUGGESTIONS.length;
  return [0, 1, 2].map((i) => FOLLOW_UP_SUGGESTIONS[(n + i) % FOLLOW_UP_SUGGESTIONS.length]);
}

export const mockServices: ServiceRegistry = {
  auth: {
    async getSession() {
      return withLatency(mockDb.session);
    },
    async signIn({ email, password }) {
      const trimmed = email.trim();
      if (!trimmed || !password) {
        throw new Error('Email and password are required');
      }
      const user = buildUserFromInput(trimmed, 'You');
      mockDb.session = buildSessionFromUser(user);
      return withLatency(mockDb.session);
    },
    async signUp({ email, password, firstName }) {
      const trimmed = email.trim();
      if (!trimmed || !password) {
        throw new Error('Email and password are required');
      }
      if (!firstName?.trim()) {
        throw new Error('First name is required');
      }
      const user = buildUserFromInput(trimmed, firstName.trim());
      mockDb.session = buildSessionFromUser(user);
      return withLatency(mockDb.session);
    },
    async updateProfile(partial) {
      if (!mockDb.session) {
        throw new Error('Not signed in');
      }
      const u = mockDb.session.user;
      const nextTz =
        partial.timeZone !== undefined
          ? partial.timeZone != null && partial.timeZone.trim().length > 0
            ? partial.timeZone.trim()
            : null
          : u.timeZone;
      mockDb.session = {
        ...mockDb.session,
        user: {
          ...u,
          firstName: partial.firstName?.trim() ?? u.firstName,
          displayName: partial.displayName?.trim() ?? u.displayName,
          timeZone: nextTz,
        },
        signedInAt: mockDb.session.signedInAt,
      };
      return withLatency(mockDb.session);
    },
    async uploadProfilePhoto(localUri: string) {
      if (!mockDb.session) {
        throw new Error('Not signed in');
      }
      const u = mockDb.session.user;
      mockDb.session = {
        ...mockDb.session,
        user: { ...u, avatarUrl: localUri },
        signedInAt: mockDb.session.signedInAt,
      };
      return withLatency(mockDb.session);
    },
    async signOut() {
      mockDb.session = null;
      mockDb.couple = null;
      mockDb.invite = { issuedToken: null, redeemedTokens: [] };
      mockDb.prefs = { ...initialPrefs };
      mockDb.privacy = { ...initialPrivacy };
      mockDb.appLock = { ...initialAppLock };
      resetThreadActivityToInitial();
      mockDb.ritualSignals = [...initialRitualSignals];
      mockDb.notificationInbox = initialNotificationInbox.map((n) => ({ ...n }));
      mockDb.subscription = { ...initialSubscription };
      return withLatency(undefined);
    },
  },
  couple: {
    async getCouple() {
      return withLatency(mockDb.couple);
    },
    async createInviteLink() {
      if (mockDb.couple) {
        throw new Error(
          'You are already linked with a partner. Use another account to test a fresh invite, or sign out to reset mock state.',
        );
      }
      const token = `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      mockDb.invite.issuedToken = token;
      const path = `invite/${token}`;
      return withLatency(`lovedistance://${path}`);
    },
    async acceptInvite(token) {
      const normalized = token.trim();
      if (!normalized) {
        throw new Error('Add an invite code or open the full link your partner sent.');
      }
      if (mockDb.couple) {
        throw new Error('You are already paired with someone.');
      }
      if (normalized === 'invalid') {
        throw new Error('This invite is not valid. Double-check the code or ask for a new link.');
      }
      if (normalized === 'expired') {
        throw new Error('This invite has expired. Ask your partner to send a new one.');
      }
      if (normalized === 'used') {
        throw new Error('This invite was already used.');
      }
      if (mockDb.invite.redeemedTokens.includes(normalized)) {
        throw new Error('This invite was already used.');
      }
      const matchesThisDevice = Boolean(
        mockDb.invite.issuedToken && normalized === mockDb.invite.issuedToken,
      );
      const validShape = isMockStyleInviteToken(normalized);
      if (!matchesThisDevice && !validShape) {
        throw new Error('This invite is not valid. Double-check the code or request a new link.');
      }

      mockDb.invite.redeemedTokens.push(normalized);
      if (matchesThisDevice) {
        mockDb.invite.issuedToken = null;
      }

      const startAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 42);
      const startCal = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate());
      const endCal = addLocalDays(startCal, 6);
      const tz = resolveUserTimeZone(mockDb.session?.user.timeZone);
      const startYmd = formatYmdLocal(startCal);
      const endYmd = formatYmdLocal(endCal);
      mockDb.couple = {
        id: `couple-${normalized}`,
        meId: mockDb.session?.user.id ?? mockMe.id,
        partner: mockPartner,
        reunionDate: reunionIsoFromYmdInZone(startYmd, tz),
        reunionEndDate: reunionEndOfDayIsoFromYmdInZone(endYmd, tz),
      };
      return withLatency({ ...mockDb.couple });
    },
    async updateReunionDates(input) {
      if (!mockDb.couple) {
        throw new Error('Complete pairing first to use this feature.');
      }
      const reunionDate = input.reunionDate ?? undefined;
      const reunionEndDate =
        reunionDate != null ? (input.reunionEndDate ?? undefined) : undefined;
      mockDb.couple = {
        ...mockDb.couple,
        reunionDate,
        reunionEndDate,
      };
      return withLatency({ ...mockDb.couple });
    },
  },
  prompt: {
    async getTodayPrompt() {
      return withLatency({ ...mockDb.prompt });
    },
    async getPromptById(promptId: string) {
      if (promptId !== mockDb.prompt.promptId) {
        return withLatency(null);
      }
      return withLatency({ ...mockDb.prompt });
    },
    async submitPromptAnswer(promptId, input) {
      const text = input.answer.trim();
      const userId = mockDb.session?.user.id ?? mockMe.id;
      const existing = mockDb.prompt.answers.find((item) => item.userId === userId);
      if (existing) {
        existing.answer = text;
        if (input.imageUri) {
          existing.imageUri = input.imageUri;
        } else {
          delete existing.imageUri;
        }
      } else {
        const row: (typeof mockDb.prompt.answers)[number] = {
          userId,
          answer: text,
          submittedAt: new Date().toISOString(),
        };
        if (input.imageUri) {
          row.imageUri = input.imageUri;
        }
        mockDb.prompt.answers.push(row);
      }
      refreshRevealState();
      upsertPromptPhotoFusionMemory();
      if (promptId !== mockDb.prompt.promptId) {
        throw new Error('Prompt id mismatch in mock service.');
      }
      return withLatency({ ...mockDb.prompt });
    },
    async reactToPrompt(promptId, emoji) {
      mockDb.prompt.reactions.push({
        id: `reaction-${Date.now()}`,
        userId: mockDb.session?.user.id ?? mockMe.id,
        emoji,
      });
      if (promptId !== mockDb.prompt.promptId) {
        throw new Error('Prompt id mismatch in mock service.');
      }
      return withLatency({ ...mockDb.prompt });
    },
    async getHomeEngagementStreak(anchorPromptDateYmd, homeTimeZone) {
      if (!mockDb.couple) {
        throw new Error('Complete pairing first to use this feature.');
      }
      const minYmd = addUtcDays(anchorPromptDateYmd, -400);
      const meId = mockDb.couple.meId;
      const partnerId = mockDb.couple.partner.id;
      const revealedPromptDates =
        mockDb.prompt.isRevealed && mockDb.prompt.date >= minYmd && mockDb.prompt.date <= anchorPromptDateYmd
          ? [mockDb.prompt.date]
          : [];
      const mutualPresenceDates = mutualPresenceUtcYmds(
        mockDb.posts.map((p) => ({ authorId: p.authorId, createdAt: p.createdAt })),
        meId,
        partnerId,
      );
      const graceUtcYmds = graceUtcYmdsInInclusiveWindow(
        minYmd,
        anchorPromptDateYmd,
        mockDb.couple.reunionDate,
        mockDb.couple.reunionEndDate,
        homeTimeZone,
      );
      const satisfied = mergeSatisfiedUtcYmds({
        revealedPromptDates,
        mutualPresenceDates,
        graceUtcYmds,
      });
      const n = computeEngagementStreakDays(anchorPromptDateYmd, satisfied);
      return withLatency(n);
    },
  },
  threadInteraction: {
    async getThreadActivity(promptId: string) {
      if (promptId !== mockDb.prompt.promptId) {
        return withLatency(null);
      }
      return withLatency(cloneThreadActivity(mockDb.threadActivity));
    },
    async addThreadReply({ promptId, body, parentReplyId = null }) {
      if (promptId !== mockDb.prompt.promptId) {
        throw new Error('Unknown prompt for thread activity.');
      }
      const text = body.trim();
      if (!text) {
        throw new Error('Message cannot be empty.');
      }
      if (parentReplyId) {
        const parent = mockDb.threadActivity.replies.find((r) => r.id === parentReplyId);
        if (!parent) {
          throw new Error('Parent reply not found.');
        }
      }
      const id = `reply-${Date.now()}`;
      const authorId = mockDb.session?.user.id ?? mockMe.id;
      const next: (typeof mockDb.threadActivity.replies)[number] = {
        id,
        promptId,
        parentReplyId: parentReplyId ?? null,
        authorId,
        body: text,
        createdAt: new Date().toISOString(),
        reactions: [],
      };
      mockDb.threadActivity = {
        ...mockDb.threadActivity,
        replies: [...mockDb.threadActivity.replies, next],
      };
      return withLatency(cloneThreadActivity(mockDb.threadActivity));
    },
    async reactToThreadReply({ promptId, replyId, emoji }) {
      if (promptId !== mockDb.prompt.promptId) {
        throw new Error('Unknown prompt for thread activity.');
      }
      const reply = mockDb.threadActivity.replies.find((r) => r.id === replyId);
      if (!reply) {
        throw new Error('Reply not found.');
      }
      const userId = mockDb.session?.user.id ?? mockMe.id;
      const nextReaction: (typeof reply.reactions)[number] = {
        id: `rr-${Date.now()}`,
        userId,
        emoji,
      };
      const replies = mockDb.threadActivity.replies.map((r) => {
        if (r.id !== replyId) {
          return r;
        }
        return { ...r, reactions: [...r.reactions, nextReaction] };
      });
      mockDb.threadActivity = { ...mockDb.threadActivity, replies };
      return withLatency(cloneThreadActivity(mockDb.threadActivity));
    },
  },
  presence: {
    async getLatestPosts() {
      const sorted = [...mockDb.posts].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return withLatency(sorted);
    },
    async sharePost(input) {
      const caption = input.caption?.trim() || undefined;
      const mood = input.mood?.trim() || undefined;
      const locationLabel = input.locationLabel?.trim() || undefined;
      const post = {
        id: `photo-${Date.now()}`,
        authorId: mockDb.session?.user.id ?? mockMe.id,
        imageUri: input.imageUri,
        caption,
        mood,
        locationLabel,
        createdAt: new Date().toISOString(),
        reactionCount: 0,
      };
      mockDb.posts = [post, ...mockDb.posts];
      return withLatency(post);
    },
    async reactToPost(postId) {
      mockDb.posts = mockDb.posts.map((post) =>
        post.id === postId ? { ...post, reactionCount: post.reactionCount + 1 } : post,
      );
      return withLatency(undefined);
    },
  },
  habits: {
    async getHabitsForMonth(monthKey) {
      void monthKey;
      return withLatency([...mockDb.habits]);
    },
    async getHabitById(habitId) {
      const found = mockDb.habits.find((h) => h.id === habitId) ?? null;
      return withLatency(found);
    },
    async toggleHabitCompletion(habitId, date) {
      const meId = mockDb.couple?.meId ?? mockMe.id;
      const partnerId = mockDb.couple?.partner.id ?? mockPartner.id;
      const actor = mockDb.session?.user.id ?? mockMe.id;
      const habit = mockDb.habits.find((h) => h.id === habitId);
      if (!habit) {
        throw new Error('Habit not found.');
      }
      if (!isUserAllowedToToggleHabit(habit, actor, { meId, partnerId })) {
        throw new Error('This habit is for your partner; only they can check it off in this mock.');
      }
      mockDb.habits = mockDb.habits.map((h) => {
        if (h.id !== habitId) {
          return h;
        }
        const current = h.completionsByDate[date] ?? [];
        const next = current.includes(actor)
          ? current.filter((id) => id !== actor)
          : [...current, actor];
        const allowed = new Set(
          h.type === 'mine' ? [meId] : h.type === 'yours' ? [partnerId] : [meId, partnerId],
        );
        const cleaned = next.filter((id) => allowed.has(id));
        return {
          ...h,
          completionsByDate: { ...h.completionsByDate, [date]: cleaned },
        };
      });
      return withLatency([...mockDb.habits]);
    },
  },
  rituals: {
    async logRitualSignal(kind, body) {
      const text = body.trim();
      if (!text) {
        throw new Error('Message cannot be empty.');
      }
      if (!mockDb.session) {
        throw new Error('Not signed in');
      }
      const authorId = mockDb.session.user.id;
      const entry: RitualSignalEntry = {
        id: `ritual-${Date.now()}`,
        kind,
        body: text,
        authorId,
        createdAt: new Date().toISOString(),
      };
      mockDb.ritualSignals = [entry, ...mockDb.ritualSignals];
      return withLatency([...mockDb.ritualSignals]);
    },
    async listRecentRitualSignals(limit) {
      const n = Math.max(0, Math.min(50, limit));
      return withLatency(mockDb.ritualSignals.slice(0, n));
    },
  },
  timeline: {
    async listMemories(filter: TimelineMemoryFilter = 'all') {
      const base =
        filter === 'all'
          ? mockDb.memories
          : filter === 'favorites'
            ? mockDb.memories.filter((item) => item.isFavorite)
            : mockDb.memories.filter((item) => item.type === filter);
      const sorted = [...base].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return withLatency(sorted);
    },
    async getMemoryById(memoryId) {
      const found = mockDb.memories.find((item) => item.id === memoryId) ?? null;
      return withLatency(found);
    },
    async setMemoryFavorite(memoryId, isFavorite) {
      const i = mockDb.memories.findIndex((m) => m.id === memoryId);
      if (i < 0) {
        return Promise.reject(new Error(`Memory not found: ${memoryId}`));
      }
      const next = { ...mockDb.memories[i], isFavorite };
      mockDb.memories = [...mockDb.memories.slice(0, i), next, ...mockDb.memories.slice(i + 1)];
      return withLatency(next);
    },
  },
  followUpSuggestions: {
    async suggestForReceivedPhoto(input) {
      return withLatency(suggestFollowUpsRotated(input));
    },
  },
  notificationPrefs: {
    async getPreferences() {
      return withLatency({ ...mockDb.prefs });
    },
    async updatePreferences(prefs) {
      mockDb.prefs = {
        ...mockDb.prefs,
        ...prefs,
      };
      return withLatency({ ...mockDb.prefs });
    },
  },
  notificationInbox: {
    async listInbox(limit = 50) {
      const sorted = [...mockDb.notificationInbox].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const n = Math.max(1, Math.min(100, limit));
      return withLatency(sorted.slice(0, n).map((x) => ({ ...x })));
    },
    async markRead(ids) {
      const idSet = new Set(ids);
      mockDb.notificationInbox = mockDb.notificationInbox.map((row): NotificationInboxItem =>
        idSet.has(row.id) ? { ...row, read: true } : row,
      );
      return withLatency(mockDb.notificationInbox.map((x) => ({ ...x })));
    },
    async markAllRead() {
      mockDb.notificationInbox = mockDb.notificationInbox.map(
        (row): NotificationInboxItem => ({ ...row, read: true }),
      );
      return withLatency(mockDb.notificationInbox.map((x) => ({ ...x })));
    },
  },
  pushTokens: {
    async upsertExpoPushToken() {
      return withLatency(undefined);
    },
  },
  userSettings: {
    async getPrivacy() {
      return withLatency({ ...mockDb.privacy });
    },
    async updatePrivacy(partial) {
      mockDb.privacy = {
        ...mockDb.privacy,
        ...partial,
      };
      return withLatency({ ...mockDb.privacy });
    },
    async getAppLock() {
      return withLatency({ ...mockDb.appLock });
    },
    async updateAppLock(partial) {
      const next: typeof mockDb.appLock = {
        ...mockDb.appLock,
        ...partial,
      };
      if (next.requirePasscode && !mockDb.appLock.isPasscodeSet) {
        next.isPasscodeSet = true;
      }
      if (!next.requirePasscode) {
        next.isPasscodeSet = false;
        next.useBiometric = false;
      }
      mockDb.appLock = next;
      return withLatency({ ...mockDb.appLock });
    },
  },
  deepLinks: {
    parseUrl: parseDeepLink,
    toPath: getPathFromRef,
  },
  relationshipDashboard: {
    async getSnapshot() {
      return withLatency(mockRelationshipDashboardSnapshot);
    },
  },
  weeklyRecap: {
    async listPhotoCandidatesForWeek(anchorIso) {
      return withLatency(filterPresencePostsInWeek(recapPostPool(), anchorIso));
    },
    async buildRecapDraft({ weekStartYmd, selectedPhotoIds }) {
      const uniq = [...new Set(selectedPhotoIds)].slice(0, 5);
      if (uniq.length === 0) {
        throw new Error('Pick at least one photo for your recap.');
      }
      const week = weekMetaFromMondayYmd(weekStartYmd);
      const byId = new Map(recapPostPool().map((p) => [p.id, p]));
      const selectedPhotos = uniq.map((id) => {
        const p = byId.get(id);
        if (!p) {
          throw new Error(`Unknown photo: ${id}`);
        }
        return p;
      });
      return withLatency({
        week,
        selectedPhotos,
        bestQuestion: { status: 'placeholder' as const },
        bestMoment: { status: 'placeholder' as const },
      });
    },
  },
  subscription: {
    async getSubscription() {
      return withLatency({ ...mockDb.subscription });
    },
    async setMockTier(tier: SubscriptionTier) {
      mockDb.subscription = {
        ...mockDb.subscription,
        tier,
        renewsAtIso: tier === 'premium' ? '2027-01-01T00:00:00.000Z' : null,
        source: 'mock',
      };
      return withLatency({ ...mockDb.subscription });
    },
    async redeemPromoCode(code: string) {
      void code;
      return withLatency({ ok: false as const, error: 'invalid_code' as const });
    },
  },
};
