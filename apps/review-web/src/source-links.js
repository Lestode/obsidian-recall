export function inspectorSourceLink(href, questionId) {
  if (!questionId) return href;
  try {
    const url = new URL(href);
    if (url.protocol !== "file:" || url.hostname || url.search ||
        !decodeURIComponent(url.pathname).toLowerCase().endsWith(".pdf")) return href;
    const fragment = url.hash;
    url.hash = "";
    return `/api/questions/${encodeURIComponent(questionId)}/source-pdf?source=${encodeURIComponent(url.href)}${fragment}`;
  } catch {
    return href;
  }
}
