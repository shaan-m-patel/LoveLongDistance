import type {
  CoupleProfile,
  Habit,
  MemoryItem,
  NotificationCategory,
  NotificationInboxItem,
  NotificationPrefs,
  PresencePost,
  PrivacySettings,
  AppLockSettings,
  PromptThread,
  PromptThreadActivity,
  PromptThreadCategory,
  PromptThreadReply,
  RelationshipDashboardCategoryShare,
  RelationshipDashboardMemoryHighlight,
  RelationshipDashboardSnapshot,
  RelationshipDashboardWeekRhythm,
  RitualSignalEntry,
  RitualSignalKind,
  TimelineMemoryFilter,
  UserProfile,
} from '@/types/domain';
import type { Tables, TablesUpdate } from '@/services/supabase/database.types';
import {
  addUtcDays,
  computeEngagementStreakDays,
  graceUtcYmdsInInclusiveWindow,
  mergeSatisfiedUtcYmds,
  mutualPresenceUtcYmds,
} from '@/features/home/homeEngagementStreak';
import { isUserAllowedToToggleHabit } from '@/features/habits/habitPolicy';
import { safeNotificationHref } from '@/features/notifications/inboxLabels';
import { pickCouplesPromptForDay } from '@/features/prompts/promptLibraryPick';
import { isPromptAnswerVisibleToViewer } from '@/features/prompts/revealLogic';
import {
  mapInviteFailure,
  requireClient,
  signedAvatarUrl,
  signedUrlForBucketPath,
  todayYmdUtc,
  trySignedUrlForBucketPath,
} from '@/services/supabase/helpers';

function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function loadCompleteCoupleProfile(): Promise<CoupleProfile | null> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const { data: memberships } = await sb
    .from('couple_members')
    .select('couple_id')
    .eq('user_id', user.id);
  const ids = memberships?.map((m) => m.couple_id) ?? [];
  if (ids.length === 0) return null;

  const { data: couple } = await sb
    .from('couples')
    .select('id, reunion_date, reunion_end_date, is_complete')
    .in('id', ids)
    .eq('is_complete', true)
    .maybeSingle();

  if (!couple) return null;

  const { data: members } = await sb
    .from('couple_members')
    .select('user_id')
    .eq('couple_id', couple.id);
  const partnerId = members?.find((m) => m.user_id !== user.id)?.user_id;
  if (!partnerId) return null;

  const { data: profiles } = await sb
    .from('profiles')
    .select('id, first_name, display_name, time_zone, avatar_storage_path')
    .in('id', [user.id, partnerId]);

  const partnerRow = profiles?.find((p) => p.id === partnerId);
  const partner: UserProfile = {
    id: partnerId,
    firstName: partnerRow?.first_name?.trim() || 'Partner',
    displayName: partnerRow?.display_name ?? undefined,
    avatarUrl: await signedAvatarUrl(partnerRow?.avatar_storage_path ?? undefined),
    timeZone: partnerRow?.time_zone ?? null,
  };

  return {
    id: couple.id,
    meId: user.id,
    partner,
    reunionDate: couple.reunion_date ?? undefined,
    reunionEndDate: couple.reunion_end_date ?? undefined,
  };
}

export async function updateReunionDates(input: {
  reunionDate: string | null;
  reunionEndDate: string | null;
}): Promise<CoupleProfile> {
  const sb = requireClient();
  const coupleId = await requireCompleteCoupleId();
  const reunionDate = input.reunionDate;
  const reunionEndDate = reunionDate ? input.reunionEndDate : null;
  const { error } = await sb
    .from('couples')
    .update({
      reunion_date: reunionDate,
      reunion_end_date: reunionEndDate,
    })
    .eq('id', coupleId);
  if (error) {
    throw new Error(error.message);
  }
  const next = await loadCompleteCoupleProfile();
  if (!next) {
    throw new Error('Could not reload couple after update.');
  }
  return next;
}

async function requireCompleteCoupleId(): Promise<string> {
  const couple = await loadCompleteCoupleProfile();
  if (!couple) {
    throw new Error('Complete pairing first to use this feature.');
  }
  return couple.id;
}

function mapCategory(row: Tables<'couple_prompts'>): PromptThreadCategory | undefined {
  const c = row.category;
  if (!c || typeof c !== 'object') return undefined;
  const o = c as Record<string, unknown>;
  if (typeof o.id === 'string' && typeof o.label === 'string') {
    return { id: o.id, label: o.label };
  }
  return undefined;
}

