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
    const controller = new AbortController();
    const timeoutMs = config.langgraph.timeoutMs || 5000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.error('LangGraph adapter non-2xx response', { status: resp.status });
      return { skipped: false, ok: false, error: `HTTP ${resp.status}`, data };
    }
    logger.info('LangGraph adapter received response', { status: resp.status });
    return { skipped: false, ok: true, data };
  } catch (err: any) {
    logger.error('LangGraph adapter request failed', { error: err.message });
    return { skipped: false, ok: false, error: err.message };
  }
}

export default { sendToLangGraph };
