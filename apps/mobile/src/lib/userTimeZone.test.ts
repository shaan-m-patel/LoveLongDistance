import { describe, expect, it } from 'vitest';

import { isValidIanaTimeZone } from '@/lib/userTimeZone';

describe('isValidIanaTimeZone', () => {
  it('accepts an IANA zone', () => {
    expect(isValidIanaTimeZone('America/Chicago')).toBe(true);
  });

  it('rejects an unknown zone', () => {
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
    expect(isValidIanaTimeZone('   ')).toBe(false);
  });
});
