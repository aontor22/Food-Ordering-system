import { app } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';

const server = app.listen(config.PORT, () => console.log(`API listening on http://localhost:${config.PORT}`));
async function shutdown(signal) { console.log(`${signal}: shutting down`); server.close(async () => { await prisma.$disconnect(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); }
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', error => { console.error(error); shutdown('unhandledRejection'); });
