# Virtual Thermal Printer

A web-based virtual thermal printer that simulates a real ESC/POS and Epson EPOS
printer. This tool is designed for developers who need to test point-of-sale
(POS) applications without a physical printer.

## Features

- **Epson EPOS Support:** Receives and processes Epson EPOS commands via an HTTP endpoint.
- **ESC/POS Support:** Receives and processes raw ESC/POS commands via a TCP socket.
- **Web-Based Rendering:** Renders the print output in a real-time web interface.

## Packages

| Package | Description |
|---|---|
| [`escpos-decoder`](packages/escpos-decoder) | Transforms a stream of raw ESC/POS bytes into typed TypeScript blocks |
| [`virtual-thermal-printer`](packages/virtual-thermal-printer) | HTTP + WebSocket + TCP server with browser UI |

## Local Development

Requires [Node.js](https://nodejs.org/) 22+.

```bash
git clone https://github.com/FilipChalupa/virtual-thermal-printer.git
cd virtual-thermal-printer
npm install
npm run dev
```

The server starts at `http://localhost:8000` and listens for raw ESC/POS on TCP port `9100`.

## Sending Print Commands

> [!WARNING]
> The public server is shared among all users. Any print jobs you send will be
> visible to anyone currently viewing the page.

### Epson EPOS (HTTP)

> [!WARNING]
> The public server only supports Epson EPOS commands via HTTP. Raw ESC/POS
> commands over TCP are **not** supported on the public server and must be used
> with a locally running instance.

```bash
curl -X POST \
  -H "Content-Type: text/xml" \
  --data @packages/virtual-thermal-printer/fixtures/request1.xml \
  http://localhost:8000/cgi-bin/epos/service.cgi
```

### ESC/POS (TCP Socket)

Connect to port `9100` and send raw ESC/POS bytes, e.g. via `netcat`:

```bash
echo -e "\x1b\x40Hello\x0a" | nc localhost 9100
```

## Docker

```bash
docker build -t virtual-thermal-printer .
docker run -p 8000:80 -p 9100:9100 virtual-thermal-printer
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload on port 8000 |
| `npm run build` | Build `escpos-decoder` and the frontend |
| `npm test` | Run all tests across all packages |
