import { Prisma } from '@prisma/client';

function isUniqueConstraintError(err: unknown): err is { code: 'P2002'; meta?: { target?: unknown } } {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'P2002');
}

export function mapPrismaError(err: unknown): string | null {
  const prismaErr =
    err instanceof Prisma.PrismaClientKnownRequestError
      ? err
      : isUniqueConstraintError(err)
        ? err
        : null;

  if (prismaErr?.code === 'P2002') {
    const target = Array.isArray(prismaErr.meta?.target)
      ? (prismaErr.meta?.target as string[]).join(', ')
      : String(prismaErr.meta?.target || '');
    if (target.includes('whatsapp_phone') || target.includes('whatsappPhone')) {
      return 'This WhatsApp number is already registered to another agency. Use your agency\'s own business WhatsApp number.';
    }
    return 'A record with this value already exists.';
  }

  return null;
}
