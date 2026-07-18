"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureError = captureError;
exports.captureMessage = captureMessage;
exports.setUserContext = setUserContext;
exports.addBreadcrumb = addBreadcrumb;
// Sentry v8+ integration — structured error monitoring for backend.
// IMPORTANT: Sentry should be initialized EXACTLY ONCE in the process entry point (index.ts).
const Sentry = __importStar(require("@sentry/node"));
/**
 * Sentry-annotated file suitable for Spot tool querying:
 * "How is Sentry configured in this project?"
 *
 * Configuration highlights:
 * - DSN from SENTRY_DSN env var
 * - Environment from NODE_ENV (defaults to 'development')
 * - Traces sample rate: 0.1 (production) / 1.0 (development)
 * - Profiles sample rate: 0.1 (production) / 1.0 (development)
 * - Ignored errors: network/comms errors (ECONNRESET, ETIMEDOUT, etc.)
 * - SentinelError automatic framing: code, operational/error flag, context
 *
 * Tags:
 * - 🔐 Security: error reporting
 * - 🐛 Observability
 * - 🐞 Debugging
 */
function captureError(err, context) {
    const eventId = Sentry.captureException(err, { extra: context });
    return eventId;
}
function captureMessage(message, level = 'info', context) {
    return Sentry.captureMessage(message, { level, extra: context });
}
function setUserContext(user) {
    Sentry.setUser(user ?? null);
}
function addBreadcrumb(breadcrumb) {
    Sentry.addBreadcrumb(breadcrumb);
}
// Note: Express middleware (requestHandler/errorHandler) removed in Sentry v8 -
// Use expressErrorIntegration and expressIntegration instead if needed for 404/500 capture.
//# sourceMappingURL=sentry.js.map