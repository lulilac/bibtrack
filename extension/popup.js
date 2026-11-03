import { capturePage } from './capture.js';

// Where the server lives. Kept in storage rather than hardcoded, so the same add-on
// works against a local server or a remote one; set it from the popup when the server
// cannot be reached. A local server is framed inside the popup (see frame-src in
// manifest.json); a remote one is opened in a tab, because it sits behind HTTP auth and
// Firefox refuses to show an auth prompt inside a cross-origin frame.
const DEFAULT_SERVER = 'http://localhost:5577';
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

function askForServer() {
  const hint = isLocal(server)
    ? 'Start it with <code>npm start</code>, or point the add-on at a remote bibtrack.'
    : 'Check the address, or that you are online.';
  msg.innerHTML = `Can't reach bibtrack at <code>${server}</code>.<br><br>${hint}`;
  input.value = server;
  setup.style.display = 'flex';
}

async function main() {
  server = clean((await ext.storage.local.get('server')).server || DEFAULT_SERVER);
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const [data, up] = await Promise.all([
    capture(tab),
    fetch(`${server}/api/library`, { mode: 'no-cors' }).then(() => true, () => false),
  ]);
  if (!up) return askForServer();

  const target = `${server}/add#${encodeURIComponent(JSON.stringify(data))}`;
  if (!isLocal(server)) {
    await ext.tabs.create({ url: target });
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
