import { defineConfig } from 'vitepress'

// Project Pages base path. In GitLab CI, CI_PAGES_URL carries the full site URL
// (e.g. https://<user>.gitlab.io/<project>/); its pathname is exactly the base
// VitePress needs, and it adapts to groups/subgroups on its own. Locally the
// variable is unset, so the site builds at root ("/") for `npm run dev`.
const base = process.env.CI_PAGES_URL
  ? new URL(process.env.CI_PAGES_URL).pathname
  : '/'

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'Spot Trading Bot for Binance',
  description: 'Self-hosted DCA / Grid hybrid spot trading bot for Binance.',
  cleanUrls: true,
  lastUpdated: true,
  // Keep the internal dead-link check on, but allow references to the local
  // dashboard (unreachable at build time).
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  // Favicon lives in docs/public and is served at the site root. Prepend `base`
  // so the path stays correct under the GitLab Pages subpath in production.
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/overview' },
      { text: 'DCA / Grid', link: '/dca-grid/overview' },
      { text: 'Expert', link: '/expert/expert-mode' },
      { text: 'Hybrid', link: '/hybrid/overview' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/guide/overview' },
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Testnet vs Real', link: '/guide/testnet-vs-real' },
        ],
      },
      {
        text: 'DCA / Grid strategy',
        items: [
          { text: 'The strategy', link: '/dca-grid/overview' },
          { text: 'Interface', link: '/dca-grid/interface' },
          { text: 'Reading the table', link: '/dca-grid/table' },
          { text: 'Managing a pair', link: '/dca-grid/pair-controls' },
        ],
      },
      {
        text: 'Expert Mode',
        items: [
          { text: 'Expert Mode', link: '/expert/expert-mode' },
        ],
      },
      {
        text: 'Hybrid (DCA + micro-scalp)',
        items: [
          { text: 'Enabling Hybrid', link: '/hybrid/overview' },
          { text: 'Hybrid parameters', link: '/hybrid/parameters' },
          { text: 'The scalp summary bar', link: '/hybrid/summary-bar' },
          { text: 'Grid marks: ✓ and ✗', link: '/hybrid/grid-marks' },
          { text: 'Badges & prices', link: '/hybrid/badges' },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'Running & Persistence', link: '/operations/running' },
          { text: 'Configuration (.env)', link: '/operations/configuration' },
          { text: 'Backup & Updates', link: '/operations/backup' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'FAQ & Troubleshooting', link: '/help/faq' },
          { text: 'Disclaimer', link: '/help/disclaimer' },
        ],
      },
    ],

    outline: 'deep',
    search: { provider: 'local' },
  },
})
