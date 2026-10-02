/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ["\"Space Grotesk\"", "system-ui", "sans-serif"],
        mono: ["\"JetBrains Mono\"", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: {
          900: "#0b0f1a",
          800: "#12192b",
          700: "#1a2540",
          600: "#263255",
          500: "#374066",
        },
        mist: {
          50: "#f6f7fb",
          100: "#eceff6",
          200: "#d8dff0",
        },
        tealish: {
          500: "#23b4a7",
          600: "#1a9a8f",
        },
        ember: {
          500: "#f07a49",
          600: "#e06533",
        },
        limeish: {
          500: "#79d36f",
        },
        roseish: {
          500: "#f05d6b",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(35, 180, 167, 0.35), 0 10px 30px rgba(10, 16, 30, 0.35)",
      },
    },
  },
  plugins: [],
};
