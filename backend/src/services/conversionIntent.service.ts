/**
 * Detects customer intents from inbound text for Never-Say-No scenario routing.
 */

export interface ConversionIntents {
  wantsToBuy: boolean;
  wantsToRent: boolean;
  wantsCommercial: boolean;
  wantsPlot: boolean;
  wantsIndependentHouse: boolean;
  wantsPanIndia: boolean;
  wantsInternational: boolean;
  urgentPossession: boolean;
  notInterested: boolean;
  tooExpensive: boolean;
  letMeThink: boolean;
  foundElsewhere: boolean;
  blockedOrSilent: boolean;
}

export function detectConversionIntents(message: string): ConversionIntents {
  const m = message.toLowerCase();

  return {
    wantsToBuy: /\b(buy|purchase|own|buying)\b/i.test(m),
    wantsToRent: /\b(rent|rental|lease|leasing)\b/i.test(m),
    wantsCommercial: /\b(commercial|office|retail|warehouse|shop space)\b/i.test(m),
    wantsPlot: /\b(plot|land|site|acre)\b/i.test(m),
    wantsIndependentHouse: /\b(independent house|individual house|bungalow)\b/i.test(m),
    wantsPanIndia: /\b(pan india|all india|multiple cities|pune|hyderabad|chennai|mumbai|delhi|ncr)\b/i.test(m),
    wantsInternational: /\b(dubai|uae|abroad|international|overseas|nri)\b/i.test(m),
    urgentPossession:
      /\b(1 month|one month|immediate|immediately|ready to move|rtm|urgent possession|asap)\b/i.test(m),
    notInterested: /\b(not interested|no thanks|don't want|stop messaging)\b/i.test(m),
    tooExpensive: /\b(too expensive|can't afford|out of budget|costly|high price)\b/i.test(m),
    letMeThink: /\b(let me think|will think|need time|later)\b/i.test(m),
    foundElsewhere: /\b(found (another|a property)|already (found|booked)|signed elsewhere)\b/i.test(m),
    blockedOrSilent: /\b(block|unsubscribe|stop)\b/i.test(m),
  };
}
