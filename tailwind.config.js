/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  // klassen die dynamisch worden samengesteld (pill-${soort}, c-${dienst})
  safelist: [{ pattern: /^pill-(ok|warn|bad|info|neutral)$/ }, 'c-1', 'c-1M', 'c-2', 'c-1B', 'c-DG1', 'c-DG2', 'c-O', 'c-OR', 'c-VMS', 'c-TD', 'c-V', 'c-Z'],
  theme: {
    extend: {
      colors: {
        navy: 'var(--navy)',
        teal: 'var(--teal)',
        gold: 'var(--gold)',
        rood: 'var(--red)',
        paper: 'var(--paper)',
        card: 'var(--card)',
        line: 'var(--line)',
        ink: 'var(--text)',
        muted: 'var(--muted)',
        soft: 'var(--soft)',
        accent: 'var(--accent)',
        primary: 'var(--primary)',
        plum: 'var(--plum)',
        info: 'var(--info)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Literata', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'Hanken Grotesk', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: 'var(--shadow)',
      },
      maxWidth: {
        app: '1360px',
      },
    },
  },
  plugins: [],
};
