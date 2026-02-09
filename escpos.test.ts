import { assertEquals } from "@std/assert/mod.ts";
import { Alignment, parseEscPos, PrinterState } from "./escpos.ts";
import iconv from "iconv-lite";

Deno.test("parseEscPos - Initialize Printer", () => {
  const command = new Uint8Array([0x1b, 0x40]);
  const state: PrinterState = {
    alignment: Alignment.Center,
    charSize: 1,
    leftMargin: 10,
    printAreaWidth: 100,
  };
  const result = parseEscPos(command, state);
  assertEquals(result, "[Initialize Printer]\n");
  assertEquals(state.alignment, Alignment.Left);
});

Deno.test("parseEscPos - Cut Paper", () => {
  const command = new Uint8Array([0x1d, 0x56]);
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const result = parseEscPos(command, state);
  assertEquals(result, "[Cut Paper]\n");
});

Deno.test("parseEscPos - Set Alignment", () => {
  const command = new Uint8Array([0x1b, 0x61, 1]);
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const result = parseEscPos(command, state);
  assertEquals(result, "[Set Alignment: Center]\n");
  assertEquals(state.alignment, Alignment.Center);
});

Deno.test("parseEscPos - Print Text", () => {
  const command = iconv.encode("Hello, World!", "CP852");
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const result = parseEscPos(command, state);
  assertEquals(result, "Hello, World!");
});

Deno.test("parseEscPos - CP852 Encoded Text", () => {
  const command = iconv.encode("Dva obrázky", "CP852");
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const result = parseEscPos(command, state);
  assertEquals(result, "Dva obrázky");
});

Deno.test("parseEscPos - Set Char Size", () => {
  const command = new Uint8Array([0x1d, 0x21, 0x11]);
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const result = parseEscPos(command, state);
  assertEquals(result, "[Set Char Size: 17]\n");
  assertEquals(state.charSize, 17);
});

Deno.test("parseEscPos - Set Left Margin", () => {
  const command = new Uint8Array([0x1d, 0x4c, 0x0a, 0x00]);
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const result = parseEscPos(command, state);
  assertEquals(result, "[Set Left Margin: 10]\n");
  assertEquals(state.leftMargin, 10);
});

Deno.test("parseEscPos - Set Print Area Width", () => {
  const command = new Uint8Array([0x1d, 0x57, 0x80, 0x01]);
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const result = parseEscPos(command, state);
  assertEquals(result, "[Set Print Area Width: 384]\n");
  assertEquals(state.printAreaWidth, 384);
});

Deno.test("parseEscPos - Complex Command", () => {
  const command = new Uint8Array([
    ...iconv.encode("Hello\n", "CP852"),
    0x1b,
    0x61,
    1, // Center
    ...iconv.encode("World\n", "CP852"),
    0x1b,
    0x61,
    2, // Right
    ...iconv.encode("!\n", "CP852"),
    0x1d,
    0x56, // Cut
  ]);
  const state: PrinterState = {
    alignment: Alignment.Left,
    charSize: 0,
    leftMargin: 0,
    printAreaWidth: 0,
  };
  const result = parseEscPos(command, state);
  assertEquals(
    result,
    "Hello\n[Set Alignment: Center]\nWorld\n[Set Alignment: Right]\n!\n[Cut Paper]\n",
  );
});