async function rowToPromptThread(row: Tables<'couple_prompts'>): Promise<PromptThread> {
  const sb = requireClient();
  const [{ data: answers }, { data: reactions }, { data: userData }] = await Promise.all([
    sb.from('prompt_answers').select('*').eq('couple_prompt_id', row.id),
    sb.from('prompt_reactions').select('*').eq('couple_prompt_id', row.id),
    sb.auth.getUser(),
  ]);
  const viewerId = userData.user?.id;
  const revealed = row.is_revealed;

  const resolvedAnswers = await Promise.all(
    (answers ?? []).map(async (a) => {
      const visible = isPromptAnswerVisibleToViewer(revealed, viewerId, a.user_id);
      const imageUri =
        visible && a.image_storage_path
          ? ((await trySignedUrlForBucketPath('prompt_attachments', a.image_storage_path)) ?? undefined)
          : undefined;
      return {
        userId: a.user_id,
        answer: visible ? a.body : '',
        submittedAt: a.submitted_at,
        imageUri,
      };
    }),
  );

  if (!revealed) {
    const { data: hiddenPartner, error: hiddenErr } = await sb.rpc('hidden_prompt_partner', {
      p_prompt_id: row.id,
    });
    if (
      !hiddenErr &&
      typeof hiddenPartner === 'string' &&
      !resolvedAnswers.some((a) => a.userId === hiddenPartner)
    ) {
      resolvedAnswers.push({
        userId: hiddenPartner,
        answer: '',
        submittedAt: new Date(0).toISOString(),
      });
    }
  }

  return {
    promptId: row.id,
    date: row.prompt_date,
    question: row.question,
    category: mapCategory(row),
    answers: resolvedAnswers,
    isRevealed: revealed,
    reactions: (reactions ?? []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      emoji: r.emoji,
    })),
  };
}

export async function getTodayPrompt(): Promise<PromptThread> {
  const sb = requireClient();
  const coupleId = await requireCompleteCoupleId();
  const ymd = todayYmdUtc();

  let { data: row } = await sb
    .from('couple_prompts')
    .select('*')
    .eq('couple_id', coupleId)
    .eq('prompt_date', ymd)
    .maybeSingle();

  if (!row) {
    const { data: userData } = await sb.auth.getUser();
    const uid = userData.user?.id;
    let allowNsfw = false;
    if (uid) {
      const { data: settings } = await sb
        .from('user_app_settings')
        .select('allow_nsfw_prompts')
        .eq('user_id', uid)
        .maybeSingle();
      allowNsfw = settings?.allow_nsfw_prompts ?? false;
    }
    const picked = pickCouplesPromptForDay(coupleId, ymd, allowNsfw);
    const { data: inserted, error } = await sb
      .from('couple_prompts')
      .insert({
        couple_id: coupleId,
        prompt_date: ymd,
        question: picked.question,
        category: picked.category,
        is_revealed: false,
      })
      .select('*')
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? 'Could not create today’s prompt.');
    }
    row = inserted;
  }

  return rowToPromptThread(row);
}

const HOME_ENGAGEMENT_STREAK_LOOKBACK_DAYS = 400;

/**
 * Consecutive UTC days (aligned with `couple_prompts.prompt_date`) where the couple
 * revealed the daily prompt, both shared a presence photo that UTC day, or the day
 * overlaps the reunion visit window.
 */
export async function getHomeEngagementStreak(
  anchorPromptDateYmd: string,
  homeTimeZone: string,
): Promise<number> {
  const couple = await loadCompleteCoupleProfile();
  if (!couple) {
    throw new Error('Complete pairing first to use this feature.');
  }
  const sb = requireClient();
  const coupleId = couple.id;
  const meId = couple.meId;
  const partnerId = couple.partner.id;
  const minYmd = addUtcDays(anchorPromptDateYmd, -HOME_ENGAGEMENT_STREAK_LOOKBACK_DAYS);
  const createdFrom = `${minYmd}T00:00:00.000Z`;
  const createdToExclusive = `${addUtcDays(anchorPromptDateYmd, 1)}T00:00:00.000Z`;

  const [{ data: promptRows }, { data: presenceRows }] = await Promise.all([
    sb
      .from('couple_prompts')
      .select('prompt_date')
      .eq('couple_id', coupleId)
      .eq('is_revealed', true)
      .gte('prompt_date', minYmd)
      .lte('prompt_date', anchorPromptDateYmd),
    sb
      .from('presence_posts')
      .select('author_id, created_at')
      .eq('couple_id', coupleId)
      .gte('created_at', createdFrom)
      .lt('created_at', createdToExclusive),
  ]);

  const revealedPromptDates = (promptRows ?? []).map((r) => r.prompt_date);
  const mutualPresenceDates = mutualPresenceUtcYmds(
    (presenceRows ?? []).map((r) => ({
      authorId: r.author_id,
      createdAt: r.created_at,
    })),
    meId,
    partnerId,
  );
  const graceUtcYmds = graceUtcYmdsInInclusiveWindow(
    minYmd,
    anchorPromptDateYmd,
    couple.reunionDate,
    couple.reunionEndDate,
    homeTimeZone,
  );
  const satisfied = mergeSatisfiedUtcYmds({
    revealedPromptDates,
    mutualPresenceDates,
    graceUtcYmds,
  });
  return computeEngagementStreakDays(anchorPromptDateYmd, satisfied);
}

