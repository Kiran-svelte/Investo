/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Instrument Serif', 'Georgia', 'serif'],
      },
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        ink: {
          primary: '#0f172a',
          secondary: '#334155',
          muted: '#64748b',
          faint: '#94a3b8',
        },
        surface: {
          base: '#ffffff',
          muted: '#f8fafc',
          subtle: '#f1f5f9',
          elevated: '#ffffff',
          border: '#e2e8f0',
          'border-strong': '#cbd5e1',
        },
        sidebar: {
          DEFAULT: '#0f172a',
          border: '#1e293b',
          text: '#cbd5e1',
          active: '#f8fafc',
          accent: '#14b8a6',
        },
      },
      borderRadius: {
        investo: '8px',
        'investo-lg': '12px',
      },
      boxShadow: {
        investo: '0 4px 12px rgba(15, 23, 42, 0.08)',
        'investo-lg': '0 12px 32px rgba(15, 23, 42, 0.12)',
      },
      screens: {
        xs: '375px',
      },
    },
  },
  plugins: [],
};
