import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import logger from './logger';
import { processWebhook } from './webhook/processWebhook';
import { processPREvent } from './webhook/processPREvent';
import { processCodeRabbitEvent } from './webhook/processCodeRabbitEvent';

const router = express.Router();

const limiter = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests — slow down' },
});

function verifySignature(req: any, res: any, next: any): void {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    logger.warn({ ip: req.ip }, 'Webhook received without x-hub-signature-256 header');
    res.status(401).json({ error: 'Missing signature header' });
    return;
  }

  const body     = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env['GITHUB_WEBHOOK_SECRET'] || '')
    .update(body)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  const validLength = sigBuf.length === expBuf.length;
  const validHmac   = validLength && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!validHmac) {
    logger.warn({ ip: req.ip }, 'Webhook signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

// CodeRabbit's actual signature header/scheme is unverified (see
// processCodeRabbitEvent.ts header comment) — this assumes the same
// "sha256=<hmac>" convention GitHub uses, under a plausible header name.
// Re-check against CodeRabbit's real webhook-delivery docs/dashboard before
// relying on this in production; update the header name and/or algorithm
// here if it turns out different, nothing else needs to change.
function verifyCodeRabbitSignature(req: any, res: any, next: any): void {
  const signature = req.headers['x-coderabbit-signature-256'];
  const secret    = process.env['CODERABBIT_WEBHOOK_SECRET'];

  if (!secret) {
    logger.error('CODERABBIT_WEBHOOK_SECRET not set — rejecting CodeRabbit webhook');
    res.status(401).json({ error: 'Webhook not configured' });
    return;
  }
  if (!signature) {
    logger.warn({ ip: req.ip }, 'CodeRabbit webhook received without signature header');
    res.status(401).json({ error: 'Missing signature header' });
    return;
  }

  const body     = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  const validHmac = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!validHmac) {
    logger.warn({ ip: req.ip }, 'CodeRabbit webhook signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

router.post('/github', limiter, verifySignature, (req: any, res: any) => {
  res.status(200).json({ received: true });

  const event = req.headers['x-github-event'] || 'push';

  if (event === 'pull_request') {
    processPREvent(req.body).catch((err: any) => {
      logger.error({ err: err.stack ?? err.message }, 'Unhandled error in processPREvent');
    });
    return;
  }

  processWebhook(req.body).catch((err: any) => {
    logger.error({ err: err.stack ?? err.message }, 'Unhandled error in processWebhook');
  });
});

router.post('/coderabbit', limiter, verifyCodeRabbitSignature, (req: any, res: any) => {
  res.status(200).json({ received: true });

  processCodeRabbitEvent(req.body).catch((err: any) => {
    logger.error({ err: err.stack ?? err.message }, 'Unhandled error in processCodeRabbitEvent');
  });
});

export = router;
