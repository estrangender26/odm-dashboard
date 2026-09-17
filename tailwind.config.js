/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  /* Tailwind only emits rules written inside `@layer components` when the class
     name appears literally in scanned source. The Programs Engineering
     primitives compose their variant class from a `tone` prop
     (`pe-orb--${tone}`), so those names never appear literally and the teal
     variants were being tree-shaken away — every orb silently rendered blue.
     Safelisting the full variant matrix keeps them emitted without forcing
     callers to write magic strings. */
  safelist: [
    "pe-orb--blue",
    "pe-orb--teal",
    "pe-orb--blue-light",
    "pe-orb--teal-light",
    "pe-orb--soft-blue",
    "pe-orb--soft-teal",
    "pe-badge--blue",
    "pe-badge--teal",
    "pe-badge--success",
    "pe-badge--warning",
    "pe-badge--danger",
    "pe-card--interactive",
    "pe-btn--primary",
    "pe-btn--secondary",
    "pe-btn--ghost",
    "pe-btn--danger",
    "pe-gradient-rule--thin",
    "pe-wordmark--lg",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        /* ── PROGRAMS ENGINEERING BRAND ──────────────────────────────────────
           The suite identity derived from the OWNER banner. `pe-blue` is the
           primary engineering blue, `pe-teal` the second brand voice used for
           secondary/comparison series and alternating module accents. */
        pe: {
          blue: "#258ac1",
          "blue-deep": "#1878b3",
          "blue-light": "#4aa2d3",
          "blue-soft": "#eaf4fb",
          "blue-border": "#bfe0f2",
          "blue-ink": "#186390",
          teal: "#2fb19f",
          "teal-deep": "#209c8c",
          "teal-light": "#55c0ae",
          "teal-soft": "#e7f6f3",
          "teal-border": "#b6e4dc",
          "teal-ink": "#1a7266",
          text: "#26343d",
          "text-strong": "#1b2830",
          muted: "#56636b",
          faint: "#7c8a93",
          border: "#dce6ea",
          "border-strong": "#c2d4db",
          bg: "#f5f9fa",
          surface: "#ffffff",
          sunk: "#edf4f7",
          "table-header": "#eef5f8",
          "row-hover": "#f2f8fb",
          "row-selected": "#e7f6f3",
          disabled: "#f2f5f6",
          /* Semantic families. The `-ink` values are the AA-safe text colours
             for small type on the corresponding `-bg`. */
          success: "#0f9d6b",
          "success-bg": "#e8f7f1",
          "success-border": "#b3e6d2",
          "success-ink": "#0b6b4a",
          warning: "#c2740a",
          "warning-bg": "#fdf5e6",
          "warning-border": "#f4dcae",
          "warning-ink": "#8a5208",
          danger: "#d0342f",
          "danger-bg": "#fdeeee",
          "danger-border": "#f5c9c7",
          "danger-ink": "#a32a26",
          "neutral-bg": "#eef3f5",
          "neutral-ink": "#4d5b64",
        },

        /* Remapped engineering-blue ramp. The React surface leaned on raw
           Tailwind `blue-*` utilities in hundreds of places; pointing the scale
           at the Programs Engineering blue re-voices all of them coherently,
           and keeps one brand accent instead of module-by-module blues. */
        blue: {
          50: "#eaf4fb",
          100: "#d4e9f6",
          200: "#bfe0f2",
          300: "#8ec6e6",
          400: "#4aa2d3",
          500: "#2f95c8",
          600: "#258ac1",
          700: "#1878b3",
          800: "#156393",
          900: "#124f75",
          950: "#0c3550",
        },
        /* Programs Engineering teal — secondary series and alternating accents. */
        teal: {
          50: "#e7f6f3",
          100: "#c9ece6",
          200: "#b6e4dc",
          300: "#7fd2c4",
          400: "#55c0ae",
          500: "#2fb19f",
          600: "#209c8c",
          700: "#1c7c6f",
          800: "#186659",
          900: "#14544a",
          950: "#0b332c",
        },
        /* Cooled neutrals so raw `gray-*` utilities match the banner's
           charcoal-on-white instead of the default warmer gray. */
        gray: {
          50: "#f5f9fa",
          100: "#eef3f5",
          200: "#dce6ea",
          300: "#c2d4db",
          400: "#93a5ad",
          500: "#7c8a93",
          600: "#56636b",
          700: "#3f4b53",
          800: "#2f3a41",
          900: "#26343d",
          950: "#1b2830",
        },
        /* `slate` is the React surface's other dominant neutral family. It is
           remapped onto the SAME PE neutral ramp as `gray`, keeping Tailwind's
           original lightness steps so contrast is preserved. Without this,
           `text-slate-600` and `text-gray-600` would render as two different
           greys inside one suite. */
        slate: {
          50: "#f5f9fa",
          100: "#eef3f5",
          200: "#dce6ea",
          300: "#c2d4db",
          400: "#93a5ad",
          500: "#6b7a83",
          600: "#56636b",
          700: "#3f4b53",
          800: "#2f3a41",
          900: "#26343d",
          950: "#1b2830",
        },

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
          teal: "var(--odm-teal)",
          "teal-hover": "var(--odm-teal-hover)",
          "teal-soft": "var(--odm-teal-soft)",
          "teal-border": "var(--odm-teal-border)",
          "teal-ink": "var(--odm-teal-ink)",
          "table-header": "var(--odm-table-header)",
          "row-hover": "var(--odm-row-hover)",
          "row-selected": "var(--odm-row-selected)",
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
      /* The banner's blue -> teal sweep, available as a background image.
         `pe-gradient` is decorative (no text on it); `pe-gradient-action` is the
         darkened variant that keeps white button text at WCAG AA. */
      backgroundImage: {
        "pe-gradient": "linear-gradient(90deg, #258ac1 0%, #2fb19f 100%)",
        "pe-gradient-soft": "linear-gradient(90deg, #eaf4fb 0%, #e6f5f2 100%)",
        "pe-gradient-action": "linear-gradient(90deg, #1878b3 0%, #178073 100%)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "pe-xs": "var(--pe-shadow-xs)",
        "pe-sm": "var(--pe-shadow-sm)",
        "pe-md": "var(--pe-shadow-md)",
        "pe-lg": "var(--pe-shadow-lg)",
        "pe-focus": "var(--pe-focus)",
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