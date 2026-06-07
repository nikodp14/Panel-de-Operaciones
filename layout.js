(function () {
  const btn = document.getElementById('toggleSidebar');
  const layout = document.querySelector('.layout');
  if (!btn || !layout) return;

  btn.addEventListener('click', () => {
    layout.classList.toggle('sidebar-open');
  });

  document.addEventListener('click', (e) => {
    const sidebar = document.querySelector('.sidebar');
    if (
      layout.classList.contains('sidebar-open') &&
      !sidebar.contains(e.target) &&
      !btn.contains(e.target)
    ) {
      layout.classList.remove('sidebar-open');
    }
  });
})();

const topbar = document.querySelector('.topbar');

topbar?.addEventListener('mouseenter', () => {
  topbar.classList.add('show');
});

topbar?.addEventListener('mouseleave', () => {
  topbar.classList.remove('show');
});

topbar?.addEventListener('click', () => {
  topbar.classList.toggle('show');
});