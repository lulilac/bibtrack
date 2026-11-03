import { capturePage } from './capture.js';

// Where the server lives. Kept in storage rather than hardcoded, so the same add-on
// works against a local server or a remote one; set it from the popup, or in the add-on's
// preferences. A local server is framed inside the toolbar popup (see frame-src in
// manifest.json). A remote one gets its own small window instead: it sits behind HTTP auth,
// and Firefox refuses to show an auth prompt - or to offer to save the password - inside a
// cross-origin frame. A window keeps the dialog feel that a tab loses.
const DEFAULT_SERVER = 'http://localhost:5577';
const WINDOW_SIZE = { width: 540, height: 680 };
const ext = globalThis.browser ?? globalThis.chrome;
const msg = document.getElementById('msg');
const frame = document.getElementById('frame');
const setup = document.getElementById('setup');
const input = document.getElementById('server');

const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);
const clean = (url) => url.trim().replace(/\/+$/, '');

let server = DEFAULT_SERVER;

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

// Centred on the browser window the user is looking at, so it reads as a dialog.
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

function askForServer() {
  const hint = isLocal(server)
    ? 'Start it with npm start, or point the add-on at a remote bibtrack.'
    : 'Check the address, or that you are online.';
  const code = document.createElement('code');
  code.textContent = server;
  msg.replaceChildren("Can't reach bibtrack at ", code, '.', document.createElement('br'),
    document.createElement('br'), hint);
  input.value = server;
  setup.style.display = 'flex';
}

async function main() {
  server = clean((await ext.storage.local.get('server')).server || DEFAULT_SERVER);
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  // Only probe a local server. A remote one is behind a password, so probing it would ask for
  // credentials once for the probe and again for the window itself; just open it and let the
  // browser report any problem. Change the address in about:addons if it is wrong.
  const [data, up] = await Promise.all([
    capture(tab),
    isLocal(server) ? fetch(`${server}/api/library`, { mode: 'no-cors' }).then(() => true, () => false) : true,
  ]);
  if (!up) return askForServer();

  const target = `${server}/add#${encodeURIComponent(JSON.stringify(data))}`;
  if (!isLocal(server)) {
    await openWindow(target);
    return window.close();
  }
  frame.src = target;
  frame.onload = () => { msg.style.display = 'none'; frame.style.display = 'block'; frame.focus(); };
}

document.getElementById('save').addEventListener('click', async () => {
  const value = clean(input.value);
  if (!value) return;
  await ext.storage.local.set({ server: value });
  setup.style.display = 'none';
  msg.textContent = 'Reading page…';
  main();
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('save').click(); });

// The add form asks us to close after saving / on Esc (only when framed).
window.addEventListener('message', (e) => {
  if (e.origin === server && e.data === 'bibtrack:close') window.close();
});

main();
