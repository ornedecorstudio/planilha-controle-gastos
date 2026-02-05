/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Cores base - Estilo Vercel/Shopify
        background: '#fafafa',
        foreground: '#0a0a0a',
        
        // Tons de cinza customizados
        neutral: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        },
        
        // Cores pastéis para categorias
        pastel: {
          // Verdes pastéis (PJ/Empresarial)
          green: {
            light: '#dcfce7',
            DEFAULT: '#bbf7d0',
            dark: '#86efac',
            text: '#166534',
          },
          // Vermelhos pastéis (PF/Pessoal)
          red: {
            light: '#fee2e2',
            DEFAULT: '#fecaca',
            dark: '#fca5a5',
            text: '#991b1b',
          },
          // Azuis pastéis (Marketing)
          blue: {
            light: '#dbeafe',
            DEFAULT: '#bfdbfe',
            dark: '#93c5fd',
            text: '#1e40af',
          },
          // Roxos pastéis (Fornecedores)
          purple: {
            light: '#ede9fe',
            DEFAULT: '#ddd6fe',
            dark: '#c4b5fd',
            text: '#5b21b6',
          },
          // Amarelos pastéis (Checkout)
          yellow: {
            light: '#fef9c3',
            DEFAULT: '#fef08a',
            dark: '#fde047',
            text: '#854d0e',
          },
          // Cyans pastéis (Logística)
          cyan: {
            light: '#cffafe',
            DEFAULT: '#a5f3fc',
            dark: '#67e8f9',
            text: '#155e75',
          },
          // Rosas pastéis (Telefonia)
          pink: {
            light: '#fce7f3',
            DEFAULT: '#fbcfe8',
            dark: '#f9a8d4',
            text: '#9d174d',
          },
          // Laranjas pastéis (ERP)
          orange: {
            light: '#ffedd5',
            DEFAULT: '#fed7aa',
            dark: '#fdba74',
            text: '#9a3412',
          },
          // Teals pastéis (Gestão)
          teal: {
            light: '#ccfbf1',
            DEFAULT: '#99f6e4',
            dark: '#5eead4',
            text: '#115e59',
          },
          // Índigos pastéis (IA/Automação)
          indigo: {
            light: '#e0e7ff',
            DEFAULT: '#c7d2fe',
            dark: '#a5b4fc',
            text: '#3730a3',
          },
          // Violetas pastéis (Design)
          violet: {
            light: '#ede9fe',
            DEFAULT: '#ddd6fe',
            dark: '#c4b5fd',
            text: '#5b21b6',
          },
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'sans-serif',
        ],
        mono: [
          'SF Mono',
          'Monaco',
          'Inconsolata',
          'Fira Mono',
          'Droid Sans Mono',
          'Source Code Pro',
          'monospace',
        ],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      boxShadow: {
        'subtle': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
      },
    },
  },
  plugins: [],
}
