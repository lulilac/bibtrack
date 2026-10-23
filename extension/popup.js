import { capturePage } from './capture.js';

// Must match the server's PORT (and the frame-src in manifest.json).
const SERVER = 'http://localhost:5577';
const ext = globalThis.browser ?? globalThis.chrome;
const msg = document.getElementById('msg');
const frame = document.getElementById('frame');

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

async function main() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const [data, up] = await Promise.all([
    capture(tab),
    fetch(`${SERVER}/api/library`, { mode: 'no-cors' }).then(() => true, () => false),
  ]);
  if (!up) {
    msg.innerHTML = `bibtrack server is not running.<br><br>Start it with <code>npm start</code> (or <code>systemctl --user start bibtrack</code>).`;
    return;
  }
  frame.src = `${SERVER}/add#${encodeURIComponent(JSON.stringify(data))}`;
  frame.onload = () => { msg.style.display = 'none'; frame.style.display = 'block'; frame.focus(); };
}

// The add form asks us to close after saving / on Esc.
window.addEventListener('message', (e) => {
  if (e.origin === SERVER && e.data === 'bibtrack:close') window.close();
});

main();
