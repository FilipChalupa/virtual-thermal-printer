# Virtual thermal printer

Work in progress

## Goals

- Support Epson EPOS
- Support ESC/POS over socket

## Run

### Production

```sh
deno task start
```

### Development

```sh
deno task dev
```

### Production

https://virtual-thermal-printer.deno.dev/

- Beware that the server is shared between all users so that they can see what you are printing.
- @TODO: Server runs in multiple instances so you may be printing on a different instance than the one you are connected to in browser.
