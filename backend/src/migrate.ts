import 'dotenv/config';
import logger from './logger';
import dbClient from './dbClient';

async function main(): Promise<void> {
  await dbClient.initSchema();
  logger.info('Migration run complete');
}

main().catch((err: any) => {
  logger.error({ err: err.stack ?? err.message }, 'Migration run failed');
  process.exitCode = 1;
});