export async function getPromptById(promptId: string): Promise<PromptThread | null> {
  const sb = requireClient();
  const { data: row } = await sb
    .from('couple_prompts')
    .select('*')
    .eq('id', promptId)
    .maybeSingle();
  if (!row) return null;
  return rowToPromptThread(row);
}

export async function submitPromptAnswer(
  promptId: string,
  input: { answer: string; imageUri: string | null },
): Promise<PromptThread> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');

  let imagePath: string | null = null;
  if (input.imageUri) {
    const coupleId = await requireCompleteCoupleId();
    const ext = input.imageUri.split('.').pop()?.toLowerCase();
    const suffix = ext === 'png' ? 'png' : 'jpg';
    const objectPath = `couple/${coupleId}/${promptId}/${randomUuid()}.${suffix}`;
    const buf = await (await fetch(input.imageUri)).arrayBuffer();
    const { error: upErr } = await sb.storage
      .from('prompt_attachments')
      .upload(objectPath, buf, {
        contentType: suffix === 'png' ? 'image/png' : 'image/jpeg',
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);
    imagePath = objectPath;
  }

  const { error } = await sb.from('prompt_answers').upsert(
    {
      couple_prompt_id: promptId,
      user_id: user.id,
      body: input.answer.trim(),
      image_storage_path: imagePath,
      submitted_at: new Date().toISOString(),
    },
    { onConflict: 'couple_prompt_id,user_id' },
  );
  if (error) throw new Error(error.message);

  const thread = await getPromptById(promptId);
  if (!thread) throw new Error('Prompt not found after save.');
  return thread;
}

export async function reactToPrompt(promptId: string, emoji: string): Promise<PromptThread> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');

  const { error } = await sb.from('prompt_reactions').insert({
    couple_prompt_id: promptId,
    user_id: user.id,
    emoji,
  });
  if (error && error.code !== '23505') {
    throw new Error(error.message);
  }

  const thread = await getPromptById(promptId);
  if (!thread) throw new Error('Prompt not found.');
  return thread;
}

export async function getThreadActivity(promptId: string): Promise<PromptThreadActivity | null> {
  const sb = requireClient();
  const { data: promptRow } = await sb
    .from('couple_prompts')
    .select('id')
    .eq('id', promptId)
    .maybeSingle();
  if (!promptRow) return null;

  const [{ data: replies }, { data: placeholders }] = await Promise.all([
    sb
      .from('prompt_replies')
      .select('*')
      .eq('couple_prompt_id', promptId)
      .order('created_at', { ascending: true }),
    sb.from('prompt_voice_placeholders').select('*').eq('couple_prompt_id', promptId),
  ]);

  const replyIds = (replies ?? []).map((r) => r.id);
  let reactionByReply: Record<string, Tables<'prompt_reply_reactions'>[]> = {};
  if (replyIds.length > 0) {
    const { data: rr } = await sb
      .from('prompt_reply_reactions')
      .select('*')
      .in('reply_id', replyIds);
    reactionByReply = {};
    for (const r of rr ?? []) {
      reactionByReply[r.reply_id] = [...(reactionByReply[r.reply_id] ?? []), r];
    }
  }

  const mappedReplies: PromptThreadReply[] = (replies ?? []).map((r) => ({
    id: r.id,
    promptId,
    parentReplyId: r.parent_reply_id,
    authorId: r.author_id,
    body: r.body,
    createdAt: r.created_at,
    reactions: (reactionByReply[r.id] ?? []).map((x) => ({
      id: x.id,
      userId: x.user_id,
      emoji: x.emoji,
    })),
  }));

  return {
    promptId,
    replies: mappedReplies,
    voiceNotePlaceholders: (placeholders ?? []).map((p) => ({
      id: p.id,
      promptId,
      kind: 'placeholder' as const,
      label: p.label,
    })),
  };
}

