// PDF text extraction + a tiny full-text index. Extracted text is cached next to the PDFs
// (<dir>/fulltext/<paperId>.txt, pages separated by \f) so each PDF is read once, on any machine.
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPdf(buf: Buffer, maxPages = Infinity): Promise<{ pages: string[]; title: string }> {
  const task = getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim());
      page.cleanup();
    }
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string } | undefined;
    return { pages, title: info?.Title?.trim() ?? '' };
  } finally {
    await task.destroy();
  }
}

export class FullText {
  readonly dir: string;
  private cache = new Map<string, { mtime: number; text: string }>();

  constructor(libDir: string, private pdfDir: string) {
    this.dir = path.join(libDir, 'fulltext');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(id: string) {
    return path.join(this.dir, `${id.replace(/[^\w-]/g, '_')}.txt`);
  }

  has(id: string) {
    return fs.existsSync(this.file(id));
  }

  // Cached text, or '' if this paper has not been indexed.
  get(id: string): string {
    const f = this.file(id);
    try {
      const mtime = fs.statSync(f).mtimeMs;
      const hit = this.cache.get(id);
      if (hit && hit.mtime === mtime) return hit.text;
      const text = fs.readFileSync(f, 'utf8');
      this.cache.set(id, { mtime, text });
      return text;
    } catch {
      return '';
    }
  }

  // Extract and store the text of a paper's PDF. Returns the text ('' if extraction failed).
  async index(id: string, pdfFile: string): Promise<string> {
    try {
      const { pages } = await extractPdf(fs.readFileSync(path.join(this.pdfDir, path.basename(pdfFile))));
      const text = pages.join('\n\f\n');
      fs.writeFileSync(this.file(id), text);
      return text;
    } catch (e) {
      console.warn(`[fulltext] ${pdfFile}: ${(e as Error).message}`);
      fs.writeFileSync(this.file(id), ''); // don't retry broken PDFs on every start
      return '';
    }
  }

  async ensure(id: string, pdfFile: string) {
    return this.has(id) ? this.get(id) : this.index(id, pdfFile);
  }

  remove(id: string) {
    fs.rmSync(this.file(id), { force: true });
    this.cache.delete(id);
  }

  // Papers whose text contains every term, with a short snippet around the first match.
  search(ids: string[], query: string): { id: string; snippet: string }[] {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    if (!terms.length) return [];
    const out: { id: string; snippet: string }[] = [];
    for (const id of ids) {
      const text = this.get(id);
      if (!text) continue;
      const lower = text.toLowerCase();
      if (!terms.every((t) => lower.includes(t))) continue;
      const at = lower.indexOf(terms[0]);
      const snippet = text.slice(Math.max(0, at - 70), at + 110).replace(/\s+/g, ' ').trim();
      out.push({ id, snippet: `${at > 70 ? '…' : ''}${snippet}…` });
    }
    return out;
  }
}
