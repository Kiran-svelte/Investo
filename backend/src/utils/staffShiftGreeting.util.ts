/**
 * Staff WhatsApp check-in / check-out phrase detection.
 * Distinct from generic copilot greetings — triggers day-start/day-end briefings.
 */

export const STAFF_CHECK_IN_PATTERN =
  /^(check\s*in|checkin|sign\s*in|signin|start\s*(my\s*)?(shift|day|work)|clock\s*in|reporting\s*(for\s*)?(duty|work)|i'?m\s*in|im\s*in)[!.,?\s\u00a0]*$/i;

export const STAFF_CHECK_OUT_PATTERN =
  /^(check\s*out|checkout|sign\s*out|signout|end\s*(my\s*)?(shift|day|work)|clock\s*out|done\s*(for\s*)?(today|the\s*day)|leaving\s*(for\s*)?(today|now))[!.,?\s\u00a0]*$/i;

export function isStaffCheckIn(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 40) return false;
  return STAFF_CHECK_IN_PATTERN.test(trimmed);
}

export function isStaffCheckOut(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 40) return false;
  return STAFF_CHECK_OUT_PATTERN.test(trimmed);
}