export async function addThreadReply(input: {
  promptId: string;
  body: string;
  parentReplyId?: string | null;
}): Promise<PromptThreadActivity> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const text = input.body.trim();
  if (!text) throw new Error('Message cannot be empty.');

  const { error } = await sb.from('prompt_replies').insert({
    couple_prompt_id: input.promptId,
    parent_reply_id: input.parentReplyId ?? null,
    author_id: user.id,
    body: text,
  });
  if (error) throw new Error(error.message);

  const next = await getThreadActivity(input.promptId);
  if (!next) throw new Error('Thread not found.');
  return next;
}

export async function reactToThreadReply(input: {
  promptId: string;
  replyId: string;
  emoji: string;
}): Promise<PromptThreadActivity> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');

  const { error } = await sb.from('prompt_reply_reactions').insert({
    reply_id: input.replyId,
    user_id: user.id,
    emoji: input.emoji,
  });
  if (error && error.code !== '23505') {
    throw new Error(error.message);
  }

  const next = await getThreadActivity(input.promptId);
  if (!next) throw new Error('Thread not found.');
  return next;
}

export async function getLatestPosts(): Promise<PresencePost[]> {
  const sb = requireClient();
  const coupleId = await requireCompleteCoupleId();
  const { data: rows } = await sb
    .from('presence_posts')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false })
    .limit(50);

  const out: PresencePost[] = [];
  for (const r of rows ?? []) {
    const imageUri = await trySignedUrlForBucketPath('presence', r.storage_path);
    if (!imageUri) continue;
    out.push({
      id: r.id,
      authorId: r.author_id,
      imageUri,
      caption: r.caption ?? undefined,
      mood: r.mood ?? undefined,
      locationLabel: r.location_label ?? undefined,
      createdAt: r.created_at,
      reactionCount: r.reaction_count,
    });
  }
  return out;
}

export async function sharePost(input: {
  imageUri: string;
  caption?: string;
  mood?: string;
  locationLabel?: string;
}): Promise<PresencePost> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');

  const coupleId = await requireCompleteCoupleId();
  const postId = randomUuid();
  const ext = input.imageUri.split('.').pop()?.toLowerCase();
  const suffix = ext === 'png' ? 'png' : 'jpg';
  const objectPath = `couple/${coupleId}/${postId}.${suffix}`;
  const buf = await (await fetch(input.imageUri)).arrayBuffer();
  const { error: upErr } = await sb.storage
    .from('presence')
    .upload(objectPath, buf, {
      contentType: suffix === 'png' ? 'image/png' : 'image/jpeg',
      upsert: false,
    });
  if (upErr) throw new Error(upErr.message);

  const { data: row, error } = await sb
    .from('presence_posts')
    .insert({
      id: postId,
      couple_id: coupleId,
      author_id: user.id,
      caption: input.caption?.trim() || null,
      mood: input.mood?.trim() || null,
      location_label: input.locationLabel?.trim() || null,
      storage_path: objectPath,
    })
    .select('*')
    .single();

  if (error || !row) throw new Error(error?.message ?? 'Failed to save post.');

  const imageUri = await signedUrlForBucketPath('presence', row.storage_path);
  return {
    id: row.id,
    authorId: row.author_id,
    imageUri,
    caption: row.caption ?? undefined,
    mood: row.mood ?? undefined,
    locationLabel: row.location_label ?? undefined,
    createdAt: row.created_at,
    reactionCount: row.reaction_count,
  };
}

export async function reactToPost(postId: string): Promise<void> {
  const sb = requireClient();
  const { error } = await sb.rpc('increment_presence_reaction', { p_post_id: postId });
  if (error) throw new Error(error.message);
}

function mapPrefsRow(r: Tables<'user_notification_prefs'>): NotificationPrefs {
  return {
    unansweredPrompt: r.unanswered_prompt,
    newPhoto: r.new_photo,
    habitReminder: r.habit_reminder,
    milestones: r.milestones,
    reactions: r.reactions,
    anniversaries: r.anniversaries,
    countdownUpdates: r.countdown_updates,
  };
}

export async function getPreferences(): Promise<NotificationPrefs> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const { data, error } = await sb
    .from('user_notification_prefs')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'No notification preferences.');
  return mapPrefsRow(data);
}

