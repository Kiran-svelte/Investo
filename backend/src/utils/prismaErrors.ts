import { Prisma } from '@prisma/client';

export function mapPrismaError(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target)
        ? (err.meta?.target as string[]).join(', ')
        : String(err.meta?.target || '');
      if (target.includes('whatsapp_phone') || target.includes('whatsappPhone')) {
        return 'This WhatsApp number is already registered to another agency. Use your agency\'s own business WhatsApp number.';
      }
      return 'A record with this value already exists.';
    }
  }
  return null;
}
