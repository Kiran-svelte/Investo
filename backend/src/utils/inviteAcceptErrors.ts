import { STAFF_PHONE_REQUIRED_MESSAGE } from '../constants/staffPhonePolicy';
import { StaffPhoneInUseError } from './staffPhoneUniqueness';

export function mapInviteAcceptError(err: unknown): { status: number; error: string } {
  const message = err instanceof Error ? err.message : 'Failed to accept invite';

  if (message === 'Invalid invite link') {
    return { status: 404, error: message };
  }
  if (message === 'Invite already accepted' || message === 'Invite has expired') {
    return { status: 409, error: message };
  }
  if (message === 'An account with this email already exists' || message === 'Email already registered') {
    return { status: 409, error: 'An account with this email already exists' };
  }
  if (message === STAFF_PHONE_REQUIRED_MESSAGE) {
    return { status: 400, error: message };
  }
  if (err instanceof StaffPhoneInUseError) {
    return { status: 409, error: err.message };
  }
  if (message.includes('Unique constraint') && message.includes('whatsapp_phone')) {
    return { status: 409, error: 'This WhatsApp number is already registered to another company.' };
  }
  if (message.includes('Unique constraint') && message.includes('users_active_phone')) {
    return { status: 409, error: 'This mobile number is already registered to another active user.' };
  }
  if (
    message.includes('Transaction API error') ||
    message.includes('Transaction already closed') ||
    message.includes('expired transaction') ||
    message.includes('transaction timeout')
  ) {
    return {
      status: 503,
      error: 'Account setup took too long and was safely rolled back. Please try again.',
    };
  }

  return { status: 500, error: 'Failed to accept invite' };
}

export function getInviteAcceptErrorCode(error: string): string {
  if (error === 'Invalid invite link') return 'invite_not_found';
  if (error === 'Invite already accepted') return 'invite_already_accepted';
  if (error === 'Invite has expired') return 'invite_expired';
  if (error.includes('email already exists')) return 'email_already_registered';
  if (error.includes('mobile number') || error.includes('WhatsApp number')) return 'phone_already_registered';
  if (error.includes('took too long')) return 'invite_accept_timeout';
  return 'invite_accept_failed';
}
