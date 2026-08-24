import crypto from 'node:crypto';

const LEADER_PIN_HASH = 'fde9feeae574266f4794acd86c471922e8582955ce78c4e05b27d54743603b77';

export function verifyLeaderPin(value) {
  const pin = String(value || '').trim();
  if (!/^\d{4}$/.test(pin)) return false;
  const supplied = crypto.createHash('sha256').update(pin).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(LEADER_PIN_HASH));
}
