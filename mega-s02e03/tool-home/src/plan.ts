import { page } from "./oauth";
import { esc } from "./util";

export function planPage(origin: string): string {
  const mcp = `${origin}/mcp`;
  return page("Tool Home — plan", `
<h1>Tool Home</h1>
<p>A remote MCP server with four tools, run by one owner. MCP endpoint: <code>${esc(mcp)}</code> (Streamable HTTP).</p>

<h2>Tools</h2>
<table>
<tr><th>Tool</th><th>Input</th><th>Result</th><th>What it does</th></tr>
<tr><td><code>memo_write</code></td><td><code>{ text }</code></td><td><code>{ id, created_at }</code></td><td>Saves a text note (up to 20,000 characters).</td></tr>
<tr><td><code>memo_search</code></td><td><code>{ query, limit? }</code></td><td><code>{ notes: [{ id, text, created_at, source, truncated? }], omitted?, hint? }</code></td><td>Returns notes that contain every word of the query, newest first. An empty query returns the newest notes. <code>source</code> is the name of the client that saved the note. The result stays under 1 kB: older matches are left out (<code>omitted</code>) and one very long note is clipped (<code>truncated</code>), with a <code>hint</code> on how to narrow the search.</td></tr>
<tr><td><code>upload</code></td><td><code>{ filename, content_type? }</code></td><td><code>{ url, upload_url, expires_at }</code></td><td>Gives a place to store a file of up to 25 MB. Send the raw bytes with one HTTP <code>PUT</code> to <code>upload_url</code>: it works once, needs no sign-in header, and expires after 15 minutes. The file never goes through the tool call. The <code>url</code> is served by this server, under <code>/files/</code>, and anyone with the link can open it without signing in.</td></tr>
<tr><td><code>transcribe</code></td><td><code>{ url }</code></td><td><code>{ segments: [{ start, text }], omitted?, transcript_url?, transcript_bytes? }</code></td><td>Downloads audio from a public link (up to 25 MB) and transcribes it with Whisper (<code>@cf/openai/whisper-large-v3-turbo</code> on Cloudflare Workers AI). <code>start</code> is seconds from the start of the audio, rounded to 0.01 s. Links to this machine or a private network are refused, at every redirect. A transcript over 1 kB is stored as a text file under <code>/files/</code>; the result then holds the first segments and its link.</td></tr>
</table>
<p>Every tool has a contract (a hands TOOL.md in <code>tools/</code>) that sets its schemas, its description, a 1024-byte budget for the whole result and its errors. A successful call returns <code>structuredContent</code> that matches its <code>outputSchema</code>, and one text block with the same JSON, compact. A failed call returns <code>isError: true</code> with one line that starts with the bad field, says what is wrong with it and what to send instead, for example a link that is a web page or answers 404.</p>

<h2>Protocol</h2>
<ul>
<li>MCP revision <code>2026-07-28</code>: stateless requests with <code>_meta</code>, <code>server/discover</code>, and the <code>MCP-Protocol-Version</code>, <code>Mcp-Method</code> and <code>Mcp-Name</code> headers checked against the body.</li>
<li>Older clients can still use <code>2025-11-25</code> (also <code>2025-06-18</code> and <code>2025-03-26</code>) with the <code>initialize</code> handshake. No sessions are kept.</li>
</ul>

<h2>Sign-in</h2>
<ul>
<li>OAuth 2.1 with PKCE (S256). This server is its own authorization server, with issuer <code>${esc(origin)}</code>.</li>
<li>Discovery: <a href="/.well-known/oauth-protected-resource/mcp">protected resource metadata</a> (RFC 9728) and <a href="/.well-known/oauth-authorization-server">authorization server metadata</a> (RFC 8414). An unauthenticated call to <code>/mcp</code> gets <code>401</code> with a <code>WWW-Authenticate</code> header that points to them.</li>
<li>Clients identify themselves with a Client ID Metadata Document (an https URL as <code>client_id</code>), or register at <code>/register</code> (RFC 7591, kept for older clients).</li>
<li>On the consent page the owner types the server passphrase and approves or denies. Only the owner has that passphrase, so only clients the owner lets in get a token. After 5 wrong passphrases, sign-in from that address is blocked for 15 minutes.</li>
<li>The authorization response includes <code>iss</code> (RFC 9207). Tokens are bound to the resource <code>${esc(mcp)}</code> (RFC 8707). Access tokens last 1 hour. Refresh tokens last 30 days and are replaced each time they are used.</li>
<li>Scope: <code>mcp</code> (all four tools).</li>
<li>Taking access back: a client can end its own tokens at <code>/revoke</code> (RFC 7009); revoking one token ends the access and refresh tokens of the same approval. The owner can see every client that holds access, and take it back, on <a href="/grants">/grants</a> with the server passphrase. A client whose access was taken back gets <code>401</code> and must ask for approval again.</li>
</ul>

<h2>Data it keeps</h2>
<ul>
<li><b>Notes</b>: their text, the time they were saved, and the id and name of the client that saved them. Kept until the owner deletes them.</li>
<li><b>Files</b>: the bytes, file name, type, size, upload time and the client id. Kept until the owner deletes them. Anyone with a file's link can read it.</li>
<li><b>Audio for transcribe</b>: fetched when the tool is called and passed to Workers AI. Neither the audio nor the transcript is stored here.</li>
<li><b>Sign-in</b>: registered clients (name and redirect URIs), cached client metadata documents (1 hour), and hashes of pending codes and tokens until they expire. Raw tokens and the passphrase are never stored. For the wrong-passphrase limit, the caller's IP address and a count are kept for 15 minutes.</li>
<li><b>Logs</b>: Cloudflare Workers Logs keep request logs (URL, status, time) for a few days. For each tool call the logs also hold the tool name and the size of its result in bytes. Logs never include tool arguments or tokens.</li>
<li>Storage: Cloudflare D1. Hosting: Cloudflare Workers.</li>
</ul>
`);
}
