import { beforeEach, describe, expect, it } from 'vitest';

import { mockServices } from '@/services/mock/mockServices';
import { initialSubscription, mockDb, mockMe, mockPartner } from '@/services/mock/mockData';
import type { CoupleProfile } from '@/types/domain';

const sampleCouple: CoupleProfile = {
  id: 'couple-test',
  meId: mockMe.id,
  partner: mockPartner,
};

describe('mockServices.subscription.redeemPromoCode', () => {
  beforeEach(() => {
    mockDb.subscription = { ...initialSubscription };
    mockDb.couple = null;
  });

  it('rejects unknown codes', async () => {
    const r = await mockServices.subscription.redeemPromoCode('NOTBG');
    expect(r).toEqual({ ok: false, error: 'invalid_code' });
    expect(mockDb.subscription.tier).toBe('free');
  });

  it('does not grant Plus from a client-known code when unpaired', async () => {
    const r = await mockServices.subscription.redeemPromoCode('BG');
    expect(r).toEqual({ ok: false, error: 'invalid_code' });
    expect(mockDb.subscription.tier).toBe('free');
  });

  it('does not grant Plus from a client-known code when paired', async () => {
    mockDb.couple = { ...sampleCouple };
    const r = await mockServices.subscription.redeemPromoCode(' bg ');
    expect(r).toEqual({ ok: false, error: 'invalid_code' });
    expect(mockDb.subscription.tier).toBe('free');
  });
});
