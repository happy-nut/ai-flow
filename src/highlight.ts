import { html as renderDiff2HtmlMarkup } from "diff2html";
import hljs from "highlight.js";
import { decodeEntities, languageForPath, stripHtmlTags } from "./util.js";

export function renderDiff2Html(diffText: string): string {
  if (diffText.trim().length === 0) {
    return "";
  }

  const markup = renderDiff2HtmlMarkup(diffText, {
    outputFormat: "side-by-side",
    drawFileList: false,
    matching: "lines",
  });
  return highlightDiffHtml(markup);
}

function highlightDiffHtml(markup: string): string {
  const parts = markup.split(/(?=<div [^>]*class="d2h-file-wrapper")/);
  if (parts.length <= 1) {
    return markup;
  }
  return parts
    .map((part) => (part.includes('class="d2h-file-wrapper"') ? highlightDiffWrapper(part) : part))
    .join("");
}

function highlightDiffWrapper(wrapper: string): string {
  const nameMatch = wrapper.match(/<span class="d2h-file-name">([\s\S]*?)<\/span>/);
  const path = nameMatch ? decodeEntities(stripHtmlTags(nameMatch[1])).trim() : "";
  const language = hljsLanguageForPath(path);
  if (!language) {
    return wrapper;
  }
  return wrapper.replace(
    /(<span class="d2h-code-line-ctn">)([\s\S]*?)(<\/span>\s*<\/div>)/g,
    (whole: string, open: string, content: string, close: string) => {
      const highlighted = highlightCtnSegments(content, language);
      return highlighted === null ? whole : `${open}${highlighted}${close}`;
    },
  );
}

// Apply hljs to a code-line container while preserving diff2html word-level
// change markup (e.g. <span class="d2h-change">...): tags are kept verbatim and
// only the text segments between them are syntax-highlighted.
function highlightCtnSegments(content: string, language: string): string | null {
  if (content.trim().length === 0) {
    return null;
  }
  if (content.indexOf("<") < 0) {
    const text = decodeEntities(content);
    if (text.trim().length === 0) {
      return null;
    }
    try {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }
  let changed = false;
  const out = content.replace(/(<[^>]+>)|([^<]+)/g, (_match: string, tag: string, text: string) => {
    if (tag) {
      return tag;
    }
    const decoded = decodeEntities(text);
    if (decoded.trim().length === 0) {
      return text;
    }
    try {
      changed = true;
      return hljs.highlight(decoded, { language, ignoreIllegals: true }).value;
    } catch {
      return text;
    }
  });
  return changed ? out : null;
}

function hljsLanguageForPath(path: string): string {
  if (!path) {
    return "";
  }
  const lower = path.toLowerCase();
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) {
    return "kotlin";
  }
  const base = languageForPath(path);
  const mapped = base === "markup" ? "xml" : base === "text" ? "" : base;
  return mapped && hljs.getLanguage(mapped) ? mapped : "";
}
