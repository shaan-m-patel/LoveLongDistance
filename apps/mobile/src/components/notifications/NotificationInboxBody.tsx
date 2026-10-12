import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { NotificationCategoryHeader } from '@/components/notifications/NotificationCategoryHeader';
import { NotificationListRow } from '@/components/notifications/NotificationListRow';
import { Button } from '@/components/primitives/Button';
import { Body } from '@/components/ui';
import {
  useCurrentUserId,
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  useNotificationInbox,
} from '@/features/hooks';
import { safeNotificationHref } from '@/features/notifications/inboxLabels';
import type { NotificationCategory, NotificationInboxItem } from '@/types/domain';
import { usesConfiguredSupabase } from '@/services/apiMode';
import { supabaseClient } from '@/services/supabase/client';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, typeBase } from '@/theme/tokens';

const INBOX_LIMIT = 50;

const CATEGORY_ORDER: NotificationCategory[] = [
  'prompt',
  'photo',
  'reaction',
  'habit',
  'anniversary',
  'countdown',
];

export type InboxSection = { category: NotificationCategory; data: NotificationInboxItem[] };

function buildSections(items: NotificationInboxItem[] | undefined): InboxSection[] {
  if (!items?.length) return [];
  const map = new Map<NotificationCategory, NotificationInboxItem[]>();
  for (const c of CATEGORY_ORDER) {
    map.set(c, []);
  }
  for (const item of items) {
    map.get(item.category)?.push(item);
  }
  return CATEGORY_ORDER.filter((c) => (map.get(c)?.length ?? 0) > 0).map((category) => ({
    category,
    data: map.get(category)!,
  }));
}

/** First `max` items in category order (same order as full inbox). */
function sliceSections(sections: InboxSection[], max: number): InboxSection[] {
  const out: InboxSection[] = [];
  let count = 0;
  for (const sec of sections) {
    const remaining = max - count;
    if (remaining <= 0) break;
    const slice = sec.data.slice(0, remaining);
    if (slice.length > 0) {
      out.push({ category: sec.category, data: slice });
      count += slice.length;
    }
  }
  return out;
}

type Props = {
  variant: 'screen' | 'peek';
  /** Peek list height cap (SectionList). */
  listMaxHeight?: number;
  peekMaxItems?: number;
  onViewAllPress?: () => void;
  /** After navigating from a row (href set); e.g. close popover. */
  onNavigateFromRow?: () => void;
  listStyle?: StyleProp<ViewStyle>;
};

export function NotificationInboxBody({
  variant,
  listMaxHeight,
  peekMaxItems = 10,
  onViewAllPress,
  onNavigateFromRow,
  listStyle,
}: Props) {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const live = usesConfiguredSupabase();
  const { meId } = useCurrentUserId();
  const { data, isLoading, isError, refetch } = useNotificationInbox(INBOX_LIMIT);
  const markRead = useMarkNotificationsRead();
  const markAll = useMarkAllNotificationsRead();
  /** Unique per mount so peek + full-screen inboxes do not share one Realtime topic. */
  const realtimeChannelInstanceId = useRef(
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  );

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  useEffect(() => {
    if (!live || !supabaseClient || !meId) {
      return;
    }
    const sb = supabaseClient;
    const channel = sb
      .channel(`notifications-inbox:${meId}:${realtimeChannelInstanceId.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${meId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] });
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [live, meId, queryClient]);

  const fullSections = useMemo(() => buildSections(data), [data]);
  const sections = useMemo(() => {
    if (variant === 'peek') {
      return sliceSections(fullSections, peekMaxItems);
    }
    return fullSections;
  }, [variant, fullSections, peekMaxItems]);

  const onRowPress = useCallback(
    (item: NotificationInboxItem) => {
      if (!item.read) {
        markRead.mutate([item.id]);
      }
      const href = safeNotificationHref(item.href);
      if (href) {
        router.push(href as Href);
        onNavigateFromRow?.();
      }
    },
    [markRead, router, onNavigateFromRow],
  );

  const topPadding = variant === 'peek' ? spacing.sm : spacing.md;
  const horizontal = variant === 'peek' ? spacing.md : spacing.lg;

  if (isLoading) {
    return (
      <View
        style={{ padding: variant === 'peek' ? spacing.lg : spacing.xxl, alignItems: 'center' }}
      >
        <ActivityIndicator
          color={theme.colors.primary}
          size={variant === 'peek' ? 'small' : 'large'}
        />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Body>Could not load notifications.</Body>
        <Button label="Retry" onPress={() => void refetch()} />
      </View>
    );
  }

  if (fullSections.length === 0) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Body>You are all caught up.</Body>
      </View>
    );
  }

  return (
    <View style={{ flex: variant === 'screen' ? 1 : undefined }}>
      {variant === 'screen' ? (
        <View style={{ paddingHorizontal: horizontal, paddingTop: topPadding, gap: spacing.sm }}>
          <Text style={{ ...typeBase.bodySm, color: theme.colors.textSecondary }}>
            {live
              ? 'Alerts from your couple sync here while you are signed in. Toggles live under Settings → Notifications. Optional Expo push is sent when your Supabase project dispatches it.'
              : 'Preview data; no live backend. Toggles live under Settings → Notifications.'}
          </Text>
          <Button
            label={markAll.isPending ? 'Updating…' : 'Mark all read'}
            variant="secondary"
            disabled={markAll.isPending || !data?.some((n) => !n.read)}
            onPress={() => markAll.mutate()}
          />
        </View>
      ) : (
        <View
          style={{
            paddingHorizontal: horizontal,
            paddingTop: topPadding,
            paddingBottom: spacing.xs,
          }}
        >
          <Text style={{ ...typeBase.caption, color: theme.colors.textMuted }}>
            {live
              ? 'Live inbox when paired; toggles in Settings → Notifications.'
              : 'Preview; toggles in Settings → Notifications.'}
          </Text>
        </View>
      )}
      <SectionList<NotificationInboxItem, InboxSection>
        style={[
          { flex: variant === 'screen' ? 1 : undefined, maxHeight: listMaxHeight },
          listStyle,
        ]}
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => (
          <NotificationCategoryHeader category={section.category} />
        )}
        renderItem={({ item }) => (
          <NotificationListRow item={item} onPress={() => onRowPress(item)} />
        )}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: variant === 'screen' ? spacing.xxxl : spacing.sm }}
        ListFooterComponent={
          variant === 'peek' && onViewAllPress ? (
            <Pressable
              accessibilityRole="button"
              onPress={onViewAllPress}
              style={({ pressed }) => ({
                paddingVertical: spacing.md,
                paddingHorizontal: horizontal,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ ...typeBase.bodySm, color: theme.colors.primary, fontWeight: '600' }}>
                View all notifications
              </Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}
