'use strict';

const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { handleConnection } = require('./server');

const PORT = Number(process.env.HTTPS_PORT) || 3443;

const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

function ensureCertificate() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) return;

  console.log('certs/key.pem or certs/cert.pem not found - generating a self-signed certificate...');
  fs.mkdirSync(CERT_DIR, { recursive: true });

  const result = spawnSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', KEY_PATH,
      '-out', CERT_PATH,
      '-days', '365',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );

  if (result.error || result.status !== 0) {
    console.error('Could not run openssl. Generate the certificate manually (see README.md).');
    process.exit(1);
  }
}

function createServer() {
  ensureCertificate();

  const server = tls.createServer(
    { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) },
    handleConnection,
  );

  server.on('tlsClientError', (err) => {
    console.error(`TLS handshake failed: ${err.message}`);
  });

  return server;
}

module.exports = { createServer };

if (require.main === module) {
  const server = createServer();
  server.on('error', (err) => {
    console.error(`Server error: ${err.message}`);
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`HTTPS (tls) listening on https://localhost:${PORT}`);
  });
}
