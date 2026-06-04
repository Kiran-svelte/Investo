"use strict";
/**
 * Post-LLM guard: ensures replies never dead-end without an alternative CTA.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceNeverSayNoResponse = enforceNeverSayNoResponse;
const groundingGuard_service_1 = require("./groundingGuard.service");
const DEAD_END_PATTERNS = [
    /\bwe don'?t have\b/i,
    /\bnot available\b/i,
    /\bsorry,? we\b/i,
    /\bnothing (available|matches)\b/i,
    /\bno (inventory|properties|listings)\b/i,
    /\bunfortunately\b/i,
];
const VISIT_ALREADY_ADDRESSED = [
    /\bvisit\s+(scheduled|confirmed|booked|noted|set)\b/i,
    /\b(site\s+)?visit\b.*\b(saturday|sunday|monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i,
    /\bagent will (call|give you a call|contact)\b/i,
    /\bsee you (then|there|soon)\b/i,
    /\bpreferred (visit )?time\b/i,
    /\bnoted your preference\b/i,
    /\bconfirm everything\b/i,
    /✅\s*\*?Visit scheduled/i,
];
function visitAlreadyAddressed(text) {
    return VISIT_ALREADY_ADDRESSED.some((p) => p.test(text));
}
function applyGrounding(text, input) {
    if (!input.groundedProperties?.length) {
        return { text, guardApplied: false };
    }
    const allowlist = (0, groundingGuard_service_1.buildGroundedNumberAllowlist)(input.groundedProperties, input.conversionPromptBlock);
    return (0, groundingGuard_service_1.stripUngroundedClaims)(text, allowlist);
}
function enforceNeverSayNoResponse(input) {
    const trimmed = input.text.trim();
    let resultText;
    let guardApplied = false;
    if (!trimmed) {
        resultText = `${input.fallbackCta}\n\nWhich option should I share first?`;
        guardApplied = true;
    }
    else {
        const hasDeadEnd = DEAD_END_PATTERNS.some((p) => p.test(trimmed));
        const lacksQuestion = !trimmed.includes('?');
        const skipCta = input.skipFallbackCta || visitAlreadyAddressed(trimmed);
        if (!hasDeadEnd && (!lacksQuestion || skipCta)) {
            resultText = trimmed;
        }
        else if (hasDeadEnd || (lacksQuestion && !input.hasInventoryAlternatives)) {
            const bridge = input.hasInventoryAlternatives
                ? 'I do have strong alternatives for you — let me share the best matches.'
                : 'I can still help with waitlist, EMI options, partner inventory, or a free legal check on any property you find.';
            resultText = `${bridge}\n\n${input.fallbackCta}`;
            guardApplied = true;
        }
        else if (lacksQuestion && !skipCta) {
            resultText = `${trimmed}\n\n${input.fallbackCta}`;
            guardApplied = true;
        }
        else {
            resultText = trimmed;
        }
    }
    const grounded = applyGrounding(resultText, input);
    return {
        text: grounded.text,
        guardApplied: guardApplied || grounded.guardApplied,
    };
}
