/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          400: '#F3C343',
          500: '#D4AF37',
          600: '#AA8C2C',
        }
      },
      fontFamily: {
        sans: ["Cairo", "ui-sans-serif", "system-ui", "sans-serif"],
      }
    },
  },
  plugins: [],
}
