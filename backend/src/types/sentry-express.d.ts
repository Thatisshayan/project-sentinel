// Type shim for @sentry/express (no @types package available)
// Sentry v8+ uses named export: expressIntegration()
declare module '@sentry/express' {
  interface ExpressIntegrationOptions {
    namespace?: string;
  }
  function expressIntegration(options?: ExpressIntegrationOptions): () => Promise<express.RequestHandler>;
  export { expressIntegration };
  export default expressIntegration;
}