export async function updatePreferences(
  partial: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');

  const patch: TablesUpdate<'user_notification_prefs'> = {};
  if (partial.unansweredPrompt !== undefined) patch.unanswered_prompt = partial.unansweredPrompt;
  if (partial.newPhoto !== undefined) patch.new_photo = partial.newPhoto;
  if (partial.habitReminder !== undefined) patch.habit_reminder = partial.habitReminder;
  if (partial.milestones !== undefined) patch.milestones = partial.milestones;
  if (partial.reactions !== undefined) patch.reactions = partial.reactions;
  if (partial.anniversaries !== undefined) patch.anniversaries = partial.anniversaries;
  if (partial.countdownUpdates !== undefined) patch.countdown_updates = partial.countdownUpdates;

  const { data, error } = await sb
    .from('user_notification_prefs')
    .update(patch)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Update failed.');
  return mapPrefsRow(data);
}

export async function listInbox(limit = 50): Promise<NotificationInboxItem[]> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const n = Math.max(1, Math.min(100, limit));
  const { data } = await sb
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(n);

  return (data ?? []).map((r) => ({
    id: r.id,
    category: r.category as NotificationCategory,
    title: r.title,
    summary: r.summary,
    createdAt: r.created_at,
    read: r.read,
    href: safeNotificationHref(r.href),
  }));
}

export async function markRead(ids: string[]): Promise<NotificationInboxItem[]> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  if (ids.length === 0) return listInbox();
  const { error } = await sb
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .in('id', ids);
  if (error) throw new Error(error.message);
  return listInbox();
}

export async function markAllRead(): Promise<NotificationInboxItem[]> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const { error } = await sb.from('notifications').update({ read: true }).eq('user_id', user.id);
  if (error) throw new Error(error.message);
  return listInbox();
}

export async function upsertExpoPushToken(expoPushToken: string, platform: string): Promise<void> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const iso = new Date().toISOString();
  const { error } = await sb.from('user_push_tokens').upsert(
    {
      user_id: user.id,
      expo_push_token: expoPushToken,
      platform,
      updated_at: iso,
    },
    { onConflict: 'expo_push_token' },
  );
  if (error) throw new Error(error.message);
}

export async function getPrivacy(): Promise<PrivacySettings> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const { data, error } = await sb
    .from('user_app_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'No settings row.');
  return {
    sharePresence: data.share_presence,
    productAnalytics: data.product_analytics,
    redactPreviews: data.redact_previews,
    allowNsfwPrompts: data.allow_nsfw_prompts,
  };
}

export async function updatePrivacy(partial: Partial<PrivacySettings>): Promise<PrivacySettings> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const patch: TablesUpdate<'user_app_settings'> = {};
  if (partial.sharePresence !== undefined) patch.share_presence = partial.sharePresence;
  if (partial.productAnalytics !== undefined) patch.product_analytics = partial.productAnalytics;
  if (partial.redactPreviews !== undefined) patch.redact_previews = partial.redactPreviews;
  if (partial.allowNsfwPrompts !== undefined) patch.allow_nsfw_prompts = partial.allowNsfwPrompts;
  const { data, error } = await sb
    .from('user_app_settings')
    .update(patch)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Update failed.');
  return {
    sharePresence: data.share_presence,
    productAnalytics: data.product_analytics,
    redactPreviews: data.redact_previews,
    allowNsfwPrompts: data.allow_nsfw_prompts,
  };
}

export async function getAppLock(): Promise<AppLockSettings> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const { data, error } = await sb
    .from('user_app_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'No settings row.');
  return {
    requirePasscode: data.require_passcode,
    useBiometric: data.use_biometric,
    isPasscodeSet: data.is_passcode_set,
  };
}

