/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        /* ODM visual system — approved tokens (defined in src/index.css).
           Governance does not consume Tailwind, so these cannot reach it. */
        odm: {
          canvas: "var(--odm-canvas)",
          surface: "var(--odm-surface)",
          sunk: "var(--odm-surface-sunk)",
          subtle: "var(--odm-surface-subtle)",
          border: "var(--odm-border)",
          "border-strong": "var(--odm-border-strong)",
          "border-soft": "var(--odm-border-soft)",
          text: "var(--odm-text)",
          strong: "var(--odm-text-strong)",
          muted: "var(--odm-text-muted)",
          faint: "var(--odm-text-faint)",
          navy: "var(--odm-navy)",
          "navy-deep": "var(--odm-navy-deep)",
          "navy-ink": "var(--odm-navy-ink)",
          blue: "var(--odm-blue)",
          "blue-hover": "var(--odm-blue-hover)",
          "blue-soft": "var(--odm-blue-soft)",
          "blue-border": "var(--odm-blue-border)",
          "blue-ink": "var(--odm-blue-ink)",
          success: "var(--odm-success)",
          "success-bg": "var(--odm-success-bg)",
          "success-border": "var(--odm-success-border)",
          warning: "var(--odm-warning)",
          "warning-bg": "var(--odm-warning-bg)",
          "warning-border": "var(--odm-warning-border)",
          danger: "var(--odm-danger)",
          "danger-bg": "var(--odm-danger-bg)",
          "danger-border": "var(--odm-danger-border)",
          "neutral-bg": "var(--odm-neutral-bg)",
          "neutral-ink": "var(--odm-neutral-ink)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}