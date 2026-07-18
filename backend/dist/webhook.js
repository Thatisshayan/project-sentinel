"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const logger_1 = __importDefault(require("./logger"));
const processWebhook_1 = require("./webhook/processWebhook");
const processPREvent_1 = require("./webhook/processPREvent");
const router = express_1.default.Router();
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — slow down' },
});
function verifySignature(req, res, next) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
        logger_1.default.warn({ ip: req.ip }, 'Webhook received without x-hub-signature-256 header');
        res.status(401).json({ error: 'Missing signature header' });
        return;
    }
    const body = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const expected = 'sha256=' + crypto_1.default
        .createHmac('sha256', process.env['GITHUB_WEBHOOK_SECRET'] || '')
        .update(body)
        .digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    const validLength = sigBuf.length === expBuf.length;
    const validHmac = validLength && crypto_1.default.timingSafeEqual(sigBuf, expBuf);
    if (!validHmac) {
        logger_1.default.warn({ ip: req.ip }, 'Webhook signature verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }
    next();
}
router.post('/github', limiter, verifySignature, (req, res) => {
    res.status(200).json({ received: true });
    const event = req.headers['x-github-event'] || 'push';
    if (event === 'pull_request') {
        (0, processPREvent_1.processPREvent)(req.body).catch((err) => {
            logger_1.default.error({ err: err.stack ?? err.message }, 'Unhandled error in processPREvent');
        });
        return;
    }
    (0, processWebhook_1.processWebhook)(req.body).catch((err) => {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Unhandled error in processWebhook');
    });
});
module.exports = router;
//# sourceMappingURL=webhook.js.map