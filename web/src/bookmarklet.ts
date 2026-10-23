import { capturePage } from '../../extension/capture.js';

// The bookmarklet opens the "add" popup (rather than fetching) so page CSP can't block it.
export const bookmarkletHref = (origin: string) =>
  `javascript:(()=>{const capturePage=${capturePage.toString().replace(/\s*\n\s*/g, ' ')};` +
  `window.open(${JSON.stringify(origin + '/add#')}+encodeURIComponent(JSON.stringify(capturePage())),'bibtrack','width=560,height=760')})();void 0`;
