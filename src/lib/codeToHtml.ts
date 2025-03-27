// import { codeToHtml as codeToHtmlInternal } from "shiki";

// export const codeToHtml = async (code: string): Promise<string> => {
//   return codeToHtmlInternal(code, {
//     lang: "zig",
//     theme: "dracula",
//   });
// };

// now i will do a fine grained bundle

import dracula from "@shikijs/themes/dracula";
import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import zig from "@shikijs/langs/zig";

const highlighter = await createHighlighterCore({
  themes: [dracula],
  langs: [zig],
  engine: createOnigurumaEngine(import("shiki/wasm")),
});

export const codeToHtml = async (code: string): Promise<string> => {
  return highlighter.codeToHtml(code, {
    lang: "zig",
    theme: "dracula",
  });
};
