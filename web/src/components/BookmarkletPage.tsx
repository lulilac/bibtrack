import { useEffect, useRef } from 'react';
import { bookmarkletHref } from '../bookmarklet.ts';

export default function BookmarkletPage() {
  const ref = useRef<HTMLAnchorElement>(null);
  // React refuses javascript: hrefs, so set it directly.
  useEffect(() => ref.current?.setAttribute('href', bookmarkletHref(location.origin)), []);
  return (
    <div className="page">
      <h1>Install the bibtrack bookmarklet</h1>
      <p>Drag this button to your bookmarks bar:</p>
      <p>
        <a ref={ref} className="bookmarklet" onClick={(e) => e.preventDefault()}>＋ bibtrack</a>
      </p>
      <ol>
        <li>Show the bookmarks bar (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>).</li>
        <li>Drag the button above onto it.</li>
        <li>On any paper page (arXiv, IEEE, ACM, Springer, Google Scholar result, a PDF…) click it.
          Select text first to save it as a note.</li>
        <li>Pick the project(s) and press <kbd>Enter</kbd>.</li>
      </ol>
      <p className="muted">The bookmarklet talks to the bibtrack server on <code>{location.origin}</code>, so the server must be running on this machine.
        If the browser blocks the popup the first time, allow popups for that site.</p>
      <p><a href="/">← back to library</a></p>
    </div>
  );
}
