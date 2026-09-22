import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudinaryConfigured, destroyCloudinaryImage, uploadImageSource } from '../lib/cloudinary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetFolder = path.resolve(here, '../../../front-end/src/assets');

function localAssetFor(imageUrl) {
  if (typeof imageUrl !== 'string') return null;
  const match = imageUrl.match(/^\/food_(\d+)\.(png|jpe?g|webp|avif)$/i);
  if (!match) return null;
  return path.join(assetFolder, `food_${match[1]}.${match[2].toLowerCase()}`);
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  return 'image/png';
}

export async function migrateLegacyProductImages(prisma, { logger = console } = {}) {
  if (!cloudinaryConfigured()) return { configured: false, migrated: 0, skipped: 0, failed: 0, failures: [] };

  const products = await prisma.product.findMany({
    where: { imagePublicId: null, imageUrl: { not: null } },
    select: { id: true, name: true, imageUrl: true },
    orderBy: { id: 'asc' },
  });
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for (const product of products) {
    let uploaded = null;
    try {
      let source;
      const localPath = localAssetFor(product.imageUrl);
      if (localPath) {
        const bytes = await readFile(localPath);
        source = new Blob([bytes], { type: mimeFor(localPath) });
      } else if (/^https?:\/\//i.test(product.imageUrl) && !product.imageUrl.includes('res.cloudinary.com')) {
        source = product.imageUrl;
      } else {
        skipped += 1;
        continue;
      }

      uploaded = await uploadImageSource(source);
      await prisma.product.update({
        where: { id: product.id },
        data: { imageUrl: uploaded.imageUrl, imagePublicId: uploaded.imagePublicId },
      });
      migrated += 1;
      logger.info?.(`Cloudinary: migrated product ${product.id} (${product.name})`);
    } catch (error) {
      if (uploaded?.imagePublicId) {
        try { await destroyCloudinaryImage(uploaded.imagePublicId); }
        catch { /* best-effort cleanup only */ }
      }
      failed += 1;
      failures.push({ productId: product.id, message: error.message });
      logger.error?.(`Cloudinary: failed product ${product.id}: ${error.message}`);
    }
  }

  return { configured: true, migrated, skipped, failed, failures };
}
