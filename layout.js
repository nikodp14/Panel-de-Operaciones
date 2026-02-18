(function () {
  const btn = document.getElementById('toggleSidebar');
  const layout = document.querySelector('.layout');
  if (!btn || !layout) return;

  // Restaurar estado
  if (localStorage.getItem('sidebar-collapsed') === '1') {
    layout.classList.add('sidebar-collapsed');
  }

  btn.addEventListener('click', () => {
    layout.classList.toggle('sidebar-collapsed');
    localStorage.setItem(
      'sidebar-collapsed',
      layout.classList.contains('sidebar-collapsed') ? '1' : '0'
    );
  });
})();