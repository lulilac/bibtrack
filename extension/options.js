// Lets the server address be changed at any time (about:addons → bibtrack → Preferences),
// not only when the popup fails to reach it.
const ext = globalThis.browser ?? globalThis.chrome;
const input = document.getElementById('server');
const saved = document.getElementById('saved');

input.value = (await ext.storage.local.get('server')).server || '';

document.getElementById('save').addEventListener('click', async () => {
  const value = input.value.trim().replace(/\/+$/, '');
  await ext.storage.local.set({ server: value || 'http://localhost:5577' });
  saved.textContent = 'Saved.';
  setTimeout(() => { saved.textContent = ''; }, 2000);
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('save').click(); });
