export class Theme {
  constructor() {
    const toggle = document.getElementById('themeToggle');
    const icon = document.getElementById('themeIcon');
    const html = document.documentElement;

    // SVG-иконка темы (sun/moon) из спрайта вместо эмодзи: меняем ссылку <use>.
    const setIcon = (dark) => {
      const use = icon && icon.querySelector('use');
      if (use) use.setAttribute('href', dark ? '/sprite.svg#moon' : '/sprite.svg#sun');
    };

    // Загружаем тему из localStorage
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
        // Явный 'light', а не removeAttribute: иначе ui-elements 0.4.0
        // включит авто-тёмную тему по ОС (prefers-color-scheme).
        html.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
        setIcon(false);
      }
    });

    this.menuHighlight();
  }

  menuHighlight() {
    const currentPath = window.location.pathname;
    const links = document.querySelectorAll('.nav ul>li>a');
    const drops = document.querySelectorAll('.nav ul>li.ddown a');

    drops.forEach((link) => {
      const linkPath = new URL(link.href, window.location.origin).pathname;

      if (linkPath == currentPath) {
        link.classList.add('active');
      }
    });

    links.forEach((link) => {
      if (link.getAttribute('href') === currentPath) {
        link.closest('li').classList.add('active');
      }
    });
  }
}
