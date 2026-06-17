import config from '../config';
import { getCircuitBreaker } from '../utils/circuit-breaker';

const META_WHATSAPP_BREAKER_NAME = 'meta_whatsapp_outbound';

export const metaWhatsAppCircuitBreaker = getCircuitBreaker({
  name: META_WHATSAPP_BREAKER_NAME,
  failureThreshold: 5,
  recoveryTimeoutMs: 60_000,
  halfOpenMaxAttempts: 1,
});

export async function executeMetaApiWithCircuitBreaker<T>(operation: () => Promise<T>): Promise<T> {
  if (!config.features?.metaCircuitBreaker) {
    return operation();
  }
  return metaWhatsAppCircuitBreaker.execute(operation);
}

export function getMetaApiCircuitState() {
  return metaWhatsAppCircuitBreaker.getState();
}
