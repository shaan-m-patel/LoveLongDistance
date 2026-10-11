import { describe, expect, it } from 'vitest';

import {
  formatNotificationRelativeTime,
  notificationCategoryTitle,
  safeNotificationHref,
} from '@/features/notifications/inboxLabels';

describe('notificationCategoryTitle', () => {
  it('returns a label for each category', () => {
    expect(notificationCategoryTitle('prompt').length).toBeGreaterThan(2);
    expect(notificationCategoryTitle('countdown')).toContain('Countdown');
  });
});

describe('safeNotificationHref', () => {
  it('allows fixed tab paths and prompt ids', () => {
    expect(safeNotificationHref('/(app)/(tabs)/home')).toBe('/(app)/(tabs)/home');
    expect(safeNotificationHref('/(app)/prompt/prompt-today')).toBe('/(app)/prompt/prompt-today');
    expect(safeNotificationHref('/(app)/prompt/11111111-1111-4111-8111-111111111111')).toBe(
      '/(app)/prompt/11111111-1111-4111-8111-111111111111',
    );
  });

  it('drops external and nested paths', () => {
    expect(safeNotificationHref('https://example.com')).toBeUndefined();
    expect(safeNotificationHref('/(app)/prompt/../../secret')).toBeUndefined();
    expect(safeNotificationHref('/(app)/(tabs)/photos?next=https://example.com')).toBeUndefined();
    expect(safeNotificationHref(null)).toBeUndefined();
  });
});

describe('formatNotificationRelativeTime', () => {
  const now = new Date('2026-04-26T12:00:00.000Z');

  it('formats minutes ago', () => {
    const iso = '2026-04-26T11:30:00.000Z';
    expect(formatNotificationRelativeTime(iso, now)).toBe('30m ago');
  });

  it('formats just now', () => {
    const iso = '2026-04-26T11:59:30.000Z';
    expect(formatNotificationRelativeTime(iso, now)).toBe('Just now');
  });
});
