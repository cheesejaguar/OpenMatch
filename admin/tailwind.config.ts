import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f5f6f8",
          100: "#e6e8ee",
          200: "#c7ccd8",
          300: "#9aa2b4",
          400: "#6c7689",
          500: "#4a5366",
          600: "#353c4d",
          700: "#252b39",
          800: "#171c27",
          900: "#0c1018",
        },
        accent: {
          DEFAULT: "#3b82f6",
          soft: "#dbeafe",
        },
        danger: {
          DEFAULT: "#dc2626",
          soft: "#fee2e2",
        },
        warn: {
          DEFAULT: "#d97706",
          soft: "#fef3c7",
        },
        ok: {
          DEFAULT: "#16a34a",
          soft: "#dcfce7",
        },
      },
    },
  },
  plugins: [],
};

export default config;
