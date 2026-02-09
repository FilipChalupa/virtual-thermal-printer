import iconv from "https://esm.sh/iconv-lite@0.6.3";

export enum Alignment {
  Left,
  Center,
  Right,
}

export interface PrinterState {
  alignment: Alignment;
  charSize: number;
  leftMargin: number;
  printAreaWidth: number;
}

export function parseEscPos(command: Uint8Array, state: PrinterState): string | object {
  let result: string | object = "";
  let i = 0;
  let textBuffer: number[] = [];

  const appendText = () => {
    if (textBuffer.length > 0) {
      result = (typeof result === "string" ? result : "") +
        iconv.decode(new Uint8Array(textBuffer), "CP852");
      textBuffer = [];
    }
  };

  while (i < command.length) {
    const byte = command[i];
    switch (byte) {
      case 0x0a: // LF
        appendText();
        result = (typeof result === "string" ? result : "") + "\n";
        i++;
        break;
      case 0x1b: // ESC
        appendText();
        if (i + 1 < command.length) {
          const nextByte = command[i + 1];
          switch (nextByte) {
            case 0x40: // @
              result = (typeof result === "string" ? result : "") +
                "[Initialize Printer]\n";
              state.alignment = Alignment.Left;
              i += 2;
              break;
            case 0x61: // a
              if (i + 2 < command.length) {
                const alignment = command[i + 2];
                if (alignment === 0 || alignment === 48) {
                  state.alignment = Alignment.Left;
                  result = (typeof result === "string" ? result : "") +
                    "[Set Alignment: Left]\n";
                } else if (alignment === 1 || alignment === 49) {
                  state.alignment = Alignment.Center;
                  result = (typeof result === "string" ? result : "") +
                    "[Set Alignment: Center]\n";
                } else if (alignment === 2 || alignment === 50) {
                  state.alignment = Alignment.Right;
                  result = (typeof result === "string" ? result : "") +
                    "[Set Alignment: Right]\n";
                }
                i += 3;
              } else {
                i++;
              }
              break;
            case 0x21: // !
              if (i + 2 < command.length) {
                result = (typeof result === "string" ? result : "") +
                  `[Set Font: 0x${command[i + 2].toString(16)}]\n`;
                i += 3;
              } else {
                i++;
              }
              break;
            default:
              result = (typeof result === "string" ? result : "") +
                `[ESC 0x${nextByte.toString(16)}]`;
              i += 2;
              break;
          }
        } else {
          i++;
        }
        break;
      case 0x1d: // GS
        appendText();
        if (i + 1 < command.length) {
          const nextByte = command[i + 1];
          switch (nextByte) {
            case 0x21: // !
              if (i + 2 < command.length) {
                state.charSize = command[i + 2];
                result = (typeof result === "string" ? result : "") +
                  `[Set Char Size: ${state.charSize}]\n`;
                i += 3;
              } else {
                i++;
              }
              break;
            case 0x4c: // L
              if (i + 3 < command.length) {
                state.leftMargin = command[i + 2] + command[i + 3] * 256;
                result = (typeof result === "string" ? result : "") +
                  `[Set Left Margin: ${state.leftMargin}]\n`;
                i += 4;
              } else {
                i++;
              }
              break;
            case 0x56: // V
              result = (typeof result === "string" ? result : "") +
                "[Cut Paper]\n";
              i += 2;
              break;
            case 0x76: // v
              if (i + 1 < command.length) {
                const nextByte = command[i + 1];
                if (nextByte === 0x30) { // 0
                  const m = command[i + 2];
                  const fn = command[i + 3];
                  const xL = command[i + 4];
                  const xH = command[i + 5];
                  const yL = command[i + 6];
                  const yH = command[i + 7];
                  const width = xL + xH * 256;
                  const height = yL + yH * 256;
                  const data = command.subarray(i + 8, i + 8 + width * height);
                  result = {
                    type: "image",
                    width,
                    height,
                    data: Array.from(data),
                  };
                  i += 8 + width * height;
                }
              }
              break;
            case 0x57: // W
              if (i + 3 < command.length) {
                state.printAreaWidth = command[i + 2] + command[i + 3] * 256;
                result = (typeof result === "string" ? result : "") +
                  `[Set Print Area Width: ${state.printAreaWidth}]\n`;
                i += 4;
              } else {
                i++;
              }
              break;
            default:
              result = (typeof result === "string" ? result : "") +
                `[GS 0x${nextByte.toString(16)}]`;
              i += 2;
              break;
          }
        } else {
          i++;
        }
        break;
      default:
        textBuffer.push(byte);
        i++;
        break;
    }
  }
  appendText(); // Append any remaining text
  return result;
}

export async function handleConnection(conn: Deno.Conn, connectedClients: Set<WebSocket>) {
  const remoteAddr = conn.remoteAddr;
  const remoteAddrString = remoteAddr.transport === "tcp" ? `${remoteAddr.hostname}:${remoteAddr.port}` : "unknown";
  console.log(`New connection from ${remoteAddrString}.`);
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const buffer = new Uint8Array(1024);
  while (true) {
    try {
      const n = await conn.read(buffer);
      if (n === null) {
        break;
      }
      const command = buffer.subarray(0, n);
      const parsedData = parseEscPos(command, state);
      if (parsedData) {
        const dataToSend = typeof parsedData === "string" ? parsedData : JSON.stringify(parsedData);
        for (const client of connectedClients) {
          client.send(dataToSend);
        }
      }
    } catch (error) {
      console.error("Error reading from connection:", error);
      break;
    }
  }
  console.log(`Connection from ${remoteAddrString} closed.`);
}
