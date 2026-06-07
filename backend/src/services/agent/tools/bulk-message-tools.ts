import { z } from 'zod';
import prisma from '../../../config/prisma';
import { ToolContext } from '../agent-state';
import { maskPhone } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

/**
 * Maximum phone numbers that can be targeted in a single bulk send.
 * Prevents accidental mass-spam and rate-limit exhaustion.
 */
const MAX_BULK_RECIPIENTS = 50;

/**
 * Normalizes a raw phone string to E.164-like format.
 * Strips spaces, dashes, parentheses, and leading '+'.
 * Prepends '91' country code if the number is 10 digits (Indian mobile).
 *
 * @param raw - Raw phone string from the agent message.
 * @returns Normalized phone string, or null if unparseable.
 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

/**
 * sendBulkMessages agent tool.
 *
 * Sends a WhatsApp text message to multiple phone numbers in a single command.
 * Rate-limited to MAX_BULK_RECIPIENTS per invocation.
 * Each send is attempted independently — partial failures are reported.
 *
 * Used when an Investo user types:
 *   "send 'message text' to +91XXXXXX, +91YYYYYY, +91ZZZZZZ"
 *
 * @param context - Caller identity and company scope.
 * @returns Array of AgentTool instances.
 */
export function createBulkMessageTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'sendBulkMessages',
      description:
        'Send a WhatsApp text message to multiple phone numbers at once. ' +
        'Use when the user says "send [message] to [phone1], [phone2], ...". ' +
        'Accepts raw Indian phone numbers (10-digit or E.164 +91 format). ' +
        `Max ${MAX_BULK_RECIPIENTS} recipients per call.`,
      schema: z.object({
        message: z
          .string()
          .min(1)
          .max(2000)
          .describe('The text message to send to all recipients.'),
        phoneNumbers: z
          .array(z.string().min(6))
          .min(1)
          .max(MAX_BULK_RECIPIENTS)
          .describe(
            'List of phone numbers to send to. Accepts 10-digit, +91, or 91-prefixed formats.',
          ),
      }),
      func: async ({ message, phoneNumbers }) => {
        if (phoneNumbers.length > MAX_BULK_RECIPIENTS) {
          return `Error: Cannot send to more than ${MAX_BULK_RECIPIENTS} numbers in one command. You provided ${phoneNumbers.length}.`;
        }

        // Normalize all numbers up front and reject the whole batch if any are invalid.
        const normalized: Array<{ original: string; phone: string }> = [];
        const invalid: string[] = [];

        for (const raw of phoneNumbers) {
          const phone = normalizePhone(raw.trim());
          if (phone) {
            normalized.push({ original: raw.trim(), phone });
          } else {
            invalid.push(raw.trim());
          }
        }

        if (invalid.length > 0) {
          return (
            `Invalid phone numbers (cannot parse): ${invalid.join(', ')}.\n` +
            `Please provide 10-digit Indian numbers or E.164 (+91XXXXXXXXXX) format.`
          );
        }

        const { whatsappService } = await import('../../whatsapp.service');

        const results: Array<{ phone: string; status: 'sent' | 'failed'; error?: string }> = [];

        // Send sequentially to avoid hammering the Meta rate limit.
        for (const { original, phone } of normalized) {
          try {
            await whatsappService.sendCompanyTextMessage(phone, message, context.companyId);
            results.push({ phone: maskPhone(phone), status: 'sent' });

            // Log the outbound message against the lead's conversation if it exists.
            const conversation = await prisma.conversation.findFirst({
              where: { whatsappPhone: phone, companyId: context.companyId },
            });
            if (conversation) {
              await prisma.message.create({
                data: {
                  conversationId: conversation.id,
                  senderType: 'agent',
                  content: message,
                },
              });
            }
          } catch (err: unknown) {
            results.push({
              phone: maskPhone(original),
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const sent = results.filter((r) => r.status === 'sent');
        const failed = results.filter((r) => r.status === 'failed');

        const lines = [
          `*Bulk send complete*`,
          `✅ Sent: ${sent.length}/${results.length}`,
          ...sent.map((r) => `  • ${r.phone}`),
        ];

        if (failed.length > 0) {
          lines.push(`❌ Failed: ${failed.length}`);
          for (const f of failed) {
            lines.push(`  • ${f.phone}: ${f.error ?? 'unknown error'}`);
          }
        }

        return lines.join('\n');
      },
    }),
  ];
}
