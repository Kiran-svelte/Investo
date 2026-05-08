import axios from 'axios';
import config from '../config';
import logger from '../config/logger';

type LangGraphPayload = {
  event: string;
  session: string;
  body: string;
  type: string;
  isNewMsg: boolean;
  sender: { id: string; isUser: boolean };
  isGroupMsg: boolean;
};

export async function sendToLangGraph(payload: LangGraphPayload): Promise<any> {
  if (!config.langgraph?.enabled) {
    logger.debug('LangGraph disabled in config; skipping send');
    return { skipped: true };
  }

  const url = `${config.langgraph.url.replace(/\/+$/,'')}/webhook`;

  try {
    const resp = await axios.post(url, payload, {
      timeout: config.langgraph.timeoutMs || 5000,
      headers: { 'Content-Type': 'application/json' },
    });

    logger.info('LangGraph adapter received response', { status: resp.status });
    return { skipped: false, ok: true, data: resp.data };
  } catch (err: any) {
    logger.error('LangGraph adapter request failed', { error: err.message });
    return { skipped: false, ok: false, error: err.message };
  }
}

export default { sendToLangGraph };
