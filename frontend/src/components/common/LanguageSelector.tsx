import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check, ChevronDown } from 'lucide-react';

// ──────────────────────────────────────────────
// Supported languages
// ──────────────────────────────────────────────

interface Language {
  code: string;
  nativeLabel: string; // fallback shown if translation key is missing
}

const LANGUAGES: Language[] = [
  { code: 'en', nativeLabel: 'English' },
  { code: 'hi', nativeLabel: '\u0939\u093F\u0928\u094D\u0926\u0940' },
  { code: 'kn', nativeLabel: '\u0C95\u0CA8\u0CCD\u0CA8\u0CA1' },
  { code: 'te', nativeLabel: '\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41' },
  { code: 'ta', nativeLabel: '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD' },
  { code: 'ml', nativeLabel: '\u0D2E\u0D32\u0D2F\u0D3E\u0D33\u0D02' },
  { code: 'mr', nativeLabel: '\u092E\u0930\u093E\u0920\u0940' },
  { code: 'bn', nativeLabel: '\u09AC\u09BE\u0982\u09B2\u09BE' },
  { code: 'gu', nativeLabel: '\u0A97\u0AC1\u0A9C\u0AB0\u0ABE\u0AA4\u0AC0' },
  { code: 'pa', nativeLabel: '\u0A2A\u0A70\u0A1C\u0A3E\u0A2C\u0A40' },
  { code: 'or', nativeLabel: '\u0B13\u0B21\u0B3C\u0B3F\u0B06' },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

const LanguageSelector: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentLang =
    LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const selectLanguage = (code: string) => {
    i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('common.select_language')}
      >
        <Globe className="h-4 w-4 text-gray-500" />
        <span className="hidden sm:inline">
          {t(`languages.${currentLang.code}`)}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <ul
          role="listbox"
          aria-label={t('common.select_language')}
          className="absolute right-0 z-50 mt-1 max-h-72 w-52 overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-gray-200 focus:outline-none"
        >
          {LANGUAGES.map((lang) => {
            const isSelected = lang.code === i18n.language;
            return (
              <li
                key={lang.code}
                role="option"
                aria-selected={isSelected}
                onClick={() => selectLanguage(lang.code)}
                className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm transition-colors ${
                  isSelected
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span>{t(`languages.${lang.code}`)}</span>
                {isSelected && <Check className="h-4 w-4 text-blue-600" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default LanguageSelector;
