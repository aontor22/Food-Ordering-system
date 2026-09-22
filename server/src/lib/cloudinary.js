import crypto from 'node:crypto';
import { config } from '../config.js';
import { AppError } from './errors.js';

const folder = String(config.CLOUDINARY_FOLDER || 'tomato/products').replace(/^\/+|\/+$/g, '');

export function cloudinaryConfigured() {
  return Boolean(config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET);
}

export function cloudinaryFolder() {
  return folder;
}

function assertConfigured() {
  if (!cloudinaryConfigured()) {
    throw new AppError(503, 'CLOUDINARY_NOT_CONFIGURED', 'Cloudinary is not configured on the server');
  }
}

function signatureFor(params) {
  assertConfigured();
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`)
    .join('&');
  return crypto.createHash('sha1').update(`${serialized}${config.CLOUDINARY_API_SECRET}`).digest('hex');
}

export function createCloudinaryUploadSignature() {
  assertConfigured();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, timestamp };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.CLOUDINARY_CLOUD_NAME)}/image/upload`,
    apiKey: config.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature: signatureFor(params),
    maxBytes: 8 * 1024 * 1024,
  };
}

export function ownsCloudinaryPublicId(publicId) {
  return typeof publicId === 'string' && publicId.startsWith(`${folder}/`) && !publicId.includes('..');
}

export function optimizeCloudinaryUrl(url) {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com') || !url.includes('/image/upload/')) return url;
  if (url.includes('/image/upload/f_auto,')) return url;
  return url.replace('/image/upload/', '/image/upload/f_auto,q_auto,c_limit,w_1200/');
}

async function cloudinaryPost(path, fields) {
  assertConfigured();
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = { ...fields, timestamp };
  const form = new FormData();
  for (const [key, value] of Object.entries(signed)) form.append(key, String(value));
  form.append('api_key', config.CLOUDINARY_API_KEY);
  form.append('signature', signatureFor(signed));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.CLOUDINARY_CLOUD_NAME)}/image/${path}`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(502, 'CLOUDINARY_ERROR', payload.error?.message || 'Cloudinary request failed');
  return payload;
}

export async function destroyCloudinaryImage(publicId) {
  if (!publicId) return { result: 'not_found' };
  if (!ownsCloudinaryPublicId(publicId)) throw new AppError(400, 'INVALID_CLOUDINARY_ASSET', 'The image is outside the configured product image folder');
  return cloudinaryPost('destroy', { invalidate: true, public_id: publicId });
}

export async function uploadImageSource(source) {
  assertConfigured();
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = { folder, timestamp };
  const form = new FormData();
  if (source instanceof Blob) form.append('file', source, 'product-image');
  else form.append('file', source);
  form.append('api_key', config.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signatureFor(signed));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.CLOUDINARY_CLOUD_NAME)}/image/upload`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(502, 'CLOUDINARY_UPLOAD_FAILED', payload.error?.message || 'Cloudinary upload failed');
  return {
    imageUrl: optimizeCloudinaryUrl(payload.secure_url),
    imagePublicId: payload.public_id,
    bytes: payload.bytes,
    width: payload.width,
    height: payload.height,
    format: payload.format,
  };
}
