import type { Config } from "tailwindcss";
import { SENTINEL_TOKENS, AGENT_PALETTE } from "./lib/theme";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic shadcn/base-ui tokens — driven by the CSS vars in
        // globals.css, which are themselves Sentinel-colored (not the
        // stock shadcn oklch theme). This is what makes components/ui/*
        // (Card, Badge, Button, Progress, Select, ScrollArea…) actually
        // render on-brand instead of unstyled.
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: "var(--destructive)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        // Sentinel tokens — the app's real palette, used directly (incl.
        // with Tailwind's opacity modifiers, e.g. bg-s-ind/10) throughout.
        s: {
          bg: SENTINEL_TOKENS.bg,
          surface: SENTINEL_TOKENS.surface,
          s2: SENTINEL_TOKENS.s2,
          border: SENTINEL_TOKENS.border,
          border2: SENTINEL_TOKENS.border2,
          text: SENTINEL_TOKENS.text,
          muted: SENTINEL_TOKENS.muted,
          dim: SENTINEL_TOKENS.dim,
          ind: SENTINEL_TOKENS.ind,
          gold: SENTINEL_TOKENS.gold,
          green: SENTINEL_TOKENS.green,
          amber: SENTINEL_TOKENS.amber,
          red: SENTINEL_TOKENS.red,
          cyan: SENTINEL_TOKENS.cyan,
        },
        agent: { ...AGENT_PALETTE },
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", "JetBrains Mono", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "1.4"],
        xs:    ["12px", "1.5"],
        sm:    ["13px", "1.5"],
        base:  ["14px", "1.6"],
        lg:    ["16px", "1.5"],
        xl:    ["20px", "1.3"],
        "2xl": ["24px", "1.2"],
        "3xl": ["32px", "1.1"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
        xl: "10px",
      },
    },
  },
  plugins: [],
};
export default config;
