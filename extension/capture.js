// Runs inside the page you are reading and returns its citation metadata.
// Shared by the toolbar extension (scripting.executeScript) and the bookmarklet (toString()),
// so it must stay self-contained: no imports, no outer variables.
export function capturePage() {
  const q = (n) =>
    Array.from(document.querySelectorAll(`meta[name="${n}" i],meta[property="${n}" i]`))
      .map((m) => (m.content || '').trim())
      .filter(Boolean);
  const g = (...n) => n.map((x) => q(x)[0]).find(Boolean) || '';
  const doiRe = /\b10\.\d{4,9}\/[^\s"'<>]+[^\s"'<>.,;)\]]/;
  const head = (document.body?.innerText || '').slice(0, 4000);
  const authors = q('citation_author');
  return {
    url: location.href,
    title: g('citation_title', 'dc.title', 'og:title') || document.title,
    authors: authors.length ? authors : q('dc.creator'),
    year: (g('citation_publication_date', 'citation_date', 'dc.date', 'citation_online_date').match(/\d{4}/) || [''])[0],
    venue: g('citation_journal_title', 'citation_conference_title', 'citation_publisher'),
    doi: (g('citation_doi', 'dc.identifier', 'prism.doi').match(doiRe) || head.match(doiRe) || [''])[0],
    pdfUrl: g('citation_pdf_url') || (/\.pdf($|[?#])/i.test(location.href) ? location.href : ''),
    abstract: g('citation_abstract', 'dc.description', 'description', 'og:description'),
    notes: String(getSelection() || '').trim(),
  };
}
