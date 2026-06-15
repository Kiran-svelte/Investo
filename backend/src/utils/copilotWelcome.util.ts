/**
 * Localized Investo Copilot welcome messages for staff WhatsApp.
 * Uses the company AI default language (same codes as buyer AI).
 */

const COPILOT_WELCOME_BY_LANG: Record<string, (name: string, company: string) => string> = {
  en: (name, company) =>
    `*Hi ${name}!* Welcome to *Investo Copilot* for *${company}*.\n\n` +
    `I can help you with:\n` +
    `- *Visits* - "visits today", "visits tomorrow", "visits on 6th June"\n` +
    `- *Leads* - "new leads today", "get lead Rahul", "update lead status"\n` +
    `- *Properties* - "list properties", "property details"\n` +
    `- *Analytics* - "dashboard stats", "my performance"\n` +
    `- *Actions* - "confirm visit", "mark lead visited", "send brochure"\n\n` +
    `Type *CHECK IN* at start of day or *CHECK OUT* at end of day for your briefing.\n` +
    `Just type your command or tap a shortcut below.`,
  hi: (name, company) =>
    `*नमस्ते ${name}!* *${company}* के लिए *Investo Copilot* में आपका स्वागत है।\n\n` +
    `मैं इनमें मदद कर सकता/सकती हूँ:\n` +
    `- *विज़िट* - "आज की visits", "कल की visits"\n` +
    `- *लीड* - "आज की new leads", "lead Rahul दिखाओ"\n` +
    `- *प्रॉपर्टी* - "list properties", "property details"\n` +
    `- *एनालिटिक्स* - "dashboard stats", "my performance"\n` +
    `- *एक्शन* - "confirm visit", "mark lead visited"\n\n` +
    `कमांड टाइप करें या नीचे शॉर्टकट टैप करें।`,
  kn: (name, company) =>
    `*ನಮಸ್ಕಾರ ${name}!* *${company}* ಗಾಗಿ *Investo Copilot* ಗೆ ಸ್ವಾಗತ.\n\n` +
    `ನಾನು ಸಹಾಯ ಮಾಡಬಲ್ಲೆ:\n` +
    `- *Visits* - "visits today", "visits tomorrow"\n` +
    `- *Leads* - "new leads today", "get lead Rahul"\n` +
    `- *Properties* - "list properties"\n` +
    `- *Analytics* - "dashboard stats"\n` +
    `- *Actions* - "confirm visit", "mark lead visited"\n\n` +
    `ಕಮಾಂಡ್ ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ಕೆಳಗಿನ ಶಾರ್ಟ್‌ಕಟ್ ಟ್ಯಾಪ್ ಮಾಡಿ.`,
  te: (name, company) =>
    `*హాయ్ ${name}!* *${company}* కోసం *Investo Copilot* కు స్వాగతం.\n\n` +
    `నేను సహాయం చేయగలను:\n` +
    `- *Visits* - "visits today", "visits tomorrow"\n` +
    `- *Leads* - "new leads today", "get lead Rahul"\n` +
    `- *Properties* - "list properties"\n` +
    `- *Analytics* - "dashboard stats"\n` +
    `- *Actions* - "confirm visit", "mark lead visited"\n\n` +
    `కమాండ్ టైప్ చేయండి లేదా క్రింద షార్ట్‌కట్ ట్యాప్ చేయండి.`,
  ta: (name, company) =>
    `*வணக்கம் ${name}!* *${company}* க்கான *Investo Copilot* க்கு வரவேற்கிறோம்.\n\n` +
    `நான் உதவ முடியும்:\n` +
    `- *Visits* - "visits today", "visits tomorrow"\n` +
    `- *Leads* - "new leads today", "get lead Rahul"\n` +
    `- *Properties* - "list properties"\n` +
    `- *Analytics* - "dashboard stats"\n` +
    `- *Actions* - "confirm visit", "mark lead visited"\n\n` +
    `கட்டளையை தட்டச்சு செய்யுங்கள் அல்லது கீழே உள்ள ஷார்ட்கட் தட்டுங்கள்.`,
};

export function normalizeCopilotLanguageCode(code?: string | null): string {
  const raw = (code ?? 'en').trim().toLowerCase();
  const base = raw.split(/[-_]/)[0];
  return base || 'en';
}

export function buildCopilotWelcomeMessage(
  userName: string,
  companyName: string,
  languageCode?: string | null,
): string {
  const name = userName.trim() || 'there';
  const company = companyName.trim() || 'your company';
  const lang = normalizeCopilotLanguageCode(languageCode);
  const builder = COPILOT_WELCOME_BY_LANG[lang] ?? COPILOT_WELCOME_BY_LANG.en;
  return builder(name, company);
}

export async function getCompanyDefaultLanguage(companyId: string): Promise<string> {
  const { default: prisma } = await import('../config/prisma');
  const settings = await prisma.aiSetting.findUnique({
    where: { companyId },
    select: { defaultLanguage: true },
  });
  return normalizeCopilotLanguageCode(settings?.defaultLanguage);
}
