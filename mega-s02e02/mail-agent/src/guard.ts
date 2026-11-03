// Keeps secrets out of outgoing mail and decides whom the agent works for.

// Shapes of keys that must never leave in a reply, whoever's they are.
const KEY_PATTERNS = [/am_[A-Za-z0-9_-]{16,}/g, /sk-ant-[A-Za-z0-9_-]{8,}/g, /whsec_[A-Za-z0-9+/=]{8,}/g];

export function scrub(text: string, secrets: string[]): { text: string; hits: number } {
  let hits = 0;
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 8) continue;
    while (out.includes(s)) {
      out = out.replace(s, "[redacted]");
      hits++;
    }
  }
  for (const re of KEY_PATTERNS) {
    out = out.replace(re, () => {
      hits++;
      return "[redacted]";
    });
  }
  return { text: out, hits };
}

// "Rook <rook@mail.mega.dev>" -> "rook@mail.mega.dev"
export function address(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export function isTrusted(from: string, allowed: string): boolean {
  const list = allowed.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
  return list.includes(address(from));
}
