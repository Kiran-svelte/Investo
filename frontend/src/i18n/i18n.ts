import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import hi from './locales/hi.json';
import kn from './locales/kn.json';
import te from './locales/te.json';
import ta from './locales/ta.json';
import ml from './locales/ml.json';
import mr from './locales/mr.json';
import bn from './locales/bn.json';
import gu from './locales/gu.json';
import pa from './locales/pa.json';
import or_lang from './locales/or.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      kn: { translation: kn },
      te: { translation: te },
      ta: { translation: ta },
      ml: { translation: ml },
      mr: { translation: mr },
      bn: { translation: bn },
      gu: { translation: gu },
      pa: { translation: pa },
      or: { translation: or_lang },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