export async function updateAppLock(partial: Partial<AppLockSettings>): Promise<AppLockSettings> {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const { data: cur } = await sb
    .from('user_app_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (!cur) throw new Error('No settings row.');

  let requirePasscode = partial.requirePasscode ?? cur.require_passcode;
  let useBiometric = partial.useBiometric ?? cur.use_biometric;
  let isPasscodeSet = partial.isPasscodeSet ?? cur.is_passcode_set;

  if (requirePasscode && !cur.is_passcode_set) {
    isPasscodeSet = true;
  }
  if (!requirePasscode) {
    isPasscodeSet = false;
    useBiometric = false;
  }

  const { data, error } = await sb
    .from('user_app_settings')
    .update({
      require_passcode: requirePasscode,
      use_biometric: useBiometric,
      is_passcode_set: isPasscodeSet,
    })
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Update failed.');
  return {
    requirePasscode: data.require_passcode,
    useBiometric: data.use_biometric,
    isPasscodeSet: data.is_passcode_set,
  };
}

function mapMemory(r: Tables<'memories'>, imageUri?: string): MemoryItem {
  const mk = r.milestone_kind;
  return {
    id: r.id,
    type: r.type as MemoryItem['type'],
    title: r.title,
    summary: r.summary,
    createdAt: r.created_at,
    deepLinkRef: r.deep_link_ref,
    isFavorite: r.is_favorite,
    milestoneKind: mk ? (mk as MemoryItem['milestoneKind']) : undefined,
    imageUri,
  };
}

export async function listMemories(filter: TimelineMemoryFilter = 'all'): Promise<MemoryItem[]> {
  const sb = requireClient();
  const coupleId = await requireCompleteCoupleId();
  let q = sb
    .from('memories')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false });
  if (filter === 'favorites') {
    q = q.eq('is_favorite', true);
  } else if (filter !== 'all') {
    q = q.eq('type', filter);
  }
  const { data: rows } = await q;
  const out: MemoryItem[] = [];
  for (const r of rows ?? []) {
    let imageUri: string | undefined;
    if (r.image_storage_path) {
      imageUri = (await trySignedUrlForBucketPath('presence', r.image_storage_path)) ?? undefined;
    }
    out.push(mapMemory(r, imageUri));
  }
  return out;
}

export async function getMemoryById(memoryId: string): Promise<MemoryItem | null> {
  const sb = requireClient();
  const { data: r } = await sb.from('memories').select('*').eq('id', memoryId).maybeSingle();
  if (!r) return null;
  let imageUri: string | undefined;
  if (r.image_storage_path) {
    imageUri = (await trySignedUrlForBucketPath('presence', r.image_storage_path)) ?? undefined;
  }
  return mapMemory(r, imageUri);
}

export async function setMemoryFavorite(
  memoryId: string,
  isFavorite: boolean,
): Promise<MemoryItem> {
  const sb = requireClient();
  const { data, error } = await sb
    .from('memories')
    .update({ is_favorite: isFavorite })
    .eq('id', memoryId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Memory not found.');
  let imageUri: string | undefined;
  if (data.image_storage_path) {
    imageUri = (await trySignedUrlForBucketPath('presence', data.image_storage_path)) ?? undefined;
  }
  return mapMemory(data, imageUri);
}

async function habitRowsToDomain(rows: Tables<'habits'>[]): Promise<Habit[]> {
  const sb = requireClient();
  if (rows.length === 0) return [];
  const ids = rows.map((h) => h.id);
  const { data: comps } = await sb.from('habit_completions').select('*').in('habit_id', ids);
  const byHabit: Record<string, Record<string, string[]>> = {};
  for (const c of comps ?? []) {
    const ymd = c.ymd;
    if (!byHabit[c.habit_id]) byHabit[c.habit_id] = {};
    const arr = byHabit[c.habit_id][ymd] ?? [];
    if (!arr.includes(c.user_id)) arr.push(c.user_id);
    byHabit[c.habit_id][ymd] = arr;
  }

  return rows.map((h) => ({
    id: h.id,
    title: h.title,
    type: h.type as Habit['type'],
    completionPolicy: h.completion_policy as Habit['completionPolicy'],
    goal: (h.goal ?? undefined) as Habit['goal'] | undefined,
    completionsByDate: byHabit[h.id] ?? {},
  }));
}

export async function getHabitsForMonth(monthKey: string): Promise<Habit[]> {
  void monthKey;
  const sb = requireClient();
  const coupleId = await requireCompleteCoupleId();
  const { data: rows } = await sb
    .from('habits')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: true });
  return habitRowsToDomain(rows ?? []);
}

export async function getHabitById(habitId: string): Promise<Habit | null> {
  const sb = requireClient();
  const { data: row } = await sb.from('habits').select('*').eq('id', habitId).maybeSingle();
  if (!row) return null;
  const [h] = await habitRowsToDomain([row]);
  return h ?? null;
}

export async function toggleHabitCompletion(habitId: string, date: string): Promise<Habit[]> {
  const sb = requireClient();
  const couple = await loadCompleteCoupleProfile();
  if (!couple) throw new Error('Not paired.');
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');

  const habit = await getHabitById(habitId);
  if (!habit) throw new Error('Habit not found.');
  if (
    !isUserAllowedToToggleHabit(habit, user.id, { meId: couple.meId, partnerId: couple.partner.id })
  ) {
    throw new Error('This habit is for your partner; only they can check it off.');
  }

  const { data: existing } = await sb
    .from('habit_completions')
    .select('user_id')
    .eq('habit_id', habitId)
    .eq('ymd', date)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await sb
      .from('habit_completions')
      .delete()
      .eq('habit_id', habitId)
      .eq('ymd', date)
      .eq('user_id', user.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from('habit_completions').insert({
      habit_id: habitId,
      ymd: date,
      user_id: user.id,
    });
    if (error) throw new Error(error.message);
  }

  return getHabitsForMonth(date.slice(0, 7));
}

