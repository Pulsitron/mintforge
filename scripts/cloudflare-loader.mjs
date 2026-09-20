// Node-only artifact checks: Workers provides this built-in at runtime.
// This stub permits export/render inspection; it does not emulate D1 or storage.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers")
    return {
      url: "data:text/javascript,export const env = {};",
      shortCircuit: true,
    };
  return nextResolve(specifier, context);
}
