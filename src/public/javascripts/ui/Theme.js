export class Theme {
  constructor() {
    const toggle = document.getElementById('themeToggle');
    const icon = document.getElementById('themeIcon');
    const html = document.documentElement;

    // Загружаем тему из localStorage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      html.setAttribute('data-theme', 'dark');
      toggle.checked = true;
      icon.textContent = '🌘';
    }

    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        icon.textContent = '🌘';
      } else {
        html.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        icon.textContent = '☀️';
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
