import { capturePage } from './capture.js';

// Where the server lives. Kept in storage rather than hardcoded, so the same add-on works
// against a local server or a remote one; set it here when the server cannot be reached, or
// any time from the add-on's preferences.
//
// The add form is shown inside this popup, local or remote. A remote bibtrack sits behind a
// password and Firefox will not open an auth prompt inside a cross-origin frame, so the frame
// only works once the browser has the credentials cached - which it does after the first
// sign-in. When it does not, the frame comes back as a 401 page that looks the same from out
// here, so the page sends us `bibtrack:ready` when it really loaded; if that never arrives we
// open the add form in a window instead, where the prompt is allowed.
const DEFAULT_SERVER = 'http://localhost:5577';
const WINDOW_SIZE = { width: 540, height: 680 };
const READY_TIMEOUT = 4000;

const ext = globalThis.browser ?? globalThis.chrome;
const msg = document.getElementById('msg');
const frame = document.getElementById('frame');
const setup = document.getElementById('setup');
const input = document.getElementById('server');

const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);
const clean = (url) => url.trim().replace(/\/+$/, '');
const reachable = (url) => fetch(`${url}/api/library`, { mode: 'no-cors' }).then(() => true, () => false);

let server = DEFAULT_SERVER;
let ready = false;

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

// Centred on the browser window, for when the frame cannot be used.
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

function askForServer(text) {
  const code = document.createElement('code');
  code.textContent = server;
  msg.replaceChildren(text ?? "Can't reach bibtrack at ", code, '.', document.createElement('br'),
    document.createElement('br'),
    isLocal(server)
      ? 'Start it with npm start, or point the add-on at a remote bibtrack.'
      : 'Check the address, or that you are online.');
  frame.style.display = 'none';
  msg.style.display = 'block';
  input.value = server;
  setup.style.display = 'flex';
}

async function main() {
  ready = false;
  server = clean((await ext.storage.local.get('server')).server || DEFAULT_SERVER);
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const data = await capture(tab);
  const target = `${server}/add#${encodeURIComponent(JSON.stringify(data))}`;

  frame.src = target;
  setTimeout(async () => {
    if (ready) return;
    // The frame never reported in: either the server is down, or it is behind a password the
    // browser cannot ask for in a frame. A window can ask.
    if (await reachable(server)) {
      await openWindow(target);
      window.close();
    } else {
      askForServer();
    }
  }, READY_TIMEOUT);
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

window.addEventListener('message', (e) => {
  if (e.origin !== server) return;
  if (e.data === 'bibtrack:ready') {
    ready = true;
    msg.style.display = 'none';
    frame.style.display = 'block';
    frame.focus();
  }
  // The add form asks us to close after saving / on Esc.
  if (e.data === 'bibtrack:close') {
    // Whatever just happened, the icon's answer may have changed.
    ext.runtime.sendMessage('bibtrack:saved').catch(() => {});
    window.close();
  }
});

main();
