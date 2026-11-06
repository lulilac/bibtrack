import { capturePage } from './capture.js';

// Where the server lives. Stored per browser, so the same add-on works against a local server or
// a remote one. The default comes from config.local.js when you made one (see config.example.js),
// otherwise a local server; either way it is editable here and in the add-on's preferences.
//
// The add form is shown inside this popup. A remote bibtrack sits behind a password, and Firefox
// will not open an auth prompt inside a cross-origin frame — so when the frame cannot load we ask
// for the password ourselves, sign in once from the extension to put the credentials in the
// browser's cache, and reload the frame. If even that does not take, we fall back to opening the
// form in a window, where the browser's own prompt is allowed.
let DEFAULT_SERVER = 'http://localhost:5577';
try {
  const mod = await import('./config.local.js');
  if (mod?.SERVER) DEFAULT_SERVER = mod.SERVER;
} catch {
  // No local config: localhost it is.
}

const WINDOW_SIZE = { width: 540, height: 680 };
const READY_TIMEOUT = 4000;

const ext = globalThis.browser ?? globalThis.chrome;
const msg = document.getElementById('msg');
const frame = document.getElementById('frame');
const setup = document.getElementById('setup');
const input = document.getElementById('server');
const signin = document.getElementById('signin');
const userInput = document.getElementById('user');
const passInput = document.getElementById('pass');

const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);
const reachable = (url) => fetch(`${url}/api/library`, { mode: 'no-cors' }).then(() => true, () => false);

// Accept "bibtrack.example.org" as readily as the full address: a missing scheme would otherwise
// be stored as-is and resolve against the extension's own origin, failing silently every time.
const clean = (url) => {
  const v = url.trim().replace(/\/+$/, '');
  return v && !/^https?:\/\//i.test(v) ? `https://${v}` : v;
};

let server = DEFAULT_SERVER;
let ready = false;
let payload = '';
let timer = 0;

async function capture(tab) {
  try {
    const [res] = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage });
    if (res?.result) return res.result;
  } catch {
    // Pages scripts can't run in (built-in PDF viewer, about: pages, addons store): use the tab itself.
  }
  const pdf = /\.pdf($|[?#])/i.test(tab.url ?? '');
  return { url: tab.url, title: tab.title, pdfUrl: pdf ? tab.url : '' };
}

// Centred on the browser window, for when the frame cannot be used at all.
async function openWindow(url) {
  const size = { ...WINDOW_SIZE };
  try {
    const win = await ext.windows.getCurrent();
    size.left = Math.round(win.left + (win.width - size.width) / 2);
    size.top = Math.round(win.top + (win.height - size.height) / 2);
  } catch {
    // No position available (some platforms): let the browser place it.
  }
  await ext.windows.create({ url, type: 'popup', ...size });
}

function show(panel, text) {
  msg.textContent = text ?? '';
  msg.style.display = text ? 'block' : 'none';
  frame.style.display = panel === 'frame' ? 'block' : 'none';
  setup.style.display = panel === 'setup' ? 'flex' : 'none';
  signin.style.display = panel === 'signin' ? 'flex' : 'none';
}

function askForServer() {
  input.value = server;
  show('setup', `Can't reach bibtrack at ${server}.`);
}

function askForPassword() {
  show('signin', `${new URL(server).host} wants a username and password.`);
  userInput.focus();
}

/** Sign in from the extension, which puts the credentials in the browser's auth cache so the
 *  frame (and the already-saved tick) can use them. Needs permission for this one origin. */
async function signInAndRetry() {
  const user = userInput.value.trim();
  const pass = passInput.value;
  if (!user) return userInput.focus();
  show(null, 'Signing in…');

  const origins = [`${new URL(server).origin}/*`];
  try {
    if (!(await ext.permissions.contains({ origins }))) {
      if (!(await ext.permissions.request({ origins }))) {
        show('signin', 'Permission refused — cannot sign in from the add-on.');
        return;
      }
    }
    const res = await fetch(`${server}/api/info`, {
      headers: { Authorization: 'Basic ' + btoa(`${user}:${pass}`) },
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      show('signin', res.status === 401 ? 'Wrong username or password.' : `Server said ${res.status}.`);
      return;
    }
    // Keep them for the already-saved tick in background.js, which cannot ask.
    await ext.storage.local.set({ user, pass });
    load();
  } catch {
    // Signing in from here did not work; the browser can still ask in a window of its own.
    await openWindow(`${server}/add#${payload}`);
    window.close();
  }
}

function load() {
  ready = false;
  clearTimeout(timer);
  show(null, 'Opening bibtrack…');
  frame.src = `${server}/add#${payload}`;
  timer = setTimeout(async () => {
    if (ready) return;
    // The frame never reported in: the server is down, or it is behind a password.
    if (await reachable(server)) askForPassword();
    else askForServer();
  }, READY_TIMEOUT);
}

async function main() {
  const stored = await ext.storage.local.get('server');
  server = clean(stored.server || DEFAULT_SERVER);
  // Remember the default the first time, so the background tick uses the same server.
  if (!stored.server) await ext.storage.local.set({ server });

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  payload = encodeURIComponent(JSON.stringify(await capture(tab)));
  load();
}

document.getElementById('save').addEventListener('click', async () => {
  const value = clean(input.value);
  if (!value) return;
  server = value;
  await ext.storage.local.set({ server });
  load();
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('save').click(); });

document.getElementById('signinBtn').addEventListener('click', signInAndRetry);
for (const el of [userInput, passInput]) {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') signInAndRetry(); });
}
document.getElementById('changeServer').addEventListener('click', (e) => { e.preventDefault(); askForServer(); });

window.addEventListener('message', (e) => {
  if (e.origin !== server) return;
  if (e.data === 'bibtrack:ready') {
    ready = true;
    clearTimeout(timer);
    show('frame');
    frame.focus();
  }
  if (e.data === 'bibtrack:close') {
    // Whatever just happened, the icon's answer may have changed.
    ext.runtime.sendMessage('bibtrack:saved').catch(() => {});
    window.close();
  }
});

main();
