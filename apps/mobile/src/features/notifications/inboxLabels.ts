import type { NotificationCategory } from '@/types/domain';

const TITLES: Record<NotificationCategory, string> = {
  prompt: 'Prompt reminders',
  photo: 'New photos',
  reaction: 'Reactions',
  habit: 'Habit reminders',
  anniversary: 'Anniversaries',
  countdown: 'Countdown updates',
};

export function notificationCategoryTitle(category: NotificationCategory): string {
  return TITLES[category];
}

const EXACT_NOTIFICATION_HREFS = new Set([
  '/(app)/(tabs)/home',
  '/(app)/(tabs)/photos',
  '/(app)/(tabs)/timeline',
  '/(app)/(tabs)/calendar',
  '/(app)/wake-check-in',
]);

const PROMPT_NOTIFICATION_HREF = /^\/\(app\)\/prompt\/[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

/** Inbox taps only follow fixed in-app paths. Anything else is dropped. */
export function safeNotificationHref(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  if (EXACT_NOTIFICATION_HREFS.has(href)) return href;
  if (PROMPT_NOTIFICATION_HREF.test(href)) return href;
  return undefined;
}

export function formatNotificationRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  if (diffMs < 60_000) return 'Just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
