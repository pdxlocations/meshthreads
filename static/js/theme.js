/* Harbor mode preference is independent of Firefly and survives page reloads. */
(function () {
    const key = 'meshthreads.harbor.theme';
    const icons = {
        light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
        dark: '<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>',
    };
    const button = document.getElementById('themeToggle');
    const icon = document.getElementById('themeIcon');
    function applyTheme(theme) {
        const current = theme === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-bs-theme', current);
        document.body.setAttribute('data-bs-theme', current);
        if (button) {
            button.setAttribute('aria-label', `Switch to ${next} mode`);
            button.setAttribute('title', `Switch to ${next} mode`);
            button.setAttribute('aria-pressed', String(current === 'dark'));
        }
        if (icon) icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[next]}</svg>`;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', current === 'dark' ? '#121d24' : '#e8eff0');
    }
    let saved = 'light';
    try { saved = localStorage.getItem(key) || 'light'; } catch (_) { /* Session-only mode still works. */ }
    applyTheme(saved);
    button?.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem(key, next); } catch (_) { /* Session-only mode still works. */ }
    });
    window.addEventListener('storage', event => { if (event.key === key) applyTheme(event.newValue); });
})();
