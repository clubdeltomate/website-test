/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // SketchLearn "Beautiful Notebook" palette (design.md §2)
        paper: '#FBF4E6',
        'paper-2': '#F4EBD6',
        'paper-3': '#FFFDF6',
        ink: '#2E2820',
        'ink-soft': '#5C5347',
        'ink-faint': '#8B8071',
        pencil: '#C9BFA9',
        yellow: '#FFC53D',
        'yellow-soft': '#FFE9AE',
        blue: '#3F74D6',
        'blue-soft': '#DDE9FB',
        red: '#DE5346',
        'red-soft': '#FADFDB',
        green: '#4C9A5C',
        'green-soft': '#DDF0DF',
        purple: '#8566D4',
        'purple-soft': '#E9E0FA',
        orange: '#EF8A3C',
        // shadcn compatibility tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
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
        // Wobbly hand-drawn radii (design.md §4)
        'wobble-1': '255px 15px 225px 15px / 15px 225px 15px 255px',
        'wobble-2': '15px 225px 15px 255px / 255px 15px 225px 15px',
        'wobble-3': '225px 15px 255px 15px / 15px 255px 15px 225px',
        'wobble-4': '18px 200px 18px 200px / 200px 18px 200px 18px',
        'wobble-sm': '12px 6px 14px 6px / 6px 14px 6px 12px',
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        // Offset paper-cutout shadows (design.md §4)
        offset: '4px 4px 0 rgba(46,40,32,.14)',
        'offset-hover': '6px 6px 0 rgba(46,40,32,.16)',
        'offset-pressed': '1px 1px 0 rgba(46,40,32,.2)',
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      fontFamily: {
        display: ['Caveat', 'cursive'],
        heading: ['"Shantell Sans"', 'cursive'],
        body: ['Nunito', 'sans-serif'],
        mono: ['"Space Mono"', 'monospace'],
      },
      maxWidth: {
        content: '1200px',
        chat: '820px',
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
        "pencil-shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "dot-bounce": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        "low-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: ".6" },
        },
        "bar-slide": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "pencil-shimmer": "pencil-shimmer 1.6s linear infinite",
        "dot-bounce": "dot-bounce 0.9s ease-in-out infinite",
        "low-pulse": "low-pulse 2s ease-in-out infinite",
        "bar-slide": "bar-slide 1.2s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
