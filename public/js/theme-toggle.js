// Theme toggle - persiste a preferência do usuário
(function () {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (saved === 'light') {
    document.documentElement.classList.remove('dark');
  } else if (saved === 'dark' || prefersDark) {
    document.documentElement.classList.add('dark');
  }
})();
