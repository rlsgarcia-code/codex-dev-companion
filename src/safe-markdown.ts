const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FENCE = /^ {0,3}```([A-Za-z0-9_.+-]*)[ \t]*$/;

export function renderSafeMarkdown(value: string): string {
  const lines = String(value).replace(CONTROL_CHARACTERS, "").replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | undefined;
  let listItems: string[] = [];
  let codeLanguage = "";
  let codeLines: string[] | undefined;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType || !listItems.length) return;
    output.push(`<${listType}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${listType}>`);
    listType = undefined;
    listItems = [];
  };
  const flushCode = () => {
    if (!codeLines) return;
    const language = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
    output.push(`<pre><code${language}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = undefined;
    codeLanguage = "";
  };

  for (const line of lines) {
    if (codeLines) {
      if (/^ {0,3}```[ \t]*$/.test(line)) flushCode();
      else codeLines.push(line);
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      codeLanguage = fence[1] ?? "";
      codeLines = [];
      continue;
    }
    const heading = /^(#{1,3})[ \t]+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(5, heading[1]!.length + 2);
      output.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      continue;
    }
    const unordered = /^\s*[-*][ \t]+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.[ \t]+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered?.[1] ?? ordered?.[1])!);
      continue;
    }
    const quote = /^>[ \t]?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      output.push(`<blockquote>${renderInline(quote[1]!)}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushCode();
  flushParagraph();
  flushList();
  return output.join("");
}

function renderInline(value: string): string {
  return value.split(/(`[^`\n]*`)/g).map((part) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    }
    return escapeHtml(part).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }).join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]!);
}
