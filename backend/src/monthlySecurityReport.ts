import logger from './logger';

async function generateMonthlySecurityReport(): Promise<void> {
  logger.info('Monthly security report generation triggered');
  // TODO: implement monthly security report logic
}

export = { generateMonthlySecurityReport };
