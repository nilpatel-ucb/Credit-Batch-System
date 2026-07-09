/**
 * Normalize PDF bytes received over Electron IPC into a Uint8Array.
 * IPC may deliver ArrayBuffer, Uint8Array, or Node Buffer — not all have a .buffer field.
 */
function toUint8Array(input) {
  if (!input) {
    throw new Error("No PDF data received.");
  }

  if (Buffer.isBuffer(input)) {
    return new Uint8Array(input);
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }

  throw new Error(`Unexpected PDF data type: ${Object.prototype.toString.call(input)}`);
}

module.exports = { toUint8Array };
