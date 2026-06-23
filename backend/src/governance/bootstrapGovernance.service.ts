import logger from '../config/logger';
import {
  REAL_ESTATE_AI_CAPABILITIES_BLOCK,
  REAL_ESTATE_AI_LIMITS_BLOCK,
} from '../constants/realEstateAssistantPrompt.constants';
import { promptVersionService } from './promptVersion.service';

const DEFAULT_PROMPT_NAME = 'buyer_assistant';
const DEFAULT_PROMPT_VERSION = 'v1';

function defaultBuyerPromptContent(): string {
  return `${REAL_ESTATE_AI_CAPABILITIES_BLOCK}\n\n${REAL_ESTATE_AI_LIMITS_BLOCK}`;
}

export async function bootstrapGovernanceDefaults(): Promise<void> {
  if (!promptVersionService.isEnabled()) {
    return;
  }

  try {
    const existing = await promptVersionService.listVersions(DEFAULT_PROMPT_NAME);
    if (existing.length > 0) {
      return;
    }

    const created = await promptVersionService.createVersion({
      name: DEFAULT_PROMPT_NAME,
      version: DEFAULT_PROMPT_VERSION,
      content: defaultBuyerPromptContent(),
      status: 'active',
    });

    logger.info('Bootstrapped default prompt version for AI governance', {
      name: created.name,
      version: created.version,
    });
  } catch (err) {
    logger.warn('Governance bootstrap skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
