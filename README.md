# HTTP/1.1 і TLS «з нуля» (hw-03)

HTTP-сервер без фреймворка і без модуля `http`: байти з TCP-сокета (`net`) → власний парсер request-line і заголовків → власна відповідь (статус-рядок, `Content-Type`, `Content-Length`, порожній рядок, тіло). HTTPS-варіант — те саме, але на `tls.createServer()` (без модуля `https`). Залежностей немає, лише стандартна бібліотека Node (`net`, `tls`, `fs`, `child_process`).

## Структура

| Файл | Призначення |
| --- | --- |
| `src/server.js` | raw HTTP на `net`; експортує парсер (`parseRequest`), роутер (`handleRequest`) і `handleConnection` |
| `src/https-server.js` | HTTPS на `tls`; перевикористовує `handleConnection` із `server.js` |
| `.gitignore` | виключає згенеровані `*.pem` / `*.key` |

## Запуск

```bash
node src/server.js         # http://localhost:3000
node src/https-server.js   # https://localhost:3443
```

Порти за замовчуванням `3000` і `3443` (можна змінити через `PORT` / `HTTPS_PORT`). Прапорці не потрібні.

### Self-signed сертифікат

Сертифікат і ключ не комітяться (`*.pem`, `*.key` у `.gitignore`). `src/https-server.js` сам згенерує їх у `certs/` при першому запуску, якщо їх там немає. Ту саму команду можна виконати вручну:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

## Маршрути

| Запит | Відповідь |
| --- | --- |
| `GET /` | `200 OK`, `Content-Type: text/plain` |
| `GET /headers` | `200 OK`, тіло — розпарсені заголовки запиту (`ключ: значення`, ключі в lower-case) |
| будь-що інше | `404 Not Found` |

Некоректний запит (сміття замість request-line, немає `Host` у HTTP/1.1, кривий `Content-Length` тощо) отримує `400 Bad Request` і закриття з'єднання. Підтримується keep-alive (за замовчуванням для HTTP/1.1) та `Connection: close`.

## Перевірка

```bash
curl -sv http://localhost:3000/                          # HTTP/1.1 200 OK, Content-Type: text/plain
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/nope   # 404
curl -s http://localhost:3000/headers -H "X-Demo: abc"   # host: ..., x-demo: abc
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:3443/     # 200
```

## Debug-сесія: `openssl s_client`

```bash
echo | openssl s_client -connect localhost:3443 -servername localhost
```

Вивід (macOS, LibreSSL 3.3.6):

```text
depth=0 CN = localhost
verify error:num=18:self signed certificate
verify return:1
depth=0 CN = localhost
verify return:1
CONNECTED(00000007)
write W BLOCK
---
Certificate chain
 0 s:/CN=localhost
   i:/CN=localhost
---
Server certificate
-----BEGIN CERTIFICATE-----
MIICyTCCAbGgAwIBAgIJAMhsbe3WLR8JMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV
BAMMCWxvY2FsaG9zdDAeFw0yNjEwMDEyMTUyMjVaFw0yNzEwMDEyMTUyMjVaMBQx
EjAQBgNVBAMMCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
ggEBAM2DRrCm987nqWmS6dGRkSXxOjhaV9XZgVfE0A0YsxQkr9pjWIFLXjfDS2+M
k49iD4j//1tnV5w/pOZgqS7we2z9uu2nZMUeKjVRq3j2D6s4bK8/Vinf3w0Nt9Q5
HbgMxPyBYrWRWZzhaMJmzpAW5uMl9Mo6ZHy8PS9YFUyjND5ttCkzaeZgMUhwniGB
4MWXs6rvG9UA2QvH/BqLaixw2Y1UPuykK/clgi91pHJvhuiLK1zIK3JWyGm/t/C8
QKAYhD/XB1bKwWhEGiyIO81mEx7Je8hNNxyYr3cos5UbBWMbiM9PgNKpBHNYt9sr
rdHdoNmeoqUihO8X0nKuWO7N6S8CAwEAAaMeMBwwGgYDVR0RBBMwEYIJbG9jYWxo
b3N0hwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQCIVUo4XUtQG7XS2eWNHvyrxvlE
ylXqYb8cAHqMfj2WvumKPNApGXXdyclGDxUljUHU58yFsUZBz5UagW2bGGv7NlKo
25LG7m946TA69lawpRdXrtkfRpWftIts95NLmsBriprc0RSv8gJXH301VeVCEKEC
iRCEkeKCkAVWedyuiQXPM5TPzqG7uX9ZnFBpzTg+FFW1MFrv/pmbMiYz+s1YPRBd
EqJVRLzSD+zRJGZDrDFoFNlTSr7TKGUZJTjIkQilCtzB1esY6OrMj16kgBAOi4Qk
mkqYKt7ir8fuqeJWqaTEws5ac5haV/YYeMiXAWhAPAJH/jZUv9cMU40my3ey
-----END CERTIFICATE-----
subject=/CN=localhost
issuer=/CN=localhost
---
No client certificate CA names sent
Server Temp Key: ECDH, X25519, 253 bits
---
SSL handshake has read 1295 bytes and written 385 bytes
---
New, TLSv1/SSLv3, Cipher is AEAD-AES256-GCM-SHA384
Server public key is 2048 bit
Secure Renegotiation IS NOT supported
Compression: NONE
Expansion: NONE
No ALPN negotiated
SSL-Session:
    Protocol  : TLSv1.3
    Cipher    : AEAD-AES256-GCM-SHA384
    Session-ID:
    Session-ID-ctx:
    Master-Key:
    Start Time: 1790891564
    Timeout   : 7200 (sec)
    Verify return code: 18 (self signed certificate)
---
DONE
```

**Що означає `verify error:num=18` / `Verify return code: 18 (self signed certificate)`:** сертифікат підписаний власним ключем (у `Certificate chain` `s:` і `i:` однакові — `CN=localhost`), тому його не можна прив'язати до жодного довіреного CA; для нашого self-signed сервера це очікувано, а TLS-handshake при цьому все одно завершується (`Protocol: TLSv1.3`).

Для порівняння: з довірою до цього сертифіката як до CA помилка зникає.

```bash
echo | openssl s_client -connect localhost:3443 -servername localhost -CAfile certs/cert.pem
# ...
#     Verify return code: 0 (ok)
```

| Код | Значення |
| --- | --- |
| 18 | self-signed: сертифікат підписаний сам собою і не в довірених |
| 19 | chain incomplete: ланцюжок не доходить до довіреного кореня (в OpenSSL — «self signed certificate in certificate chain») |
| 10 | expired: термін дії сертифіката вийшов |
