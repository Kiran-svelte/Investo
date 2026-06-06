import prisma from '../config/prisma';
import { buildPromptMemoryBlock } from './lead-memory.service';
import { getLiveLeadContext } from './liveLeadContext.service';

const MAX_BLOCK_CHARS = 1600;

function stripBoilerplate(text: string): string {
  return text
    .replace(/\*Catalog matches[^*]*\*/gi, '')
    .replace(/Brochure PDF:\s*\S+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cheap rolling context block for buyer AI + staff invokeAgent.
 * Sources: LeadMemory → recent messages → liveLeadContext.
 */
export async function buildConversationContextBlock(
  conversationId: string | undefined | null,
  leadId: string | undefined | null,
  companyId?: string,
): Promise<string> {
  const lines: string[] = ['## Recent context'];

  if (leadId) {
    const memoryBlock = await buildPromptMemoryBlock(leadId);
    if (memoryBlock.includes('Discussed:') || memoryBlock.includes('Summary:')) {
      lines.push(memoryBlock.replace('## Lead memory (known facts)', '').trim());
    }
  }

  if (conversationId) {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { senderType: true, content: true, createdAt: true },
    });

    const customerMsgs = messages
      .filter((m) => m.senderType === 'customer')
      .slice(0, 5)
      .reverse()
      .map((m) => stripBoilerplate(m.content).slice(0, 120))
      .filter(Boolean);

    const aiMsgs = messages
      .filter((m) => m.senderType === 'ai')
      .slice(0, 3)
      .reverse()
      .map((m) => stripBoilerplate(m.content).slice(0, 100))
      .filter(Boolean);

    if (customerMsgs.length) {
      lines.push('- Recent customer asks:');
      for (const msg of customerMsgs.slice(-3)) {
        lines.push(`  • "${msg}"`);
      }
    }
    if (aiMsgs.length) {
      lines.push('- Recent AI replies:');
      for (const msg of aiMsgs.slice(-2)) {
        lines.push(`  • "${msg}"`);
      }
    }
  }

  if (leadId && companyId) {
    const live = await getLiveLeadContext(leadId, companyId);
    if (live.promptBlock?.trim()) {
      lines.push(live.promptBlock.trim());
    }
  }

  const block = lines.filter(Boolean).join('\n');
  return block.length > MAX_BLOCK_CHARS ? `${block.slice(0, MAX_BLOCK_CHARS)}…` : block;
}
