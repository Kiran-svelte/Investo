import config from '../../config';
import {
  isPropertyInquiryMessage,
  shouldBypassBuyerWorkflowForRichPropertyLlm,
} from '../../services/customerMessageFastPath.service';

describe('shouldBypassBuyerWorkflowForRichPropertyLlm', () => {
  const original = config.features.detailQuestionLlm;

  afterEach(() => {
    config.features.detailQuestionLlm = original;
  });

  it('bypasses thin workflows for property detail questions when flag on', () => {
    config.features.detailQuestionLlm = true;
    expect(shouldBypassBuyerWorkflowForRichPropertyLlm('What is the carpet area for Green Valley?')).toBe(true);
    expect(shouldBypassBuyerWorkflowForRichPropertyLlm('Tell me about amenities at Skyline')).toBe(true);
  });

  it('does not bypass visit scheduling', () => {
    config.features.detailQuestionLlm = true;
    expect(shouldBypassBuyerWorkflowForRichPropertyLlm('Book visit Saturday 11am')).toBe(false);
  });

  it('returns false when detailQuestionLlm flag off', () => {
    config.features.detailQuestionLlm = false;
    expect(shouldBypassBuyerWorkflowForRichPropertyLlm('What is the price?')).toBe(false);
  });

  it('isPropertyInquiryMessage matches import-field questions', () => {
    expect(isPropertyInquiryMessage('carpet area for villa')).toBe(true);
    expect(isPropertyInquiryMessage('possession date')).toBe(true);
  });
});
