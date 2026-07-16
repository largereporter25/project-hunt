import type { Config } from "tailwindcss";

/**
 * Project HUNT — forensic-terminal Tailwind config.
 *
 * The look we want:
 *   * one font family for the entire app: the system monospaced stack
 *     (SF Mono, Cascadia, Consolas, …) — the analyst never sees a
 *     rounded sans-serif outside of a legend key.
 *   * one accent color (muted amber) used as the only non-slate hue
 *     anywhere on the page. No polychrome by entity kind.
 *   * no rounded corners. The default is 0px; the largest radius
 *     in the app is 1px, and only on tiny chips. No rounded-2xl,
 *     no rounded-lg, ever.
 *   * dense spacing scale. `gap-1`, `p-1`, `py-0.5` are the
 *     default, not the exception.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Every visible glyph on the page comes from this stack.
        // We skip Inter entirely — Inter is the de facto "looks like
        // a SaaS dashboard" tell and we are not a SaaS dashboard.
        sans: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
      colors: {
        // Two background levels (canvas, panel) and a single accent.
        // We deliberately do NOT expose a polychrome palette here:
        // every chip, border, and link uses one of these tokens.
        bg: {
          base: "#05080d",  // page background, also ReactFlow canvas
          panel: "#0b1018", // headers, drawers, footer
          row: "#101723",   // row hover
        },
        line: {
          DEFAULT: "#1e293b", // slate-800 equivalent
          strong: "#27313f",
        },
        fg: {
          DEFAULT: "#cbd5e1", // primary text
          dim: "#64748b",     // secondary text
          muted: "#475569",   // tertiary text
          inverse: "#05080d", // text on bright backgrounds (buttons)
        },
        // The single accent. Amber reads as "evidence / data" in
        // forensic tooling and doesn't compete with the slate base.
        accent: {
          DEFAULT: "#b45309",
          bright: "#d97706",
          dim: "#7c2d12",
        },
        // Semantic single-hue tones. No rose-vs-emerald polychrome:
        // the only "red" in the app is for hard errors, and the
        // only "green" is for "OK / done".
        ok: "#15803d",
        warn: "#a16207",
        err: "#b91c1c",
      },
      borderRadius: {
        // 0 by default, 1px max on tiny chips. The previous config
        // had `lg: "4px"` — that produced the rounded-panel SaaS
        // look we are killing.
        none: "0",
        sm: "1px",
        DEFAULT: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        full: "0",
      },
      letterSpacing: {
        tightest: "-0.04em",
        wider: "0.04em",
        widest: "0.12em",
      },
    },
  },
  plugins: [],
};

export default config;
