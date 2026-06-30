/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLARITY_PROJECT_ID?: string;
  readonly VITE_SUBSCRIPTION_ACCESS_ENFORCEMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  clarity?: (...args: unknown[]) => void;
}
