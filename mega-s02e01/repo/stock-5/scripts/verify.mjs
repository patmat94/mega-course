// npm run verify -- <nonce>
// Connects to the job store the way the app does — DATABASE_URL, else the connection in a
// *.config file at the repo root — asks it for its version and a hash of the nonce, and prints three
// lines. Paste them as they are.
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const nonce = process.argv[2];
if (!nonce) {
  console.error('usage: npm run verify -- <nonce>');
  process.exit(2);
}

const read = (name) => {
  try {
    return readFileSync(new URL(name, root), 'utf8');
  } catch {
    return '';
  }
};

// The connection: a url, or { host, port, user, password, database } from the config.
function connection() {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL };
  const configs = readdirSync(root).filter((f) => /\.config\.(ts|js|mjs|cjs)$/.test(f));
  for (const file of configs) {
    const text = read(file);
    const url = /\b(?!https?:)[a-z][a-z0-9+.-]*:\/\/[^'"`\s]+/.exec(text)?.[0];
    if (url) return { url };
    const field = (k) => new RegExp(`\\b${k}\\s*:\\s*['"\`]?([^'"\`,\\s}]+)`).exec(text)?.[1];
    if (field('host') && field('database')) {
      const port = field('port');
      return { options: { host: field('host'), port: port ? Number(port) : undefined, user: field('user'), password: field('password'), database: field('database') } };
    }
  }
  return null;
}

// The driver: the one the url's scheme names, else any dependency in package.json that is a client
// this script knows how to hold (a callable that returns a query fn, or a Client class).
async function driver(conn) {
  const pkg = JSON.parse(read('package.json') || '{}');
  const scheme = conn.url ? new URL(conn.url).protocol.slice(0, -1) : null;
  const names = [...new Set([scheme, ...Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })].filter(Boolean))];
  for (const name of names) {
    let mod;
    try {
      mod = await import(name);
    } catch {
      continue;
    }
    const lib = mod.default ?? mod;
    if (typeof lib.Client === 'function') {
      return async (sql, args) => {
        const client = new lib.Client(conn.url ? { connectionString: conn.url, connectionTimeoutMillis: 5000 } : conn.options);
        await client.connect();
        try {
          return (await client.query(sql, args)).rows[0];
        } finally {
          await client.end();
        }
      };
    }
    if (typeof lib === 'function') {
      let db;
      try {
        db = conn.url ? lib(conn.url, { max: 1, connect_timeout: 5 }) : lib({ ...conn.options, max: 1, connect_timeout: 5 });
      } catch {
        continue;
      }
      if (typeof db?.unsafe !== 'function') continue;
      return async (sql, args) => {
        try {
          return (await db.unsafe(sql, args))[0];
        } finally {
          await db.end();
        }
      };
    }
  }
  return null;
}

const conn = connection();
if (!conn) {
  console.error('verify: no connection — set DATABASE_URL, or put the connection in your config file');
  process.exit(1);
}
const query = await driver(conn);
if (!query) {
  console.error('verify: no client to connect with — install the driver your connection needs');
  process.exit(1);
}
try {
  const row = await query('select version() as v, md5($1 || version()) as h', [nonce]);
  console.log(`version: ${row.v}`);
  console.log(`md5: ${row.h}`);
  console.log(`port: ${(conn.url ? new URL(conn.url).port : conn.options.port) || 'default'}`);
} catch (err) {
  console.error(`verify: ${err?.message || err?.code || String(err)}`);
  process.exit(1);
}
