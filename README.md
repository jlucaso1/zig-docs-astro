Okay, here's a draft for the `README.md` file describing the project based on the code provided.

```markdown
# Zig Documentation Viewer (Astro + WASM)

This project is a web-based documentation viewer for Zig libraries (likely intended for the Zig Standard Library), built using the [Astro](https://astro.build/) framework. It aims to provide an experience similar to the official Zig documentation site by parsing documentation comments and source code information directly from the library's source files.

A key feature of this project is its use of a **WebAssembly (WASM) module**, compiled from Zig code, which handles the core parsing and data extraction logic.

## Key Features

*   **Module and Declaration Browsing:** Navigate through the library's modules and view details for various declarations (structs, functions, enums, variables, constants, etc.).
*   **Formatted Documentation:** Displays documentation comments (`//!`, `///`) rendered as HTML.
*   **Source Code Viewing:** Shows syntax-highlighted source code snippets for declarations and allows linking to the source files.
*   **Hierarchy and Alias Navigation:** Understand the structure of containers and follow aliases to their target declarations.
*   **Search Functionality:** Provides search capabilities across the documentation content (though implementation details might vary between build-time/client-side).
*   **Static Site Generation:** Leverages Astro's SSG capabilities for fast page loads by pre-rendering module and declaration pages at build time.

## How it Works

The project employs a unique architecture combining Astro's frontend capabilities with a Zig-powered WASM backend for parsing:

1.  **Prerequisites (Zig Build Process - External):** Before this Astro project can be built, a separate Zig build process (not included in this repository) is required to generate two essential artifacts from the target Zig library's source code:
    *   `public/main.wasm`: A WebAssembly module compiled from Zig code. This module contains the logic to parse Zig source code (likely from documentation comments and AST analysis), manage declaration information, and format documentation/code snippets into HTML. It exports functions like `find_decl`, `decl_docs_html`, `namespace_members`, `module_name`, `query_exec`, etc.
    *   `public/sources.tar`: A tarball archive containing the original `.zig` source files of the library.

2.  **Astro Build Process (This Repository):**
    *   **Initialization:** During the build (`npm run build`), the `initWasm` function within `src/lib/docParser.ts` is called.
    *   **WASM Loading:** `initWasm` loads the `main.wasm` binary and instantiates it, setting up the necessary JavaScript import functions (like logging) that the WASM module expects under the `js` namespace.
    *   **Tarball Loading:** It also loads the entire `sources.tar` archive into the WebAssembly module's memory using the `unpack` function exported by the WASM module. This allows the WASM code to access the source file content directly from memory.
    *   **Data Fetching:** Astro's `getStaticPaths` functions within the page components (e.g., `src/pages/modules/[module].astro`, `src/pages/modules/[module]/[...path].astro`) execute.
    *   **WASM Interaction (`docParser.ts`):** These `getStaticPaths` functions call helper functions in `src/lib/docParser.ts` (like `getAllModules`, `getModuleData`, `getDeclData`). This TypeScript module acts as a crucial bridge, translating JavaScript/TypeScript calls into calls to the appropriate functions exported by the loaded `main.wasm` module (e.g., calling `wasmExports.find_decl(...)`, `wasmExports.decl_docs_html(...)`).
    *   **Data Processing (WASM):** The WASM functions process the request, analyzing the data structures built from the source code (likely stored in the WASM memory after unpacking the tarball) and return the requested information, often as pre-formatted HTML strings or arrays of indices/identifiers.
    *   **Static Page Generation (Astro):** Astro receives the data fetched via `docParser.ts` and uses it within the `.astro` components to pre-render static HTML pages for each module and declaration.

3.  **Client-Side Interaction (Potential):**
    *   While the primary focus seems to be static generation, features like search (`executeQuery`) might involve client-side JavaScript interacting with the already-loaded WASM module via `docParser.ts` to provide dynamic results without a full page reload. The original `originalBrowserScript.js` suggests a more client-side heavy approach was initially used or considered.

## Technology Stack

*   **[Astro](https://astro.build/):** Frontend framework for static site generation and component management.
*   **[Zig](https://ziglang.org/):** Used to create the core parsing logic compiled to WebAssembly. (Zig toolchain needed to *generate* WASM/tar, but not necessarily to *run* the Astro site if artifacts are pre-built).
*   **WebAssembly (WASM):** The compiled binary containing the Zig parsing logic.
*   **TypeScript:** Used for the bridge code (`docParser.ts`) interacting with WASM and for Astro component logic.
*   **HTML / CSS:** Standard web technologies for structure and styling.
*   **[tar](https://www.npmjs.com/package/tar) / [tar-stream](https://www.npmjs.com/package/tar-stream):** Potentially used in Node.js context (e.g., scripts) or implicitly by the WASM unpacking process.

## Project Structure

```text
/
├── assets/
│   ├── main.wasm           # REQUIRED: Compiled Zig parsing logic
│   └── sources.tar         # REQUIRED: Tarball of Zig source files
├── src/
│   ├── components/         # Reusable Astro components (e.g., ModuleNav.astro)
│   ├── layouts/            # Base page layout (Layout.astro)
│   ├── pages/              # Astro pages/routes (modules, declarations, source view)
│   ├── lib/                # Helper TypeScript modules
│   │   └── docParser.ts    # CRITICAL: TS bridge to interact with main.wasm
```

## Setup and Running

**Prerequisites:**

1.  **Node.js:** Required for Astro and dependencies. (Check `package.json` for version compatibility, often LTS).
2.  **`main.wasm` and `sources.tar`:** You **must** obtain these files (generated from the Zig library you want to document) and place them inside the `public/` directory. This project *consumes* these files, it does not generate them.

**Installation:**

```bash
# Using npm
npm install

# Or using bun (if preferred, based on original README example)
# bun install
```

**Development Server:**

Starts a local development server with hot reloading.

```bash
# Using npm
npm run dev

# Or using bun
# bun dev
```

Access the site at `http://localhost:4321` (or the port specified by Astro).

**Building for Production:**

Generates a static build of the site in the `dist/` directory.

```bash
# Using npm
npm run build

# Or using bun
# bun build
```

**Previewing the Production Build:**

Starts a local server to preview the contents of the `dist/` directory.

```bash
# Using npm
npm run preview

# Or using bun
# bun preview
```