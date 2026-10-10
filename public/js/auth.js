/* ── RebalanceIQ Auth helpers ─────────────────────────────────── */
const AUTH_USER = 'admin';
const AUTH_PASS = 'citycycle2024';

function checkAuth() {
  if (!sessionStorage.getItem('riq_auth')) {
    window.location.replace('login.html');
  }
}

function doLogin(user, pass) {
  if (user.trim() === AUTH_USER && pass === AUTH_PASS) {
    sessionStorage.setItem('riq_auth', '1');
    sessionStorage.setItem('riq_user', user.trim());
    window.location.replace('index.html');
    return true;
  }
  return false;
}

function doLogout() {
  sessionStorage.removeItem('riq_auth');
  sessionStorage.removeItem('riq_user');
  window.location.replace('login.html');
}
