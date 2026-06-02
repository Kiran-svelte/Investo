import { aiService } from './ai.service';
import logger from '../config/logger';
import config from '../config';

type BridgeRequest = {
  phone: string;
  message: string;
  companyId?: string;
  conversationState?: any;
};

export async function runEnterpriseAgent(req: BridgeRequest): Promise<any> {
  if (!config.enterpriseAgent?.enabled) {
    logger.debug('EnterpriseAgent disabled; skipping bridge');
    return { skipped: true };
  }

  try {
    const aiResp = await aiService.generateResponse({
      customerMessage: req.message,
      conversationHistory: [],
      lead: { customerName: '', phone: req.phone },
      properties: [],
      aiSettings: {},
      companyName: '',
      conversationState: req.conversationState,
    } as any);

    return { skipped: false, ok: true, data: aiResp };
  } catch (err: any) {
    logger.error('EnterpriseAgentBridge failed', { error: err.message });
    return { skipped: false, ok: false, error: err.message };
  }
}

export default { runEnterpriseAgent };
