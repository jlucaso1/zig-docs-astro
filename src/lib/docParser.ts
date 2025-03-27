import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  initializeWasmUtils,
  decodeString, // Keep direct import if needed for logging callback
  unwrapString,
  unwrapSlice32,
  unwrapSlice64,
  setInputString,
} from "./wasmUtils";
import * as DeclCategories from "./constants"; // Import all constants
import * as cheerio from 'cheerio';

// Paths relative to project
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Adjusted paths relative to the new location of docParser.ts
const WASM_PATH = path.resolve(__dirname, "../../assets/main.wasm");
const SOURCES_PATH = path.resolve(__dirname, "../../assets/sources.tar");

// URLs for downloading the assets
const WASM_URL = "https://ziglang.org/documentation/master/std/main.wasm";
const SOURCES_URL = "https://ziglang.org/documentation/master/std/sources.tar";

// Global WebAssembly state (keep these here)
let wasmInstance: WebAssembly.Instance;
export let wasmExports: any; // Make exports accessible if needed elsewhere
let memory: WebAssembly.Memory;
let moduleList: { name: string; rootDeclIndex: number }[] = [];

// Re-export constants for convenience if pages import directly from docParser
export * from "./constants";

/**
 * Downloads and caches WASM assets if they don't exist.
 * This ensures that the required files are present before initializing WASM.
 */
async function downloadWasmAssets(): Promise<void> {
  console.log("Checking for WASM assets...");

  // Ensure the assets directory exists
  const assetsDir = path.dirname(WASM_PATH);
  try {
    await fs.access(assetsDir);
  } catch (error) {
    console.log("Creating assets directory...");
    await fs.mkdir(assetsDir, { recursive: true });
  }

  // Check and download main.wasm if needed
  let wasmExists = false;
  try {
    await fs.access(WASM_PATH);
    wasmExists = true;
    console.log("main.wasm found in assets folder.");
  } catch (error) {
    console.log("main.wasm not found. Downloading from ziglang.org...");
  }

  // Check and download sources.tar if needed
  let sourcesExists = false;
  try {
    await fs.access(SOURCES_PATH);
    sourcesExists = true;
    console.log("sources.tar found in assets folder.");
  } catch (error) {
    console.log("sources.tar not found. Downloading from ziglang.org...");
  }

  // Download files if they don't exist
  const downloads: Promise<void>[] = [];

  if (!wasmExists) {
    downloads.push(
      fetch(WASM_URL)
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              `Failed to fetch main.wasm: ${response.status} ${response.statusText}`
            );
          }
          return response.arrayBuffer();
        })
        .then((buffer) => fs.writeFile(WASM_PATH, Buffer.from(buffer)))
        .then(() => console.log("main.wasm downloaded and saved successfully."))
    );
  }

  if (!sourcesExists) {
    downloads.push(
      fetch(SOURCES_URL)
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              `Failed to fetch sources.tar: ${response.status} ${response.statusText}`
            );
          }
          return response.arrayBuffer();
        })
        .then((buffer) => fs.writeFile(SOURCES_PATH, Buffer.from(buffer)))
        .then(() =>
          console.log("sources.tar downloaded and saved successfully.")
        )
    );
  }

  if (downloads.length > 0) {
    await Promise.all(downloads);
    console.log("All required assets are now available.");
  } else {
    console.log("All required assets already exist.");
  }
}

