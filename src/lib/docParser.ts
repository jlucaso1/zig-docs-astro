import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { TextDecoder, TextEncoder } from "util";

// Paths relative to project
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(__dirname, "../../assets/main.wasm");
const SOURCES_PATH = path.resolve(__dirname, "../../assets/sources.tar");

// Global WebAssembly exports and utils
let wasmInstance: WebAssembly.Instance;
export let wasmExports: any; // Make exports accessible if needed elsewhere
let memory: WebAssembly.Memory;
let moduleList: { name: string; rootDeclIndex: number }[] = [];
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// Constants for categories (as seen in module.astro and original script)
export const CAT_namespace = 0;
export const CAT_container = 1; // Likely includes structs, unions, opaque types
export const CAT_global_variable = 2;
export const CAT_function = 3;
export const CAT_primitive = 4;
export const CAT_error_set = 5;
export const CAT_global_const = 6;
export const CAT_alias = 7;
export const CAT_type = 8; // Could be enum, struct, union, etc. Needs fields/members check
export const CAT_type_type = 9; // e.g., Type
export const CAT_type_function = 10; // e.g., @Type

// --- Existing initWasm and helper functions ---
// ... initWasm, decodeString, unwrapString, unwrapSlice32, unwrapSlice64, setInputString ...
// ... findDecl, fullyQualifiedName, declIndexName, updateModuleList ...

// Initialize WebAssembly
export async function initWasm() {
  if (wasmInstance) return; // Already initialized

  // Define __dirname for ES modules
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Paths relative to project
  const wasmPath = path.resolve(__dirname, WASM_PATH); // Assuming wasm is copied to public
  const tarballPath = path.resolve(__dirname, SOURCES_PATH); // Assuming tarball is copied to public

  // Read the wasm file
  const wasmBuffer = await fs.readFile(wasmPath);

  // Load sources.tar into memory
  const tarballBuffer = await fs.readFile(tarballPath);

  // Environment for WASM imports
  const importObject = {
    js: {
      log: function (level: any, ptr: number, len: number) {
        const message = decodeString(ptr, len);
        switch (level) {
          case 0:
            console.log(message);
            break;
          case 1:
            console.warn(message);
            break;
          case 2:
            console.error(message);
            break;
          default:
            console.log(`Unknown log level ${level}: ${message}`);
        }
      },
    },
  };

  // Compile and instantiate the wasm module
  const wasmModule = await WebAssembly.instantiate(wasmBuffer, importObject);
  wasmInstance = wasmModule.instance;
  wasmExports = wasmInstance.exports as any; // Assign exports
  memory = wasmExports.memory as WebAssembly.Memory; // Assign memory

  // Load the tarball into wasm memory
  const tarballJsArray = new Uint8Array(tarballBuffer);
  const ptr = wasmExports.alloc(tarballJsArray.length);
  const tarballWasmArray = new Uint8Array(
    memory.buffer,
    ptr,
    tarballJsArray.length
  );
  tarballWasmArray.set(tarballJsArray);
  wasmExports.unpack(ptr, tarballJsArray.length); // Assuming 'unpack' is the function to process the tarball

  // Update module list
  updateModuleList(); // Populate moduleList array
  console.log("WASM Initialized and Tarball processed.");
}

// Helper functions (assuming these exist and work correctly)
function decodeString(ptr: number, len: number): string {
  if (!memory) throw new Error("WASM memory not initialized");
  return textDecoder.decode(new Uint8Array(memory.buffer, ptr, len));
}

export function unwrapString(bigint: bigint): string {
  if (!wasmExports || !memory) throw new Error("WASM not initialized");
  const ptr = Number(bigint & 0xffffffffn);
  const len = Number(bigint >> 32n);
  if (len === 0) return "";
  return decodeString(ptr, len);
}

