import { app } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { cloudinaryConfigured } from './lib/cloudinary.js';
import { migrateLegacyProductImages } from './services/product-media.js';
import { startNotificationWorker } from './services/notifications.js';
import { captureOperationalError, startObservabilityMaintenance, structuredLog } from './services/observability.js';

const stopNotificationWorker = startNotificationWorker();
const stopObservabilityMaintenance = startObservabilityMaintenance();

const server = app.listen(config.PORT, () => {
  structuredLog('INFO', 'API listening', { source: 'PROCESS', code: 'SERVER_STARTED', port: config.PORT, environment: config.NODE_ENV });
  if (config.CLOUDINARY_AUTO_MIGRATE && cloudinaryConfigured()) {
    migrateLegacyProductImages(prisma).then(result => {
      if (result.migrated || result.failed) structuredLog('INFO', 'Cloudinary product image migration completed', { source: 'CLOUDINARY', code: 'IMAGE_MIGRATION_COMPLETED', ...result });
    }).catch(error => { void captureOperationalError(error, { source: 'CLOUDINARY', code: 'IMAGE_MIGRATION_FAILED', message: 'Cloudinary automatic image migration failed' }); });
  }
});
async function shutdown(signal) { structuredLog('INFO', 'Server shutting down', { source: 'PROCESS', code: 'SERVER_SHUTDOWN', signal }); stopNotificationWorker(); stopObservabilityMaintenance(); server.close(async () => { await prisma.$disconnect(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); }
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', error => { void captureOperationalError(error, { level: 'FATAL', source: 'PROCESS', code: 'UNHANDLED_REJECTION', message: 'Unhandled promise rejection' }); shutdown('unhandledRejection'); });
process.on('uncaughtException', error => { void captureOperationalError(error, { level: 'FATAL', source: 'PROCESS', code: 'UNCAUGHT_EXCEPTION', message: 'Uncaught process exception' }); shutdown('uncaughtException'); });
