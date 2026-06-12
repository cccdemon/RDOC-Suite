// swagger-ui-dist ships no types for the bundle entry. We only call the factory
// with an options bag, so a minimal ambient signature is enough.
declare module "swagger-ui-dist/swagger-ui-bundle.js" {
  const SwaggerUIBundle: (opts: Record<string, unknown>) => unknown;
  export default SwaggerUIBundle;
}
