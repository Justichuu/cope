/**
 * cope — the wire.
 *
 * Holds messages in memory, delivers each one exactly once, forgets it. There
 * is no database because there is nothing to keep: that is the product, not an
 * optimisation.
 *
 * What this server never does, and what you can check by reading it:
 *
 *   - It writes nothing to disk. No log file, no queue file, no metrics.
 *   - It keeps no IP addresses, no timestamps beyond the moment of delivery,
 *     and no session of any kind.
 *   - It never sees anybody's trigger list. Trigger filtering happens on the
 *     reader's own device, because a list of the words that hurt you is the
 *     most personal thing here and handing it over to be protected by it is a
 *     bad trade.
 *   - It cannot route a message to a chosen person. Delivery is to whoever
 *     asks next. There is no way to reach anybody twice, which is why dealing
 *     and harassment do not work here rather than being banned.
 *
 *   node server.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8737);

// The whole state of the service. Nothing else exists.
const waiting = [];             // { text, marks, at }
const MAX_HELD = 500;           // beyond this the oldest is dropped, unread
const MAX_LENGTH = 1200;        // long enough to say a thing, short enough to read

// A held message expires. Something said at 3am should not arrive on Thursday
// to a stranger with no idea what it was answering.
const LIFETIME_MS = 20 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - LIFETIME_MS;
  while (waiting.length && waiting[0].at < cutoff) waiting.shift();
}

/** Take one at random, not the oldest. A queue is an order; this is a room. */
function takeOne(accepts) {
  sweep();
  const eligible = [];
  for (let i = 0; i < waiting.length; i += 1) {
    const marks = waiting[i].marks;
    if (marks.every((m) => accepts.includes(m))) eligible.push(i);
  }
  if (!eligible.length) return null;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  return waiting.splice(pick, 1)[0];
}

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    // Nothing here should ever be embedded, framed, or sniffed into something else.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(text);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new Error('too big');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const page = await readFile(resolve(HERE, 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(page);
  }

  // Hear one thing. The reader says what marks they accept; nothing else.
  if (req.method === 'POST' && url.pathname === '/hear') {
    let accepts = [];
    try {
      ({ accepts = [] } = await body(req));
    } catch {
      return json(res, 400, { error: 'bad request' });
    }
    const got = takeOne(Array.isArray(accepts) ? accepts : []);
    if (!got) return json(res, 200, { empty: true, held: waiting.length });
    // Delivered once. It is already gone from here.
    return json(res, 200, { text: got.text, marks: got.marks });
  }

  // Say one thing. The client only offers this after something was heard;
  // the server does not enforce that, because enforcing it would require
  // knowing who you are.
  if (req.method === 'POST' && url.pathname === '/say') {
    let text = '';
    let marks = [];
    try {
      ({ text = '', marks = [] } = await body(req));
    } catch {
      return json(res, 400, { error: 'bad request' });
    }
    text = String(text).trim().slice(0, MAX_LENGTH);
    if (!text) return json(res, 400, { error: 'nothing to say' });
    marks = (Array.isArray(marks) ? marks : []).filter((m) => typeof m === 'string').slice(0, 6);

    sweep();
    if (waiting.length >= MAX_HELD) waiting.shift();
    waiting.push({ text, marks, at: Date.now() });
    return json(res, 200, { ok: true, held: waiting.length });
  }

  json(res, 404, { error: 'no' });
});

server.listen(PORT, () => {
  console.log(`cope is listening on http://localhost:${PORT}`);
  console.log('nothing is written to disk. stop the process and it is all gone.');
});
