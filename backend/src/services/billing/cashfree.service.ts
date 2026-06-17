import crypto from 'crypto';
import axios from 'axios';
import config from '../../config';
import logger from '../../config/logger';

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
 * Create a Cashfree PG order. Falls back to dev-mode checkout when credentials are missing.
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

  const response = await axios.post(`${getBaseUrl()}/orders`, body, { headers: getHeaders() });
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
    return { status: 'ACTIVE' };
  }

  const response = await axios.get(`${getBaseUrl()}/orders/${orderId}`, { headers: getHeaders() });
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