function unwrapSlice32(bigint: bigint): Uint32Array {
  if (!wasmExports || !memory) throw new Error("WASM not initialized");
  const ptr = Number(bigint & 0xffffffffn);
  const len = Number(bigint >> 32n);
  if (len === 0) return new Uint32Array(0);
  return new Uint32Array(memory.buffer, ptr, len).slice(); // Use slice to copy, preventing issues with memory growth
}

function unwrapSlice64(bigint: bigint): BigUint64Array {
  if (!wasmExports || !memory) throw new Error("WASM not initialized");
  const ptr = Number(bigint & 0xffffffffn);
  const len = Number(bigint >> 32n);
  if (len === 0) return new BigUint64Array(0);
  return new BigUint64Array(memory.buffer, ptr, len).slice(); // Use slice to copy
}

function setInputString(s: string): void {
  if (!wasmExports || !memory) throw new Error("WASM not initialized");
  const jsArray = textEncoder.encode(s);
  const len = jsArray.length;
  const ptr = wasmExports.set_input_string(len);
  const wasmArray = new Uint8Array(memory.buffer, ptr, len);
  wasmArray.set(jsArray);
}

function findDecl(fqn: string): number | null {
  if (!wasmExports) throw new Error("WASM not initialized");
  setInputString(fqn);
  const result = wasmExports.find_decl();
  return result === 0xffffffff ? null : result; // Assuming -1 or uint max indicates not found
}

function fullyQualifiedName(declIndex: number): string {
  if (!wasmExports) throw new Error("WASM not initialized");
  return unwrapString(wasmExports.decl_fqn(declIndex));
}

function declIndexName(declIndex: number): string {
  if (!wasmExports) throw new Error("WASM not initialized");
  return unwrapString(wasmExports.decl_name(declIndex));
}

