import { app } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { cloudinaryConfigured } from './lib/cloudinary.js';
import { migrateLegacyProductImages } from './services/product-media.js';
import { startNotificationWorker } from './services/notifications.js';

const stopNotificationWorker = startNotificationWorker();

const server = app.listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`);
  if (config.CLOUDINARY_AUTO_MIGRATE && cloudinaryConfigured()) {
    migrateLegacyProductImages(prisma).then(result => {
      if (result.migrated || result.failed) console.log('Cloudinary product image migration:', result);
    }).catch(error => console.error('Cloudinary automatic image migration failed:', error));
  }
});
async function shutdown(signal) { console.log(`${signal}: shutting down`); stopNotificationWorker(); server.close(async () => { await prisma.$disconnect(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); }
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', error => { console.error(error); shutdown('unhandledRejection'); });
