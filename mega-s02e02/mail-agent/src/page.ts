// read_page tool: fetch a URL from the Worker and turn HTML into text that keeps
// headings, links and list items (web_fetch drops markup the mail may ask about).

const MAX_CHARS = 60000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function htmlToText(html: string, base: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, "");
  const title = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  s = s
    .replace(/<head\b[\s\S]*?<\/head>/i, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t}\n\n`)
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, t: string) => `[${t}](${absolute(decode(href), base)})`)
    .replace(/<img\b[^>]*?alt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, alt: string) => (alt ? `[image: ${alt}]` : ""))
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|table|ul|ol|pre|blockquote|header|footer|main|nav)>/gi, "\n\n")
    .replace(/<t[dh]\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  s = decode(s)
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return (title ? `Title: ${decode(title).trim()}\n\n` : "") + s;
}

export async function readPage(url: string, raw: boolean): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Error: not a valid URL: ${url}`;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return `Error: only http and https URLs can be read.`;
  const res = await fetch(parsed.toString(), {
    headers: { "User-Agent": "mail-agent/1.0 (+https://mail-agent.patrykmatychniak.workers.dev)", Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
    redirect: "follow",
  });
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const head = `URL: ${res.url || parsed.toString()}\nStatus: ${res.status}\nContent-Type: ${type}\n\n`;
  const content = raw || !/html/i.test(type) ? body : htmlToText(body, res.url || parsed.toString());
  const cut = content.length > MAX_CHARS ? `${content.slice(0, MAX_CHARS)}\n\n[cut: page has ${content.length} characters, first ${MAX_CHARS} shown]` : content;
  return head + cut;
}
