import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode,
  createRecoveryCodes,
  maskEmail,
  maskIp,
  recoveryCodeHash,
  totpAt,
  verifyTotp,
} from '../src/services/auth-security-core.js';

test('TOTP implementation matches the RFC 6238 SHA-1 test vector', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  const result = totpAt(secret, 59_000, { digits: 8, period: 30 });
  assert.equal(result.code, '94287082');
  assert.equal(verifyTotp(secret, '94287082', { now: 59_000, digits: 8, period: 30 })?.step, result.step);
  assert.equal(verifyTotp(secret, '00000000', { now: 59_000, digits: 8, period: 30 }), null);
});

test('recovery codes are high-entropy, unique and stored only as hashes', () => {
  const recovery = createRecoveryCodes(8);
  assert.equal(recovery.codes.length, 8);
  assert.equal(new Set(recovery.codes).size, 8);
  assert.equal(recovery.hashes.length, 8);
  for (let index = 0; index < recovery.codes.length; index += 1) {
    assert.match(recovery.codes[index], /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/);
    assert.equal(recovery.hashes[index], recoveryCodeHash(recovery.codes[index]));
    assert.notEqual(recovery.hashes[index], recovery.codes[index]);
  }
});

test('security views mask email and IP address details', () => {
  assert.equal(maskEmail('customer@example.com'), 'cu******@example.com');
  assert.equal(maskIp('203.0.113.44'), '203.0.113.xxx');
  assert.match(maskIp('2001:db8:abcd:0012::1'), /^2001:db8:abcd:/);
});