export async function logRitualSignal(
  kind: RitualSignalKind,
  body: string,
): Promise<RitualSignalEntry[]> {
  const sb = requireClient();
  const text = body.trim();
  if (!text) throw new Error('Message cannot be empty.');
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in');
  const coupleId = await requireCompleteCoupleId();
  const { error } = await sb.from('ritual_signals').insert({
    couple_id: coupleId,
    author_id: user.id,
    kind,
    body: text,
  });
  if (error) throw new Error(error.message);
  return listRecentRitualSignals(50);
}

export async function listRecentRitualSignals(limit: number): Promise<RitualSignalEntry[]> {
  const sb = requireClient();
  const coupleId = await requireCompleteCoupleId();
  const n = Math.max(0, Math.min(50, limit));
  const { data } = await sb
    .from('ritual_signals')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false })
    .limit(n);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as RitualSignalKind,
    body: r.body,
    authorId: r.author_id,
    createdAt: r.created_at,
  }));
}

function utcMondayYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  const diff = (dow + 6) % 7;
  const mon = new Date(Date.UTC(y, m, day - diff));
  return mon.toISOString().slice(0, 10);
}

function weekStartUtcFromPromptYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  return utcMondayYmd(d);
}

function monthYearLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function lastNMondayKeysDescending(n: number): string[] {
  const keys: string[] = [];
  let cur = utcMondayYmd(new Date());
  for (let i = 0; i < n; i++) {
    keys.push(cur);
    const [y, mo, da] = cur.split('-').map(Number);
    const prev = new Date(Date.UTC(y!, mo! - 1, da! - 7));
    cur = utcMondayYmd(prev);
  }
  return keys.reverse();
}

