import { createAuthClient } from '@neondatabase/neon-js/auth';

export const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL || 'https://ep-billowing-salad-an35vjcp.neonauth.c-6.us-east-1.aws.neon.tech/neondb/auth');
