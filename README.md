# Virtual Thermal Printer

A web-based virtual thermal printer that simulates a real ESC/POS and Epson EPOS
printer. This tool is designed for developers who need to test point-of-sale
(POS) applications without a physical printer.

## Features

- **Epson EPOS Support:** Receives and processes Epson EPOS commands via an HTTP
  endpoint.
- **ESC/POS Support:** Receives and processes raw ESC/POS commands via a TCP
  socket.
- **Web-Based Rendering:** Renders the print output in a real-time web
  interface.

## How to Use

### Web Interface

You can view the rendered output of the virtual printer by visiting the
production URL:

[https://virtual-thermal-printer.deno.dev/](https://virtual-thermal-printer.deno.dev/)

> [!WARNING]
> The public server is shared among all users. Any print jobs you send will be
> visible to anyone currently viewing the page.

### Sending Print Commands

> [!WARNING]
> The public server
> ([virtual-thermal-printer.deno.dev](https://virtual-thermal-printer.deno.dev/))
> only supports Epson EPOS commands via HTTP. Raw ESC/POS commands over TCP are
> **not** supported on the public server and must be used with a locally running
> instance.

#### Epson EPOS (HTTP)

You can send Epson EPOS commands to the `/cgi-bin/epos/service.cgi` endpoint
using a `POST` request. Here's an example using `curl` with one of the provided
fixtures:

```bash
curl -X POST \
  -H "Content-Type: text/xml" \
  --data @fixtures/request1.xml \
  https://virtual-thermal-printer.deno.dev/cgi-bin/epos/service.cgi
```

#### ESC/POS (TCP Socket)

You can send raw ESC/POS commands by connecting to the server on port `9100`.
You can use tools like `netcat` or `telnet` to send commands.

### Local Development

To run the Virtual Thermal Printer locally, you'll need to have
[Deno](https://deno.land/) installed.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/FilipChalupa/virtual-thermal-printer.git
   cd virtual-thermal-printer
   ```

2. **Start the application:**
   ```bash
   deno task dev
   ```

   This will start the server on `http://localhost:8000` and the TCP socket
   listener on port `9100`.
