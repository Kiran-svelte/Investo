import type { EvalCase } from './evalTypes';
import { enforceTurnComponentBudget } from '../services/whatsapp/whatsappTurnOrchestrator.service';
import type { WhatsAppComponent } from '../types/whatsapp-turn.types';

export type OutboundBudgetInput = {
  components: WhatsAppComponent[];
};

export type OutboundBudgetExpected = {
  maxInteractive: number;
  maxMedia: number;
  maxTotal: number;
};

export type OutboundBudgetActual = {
  interactiveCount: number;
  mediaCount: number;
  total: number;
};

export const outboundBudgetEvalCases: Array<EvalCase<OutboundBudgetInput, OutboundBudgetExpected>> = [
  {
    id: 'outbound-shortlist-buttons-plus-hero',
    category: 'outbound-budget',
    description: 'Shortlist turn may include buttons and one hero image (max 2 components).',
    severity: 'critical',
    input: {
      components: [
        { kind: 'buttons', buttons: [{ id: 'book-visit', title: 'Book Visit' }] },
        { kind: 'media', url: 'https://cdn.example.com/hero.jpg', mime: 'image/jpeg' },
      ],
    },
    expected: { maxInteractive: 1, maxMedia: 1, maxTotal: 2 },
  },
  {
    id: 'outbound-filter-list-plus-hero',
    category: 'outbound-budget',
    description: 'Filter shortlist turn may include list and one hero image (max 2 components).',
    severity: 'critical',
    input: {
      components: [
        {
          kind: 'list',
          title: 'View Properties',
          sections: [{ title: '2 BHK Options (3)', rows: [{ id: 'prop-1', title: 'Sunrise Apts' }] }],
        },
        { kind: 'media', url: 'https://cdn.example.com/hero.jpg', mime: 'image/jpeg' },
      ],
    },
    expected: { maxInteractive: 1, maxMedia: 1, maxTotal: 2 },
  },
  {
    id: 'outbound-brochure-over-duplicate-media',
    category: 'outbound-budget',
    description: 'Property detail turn may include brochure PDF, hero image, and buttons.',
    severity: 'high',
    input: {
      components: [
        { kind: 'media', url: 'https://cdn.example.com/brochure.pdf', mime: 'application/pdf' },
        { kind: 'media', url: 'https://cdn.example.com/hero.jpg', mime: 'image/jpeg' },
        { kind: 'buttons', buttons: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] },
      ],
    },
    expected: { maxInteractive: 1, maxMedia: 2, maxTotal: 3 },
  },
];

export function evaluateOutboundBudget(input: OutboundBudgetInput): OutboundBudgetActual {
  const budgeted = enforceTurnComponentBudget(input.components);
  return {
    interactiveCount: budgeted.filter((c) => c.kind === 'buttons' || c.kind === 'list').length,
    mediaCount: budgeted.filter((c) => c.kind === 'media').length,
    total: budgeted.length,
  };
}