// --- WASM Initialization ---
export async function initWasm() {
  if (wasmInstance) return; // Already initialized

  // Download and cache required assets if they don't exist
  await downloadWasmAssets();

  // Define __dirname for ES modules - Correct calculation relative to this file
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Correct paths relative to THIS file's location (src/lib)
  const wasmPath = path.resolve(__dirname, "../../assets/main.wasm");
  const tarballPath = path.resolve(__dirname, "../../assets/sources.tar");

  // Read the wasm file
  const wasmBuffer = await fs.readFile(wasmPath);

  // Load sources.tar into memory
  const tarballBuffer = await fs.readFile(tarballPath);

  // Environment for WASM imports
  const importObject = {
    js: {
      log: function (level: any, ptr: number, len: number) {
        // Use decodeString directly here as wasmUtils might not be initialized yet
        const message = new TextDecoder().decode(
          new Uint8Array(memory?.buffer, ptr, len) // Use optional chaining for safety during early init
        );
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

  // Initialize the utility functions with the instance details
  initializeWasmUtils(memory, wasmExports);

  // Load the tarball into wasm memory
  const tarballJsArray = new Uint8Array(tarballBuffer);
  const ptr = wasmExports.alloc(tarballJsArray.length);
  if (ptr === 0) throw new Error("WASM failed to allocate memory for tarball.");
  const tarballWasmArray = new Uint8Array(
    memory.buffer,
    ptr,
    tarballJsArray.length
  );
  tarballWasmArray.set(tarballJsArray);
  wasmExports.unpack(ptr, tarballJsArray.length); // Assuming 'unpack' is the function to process the tarball
  // Note: Consider freeing the tarball memory in WASM if 'unpack' doesn't consume it
  // if (wasmExports.free) { wasmExports.free(ptr, tarballJsArray.length); }

  // Update module list
  updateModuleList(); // Populate moduleList array
  console.log("WASM Initialized and Tarball processed.");
}

// --- Internal Helper Functions ---

// Removed decodeString, unwrapString, unwrapSlice32, unwrapSlice64, setInputString (moved to wasmUtils.ts)

function findDecl(fqn: string): number | null {
  if (!wasmExports) throw new Error("WASM not initialized");
  setInputString(fqn);
  const result = wasmExports.find_decl();
  // Check against WASM's specific "not found" value (often -1 represented as max uint)
  // Assuming 0xFFFFFFFF is the "not found" indicator
  return result === 0xffffffff ? null : result;
}

function fullyQualifiedName(declIndex: number): string {
  if (!wasmExports) throw new Error("WASM not initialized");
  // Add check for invalid index if necessary
  if (declIndex === 0xffffffff) return "[Invalid Index]";
  return unwrapString(wasmExports.decl_fqn(declIndex));
}

function declIndexName(declIndex: number): string {
  if (!wasmExports) throw new Error("WASM not initialized");
  // Add check for invalid index if necessary
  if (declIndex === 0xffffffff) return "[Invalid Index]";
  return unwrapString(wasmExports.decl_name(declIndex));
}

function updateModuleList(): void {
  if (!wasmExports)
    throw new Error("WASM not initialized when updateModuleList called");
  moduleList = [];
  let i = 0;
  const MAX_MODULES_CHECK = 10000; // Safety break

  console.log("Starting module discovery...");

  while (i < MAX_MODULES_CHECK) {
    const nameBigInt = wasmExports.module_name(i);
    const len = Number(nameBigInt >> 32n);

    if (len === 0) {
      // console.log(`module_name(${i}) returned empty string. Assuming end of modules.`);
      break; // End of modules
    }

    // Use decodeString from wasmUtils now that it's initialized
    const name = decodeString(Number(nameBigInt & 0xffffffffn), len);

    const rootDeclIndex = wasmExports.find_module_root(i);

    if (rootDeclIndex !== 0xffffffff) {
      moduleList.push({ name, rootDeclIndex });
    } else {
      console.warn(
        `Could not find root declaration for module: "${name}" (index ${i})`
      );
    }
    i++;
  }

  if (i === MAX_MODULES_CHECK) {
    console.warn(
      `Reached MAX_MODULES_CHECK (${MAX_MODULES_CHECK}) while searching for modules. The list might be incomplete.`
    );
  }

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
  const memberIndices = unwrapSlice32(
    wasmExports.namespace_members(rootDeclIndex, false) // false = exclude private members
  );

  const declarations = await processDeclarations(Array.from(memberIndices));

  const docsHtml = unwrapString(
    wasmExports.decl_docs_html(rootDeclIndex, false) // false = full docs
  );

  const fieldIndices = unwrapSlice32(wasmExports.decl_fields(rootDeclIndex));

  return {
    name: moduleName,
    rootDeclIndex: rootDeclIndex,
    docs: docsHtml,
    declarations: declarations,
    fields: Array.from(fieldIndices),
  };
}

// Helper to process a list of declaration indices into structured data
export async function processDeclarations(memberIndices: number[]) {
  if (!wasmExports) {
    console.warn("WASM not initialized. Cannot process declarations.");
    await initWasm();
  };

  const declarations = [];
  for (let memberIndex of memberIndices) {
    let originalIndex = memberIndex;
    let category = wasmExports.categorize_decl(memberIndex, 0); // 0 = default context

    // Resolve aliases
    let targetIndex = memberIndex;
    while (category === DeclCategories.CAT_alias) {
      const nextIndex = wasmExports.get_aliasee(targetIndex);
      // Check for resolution failure or loop
      if (nextIndex === 0xffffffff || nextIndex === targetIndex) {
        console.warn(
          `Alias resolution failed or loop detected for index ${originalIndex}. Using original index ${targetIndex}.`
        );
        // Keep targetIndex as the last valid index before failure/loop
        break;
      }
      targetIndex = nextIndex;
      category = wasmExports.categorize_decl(targetIndex, 0);
    }

    // Skip if resolution somehow ended on an invalid index (shouldn't happen if break works)
    if (targetIndex === 0xffffffff) continue;

    const name = declIndexName(originalIndex); // Use original name (alias name)
    const fqn = fullyQualifiedName(originalIndex); // Use original FQN for linking
    const targetFqn = fullyQualifiedName(targetIndex); // FQN of the actual declaration
    const docsShortHtml = unwrapString(
      wasmExports.decl_docs_html(targetIndex, true) // true = short docs of target
    );
    const typeHtml = unwrapString(wasmExports.decl_type_html(targetIndex)); // Type HTML of target
    const protoHtmlShort =
      category === DeclCategories.CAT_function ||
      category === DeclCategories.CAT_type_function
        ? parseHTMLToCode(unwrapString(wasmExports.decl_fn_proto_html(targetIndex, true))) // true = short proto
        : null;

    declarations.push({
      originalIndex: originalIndex,
      targetIndex: targetIndex, // The resolved index
      name: name,
      fqn: fqn,
      targetFqn: targetFqn,
      category: category, // Category of the target
      docsShort: docsShortHtml,
      typeHtml: typeHtml,
      protoHtmlShort: protoHtmlShort,
    });
  }
  return declarations;
}

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
    // Assuming identifier is a valid index
    originalIndex = identifier;
    declIndex = identifier;
    // Verify the index is somewhat valid if possible (e.g., not 0xffffffff)
    if (declIndex === 0xffffffff) {
      throw new Error(`Invalid declaration index provided: ${identifier}`);
    }
  }

  let category = wasmExports.categorize_decl(declIndex, 0);
  const isAlias = category === DeclCategories.CAT_alias;
  let targetIndex = declIndex;
  let targetFqn = "";

  // Resolve alias if necessary
  while (category === DeclCategories.CAT_alias) {
    const nextIndex: number = wasmExports.get_aliasee(targetIndex);
    if (nextIndex === 0xffffffff || nextIndex === targetIndex) {
      console.warn(
        `Could not resolve alias or alias loop detected for index ${originalIndex}. Using index ${targetIndex}.`
      );
      break; // Stop resolution
    }
    targetIndex = nextIndex;
    category = wasmExports.categorize_decl(targetIndex, 0);
  }

  // Get FQN of the final target
  targetFqn = fullyQualifiedName(targetIndex);

  // Base declaration data
  const data: any = {
    index: targetIndex, // The resolved index
    originalIndex: originalIndex, // The index requested (could be alias)
    name: declIndexName(originalIndex), // Always use original name
    fqn: fullyQualifiedName(originalIndex), // Always use original FQN
    targetFqn: targetFqn, // FQN of the resolved declaration
    category: category, // Category of the resolved declaration
    categoryName: unwrapString(wasmExports.decl_category_name(targetIndex)),
    filePath: unwrapString(wasmExports.decl_file_path(targetIndex)),
    docs: unwrapString(wasmExports.decl_docs_html(targetIndex, false)), // false = Full docs
    sourceHtml: parseHTMLToCode(
      unwrapString(wasmExports.decl_source_html(targetIndex))
    ),
    typeHtml: parseHTMLToCode(
      unwrapString(wasmExports.decl_type_html(targetIndex))
    ), // Type for vars, fields etc.
    isAlias: isAlias, // Was the original identifier an alias?
  };

  // Add category-specific data based on the *target* declaration's category
  switch (category) {
    case DeclCategories.CAT_function:
    case DeclCategories.CAT_type_function:
      data.protoHtml = parseHTMLToCode(unwrapString(
        wasmExports.decl_fn_proto_html(targetIndex, false) // false = Full prototype
      ));
      data.params = Array.from(
        unwrapSlice32(wasmExports.decl_params(targetIndex))
      );
      data.doctestHtml = parseHTMLToCode(unwrapString(
        wasmExports.decl_doctest_html(targetIndex)
      ));
      const errorSetNode = wasmExports.fn_error_set(targetIndex);
      if (errorSetNode !== 0n) {
        // Assuming 0n indicates no error set
        data.errorSetBaseDecl = wasmExports.fn_error_set_decl(
          targetIndex,
          errorSetNode
        );
        // Check if errorSetBaseDecl is valid before proceeding
        if (data.errorSetBaseDecl !== 0xffffffff) {
          data.errorSetNodes = Array.from(
            unwrapSlice64(
              wasmExports.error_set_node_list(
                data.errorSetBaseDecl,
                errorSetNode
              )
            )
          );
        } else {
          console.warn(
            `fn_error_set_decl returned invalid index for target ${targetIndex}, node ${errorSetNode}`
          );
          data.errorSetNodes = [];
        }
      } else {
        data.errorSetNodes = []; // Ensure array exists even if empty
      }
      break;

    case DeclCategories.CAT_container:
    case DeclCategories.CAT_type:
    case DeclCategories.CAT_namespace:
      data.fields = Array.from(
        unwrapSlice32(wasmExports.decl_fields(targetIndex))
      );
      data.members = Array.from(
        unwrapSlice32(wasmExports.namespace_members(targetIndex, false)) // false = public members
      );
      data.doctestHtml = unwrapString(
        wasmExports.decl_doctest_html(targetIndex)
      );
      break;

    case DeclCategories.CAT_error_set:
      // Assuming decl_error_set gives nodes *directly* associated with this set decl
      data.errorSetNodes = Array.from(
        unwrapSlice64(wasmExports.decl_error_set(targetIndex))
      );
      // Error sets might also have a base decl if they are defined relative to another
      // Check if WASM provides this info, e.g., wasmExports.error_set_base_decl(targetIndex)
      // data.errorSetBaseDecl = wasmExports.error_set_base_decl(targetIndex); // Hypothetical
      break;

    // Variables, Constants, Primitives usually don't need more than base data + typeHtml
    case DeclCategories.CAT_global_variable:
    case DeclCategories.CAT_global_const:
    case DeclCategories.CAT_primitive:
      break;
  }

  // Ensure arrays exist even if empty
  data.params = data.params ?? [];
  data.fields = data.fields ?? [];
  data.members = data.members ?? [];
  data.errorSetNodes = data.errorSetNodes ?? [];

  return data;
}

// --- Data Fetching Helpers for Specific Parts ---

export async function getParamData(
  declIndex: number,
  paramIndex: number
): Promise<{ html: string }> {
  await initWasm();
  // TODO: Add validation: check if declIndex is actually a function/type_function?
  const html = parseHTMLToCode(unwrapString(wasmExports.decl_param_html(declIndex, paramIndex)));
  return { html };
}

export async function getFieldData(
  declIndex: number,
  fieldIndex: number
): Promise<{ html: string }> {
  await initWasm();
  // TODO: Add validation: check if declIndex is actually a container/type?
  const html = unwrapString(wasmExports.decl_field_html(declIndex, fieldIndex));
  return { html };
}

export async function getErrorData(
  baseDeclIndex: number, // The index relative to which the error node is defined
  errorNode: bigint
): Promise<{ html: string }> {
  await initWasm();
  // Validate baseDeclIndex?
  if (baseDeclIndex === 0xffffffff) {
    console.error(`getErrorData called with invalid baseDeclIndex.`);
    return { html: "[Error: Invalid Base Index]" };
  }
  const html = unwrapString(wasmExports.error_html(baseDeclIndex, errorNode));
  return { html };
}

function parseHTMLToCode(html: string): string {
  const $ = cheerio.load(html);
  return $("body").text();
}
