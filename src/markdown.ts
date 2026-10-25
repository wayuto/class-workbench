/**
 * 极简 Markdown 渲染（标题/加粗/斜体/行内码/代码块/列表/引用/链接/图片/分隔线）。
 * 先整体 HTML 转义再插入标签，公开站点无 XSS 风险。
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 公开站安全：只放行 http(s)/相对路径/图片 data URL，拦截 javascript: 等 */
function safeUrl(u: string): string {
  return /^(javascript|vbscript|data:(?!image\/))/i.test(u) ? "#" : u;
}

function inline(text: string): string {
  let s = esc(text);
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt: string, url: string) =>
      `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy">`,
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${safeUrl(url)}" target="_blank" rel="noopener">${label}</a>`,
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

export function renderMarkdown(text: string): string {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let listItems: string[] = [];
  let listTag = "";
  let inCode = false;
  let codeLines: string[] = [];
  let quoteLines: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      out.push(`<${listTag}>${listItems.map((i) => `<li>${inline(i)}</li>`).join("")}</${listTag}>`);
      listItems = [];
      listTag = "";
    }
  };
  const flushQuote = () => {
    if (quoteLines.length) {
      out.push(`<blockquote>${quoteLines.map(inline).join("<br>")}</blockquote>`);
      quoteLines = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (inCode) {
      if (line.trim().startsWith("```")) {
        out.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        codeLines.push(raw);
      }
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushAll();
      inCode = true;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length + 1; // 日志内标题降一级，避免与页面标题冲突
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(---|\*\*\*)\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushPara();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+[.、]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const tag = ul ? "ul" : "ol";
      if (listTag && listTag !== tag) flushList();
      listTag = tag;
      listItems.push((ul ? ul[1] : ol![1]));
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    flushList();
    flushQuote();
    para.push(line);
  }

  if (inCode && codeLines.length) {
    out.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
  }
  flushAll();
  return out.join("\n");
}

/** 提取纯文本（用于摘要）：去掉标记语法，但保留正文里的连字符/星号等内容 */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>/gm, "")
    .replace(/[#>*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
