// Theme toggle
(function () {
  var saved = localStorage.getItem('theme');
  if (saved === 'dark') document.documentElement.classList.add('dark');
})();

document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      document.documentElement.classList.toggle('dark');
      localStorage.setItem(
        'theme',
        document.documentElement.classList.contains('dark') ? 'dark' : 'light'
      );
    });
  }
});

// Generic tab group: add data-tab-group="<name>" to sibling tab buttons
document.addEventListener('click', function (e) {
  var tab = e.target.closest('[data-tab-group]');
  if (!tab) return;
  var group = tab.dataset.tabGroup;
  document.querySelectorAll('[data-tab-group="' + group + '"]').forEach(function (t) {
    t.classList.remove('active');
  });
  tab.classList.add('active');
});
