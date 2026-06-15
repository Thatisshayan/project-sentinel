import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        border:     "#222222",
        input:      "#222222",
        ring:       "#6366F1",
        // Sentinel tokens
        s: {
          bg:      "#0A0A0A",
          surface: "#111111",
          s2:      "#161B22",
          border:  "#222222",
          border2: "#2e2e2e",
          text:    "#F5F5F5",
          muted:   "#888888",
          dim:     "#444444",
          ind:     "#6366F1",
          gold:    "#C8961C",
          green:   "#22C55E",
          amber:   "#F59E0B",
          red:     "#EF4444",
          cyan:    "#00D4FF",
        },
        agent: {
          nemotron:   "#6366F1",
          "qwen-coder": "#F59E0B",
          gemini:     "#22C55E",
          llama:      "#3B82F6",
          deepseek:   "#8B5CF6",
          "qwen-max": "#EC4899",
          "qwen-turbo": "#14B8A6",
          "qwen-dash": "#F97316",
        },
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
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        bootIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateX(12px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        growBar: {
          from: { width: "0%" },
          to:   { width: "var(--bar-w, 0%)" },
        },
      },
      animation: {
        "fade-up":  "fadeUp 0.18s ease both",
        "boot-in":  "bootIn 0.25s ease both",
        "slide-in": "slideIn 0.2s ease both",
        "grow-bar": "growBar 0.9s ease both",
      },
    },
  },
  plugins: [],
};
export default config;
