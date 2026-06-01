/**
 * CompanyBrainPanel
 *
 * UI panel for configuring the AI's "company brain" — business type,
 * operating locations, partner linking, special offers, and Never-Say-No rules.
 *
 * Part of the AI Settings page and the Onboarding wizard.
 */

import React, { useState } from 'react';

/** The subset of AI settings used by the company brain panel. */
export interface CompanyBrainConfig {
  businessType: 'residential_sale' | 'rental' | 'mixed' | 'commercial' | 'fractional';
  offerFractional: boolean;
  offerRentToOwn: boolean;
  budgetStretchPct: number;
  launchWeeksFromNow: number | null;
  specialOffers: string[];
  partnerCompanyIds: string[];
  operatorContact: { name: string; phone: string };
}

interface CompanyBrainPanelProps {
  /** Current configuration from the API. */
  value: CompanyBrainConfig;
  /** Called whenever the user changes any value — parent should debounce + save. */
  onChange: (updated: CompanyBrainConfig) => void;
  /** Loading state from parent save operation. */
  isSaving?: boolean;
}

const BUSINESS_TYPE_OPTIONS: { value: CompanyBrainConfig['businessType']; label: string; description: string }[] = [
  {
    value: 'residential_sale',
    label: '🏡 Residential Sale',
    description: 'You sell residential properties (flats, villas, plots).',
  },
  {
    value: 'rental',
    label: '🔑 Rental Only',
    description: 'You only rent properties. AI will offer rent-to-own when clients ask to buy.',
  },
  {
    value: 'mixed',
    label: '🏢 Mixed (Sale + Rental)',
    description: 'You handle both sale and rental. AI will match the right option.',
  },
  {
    value: 'commercial',
    label: '🏗️ Commercial',
    description: 'You deal in commercial spaces (offices, retail, warehouses).',
  },
  {
    value: 'fractional',
    label: '📈 Fractional Ownership',
    description: 'Specialist in fractional/co-ownership investment properties.',
  },
];