function shortWeekLabel(mondayYmd: string): string {
  const d = new Date(`${mondayYmd}T12:00:00.000Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Aggregates couple activity for the relationship dashboard (Supabase-backed). */
export async function getRelationshipDashboardSnapshot(): Promise<RelationshipDashboardSnapshot> {
  const couple = await loadCompleteCoupleProfile();
  if (!couple) {
    throw new Error('Complete pairing first to use this feature.');
  }
  const sb = requireClient();
  const coupleId = couple.id;
  const generatedAt = new Date().toISOString();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 56);
  const sinceYmd = since.toISOString().slice(0, 10);
  const sinceIso = since.toISOString();

  const [
    { count: memoryTotal },
    { data: memHighlights },
    { data: promptRows },
    { data: memTypes },
  ] = await Promise.all([
    sb.from('memories').select('*', { count: 'exact', head: true }).eq('couple_id', coupleId),
    sb
      .from('memories')
      .select('id, title, created_at')
      .eq('couple_id', coupleId)
      .order('created_at', { ascending: false })
      .limit(3),
    sb
      .from('couple_prompts')
      .select('id, prompt_date, is_revealed')
      .eq('couple_id', coupleId)
      .gte('prompt_date', sinceYmd),
    sb.from('memories').select('type').eq('couple_id', coupleId).gte('created_at', sinceIso),
  ]);

  const promptList = promptRows ?? [];
  const promptIds = promptList.map((p) => p.id);

  const { data: answersForPrompts } =
    promptIds.length > 0
      ? await sb
          .from('prompt_answers')
          .select('couple_prompt_id, user_id')
          .in('couple_prompt_id', promptIds)
      : { data: [] as { couple_prompt_id: string; user_id: string }[] };

  const answerersByPrompt = new Map<string, Set<string>>();
  for (const a of answersForPrompts ?? []) {
    const s = answerersByPrompt.get(a.couple_prompt_id) ?? new Set<string>();
    s.add(a.user_id);
    answerersByPrompt.set(a.couple_prompt_id, s);
  }

  const promptsByWeek = new Map<string, typeof promptList>();
  for (const p of promptList) {
    const wk = weekStartUtcFromPromptYmd(p.prompt_date);
    const arr = promptsByWeek.get(wk) ?? [];
    arr.push(p);
    promptsByWeek.set(wk, arr);
  }

  const weekKeys = lastNMondayKeysDescending(8);
  const weeks: RelationshipDashboardWeekRhythm[] = weekKeys.map((wk) => {
    const inWeek = promptsByWeek.get(wk) ?? [];
    if (inWeek.length === 0) {
      return { weekLabel: shortWeekLabel(wk), bothEngagedScore: 0 };
    }
    let ok = 0;
    for (const pr of inWeek) {
      const n = answerersByPrompt.get(pr.id)?.size ?? 0;
      if (pr.is_revealed || n >= 2) {
        ok++;
      }
    }
    return { weekLabel: shortWeekLabel(wk), bothEngagedScore: ok / inWeek.length };
  });

  const { data: gratitudeRows } = await sb
    .from('memories')
    .select('created_at')
    .eq('couple_id', coupleId)
    .eq('type', 'gratitude')
    .gte('created_at', since.toISOString());

  const gratWeekKeys = lastNMondayKeysDescending(5);
  const gratitudeByWeek = new Map<string, number>();
  for (const r of gratitudeRows ?? []) {
    const wk = utcMondayYmd(new Date(r.created_at));
    gratitudeByWeek.set(wk, (gratitudeByWeek.get(wk) ?? 0) + 1);
  }
  const entriesPerWeek = gratWeekKeys.map((wk) => gratitudeByWeek.get(wk) ?? 0);

  const typeLabels: Record<string, string> = {
    prompt: 'Daily prompts',
    photo: 'Photos',
    gratitude: 'Gratitude',
    milestone: 'Milestones',
  };
  const typeCounts = new Map<string, number>();
  for (const r of memTypes ?? []) {
    const t = r.type as string;
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const totalTyped = [...typeCounts.values()].reduce((a, b) => a + b, 0);
  let items: RelationshipDashboardCategoryShare[] = [];
  if (totalTyped === 0) {
    items = [{ label: 'Your mix is still forming', share: 1 }];
  } else {
    items = [...typeCounts.entries()]
      .map(([type, c]) => ({
        label: typeLabels[type] ?? type,
        share: c / totalTyped,
      }))
      .sort((a, b) => b.share - a.share);
  }

  const total = memoryTotal ?? 0;
  const headline =
    total === 0
      ? 'Your story together is just getting started—small moments will fill this space soon.'
      : `You have ${total} saved moments together. Steady check-ins matter more than a perfect streak.`;

  const highlights: RelationshipDashboardMemoryHighlight[] = (memHighlights ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    savedAtLabel: monthYearLabel(m.created_at),
  }));

  return {
    generatedAt,
    headline,
    promptRhythm: {
      insight:
        'Each week shows how often you both completed the daily prompt when it was available—small consistency beats rare perfection.',
      weeks,
    },
    gratitude: {
      insight: gratitudeRows?.length
        ? 'Gratitude memories you saved recently, grouped by week.'
        : 'When you save gratitude moments to the timeline, they will show up here.',
      weekLabels: gratWeekKeys.map(shortWeekLabel),
      entriesPerWeek,
    },
    favoriteCategories: {
      insight: 'Share of recent timeline entries by type (last ~8 weeks).',
      items,
    },
    savedMemories: {
      insight: 'Recent highlights from your shared timeline.',
      totalCount: total,
      highlights,
    },
  };
}

export async function listPhotoCandidatesForWeek(anchorIso: string): Promise<PresencePost[]> {
  const posts = await getLatestPosts();
  const { filterPresencePostsInWeek } = await import('@/features/weeklyRecap/recapCandidateFilter');
  return filterPresencePostsInWeek(posts, anchorIso);
}

export async function acceptInviteWithEdge(token: string): Promise<CoupleProfile> {
  const sb = requireClient();
  const normalized = token.trim();
  if (!normalized) {
    throw new Error('Add an invite code or open the full link your partner sent.');
  }

  const { data, error } = await sb.functions.invoke<{ couple?: CoupleProfile; error?: string }>(
    'accept-invite',
    { body: { token: normalized } },
  );

  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    throw new Error(mapInviteFailure(data.error));
  }
  if (data?.couple) {
    return data.couple;
  }
  if (error) {
    throw new Error(error.message || 'Could not accept invite.');
  }
  throw new Error('Could not accept invite.');
}

export async function createInviteLinkRpc(): Promise<string> {
  const sb = requireClient();
  const { data, error } = await sb.rpc('create_invite', { expires_in: '7 days' });
  if (error) {
    if (error.message?.includes('already_paired')) {
      throw new Error(
        'You are already linked with a partner. Use another account to test a fresh invite, or sign out first.',
      );
    }
    throw new Error(error.message);
  }
  const o = data as { deep_link?: string } | null;
  if (!o?.deep_link) {
    throw new Error('Invite link could not be created.');
  }
  return o.deep_link;
}
