import fs from 'node:fs';
import path from 'node:path';

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

export function savePdf(pdfDir: string, key: string, buf: Buffer): string {
  if (!isPdf(buf)) throw new Error('not a PDF');
  const name = `${key.replace(/[^\w.-]/g, '_')}.pdf`;
  fs.writeFileSync(path.join(pdfDir, name), buf);
  return name;
}

// Returns the saved file name, or '' if the URL did not yield a PDF (paywall, HTML landing page...).
export async function downloadPdf(pdfDir: string, key: string, url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) bibtrack', Accept: 'application/pdf,*/*' },
    });
    if (!res.ok) return '';
    return savePdf(pdfDir, key, Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    console.warn(`[pdf] ${url}: ${(e as Error).message}`);
    return '';
  } finally {
    clearTimeout(t);
  }
}