/** Single-line input for special offers with add/remove. */
function SpecialOffersInput({
  offers,
  onAdd,
  onRemove,
}: {
  offers: string[];
  onAdd: (offer: string) => void;
  onRemove: (index: number) => void;
}) {
  const [draft, setDraft] = useState('');

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          id="special-offer-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Zero brokerage for December, Free modular kitchen"
          className="flex-1 px-3 py-2 rounded-lg border border-white/20 bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
        />
        <button
          type="button"
          id="add-offer-btn"
          onClick={handleAdd}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
        >
          Add
        </button>
      </div>
      {offers.length > 0 && (
        <ul className="space-y-1">
          {offers.map((offer, index) => (
            <li
              key={`offer-${index}`}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/10 text-sm text-white"
            >
              <span>🎁 {offer}</span>
              <button
                type="button"
                id={`remove-offer-${index}`}
                onClick={() => onRemove(index)}
                className="text-red-400 hover:text-red-300 ml-2 text-xs"
                aria-label={`Remove offer: ${offer}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {offers.length === 0 && (
        <p className="text-white/40 text-xs">No offers configured. Add current promotions so the AI mentions them.</p>
      )}
    </div>
  );
}

/**
 * Full company brain configuration panel.
 * Controls how the AI behaves when it encounters inventory gaps.
 */
export function CompanyBrainPanel({ value, onChange, isSaving = false }: CompanyBrainPanelProps) {
  const updateField = <K extends keyof CompanyBrainConfig>(key: K, val: CompanyBrainConfig[K]) => {
    onChange({ ...value, [key]: val });
  };

  const addOffer = (offer: string) => {
    updateField('specialOffers', [...value.specialOffers, offer]);
  };

  const removeOffer = (index: number) => {
    updateField(
      'specialOffers',
      value.specialOffers.filter((_, i) => i !== index),
    );
  };

  return (
    <div className="space-y-6">
      {/* Business Type */}
      <section aria-labelledby="business-type-heading">
        <h3 id="business-type-heading" className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-3">
          Business Type
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {BUSINESS_TYPE_OPTIONS.map((option) => {
            const isSelected = value.businessType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                id={`business-type-${option.value}`}
                onClick={() => updateField('businessType', option.value)}
                className={`text-left p-3 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-600/30 ring-2 ring-indigo-500/50'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                aria-pressed={isSelected}
              >
                <div className="font-medium text-white text-sm">{option.label}</div>
                <div className="text-white/50 text-xs mt-0.5">{option.description}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Smart Fallback Toggles */}
      <section aria-labelledby="fallback-toggles-heading">
        <h3 id="fallback-toggles-heading" className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-3">
          Never-Say-No Rules
        </h3>
        <p className="text-white/50 text-xs mb-4">
          When the AI can't find an exact match, these rules determine what alternatives it offers.
        </p>
        <div className="space-y-3">
          {/* Fractional Toggle */}
          <label
            htmlFor="toggle-fractional"
            className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5 cursor-pointer"
          >
            <div>
              <div className="text-white text-sm font-medium">📈 Offer Fractional Ownership</div>
              <div className="text-white/50 text-xs">
                When budget is below ₹75L, offer fractional ownership as an alternative.
              </div>
            </div>
            <input
              id="toggle-fractional"
              type="checkbox"
              checked={value.offerFractional}
              onChange={(e) => updateField('offerFractional', e.target.checked)}
              className="w-5 h-5 rounded accent-indigo-500 cursor-pointer"
            />
          </label>

          {/* Rent-to-Own Toggle */}
          {value.businessType === 'rental' || value.businessType === 'mixed' ? (
            <label
              htmlFor="toggle-rent-to-own"
              className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5 cursor-pointer"
            >
              <div>
                <div className="text-white text-sm font-medium">🔑 Offer Rent-to-Own</div>
                <div className="text-white/50 text-xs">
                  When rental client wants to buy, offer: "Rent 12 months, deduct 50% from purchase price."
                </div>
              </div>
              <input
                id="toggle-rent-to-own"
                type="checkbox"
                checked={value.offerRentToOwn}
                onChange={(e) => updateField('offerRentToOwn', e.target.checked)}
                className="w-5 h-5 rounded accent-indigo-500 cursor-pointer"
              />
            </label>
          ) : null}

          {/* Budget Stretch */}
          <div className="p-3 rounded-xl border border-white/10 bg-white/5">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-white text-sm font-medium">💡 Budget Stretch Offer</div>
                <div className="text-white/50 text-xs">
                  Max % above budget the AI will suggest (with EMI bridge calculation).
                </div>
              </div>
              <span className="text-indigo-400 font-bold text-lg">{value.budgetStretchPct}%</span>
            </div>
            <input
              id="budget-stretch-slider"
              type="range"
              min={5}
              max={50}
              step={5}
              value={value.budgetStretchPct}
              onChange={(e) => updateField('budgetStretchPct', Number(e.target.value))}
              className="w-full accent-indigo-500"
              aria-label="Budget stretch percentage"
            />
            <div className="flex justify-between text-white/30 text-xs mt-1">
              <span>5% (conservative)</span>
              <span>50% (aggressive)</span>
            </div>
          </div>

          {/* Pre-launch weeks */}
          <div className="p-3 rounded-xl border border-white/10 bg-white/5">
            <div className="flex items-center justify-between mb-1">
              <div>
                <div className="text-white text-sm font-medium">📅 Upcoming Launch</div>
                <div className="text-white/50 text-xs">
                  If you have a new inventory launch, tell the AI when it's happening.
                </div>
              </div>
            </div>
            <div className="flex gap-2 items-center mt-2">
              <input
                id="launch-weeks-input"
                type="number"
                min={0}
                max={52}
                placeholder="e.g. 4"
                value={value.launchWeeksFromNow ?? ''}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  updateField('launchWeeksFromNow', Number.isFinite(n) && n > 0 ? n : null);
                }}
                className="w-24 px-3 py-2 rounded-lg border border-white/20 bg-white/5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-white/50 text-sm">weeks from now</span>
              {value.launchWeeksFromNow && (
                <button
                  type="button"
                  id="clear-launch-weeks"
                  onClick={() => updateField('launchWeeksFromNow', null)}
                  className="text-red-400 hover:text-red-300 text-xs"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Special Offers */}
      <section aria-labelledby="special-offers-heading">
        <h3 id="special-offers-heading" className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-3">
          Current Special Offers
        </h3>
        <p className="text-white/50 text-xs mb-3">
          The AI will mention these offers naturally in conversation to accelerate conversion.
        </p>
        <SpecialOffersInput
          offers={value.specialOffers}
          onAdd={addOffer}
          onRemove={removeOffer}
        />
      </section>

      {/* Human Escalation Contact */}
      <section aria-labelledby="escalation-contact-heading">
        <h3 id="escalation-contact-heading" className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-3">
          Human Escalation Contact
        </h3>
        <p className="text-white/50 text-xs mb-3">
          When a client asks for a "real person", the AI will offer to connect them here.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="operator-name" className="block text-white/60 text-xs mb-1">
              Contact Name
            </label>
            <input
              id="operator-name"
              type="text"
              placeholder="e.g. Rahul (Sales Manager)"
              value={value.operatorContact.name}
              onChange={(e) =>
                updateField('operatorContact', { ...value.operatorContact, name: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-white/20 bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          <div>
            <label htmlFor="operator-phone" className="block text-white/60 text-xs mb-1">
              WhatsApp Number
            </label>
            <input
              id="operator-phone"
              type="tel"
              placeholder="e.g. +91 98765 43210"
              value={value.operatorContact.phone}
              onChange={(e) =>
                updateField('operatorContact', { ...value.operatorContact, phone: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-white/20 bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Save indicator */}
      {isSaving && (
        <div className="flex items-center gap-2 text-indigo-400 text-sm">
          <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          Saving company brain settings…
        </div>
      )}
    </div>
  );
}
