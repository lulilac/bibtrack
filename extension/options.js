// Preferences: the server address, and the already-saved tick (which needs permissions the
// capture button does not, so it is opt-in and asks for them here, on a real click).
const ext = globalThis.browser ?? globalThis.chrome;
let DEFAULT_SERVER = 'http://localhost:5577';
try {
  const mod = await import('./config.local.js');
  if (mod?.SERVER) DEFAULT_SERVER = mod.SERVER;
} catch {
  // No local config: localhost it is.
}

const $ = (id) => document.getElementById(id);
const clean = (url) => url.trim().replace(/\/+$/, '');
const flash = (el, text, cls = 'ok') => {
  el.textContent = text;
  el.className = `note ${cls}`;
  setTimeout(() => { el.textContent = ''; }, 2500);
};

const stored = await ext.storage.local.get(['server', 'indicator', 'user', 'pass']);
$('server').value = stored.server || DEFAULT_SERVER;
$('user').value = stored.user || '';
$('pass').value = stored.pass || '';

const serverUrl = () => clean($('server').value) || DEFAULT_SERVER;
// Everything under the server's origin; the user is asked for exactly this, not for every site.
const originPattern = () => {
  try { return `${new URL(serverUrl()).origin}/*`; } catch { return null; }
};

async function granted() {
  const origins = originPattern();
  if (!origins) return false;
  try { return await ext.permissions.contains({ permissions: ['tabs'], origins: [origins] }); } catch { return false; }
}

async function paintToggle() {
  const on = (await ext.storage.local.get('indicator')).indicator && (await granted());
  $('toggle').textContent = on ? 'Turn off' : 'Turn on';
  $('indNote').textContent = on ? 'On.' : '';
  $('indNote').className = 'note ok';
}

$('save').addEventListener('click', async () => {
  await ext.storage.local.set({ server: serverUrl() });
  $('server').value = serverUrl();
  flash($('savedNote'), 'Saved.');
  paintToggle();
});
$('server').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('save').click(); });

$('toggle').addEventListener('click', async () => {
  if (await granted() && (await ext.storage.local.get('indicator')).indicator) {
    await ext.storage.local.set({ indicator: false });
    return paintToggle();
  }
  const origins = originPattern();
  if (!origins) return flash($('indNote'), 'Set a valid server address first.', 'warn');
  let ok = false;
  try { ok = await ext.permissions.request({ permissions: ['tabs'], origins: [origins] }); } catch {}
  if (!ok) return flash($('indNote'), 'Permission refused — the tick stays off.', 'warn');
  await ext.storage.local.set({ indicator: true, server: serverUrl() });
  paintToggle();
});

$('saveCreds').addEventListener('click', async () => {
  await ext.storage.local.set({ user: $('user').value, pass: $('pass').value });
  flash($('credNote'), 'Saved.');
});
$('clearCreds').addEventListener('click', async () => {
  $('user').value = '';
  $('pass').value = '';
  await ext.storage.local.set({ user: '', pass: '' });
  flash($('credNote'), 'Forgotten.');
});

paintToggle();
