import { defineConfig } from 'vitepress'

const title = 'Spot Trading Bot for Binance'
const description = 'Self-hosted DCA / Grid hybrid spot trading bot for Binance.'
const gitHubRepository = process.env.GITHUB_REPOSITORY
const gitHubProjectName = gitHubRepository?.split('/')[1]

const withTrailingSlash = (value) => (value.endsWith('/') ? value : `${value}/`)
const normalizeBasePath = (value) => withTrailingSlash(value.startsWith('/') ? value : `/${value}`)

// Project Pages base path:
// - GitLab Pages exposes the final URL as CI_PAGES_URL, including groups/subgroups.
// - GitHub Pages for a project repo needs /<repo>/ unless a custom domain is used.
// - DOCS_BASE_PATH is a manual override for custom CI/deploy setups.
const base = process.env.DOCS_BASE_PATH
  ? normalizeBasePath(process.env.DOCS_BASE_PATH)
  : process.env.CI_PAGES_URL
    ? normalizeBasePath(new URL(process.env.CI_PAGES_URL).pathname)
    : process.env.GITHUB_ACTIONS && gitHubProjectName
      ? `/${gitHubProjectName}/`
      : '/'

const siteUrl = process.env.DOCS_SITE_URL
  ? withTrailingSlash(process.env.DOCS_SITE_URL)
  : process.env.CI_PAGES_URL
    ? withTrailingSlash(process.env.CI_PAGES_URL)
    : process.env.GITHUB_ACTIONS && gitHubRepository
      ? `https://${gitHubRepository.split('/')[0]}.github.io${base}`
      : undefined

const absoluteUrl = (path) => (siteUrl ? new URL(path.replace(/^\//, ''), siteUrl).href : `${base}${path.replace(/^\//, '')}`)

export default defineConfig({
  base,
  lang: 'en-US',
  title,
  description,
  cleanUrls: true,
  lastUpdated: true,
  // Keep the internal dead-link check on, but allow references to the local
  // dashboard (unreachable at build time).
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  // Assets live in docs/public and are served at the site root. Prepend `base`
  // for icons, and use absolute URLs for social previews when the CI URL is known.
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:image', content: absoluteUrl('/img/hero-light.png') }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: title }],
    ['meta', { name: 'twitter:description', content: description }],
    ['meta', { name: 'twitter:image', content: absoluteUrl('/img/hero-light.png') }],
    ...(siteUrl ? [['link', { rel: 'canonical', href: siteUrl }]] : []),
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/overview' },
      { text: 'DCA / Grid', link: '/dca-grid/overview' },
      { text: 'Expert', link: '/expert/expert-mode' },
      { text: 'Hybrid', link: '/hybrid/overview' },
      { text: 'Example', link: '/hybrid/walkthrough' },
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
          { text: 'A full session, step by step', link: '/hybrid/walkthrough' },
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
