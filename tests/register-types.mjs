import { registerHooks } from "node:module";

// Next resolves extensionless TypeScript imports. Match that resolution for the
// Node test runner while leaving packages and built-in modules untouched.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("."))
        return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
