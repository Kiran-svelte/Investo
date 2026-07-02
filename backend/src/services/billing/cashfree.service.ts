import crypto from 'crypto';
import axios from 'axios';
import config from '../../config';
import logger from '../../config/logger';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

export type CashfreeOrderResult = {
  orderId: string;
  paymentSessionId: string;
  checkoutUrl: string;
  devMode: boolean;
};

export type CashfreeWebhookPayload = {
  type?: string;
  data?: {
    order?: {
      order_id?: string;
      order_amount?: number;
      order_status?: string;
    };
    payment?: {
      cf_payment_id?: string;
      payment_status?: string;
      payment_method?: string;
    };
  };
};

export class CashfreeConfigurationError extends Error {
  constructor() {
    super('Cashfree payment gateway is not configured');
    this.name = 'CashfreeConfigurationError';
  }
}

export class CashfreeAccountNotEnabledError extends Error {
  readonly providerMessage: string;

  constructor(providerMessage: string) {
    super('Cashfree merchant account is not enabled for transactions');
    this.name = 'CashfreeAccountNotEnabledError';
    this.providerMessage = providerMessage;
  }
}

function getCashfreeErrorDetails(error: unknown): {
  status?: number;
  code?: string;
  type?: string;
  message?: string;
} {
  if (!axios.isAxiosError(error)) return {};

  const data = error.response?.data as
    | { code?: unknown; type?: unknown; message?: unknown }
    | undefined;

  return {
    status: error.response?.status,
    code: typeof data?.code === 'string' ? data.code : undefined,
    type: typeof data?.type === 'string' ? data.type : undefined,
    message: typeof data?.message === 'string' ? data.message : error.message,
  };
}

function isCashfreeAccountNotEnabled(details: { status?: number; message?: string }): boolean {
  return (
    details.status === 400 &&
    typeof details.message === 'string' &&
    /transactions are not enabled/i.test(details.message)
  );
}

function getBaseUrl(): string {
  return config.cashfree.sandbox
    ? 'https://sandbox.cashfree.com/pg'
    : 'https://api.cashfree.com/pg';
}

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-version': config.cashfree.apiVersion,
    'x-client-id': config.cashfree.appId,
    'x-client-secret': config.cashfree.secretKey,
  };
}

export function isCashfreeConfigured(): boolean {
  return Boolean(config.cashfree.appId && config.cashfree.secretKey);
}

export function generateOrderId(companyId: string): string {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `inv_${companyId.slice(0, 8)}_${Date.now()}_${suffix}`;
}

/**
 * INVESTO-20260629-PAYMENT-LOCKOUT:
 * Create a Cashfree PG order. Dev-mode checkout is local-only; production must
 * use real Cashfree credentials or return a safe setup error.
 */
export async function createCashfreeOrder(input: {
  orderId: string;
  amountInr: number;
  customerEmail: string;
  customerPhone?: string;
  customerName: string;
  returnUrl: string;
  notifyUrl: string;
  paymentMethods?: ('card' | 'upi' | 'nb')[];
}): Promise<CashfreeOrderResult> {
  if (!isCashfreeConfigured()) {
    if (config.env === 'production') {
      logger.error('Cashfree not configured in production', { orderId: input.orderId });
      throw new CashfreeConfigurationError();
    }
    logger.warn('Cashfree not configured — using dev-mode checkout', { orderId: input.orderId });
    return {
      orderId: input.orderId,
      paymentSessionId: `dev_session_${input.orderId}`,
      checkoutUrl: `${config.frontend.baseUrl}/dashboard/billing?order_id=${encodeURIComponent(input.orderId)}&dev_checkout=1`,
      devMode: true,
    };
  }

  const body: Record<string, unknown> = {
    order_id: input.orderId,
    order_amount: input.amountInr,
    order_currency: 'INR',
    customer_details: {
      customer_id: input.customerEmail.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50),
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone || '9999999999',
      customer_name: input.customerName,
    },
    order_meta: {
      return_url: input.returnUrl,
      notify_url: input.notifyUrl,
    },
  };

  if (input.paymentMethods?.length) {
    body.order_tags = { payment_methods: input.paymentMethods.join(',') };
  }

  let response;
  try {
    response = await axios.post(`${getBaseUrl()}/orders`, body, { headers: getHeaders() });
  } catch (err: unknown) {
    const details = getCashfreeErrorDetails(err);
    logger.warn('Cashfree order creation rejected', {
      orderId: input.orderId,
      status: details.status,
      code: details.code,
      type: details.type,
      message: details.message,
      resolutionId: RESOLUTION_IDS.CASHFREE_ACTIVATION,
    });

    if (isCashfreeAccountNotEnabled(details)) {
      throw new CashfreeAccountNotEnabledError(details.message || 'transactions are not enabled');
    }

    throw err;
  }

  const paymentSessionId = response.data?.payment_session_id as string;
  if (!paymentSessionId) {
    throw new Error('Cashfree did not return payment_session_id');
  }

  const checkoutUrl = config.cashfree.sandbox
    ? `https://sandbox.cashfree.com/pg/view/sessions/checkout/web/${paymentSessionId}`
    : `https://payments.cashfree.com/pg/view/sessions/checkout/web/${paymentSessionId}`;

  return {
    orderId: input.orderId,
    paymentSessionId,
    checkoutUrl,
    devMode: false,
  };
}

export async function fetchCashfreeOrder(orderId: string): Promise<{ status: string; paymentId?: string }> {
  if (!isCashfreeConfigured()) {
    if (config.env === 'production') {
      throw new CashfreeConfigurationError();
    }
    return { status: 'ACTIVE' };
  }

  let response;
  try {
    response = await axios.get(`${getBaseUrl()}/orders/${orderId}`, { headers: getHeaders() });
  } catch (err: unknown) {
    const details = getCashfreeErrorDetails(err);
    logger.warn('Cashfree order fetch rejected', {
      orderId,
      status: details.status,
      code: details.code,
      type: details.type,
      message: details.message,
      resolutionId: RESOLUTION_IDS.CASHFREE_ACTIVATION,
    });

    if (isCashfreeAccountNotEnabled(details)) {
      throw new CashfreeAccountNotEnabledError(details.message || 'transactions are not enabled');
    }

    throw err;
  }

  const orderStatus = (response.data?.order_status as string) || 'ACTIVE';
  const payments = response.data?.payments as Array<{ cf_payment_id?: string; payment_status?: string }> | undefined;
  const successPayment = payments?.find((p) => p.payment_status === 'SUCCESS');
  return {
    status: orderStatus,
    paymentId: successPayment?.cf_payment_id,
  };
}

export function verifyCashfreeWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
): boolean {
  if (!isCashfreeConfigured()) {
    return config.env !== 'production';
  }
  if (!signature || !timestamp) return false;

  const signedPayload = timestamp + rawBody;
  const expected = crypto
    .createHmac('sha256', config.cashfree.secretKey)
    .update(signedPayload)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function parseCashfreeWebhook(raw: unknown): CashfreeWebhookPayload {
  if (typeof raw === 'object' && raw !== null) {
    return raw as CashfreeWebhookPayload;
  }
  return {};
}
