// Loader for scripts/seed-demo-mail.mjs: extensionless-TS resolution (like
// tests/register-types.mjs) plus a server-only stub, because src/lib/store.ts
// imports "server-only" and must stay server-only inside Next while still being
// seedable from a plain node process.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("."))
        return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
