'use strict';

const net = require('node:net');

const PORT = Number(process.env.PORT) || 3000;

const MAX_HEAD_BYTES = 16 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const IDLE_TIMEOUT_MS = 30_000;

const CRLF = '\r\n';
const HEAD_END = Buffer.from('\r\n\r\n');

const REASONS = {
  200: 'OK',
  400: 'Bad Request',
  404: 'Not Found',
  413: 'Content Too Large',
  431: 'Request Header Fields Too Large',
  501: 'Not Implemented',
  505: 'HTTP Version Not Supported',
};

const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseRequest(head) {
  const lines = head.split(CRLF);

  const parts = lines[0].split(' ');
  if (parts.length !== 3) throw new HttpError(400, 'malformed request-line');
  const [method, target, version] = parts;

  if (!TOKEN_RE.test(method)) throw new HttpError(400, 'bad method');
  if (!target.startsWith('/') && target !== '*') throw new HttpError(400, 'bad request-target');
  if (!/^HTTP\/\d\.\d$/.test(version)) throw new HttpError(400, 'bad http version');
  if (version !== 'HTTP/1.1' && version !== 'HTTP/1.0') {
    throw new HttpError(505, 'unsupported http version');
  }

  const qIndex = target.indexOf('?');
  const path = qIndex === -1 ? target : target.slice(0, qIndex);
  const query = qIndex === -1 ? '' : target.slice(qIndex + 1);

  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    if (line[0] === ' ' || line[0] === '\t') throw new HttpError(400, 'obsolete line folding');

    const colon = line.indexOf(':');
    if (colon <= 0) throw new HttpError(400, 'malformed header line');

    const name = line.slice(0, colon);
    if (!TOKEN_RE.test(name)) throw new HttpError(400, 'bad header name');

    const key = name.toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
  }

  if (version === 'HTTP/1.1' && !('host' in headers)) {
    throw new HttpError(400, 'missing Host header');
  }

  return { method, target, path, query, version, headers };
}

function buildResponse(status, body, { contentType = 'text/plain; charset=utf-8', close = false, head = false } = {}) {
  const bodyBuf = Buffer.from(body, 'utf8');
  const headerLines = [
    `HTTP/1.1 ${status} ${REASONS[status] || 'Unknown'}`,
    `Content-Type: ${contentType}`,
    `Content-Length: ${bodyBuf.length}`,
    `Date: ${new Date().toUTCString()}`,
    `Connection: ${close ? 'close' : 'keep-alive'}`,
  ];
  const headBuf = Buffer.from(headerLines.join(CRLF) + CRLF + CRLF, 'latin1');
  return head ? headBuf : Buffer.concat([headBuf, bodyBuf]);
}

function handleRequest(req) {
  if (req.method === 'GET' && req.path === '/') {
    return { status: 200, body: 'Hello from raw HTTP/1.1 over TCP\n' };
  }

  if (req.method === 'GET' && req.path === '/headers') {
    const body = Object.entries(req.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    return { status: 200, body: body + '\n' };
  }

  return { status: 404, body: 'Not Found\n' };
}

function wantsKeepAlive(req) {
  const tokens = (req.headers.connection || '').toLowerCase().split(',').map((s) => s.trim());
  if (tokens.includes('close')) return false;
  if (req.version === 'HTTP/1.0') return tokens.includes('keep-alive');
  return true;
}

function handleConnection(socket) {
  let buffer = Buffer.alloc(0);
  let closing = false;

  socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
  socket.on('error', () => socket.destroy());

  const fail = (status, message) => {
    const body = `${status} ${REASONS[status]}: ${message}\n`;
    socket.end(buildResponse(status, body, { close: true }));
    closing = true;
    buffer = Buffer.alloc(0);
  };

  const drain = () => {
    while (!closing) {
      const headEnd = buffer.indexOf(HEAD_END);

      if (headEnd === -1) {
        if (buffer.length > MAX_HEAD_BYTES) fail(431, 'headers too large');
        return;
      }
      if (headEnd > MAX_HEAD_BYTES) return fail(431, 'headers too large');

      let req;
      try {
        req = parseRequest(buffer.subarray(0, headEnd).toString('latin1'));
      } catch (err) {
        if (err instanceof HttpError) return fail(err.status, err.message);
        throw err;
      }

      if (req.headers['transfer-encoding']) {
        return fail(501, 'Transfer-Encoding is not supported');
      }

      let bodyLength = 0;
      if ('content-length' in req.headers) {
        if (!/^\d+$/.test(req.headers['content-length'])) return fail(400, 'bad Content-Length');
        bodyLength = Number(req.headers['content-length']);
        if (bodyLength > MAX_BODY_BYTES) return fail(413, 'body too large');
      }

      const total = headEnd + HEAD_END.length + bodyLength;
      if (buffer.length < total) return;

      req.body = buffer.subarray(headEnd + HEAD_END.length, total);
      buffer = buffer.subarray(total);

      const { status, body } = handleRequest(req);
      const keepAlive = wantsKeepAlive(req);
      const response = buildResponse(status, body, { close: !keepAlive });

      if (keepAlive) {
        socket.write(response);
      } else {
        socket.end(response);
        closing = true;
      }

      log(socket, req, status);
    }
  };

  socket.on('data', (chunk) => {
    if (closing) return;
    buffer = Buffer.concat([buffer, chunk]);
    drain();
  });
}

function log(socket, req, status) {
  console.log(`${socket.remoteAddress}:${socket.remotePort} ${req.method} ${req.target} -> ${status}`);
}

function createServer() {
  return net.createServer(handleConnection);
}

module.exports = { parseRequest, buildResponse, handleRequest, handleConnection, HttpError };

if (require.main === module) {
  const server = createServer();
  server.on('error', (err) => {
    console.error(`Server error: ${err.message}`);
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`HTTP (raw TCP) listening on http://localhost:${PORT}`);
  });
}
