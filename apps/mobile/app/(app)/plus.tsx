import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Input } from '@/components/primitives';
import { PremiumBadge } from '@/components/premium';
import { SectionScaffold } from '@/components/section/SectionScaffold';
import { Body, SectionCard } from '@/components/ui';
import { useRedeemPromoCode, useSetMockSubscriptionTier, useSubscription } from '@/features/hooks';
import { isPremiumTier } from '@/features/premium/entitlements';
import type { PromoRedeemErrorCode } from '@/services/ports';
import { useServices } from '@/services/ServiceContext';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

function promoErrorMessage(code: PromoRedeemErrorCode): string {
  if (code === 'invalid_code') {
    return 'That code is not valid.';
  }
  return 'Finish pairing with your partner before using this code.';
}

const perks = [
  'Extra prompt packs for slow weeks and special seasons',
  'Advanced home widgets (countdowns, streaks, partner pulse)',
  'Theme and accent customization',
  'Exports for memories and weekly recaps',
  'Deeper analytics and longer history',
];

export default function PlusHubScreen() {
  const theme = useTheme();
  const services = useServices();
  const { data: sub, isLoading } = useSubscription();
  const setTier = useSetMockSubscriptionTier();
  const redeemPromo = useRedeemPromoCode();
  const [promoCode, setPromoCode] = useState('');
  const [promoFieldError, setPromoFieldError] = useState<string | null>(null);
  const [promoSuccess, setPromoSuccess] = useState(false);
  const premium = sub ? isPremiumTier(sub) : false;
  const canMockToggle =
    __DEV__ && typeof services.subscription.setMockTier === 'function';

  async function applyPromo() {
    setPromoFieldError(null);
    setPromoSuccess(false);
    try {
      const result = await redeemPromo.mutateAsync(promoCode.trim());
      if (result.ok) {
        setPromoSuccess(true);
        setPromoCode('');
      } else {
        setPromoFieldError(promoErrorMessage(result.error));
      }
    } catch (e) {
      setPromoFieldError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <SectionScaffold
      kicker="Optional"
      lead="Nothing here is required to feel close day to day. Plus is for couples who want a little more structure and delight later on."
      title="LoveDistance Plus"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
        <PremiumBadge />
        {premium ? (
          <Text style={{ ...theme.type.caption, color: theme.colors.textMuted }}>
            {sub?.source === 'mock'
              ? 'Active on this device (mock)'
              : 'Active on this account.'}
          </Text>
        ) : null}
      </View>

      <SectionCard>
        {isLoading ? (
          <Body>Loading…</Body>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Body>
              Billing is not connected yet. When it is, Plus will fund ongoing work on prompts, rituals, and polish.
            </Body>
            <Text style={{ ...theme.type.bodySm, color: theme.colors.textPrimary, fontWeight: '600' }}>
              Planned perks
            </Text>
            {perks.map((line) => (
              <Body key={line}>• {line}</Body>
            ))}
            <Body>We will keep the core app generous and calm—no surprise paywalls on your daily rhythm.</Body>
          </View>
        )}
      </SectionCard>

      <SectionCard>
        <Text style={{ ...theme.type.bodySm, color: theme.colors.textPrimary, fontWeight: '600', marginBottom: spacing.sm }}>
          Have a promo code?
        </Text>
        <View style={{ gap: spacing.md }}>
          <Body>
            If you have a code, enter it here. A valid code unlocks LoveDistance Plus on your account.
          </Body>
          <Input
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!redeemPromo.isPending}
            label="Code"
            placeholder="Enter code"
            value={promoCode}
            onChangeText={(t) => {
              setPromoCode(t);
              setPromoFieldError(null);
              setPromoSuccess(false);
            }}
            error={promoFieldError ?? undefined}
          />
          {promoSuccess ? (
            <Text style={{ ...theme.type.bodySm, color: theme.colors.textSecondary }}>
              Plus is now active on your account.
            </Text>
          ) : null}
          <Button
            label="Apply code"
            disabled={redeemPromo.isPending || !promoCode.trim()}
            onPress={() => void applyPromo()}
          />
        </View>
      </SectionCard>

      {canMockToggle ? (
        <SectionCard>
          <Text style={{ ...theme.type.bodySm, color: theme.colors.textMuted, marginBottom: spacing.sm }}>
            Developer: flip mock subscription tier
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button
              label="Mock: Free"
              variant="secondary"
              disabled={setTier.isPending}
              onPress={() => setTier.mutate('free')}
            />
            <Button
              label="Mock: Premium"
              variant="secondary"
              disabled={setTier.isPending}
              onPress={() => setTier.mutate('premium')}
            />
          </View>
        </SectionCard>
      ) : null}

      <Button label="Back to settings" variant="ghost" onPress={() => router.replace('/(app)/(tabs)/settings' as Href)} />
    </SectionScaffold>
  );
}
