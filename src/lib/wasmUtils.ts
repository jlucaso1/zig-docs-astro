// Internal state - initialized by docParser.ts
let _memory: WebAssembly.Memory | null = null;
let _wasmExports: any | null = null;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/**
 * Initializes the WASM utility functions with the instantiated memory and exports.
 * Must be called before any other utility function.
 */
export function initializeWasmUtils(memory: WebAssembly.Memory, exports: any): void {
  _memory = memory;
  _wasmExports = exports;
}

function ensureInitialized(): { memory: WebAssembly.Memory; exports: any } {
  if (!_memory || !_wasmExports) {
    throw new Error("WASM utils not initialized. Call initializeWasmUtils first.");
  }
  return { memory: _memory, exports: _wasmExports };
}

export function decodeString(ptr: number, len: number): string {
  const { memory } = ensureInitialized();
  return textDecoder.decode(new Uint8Array(memory.buffer, ptr, len));
}

export function unwrapString(bigint: bigint): string {
  const { memory, exports } = ensureInitialized();
  const ptr = Number(bigint & 0xffffffffn);
  const len = Number(bigint >> 32n);
  if (len === 0) return "";
  // Ensure the slice doesn't exceed memory bounds, although decodeString might handle this
  if (ptr + len > memory.buffer.byteLength) {
     console.error(`Attempted to decode string outside memory bounds: ptr=${ptr}, len=${len}, memory=${memory.buffer.byteLength}`);
     // Decide on error handling: throw, return empty string, or try to decode partial?
     // Let's return an error indicator for now.
     return "[Error: String OOB]";
  }
  return decodeString(ptr, len);
}


export function unwrapSlice32(bigint: bigint): Uint32Array {
  const { memory } = ensureInitialized();
  const ptr = Number(bigint & 0xffffffffn);
  const len = Number(bigint >> 32n);
  if (len === 0) return new Uint32Array(0);
   // Check bounds before creating the view
  const byteOffset = ptr;
  const byteLength = len * Uint32Array.BYTES_PER_ELEMENT;
  if (byteOffset + byteLength > memory.buffer.byteLength) {
      console.error(`Attempted to read Uint32Array outside memory bounds: ptr=${ptr}, len=${len}, memory=${memory.buffer.byteLength}`);
      return new Uint32Array(0); // Return empty array on error
  }
  // Use slice() to create a copy, preventing issues if the underlying buffer changes (e.g., memory growth)
  return new Uint32Array(memory.buffer, byteOffset, len).slice();
}

export function unwrapSlice64(bigint: bigint): BigUint64Array {
  const { memory } = ensureInitialized();
  const ptr = Number(bigint & 0xffffffffn);
  const len = Number(bigint >> 32n);
  if (len === 0) return new BigUint64Array(0);
  // Check bounds before creating the view
  const byteOffset = ptr;
  const byteLength = len * BigUint64Array.BYTES_PER_ELEMENT;
   if (byteOffset + byteLength > memory.buffer.byteLength) {
      console.error(`Attempted to read BigUint64Array outside memory bounds: ptr=${ptr}, len=${len}, memory=${memory.buffer.byteLength}`);
      return new BigUint64Array(0); // Return empty array on error
  }
  // Use slice() to create a copy
  return new BigUint64Array(memory.buffer, byteOffset, len).slice();
}

export function setInputString(s: string): void {
  const { memory, exports } = ensureInitialized();
  const jsArray = textEncoder.encode(s);
  const len = jsArray.length;
  // Assuming set_input_string allocates memory and returns a pointer
  const ptr = exports.set_input_string(len);
  // Check if allocation failed (depends on WASM implementation, e.g., returns 0 or throws)
   if (ptr === 0) {
       throw new Error("Failed to allocate memory in WASM for input string.");
   }
  const wasmArray = new Uint8Array(memory.buffer, ptr, len);
  wasmArray.set(jsArray);
}

// Helper to encode and write a string to WASM memory, returning ptr and len
// Useful if the WASM function expects ptr/len arguments instead of using a dedicated input buffer
export function writeStringToWasm(s: string): { ptr: number; len: number } {
    const { memory, exports } = ensureInitialized();
    const jsArray = textEncoder.encode(s);
    const len = jsArray.length;
    const ptr = exports.alloc(len); // Assuming a generic 'alloc' function exists
    if (ptr === 0) {
        throw new Error("Failed to allocate memory in WASM.");
    }
    const wasmArray = new Uint8Array(memory.buffer, ptr, len);
    wasmArray.set(jsArray);
    return { ptr, len };
}

// Helper to free memory allocated by writeStringToWasm (if needed)
export function freeWasmMemory(ptr: number, len: number): void {
    const { exports } = ensureInitialized();
    if (exports.free) { // Assuming a generic 'free' function exists
        exports.free(ptr, len);
    } else {
        console.warn("WASM module does not export a 'free' function. Memory allocated with 'alloc' might be leaked.");
    }
}