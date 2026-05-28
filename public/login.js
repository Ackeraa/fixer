const form = document.getElementById('login-form');
const statusEl = document.getElementById('login-status');
const btn = document.getElementById('login-btn');

async function checkAuth() {
  try {
    const r = await fetch('/api/me');
    const data = await r.json();
    if (data.authenticated) {
      window.location.href = '/';
    }
  } catch (_) {
    // ignore
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = '正在登录...';
  btn.disabled = true;

  const payload = {
    username: document.getElementById('username').value.trim(),
    password: document.getElementById('password').value,
  };

  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '登录失败');
    statusEl.textContent = '登录成功，正在跳转...';
    window.location.href = '/';
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

checkAuth();
