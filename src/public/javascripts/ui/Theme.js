export class Theme {
  constructor() {
    const toggle = document.getElementById('themeToggle');
    const icon = document.getElementById('themeIcon');
    const html = document.documentElement;

    // Theme SVG icon (sun/moon) from the sprite instead of an emoji: swap the <use> href.
    const setIcon = (dark) => {
      const use = icon && icon.querySelector('use');
      if (use) use.setAttribute('href', dark ? '/sprite.svg#moon' : '/sprite.svg#sun');
    };

    // Load the theme from localStorage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      html.setAttribute('data-theme', 'dark');
      toggle.checked = true;
      setIcon(true);
    }

    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        setIcon(true);
      } else {
        // Explicit 'light', not removeAttribute: otherwise ui-elements 0.4.0
        // turns on the OS auto-dark theme (prefers-color-scheme).
        html.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
        setIcon(false);
      }
    });

    this.menuHighlight();
  }

  menuHighlight() {
    const currentPath = window.location.pathname;

    // Only the bar's own links are marked here. The active pair is no longer a link —
    // it is the pairs Select's aria-selected option, set as the list is built in
    // navbar.ejs, which is also the only place that knows the pair has changed.
    document.querySelectorAll('.UInav__link').forEach((link) => {
      if (link.getAttribute('href') === currentPath) {
        link.setAttribute('aria-current', 'page');
      }
    });
  }
}
