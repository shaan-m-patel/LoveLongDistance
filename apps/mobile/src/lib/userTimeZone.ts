/** Resolved IANA id for reunion/calendar UX (profile override or device). */
export function resolveUserTimeZone(profileTimeZone: string | null | undefined): string {
  const t = profileTimeZone?.trim();
  return t && t.length > 0 ? t : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** True when `timeZone` is an IANA zone the runtime can use. */
export function isValidIanaTimeZone(timeZone: string): boolean {
  const trimmed = timeZone.trim();
  if (!trimmed || trimmed.length > 100 || /\s/.test(trimmed)) {
    return false;
  }
  try {
    Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}