function updateModuleList(): void {
  if (!wasmExports)
    throw new Error("WASM not initialized when updateModuleList called");
  moduleList = [];
  let i = 0;
  const MAX_MODULES_CHECK = 10000; // Add a safety break to prevent infinite loops

  console.log("Starting module discovery...");

  while (i < MAX_MODULES_CHECK) {
    // Call module_name with the current index
    const nameBigInt = wasmExports.module_name(i);

    // Extract the length from the returned BigInt (assuming length is in the upper 32 bits)
    const len = Number(nameBigInt >> 32n);

    if (len === 0) {
      // If the length is 0, assume it's an empty string, meaning no more modules
      console.log(
        `module_name(${i}) returned empty string. Assuming end of modules.`
      );
      break; // Exit the loop
    }

    // If length is non-zero, decode the name
    const name = decodeString(Number(nameBigInt & 0xffffffffn), len); // Use decodeString directly

    // Find the root declaration for this module
    const rootDeclIndex = wasmExports.find_module_root(i);

    if (rootDeclIndex !== 0xffffffff) {
      // Check if module root found (using 0xFFFFFFFF convention)
      moduleList.push({ name, rootDeclIndex });
      // console.log(`Found module: ${name} (index ${i}, root ${rootDeclIndex})`);
    } else {
      // Log a warning if a module name exists but its root can't be found
      console.warn(
        `Could not find root declaration for module: "${name}" (index ${i})`
      );
      // Optionally, you could still add it to the list if needed, maybe with rootDeclIndex = null
      // moduleList.push({ name, rootDeclIndex: null });
    }

    i++; // Increment index to check the next module
  }

  if (i === MAX_MODULES_CHECK) {
    console.warn(
      `Reached MAX_MODULES_CHECK (${MAX_MODULES_CHECK}) while searching for modules. The list might be incomplete.`
    );
  }

  // Optional: Sort modules by name after discovery
  moduleList.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Finished module discovery. Found ${moduleList.length} modules.`);
}

// --- Public API functions ---

export async function getAllModules() {
  await initWasm();
  return moduleList;
}

export async function getModuleData(moduleName: string) {
  await initWasm();
  const moduleInfo = moduleList.find((m) => m.name === moduleName);
  if (!moduleInfo) {
    throw new Error(`Module not found: ${moduleName}`);
  }

  const rootDeclIndex = moduleInfo.rootDeclIndex;
  // Get module members (assuming namespace_members works for modules)
  // Pass true for include_private if needed, false otherwise
  const memberIndices = unwrapSlice32(
    wasmExports.namespace_members(rootDeclIndex, false)
  );

  const declarations = processDeclarations(Array.from(memberIndices));

  // Get module documentation
  const docsHtml = unwrapString(
    wasmExports.decl_docs_html(rootDeclIndex, false)
  );

  // Get module fields (if the module root itself is a struct-like container)
  const fieldIndices = unwrapSlice32(wasmExports.decl_fields(rootDeclIndex));

  return {
    name: moduleName,
    rootDeclIndex: rootDeclIndex,
    docs: docsHtml,
    declarations: declarations, // Array of basic info for listing
    fields: Array.from(fieldIndices), // Indices of fields belonging to the module container
  };
}

// Helper to process a list of declaration indices
export function processDeclarations(memberIndices: number[]) {
  const declarations = [];
  for (let memberIndex of memberIndices) {
    // Handle potential aliases first
    let originalIndex = memberIndex;
    let category = wasmExports.categorize_decl(memberIndex, 0); // 0 might mean default context

    // Follow aliases to get the actual declaration
    while (category === CAT_alias) {
      memberIndex = wasmExports.get_aliasee(memberIndex); // Assuming get_aliasee exists
      if (memberIndex === 0xffffffff || memberIndex === originalIndex) break; // Alias loop or not found
      category = wasmExports.categorize_decl(memberIndex, 0);
    }
    if (memberIndex === 0xffffffff) continue; // Skip if alias resolution failed

    const name = declIndexName(originalIndex); // Use original name (alias name)
    const fqn = fullyQualifiedName(originalIndex); // Use original FQN for linking
    const targetFqn = fullyQualifiedName(memberIndex); // FQN of the actual declaration
    const docsShortHtml = unwrapString(
      wasmExports.decl_docs_html(memberIndex, true)
    ); // Short docs of target
    const typeHtml = unwrapString(wasmExports.decl_type_html(memberIndex)); // Type HTML of target
    const protoHtmlShort =
      category === CAT_function || category === CAT_type_function
        ? unwrapString(wasmExports.decl_fn_proto_html(memberIndex, true)) // Short proto for list view
        : null;

    declarations.push({
      originalIndex: originalIndex,
      targetIndex: memberIndex,
      name: name,
      fqn: fqn,
      targetFqn: targetFqn,
      category: category,
      docsShort: docsShortHtml,
      typeHtml: typeHtml,
      protoHtmlShort: protoHtmlShort, // Add short function prototype if applicable
    });
  }
  return declarations;
}

/*
 * Expected structure of the object returned by getDeclData(declIndex):
 * {
 *   index: number,          // The resolved declaration index (after following aliases)
 *   originalIndex: number,  // The index originally requested (could be an alias)
 *   name: string,           // Name of the declaration (original name if alias)
 *   fqn: string,            // Fully qualified name (original fqn if alias)
 *   targetFqn: string,      // Fully qualified name of the resolved declaration
 *   category: number,       // Category constant (CAT_*)
 *   categoryName: string,   // Human-readable category name ("function", "struct", etc.)
 *   filePath: string,       // Source file path
 *   docs: string | null,    // Full documentation HTML, or null
 *   sourceHtml: string | null, // Syntax-highlighted source HTML, or null
 *
 *   // Category-specific fields:
 *   protoHtml?: string | null, // For functions: Full prototype HTML
 *   params?: number[],         // For functions: Array of parameter indices
 *   fields?: number[],         // For containers/types: Array of field indices
 *   members?: number[],        // For namespaces/containers: Array of member declaration indices
 *   errorSetNodes?: bigint[],  // For functions/error sets: Array of error node identifiers (BigUint64Array)
 *   errorSetBaseDecl?: number, // For functions with error sets: The decl index the errors are relative to
 *   doctestHtml?: string | null, // For functions/types: Doc test HTML
 *   typeHtml?: string | null,  // For variables/constants/fields: Type HTML
 *   isAlias: boolean          // True if the original request was an alias
 *   // ... any other relevant data extracted from WASM ...
 * }
 */
export async function getDeclData(identifier: number | string) {
  await initWasm();

  let declIndex: number | null;
  let originalIndex: number | null;

  if (typeof identifier === "string") {
    originalIndex = findDecl(identifier);
    if (originalIndex === null) {
      throw new Error(`Declaration not found: ${identifier}`);
    }
    declIndex = originalIndex;
  } else {
    originalIndex = identifier;
    declIndex = identifier;
  }

  let category = wasmExports.categorize_decl(declIndex, 0);
  const isAlias = category === CAT_alias;
  let targetFqn = "";
  let targetIndex = declIndex;

  // Follow aliases
  while (category === CAT_alias) {
    const nextIndex: number = wasmExports.get_aliasee(declIndex);
    if (nextIndex === 0xffffffff || nextIndex === declIndex) {
      console.warn(
        `Could not resolve alias or alias loop detected for index ${originalIndex}`
      );
      // Fallback to treating it as the alias itself if resolution fails
      declIndex = originalIndex;
      targetIndex = originalIndex;
      category = wasmExports.categorize_decl(declIndex, 0); // Re-categorize original
      targetFqn = fullyQualifiedName(declIndex);
      break;
    }
    declIndex = nextIndex;
    targetIndex = declIndex; // Keep track of the final target
    category = wasmExports.categorize_decl(declIndex, 0);
    targetFqn = fullyQualifiedName(targetIndex); // Get FQN of the final target
  }
  if (targetFqn === "") {
    // If it wasn't an alias or resolution failed and we broke early
    targetFqn = fullyQualifiedName(targetIndex);
  }

  // Base declaration data
  const data: any = {
    index: targetIndex,
    originalIndex: originalIndex,
    name: declIndexName(originalIndex), // Always use original name
    fqn: fullyQualifiedName(originalIndex), // Always use original FQN
    targetFqn: targetFqn,
    category: category,
    categoryName: unwrapString(wasmExports.decl_category_name(targetIndex)),
    filePath: unwrapString(wasmExports.decl_file_path(targetIndex)),
    docs: unwrapString(wasmExports.decl_docs_html(targetIndex, false)), // Full docs
    sourceHtml: unwrapString(wasmExports.decl_source_html(targetIndex)),
    typeHtml: unwrapString(wasmExports.decl_type_html(targetIndex)), // Useful for vars, fields, etc.
    isAlias: isAlias,
  };

  // Add category-specific data
  switch (category) {
    case CAT_function:
    case CAT_type_function:
      data.protoHtml = unwrapString(
        wasmExports.decl_fn_proto_html(targetIndex, false)
      ); // Full prototype
      data.params = Array.from(
        unwrapSlice32(wasmExports.decl_params(targetIndex))
      );
      data.doctestHtml = unwrapString(
        wasmExports.decl_doctest_html(targetIndex)
      );
      // Handle error set if present
      const errorSetNode = wasmExports.fn_error_set(targetIndex); // Returns a BigInt node identifier?
      if (errorSetNode !== 0n) {
        // Assuming 0 means no error set
        data.errorSetBaseDecl = wasmExports.fn_error_set_decl(
          targetIndex,
          errorSetNode
        );
        data.errorSetNodes = Array.from(
          unwrapSlice64(
            wasmExports.error_set_node_list(data.errorSetBaseDecl, errorSetNode)
          )
        );
      }
      break;

    case CAT_container:
    case CAT_type: // Structs, Enums, Unions might fall here
    case CAT_namespace: // Namespaces also have members
      data.fields = Array.from(
        unwrapSlice32(wasmExports.decl_fields(targetIndex))
      );
      // For namespaces or types that contain nested declarations:
      data.members = Array.from(
        unwrapSlice32(wasmExports.namespace_members(targetIndex, false))
      );
      // Maybe doc tests apply to types too? Check WASM API
      data.doctestHtml = unwrapString(
        wasmExports.decl_doctest_html(targetIndex)
      );
      break;

    case CAT_error_set:
      // Get the errors directly associated with this error set declaration
      data.errorSetNodes = Array.from(
        unwrapSlice64(wasmExports.decl_error_set(targetIndex))
      );
      // Error sets themselves usually don't have fields/params in the same way,
      // but might have associated documentation or source.
      break;

    case CAT_global_variable:
    case CAT_global_const:
      // Type HTML is already included in the base data
      break;

    case CAT_primitive:
      // Usually just has documentation.
      break;
  }

  return data;
}

// Function to get HTML for a specific parameter (used by [...path].astro)
export async function getParamData(
  declIndex: number,
  paramIndex: number
): Promise<{ html: string }> {
  await initWasm();
  // Ensure the declIndex corresponds to a function or type function
  const html = unwrapString(wasmExports.decl_param_html(declIndex, paramIndex));
  return { html };
}

// Function to get HTML for a specific field (used by [...path].astro and [module].astro)
export async function getFieldData(
  declIndex: number,
  fieldIndex: number
): Promise<{ html: string }> {
  await initWasm();
  // Ensure the declIndex corresponds to a container/type
  const html = unwrapString(wasmExports.decl_field_html(declIndex, fieldIndex));
  return { html };
}

// Function to get HTML for a specific error in an error set (used by [...path].astro)
export async function getErrorData(
  baseDeclIndex: number,
  errorNode: bigint
): Promise<{ html: string }> {
  await initWasm();
  const html = unwrapString(wasmExports.error_html(baseDeclIndex, errorNode));
  return { html };
}

// Get *basic* info for all declarations - potentially very large, use with caution
export async function getAllDeclarations() {
  await initWasm();
  console.warn(
    "getAllDeclarations() might be slow and memory intensive for large libraries."
  );
  // This needs a WASM function that returns *all* known declaration indices.
  // Let's assume `wasmExports.get_all_decls()` returns a BigInt pointer/len pair for a Uint32Array.
  // const allDeclIndices = unwrapSlice32(wasmExports.get_all_decls()); // Hypothetical function
  // For now, let's rebuild it from modules - less efficient but feasible with current info
  let allIndicesSet = new Set<number>();
  for (const module of moduleList) {
    const memberIndices = unwrapSlice32(
      wasmExports.namespace_members(module.rootDeclIndex, true)
    ); // Include private? Maybe?
    memberIndices.forEach((idx) => allIndicesSet.add(idx));
    // Need a way to recursively find *all* nested decls, not just top-level module members.
    // This is complex and might require more from the WASM side.
    // The current implementation is INCOMPLETE for truly *all* decls.
  }

  // Using the incomplete set for now:
  return processDeclarations(Array.from(allIndicesSet));
}

// Execute search query
export async function executeSearch(query: string, ignoreCase: boolean = true) {
  await initWasm();

  // Set the query string in WASM memory (assuming setQueryString exists)
  const setQueryStringWasm = (s: string) => {
    const jsArray = textEncoder.encode(s);
    const len = jsArray.length;
    const ptr = wasmExports.query_begin(len); // Assuming query_begin allocates and returns pointer
    const wasmArray = new Uint8Array(memory.buffer, ptr, len);
    wasmArray.set(jsArray);
  };
  setQueryStringWasm(query);

  // Execute the search
  const resultsBigInt = wasmExports.query_exec(ignoreCase); // Assuming returns ptr/len BigInt

  // Get the search results
  const resultsIndices = unwrapSlice32(resultsBigInt);

  // Convert to declaration data (basic info for search results)
  return processDeclarations(Array.from(resultsIndices));
}
