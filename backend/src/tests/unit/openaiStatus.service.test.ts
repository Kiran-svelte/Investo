import {
  isOpenAiHardDown,
  parseOpenAiError,
} from '../../services/openaiStatus.service';

describe('openaiStatus.service', () => {
  it('classifies invalid API key as hard down', () => {
    const info = parseOpenAiError(401, '{"error":{"message":"Incorrect API key","type":"invalid_request_error","code":"invalid_api_key"}}');
    expect(info.kind).toBe('invalid_key');
    expect(info.retryable).toBe(false);
    expect(isOpenAiHardDown(info.kind)).toBe(true);
  });

  it('classifies insufficient quota as hard down', () => {
    const info = parseOpenAiError(429, '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}');
    expect(info.kind).toBe('insufficient_quota');
    expect(isOpenAiHardDown(info.kind)).toBe(true);
  });

  it('classifies generic rate limit as retryable', () => {
    const info = parseOpenAiError(429, '{"error":{"message":"Rate limit reached for requests"}}');
    expect(info.kind).toBe('rate_limited');
    expect(info.retryable).toBe(true);
    expect(isOpenAiHardDown(info.kind)).toBe(false);
  });
});
