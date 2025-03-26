/**
 * Generates the web path for a given fully qualified name (FQN).
 * Example: "std.time.Instant" -> "/modules/std/time/Instant"
 * @param fqn The fully qualified name.
 * @returns The corresponding URL path.
 */
export function getDeclPath(fqn: string | undefined | null): string {
  if (!fqn) {
    console.warn("getDeclPath called with empty FQN.");
    return "#"; // Return a safe fallback
  }
  // Ensure no leading/trailing dots and replace all dots with slashes
  const cleanedFqn = fqn.replace(/^\.+|\.+$/g, '').replace(/\./g, '/');
  return `/modules/${cleanedFqn}`;
}

/**
 * Generates the web path for the source file of a declaration.
 * Example: "std/time.zig" -> "/src/std/time.zig"
 * @param filePath The file path relative to the source root.
 * @returns The corresponding URL path for the source view.
 */
export function getSourcePath(filePath: string | undefined | null): string {
   if (!filePath) {
       return "#"; // Fallback if no file path
   }
   // Ensure no leading slashes
   const cleanedPath = filePath.replace(/^\/+/, '');
   return `/src/${cleanedPath}`;
}

/**
 * Generates the web path for the source file of a module.
 * Example: "std.time" -> "/src/std/time.zig"
 * @param moduleName The name of the module.
 * @returns The corresponding URL path for the source view.
 */
export function getModuleSourcePath(moduleName: string | undefined | null): string {
    if (!moduleName) {
        return "#";
    }
    const filePath = moduleName.replaceAll(".", "/") + ".zig";
    return getSourcePath(filePath);
}