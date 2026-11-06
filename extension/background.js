// Marks the toolbar icon when the page you are on is already in the library.
//
// This is off until you turn it on in the add-on's preferences, because it needs two things the
// capture button does not: permission to read tab addresses, and permission to talk to your
// bibtrack server from the background. Both are asked for at that point, for your server only.

const ext = globalThis.browser ?? globalThis.chrome;
const DEFAULT_SERVER = 'http://localhost:5577';
const PLAIN = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png' };
const SAVED = { 16: 'icons/16-saved.png', 32: 'icons/32-saved.png', 48: 'icons/48-saved.png' };
const DEFAULT_TITLE = 'Save to bibtrack (Alt+Shift+B)';
const CACHE_MS = 60_000;

let cfg = { server: DEFAULT_SERVER, indicator: false, user: '', pass: '' };
// One failure is enough: a server that refuses us would otherwise challenge on every page, and
// a password prompt per page load is worse than no tick at all.
let stopped = false;
const cache = new Map(); // url -> { at, found, title }

async function loadConfig() {
  const s = await ext.storage.local.get(['server', 'indicator', 'user', 'pass']);
  cfg = {
    server: (s.server || DEFAULT_SERVER).replace(/\/+$/, ''),
    indicator: !!s.indicator,
    user: s.user || '',
    pass: s.pass || '',
  };
  stopped = false;
  cache.clear();
}

ext.storage.onChanged.addListener(loadConfig);

function paint(tabId, hit) {
  ext.action.setIcon({ tabId, path: hit?.found ? SAVED : PLAIN }).catch(() => {});
  ext.action.setTitle({
    tabId,
    title: hit?.found ? `Already in bibtrack — ${hit.title || 'saved'}` : DEFAULT_TITLE,
  }).catch(() => {});
}

async function check(tabId, url) {
  if (!cfg.indicator || stopped || !tabId) return;
  if (!/^https?:\/\//i.test(url || '')) return paint(tabId, null);

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return paint(tabId, hit);

  try {
    const headers = cfg.user ? { Authorization: 'Basic ' + btoa(`${cfg.user}:${cfg.pass}`) } : undefined;
    const res = await fetch(`${cfg.server}/api/exists?url=${encodeURIComponent(url)}`,
      { headers, credentials: 'include', cache: 'no-store' });
    if (!res.ok) { stopped = true; return paint(tabId, null); }
    const data = await res.json();
    const entry = { at: Date.now(), found: !!data.found, title: data.title || '' };
    cache.set(url, entry);
    paint(tabId, entry);
  } catch {
    stopped = true;
    paint(tabId, null);
  }
}

ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) check(tabId, changeInfo.url || tab.url);
});
ext.tabs.onActivated.addListener(async ({ tabId }) => {
  try { check(tabId, (await ext.tabs.get(tabId)).url); } catch {}
});
// A save changes the answer for the page you are looking at.
ext.runtime.onMessage.addListener(async (m) => {
  if (m !== 'bibtrack:saved') return;
  cache.clear();
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab) check(tab.id, tab.url);
  } catch {}
});

loadConfig();
