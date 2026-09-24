import { BASE64_CHUNK_BYTES } from "./constants";

/**
 * Standard base64 of raw bytes. Encodes in fixed-size chunks (a multiple of 3 bytes, so
 * only the last chunk pads) instead of spreading the whole array into `String.fromCharCode`,
 * which overflows the call stack on multi-MB input.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_BYTES);
    let bin = "";
    for (const byte of chunk) bin += String.fromCharCode(byte);
    out += btoa(bin);
  }
  return out;
}

/** Reads a picked file and returns its bytes as base64. Rejects if the read fails. */
export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(bytesToBase64(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

/** A previewed skill can be confirmed once it has a name and a body. */
export function canConfirm(name: string, body: string): boolean {
  return name.trim().length > 0 && body.trim().length > 0;
}
