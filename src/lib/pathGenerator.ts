import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as DeclCategories from "./constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// this is a hack for the build mode (the problem is because the relative path is on dist)
const PATHS_CACHE_FILE = path.resolve(__dirname, "../../assets/declaration-paths-cache.json").replace('/dist/pages', '');

// @TODO Check zig version from wasm module to invalidate cache if needed

/**
 * Process data to make it JSON serializable by converting BigInt to strings
 * @param data Any data structure that might contain BigInt values
 * @returns The same structure with BigInt converted to strings with "__bigint__:" prefix
 */
function makeSerializable(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "bigint") {
    // Prefix with a marker so we can convert back to BigInt when reading
    return `__bigint__:${data.toString()}`;
  }

  if (Array.isArray(data)) {
    return data.map((item) => makeSerializable(item));
  }

  if (typeof data === "object") {
    const result: Record<string, any> = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        result[key] = makeSerializable(data[key]);
      }
    }
    return result;
  }

  return data;
}

/**
 * Restore BigInt values from serialized strings in data loaded from cache
 * @param data Any data structure that might contain serialized BigInt values
 * @returns The same structure with string BigInts converted back to actual BigInts
 */
function restoreBigInts(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string" && data.startsWith("__bigint__:")) {
    // Convert string representation back to BigInt
    return BigInt(data.substring(11));
  }

  if (Array.isArray(data)) {
    return data.map((item) => restoreBigInts(item));
  }

  if (typeof data === "object") {
    const result: Record<string, any> = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        result[key] = restoreBigInts(data[key]);
      }
    }
    return result;
  }

  return data;
}

/**
 * Checks if the cache file exists and is valid
 */
async function getCachedPaths() {
  try {
    const cacheExists = await fs
      .access(PATHS_CACHE_FILE)
      .then(() => true)
      .catch(() => false);

    if (cacheExists) {
      console.log("Using cached declaration paths");
      const cachedData = await fs.readFile(PATHS_CACHE_FILE, "utf-8");
      // Restore BigInt values when loading from cache
      return restoreBigInts(JSON.parse(cachedData));
    }
  } catch (err) {
    console.warn("Error reading cache file:", err);
  }

  console.log("No valid cache found, generating new paths...", PATHS_CACHE_FILE);
  return null;
}

/**
 * Generates all static paths for module declarations with caching
 * @param {boolean} forceRegenerate - If true, regenerates cache even if it exists
 * @returns {Promise<Array>} Array of path objects for Astro's getStaticPaths
 */
export async function generateDeclarationPaths(forceRegenerate = false) {
  // First check if we have a cached result (unless force regenerate is true)
  if (!forceRegenerate) {
    const cachedPaths = await getCachedPaths();
    if (cachedPaths) return cachedPaths;
  }

  console.log("Generating static paths for all declarations...");

  // Import needed functions dynamically to ensure they're not loaded unnecessarily
  const {
    getAllModules,
    getModuleData,
    getDeclData: getDeclDataInternal,
    processDeclarations: processDeclarationsInternal,
  } = await import("./docParser");

  const modules = await getAllModules();
  console.log(`Found ${modules.length} modules to process.`);

  const paths: {
    params: { module: any; path: any };
    props: { declData: any };
  }[] = [];
  const processedFqns = new Set();

  async function processDeclarationRecursively(declFqn: string) {
    if (processedFqns.has(declFqn)) return;
    processedFqns.add(declFqn);

    try {
      const declData = await getDeclDataInternal(declFqn);
      const fqnParts = declFqn.split(".");
      if (fqnParts.length < 2) return; // Skip module roots

      const moduleName = fqnParts[0];
      // path can be undefined if it's a direct child of the module
      const pathString =
        fqnParts.length > 1 ? fqnParts.slice(1).join("/") : undefined;

      paths.push({
        params: {
          module: moduleName,
          path: pathString,
        },
        props: { declData },
      });

      // Process nested members recursively if it's a container/namespace/type
      if (
        (declData.category === DeclCategories.CAT_container ||
          declData.category === DeclCategories.CAT_namespace ||
          declData.category === DeclCategories.CAT_type) && // Include CAT_type if they can have members
        declData.members &&
        declData.members.length > 0
      ) {
        // processDeclarations returns basic info including fqn
        const nestedDecls = await processDeclarationsInternal(declData.members);
        await Promise.all(
          nestedDecls.map((nestedDecl) =>
            processDeclarationRecursively(nestedDecl.fqn)
          )
        );
      }
    } catch (error) {
      console.error(
        `Error processing declaration ${declFqn} in generateDeclarationPaths:`,
        error
      );
    }
  }

  await Promise.all(
    modules.map(async (module) => {
      try {
        const moduleData = await getModuleData(module.name);
        if (moduleData.declarations && moduleData.declarations.length > 0) {
          // Filter out declarations without FQN
          const validDeclarations = moduleData.declarations.filter((decl) => {
            if (!decl.fqn) {
              console.warn(
                `Skipping declaration with missing FQN in module ${module.name} (Index: ${decl.originalIndex})`
              );
              return false;
            }
            return true;
          });
          await Promise.all(
            validDeclarations.map((decl) =>
              processDeclarationRecursively(decl.fqn)
            )
          );
        }
      } catch (error) {
        console.error(
          `Error processing module ${module.name} in generateDeclarationPaths:`,
          error
        );
      }
    })
  );

  console.log(
    `Successfully prepared ${paths.length} paths for declaration pages.`
  );

  // Make data JSON-serializable by converting BigInt values to strings
  const serializablePaths = makeSerializable(paths);

  // Save to cache for future use
  try {
    await fs.writeFile(PATHS_CACHE_FILE, JSON.stringify(serializablePaths));
    console.log("Declaration paths cached successfully");
  } catch (err) {
    console.error("Failed to cache declaration paths:", err);
  }

  return paths;
}

/**
 * Utility function to clear the cache if needed
 */
export async function clearPathCache() {
  try {
    await fs.unlink(PATHS_CACHE_FILE);
    console.log("Path cache cleared successfully");
    return true;
  } catch (err) {
    console.log("No path cache to clear or error:", err);
    return false;
  }
}
