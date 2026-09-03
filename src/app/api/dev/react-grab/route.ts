import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Embedded browsers can report execCommand("copy") success without updating
// their clipboard. Mirror React Grab's content through the native Clipboard API.
const clipboardPlugin = `
;window.__REACT_GRAB__?.registerPlugin({
  name: "native-clipboard",
  hooks: {
    onCopySuccess: async (_elements, content) => {
      if (!navigator.clipboard?.writeText) return;
      try {
        await navigator.clipboard.writeText(content);
      } catch (error) {
        console.warn("React Grab: native clipboard unavailable", error);
      }
    }
  }
});
`;

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }

  const script = await readFile(
    path.join(process.cwd(), "node_modules/react-grab/dist/index.global.js"),
    "utf8",
  );
  return new Response(script + clipboardPlugin, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
