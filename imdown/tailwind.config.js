/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        dark: {
          DEFAULT: '#0B0F19',
          50: '#131928',
          100: '#1C2333',
          200: '#252D3F',
          300: '#2E3750',
          400: '#3B4563',
          500: '#4B5675',
        },
        neon: {
          DEFAULT: '#00E676',
          50: '#E8FFF3',
          100: '#B9F5D0',
          200: '#69F0AE',
          300: '#00E676',
          400: '#00C853',
          500: '#00A844',
          600: '#008C38',
        },
      },
    },
  },
  plugins: [],
}
