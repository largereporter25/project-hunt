import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // UI sans-serif — system stack first, then Inter for cross-platform.
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        // Monospaced for hashes, IPs, timestamps, RFC-3161 tokens.
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Forensic-terminal palette. Keep the spacing tight: this is
        // not a marketing site, it's a workstation.
        panel: {
          900: "#0b1018", // panel
          800: "#101723", // row hover
          700: "#1a2230", // divider
          600: "#27313f",
        },
        accent: {
          // Sparse, muted accent set. Used only when a colour carries
          // semantic meaning (warning, selection, cross-source edge).
          rose: "#7f1d1d",
          indigo: "#1e1b4b",
          amber: "#78350f",
          emerald: "#064e3b",
        },
      },
      borderRadius: {
        // Sharp, dense. No rounded-2xl, ever.
        sm: "2px",
        DEFAULT: "2px",
        md: "3px",
        lg: "4px",
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
    },
  },
  plugins: [],
};

export default config;
