import { ConfigService } from '@nestjs/config';
import { QueueCrypto, canonicalPayload } from './queue-crypto.service';

describe('queue payload security and intent', () => {
  const crypto = new QueueCrypto(new ConfigService({ app: { jwtRefreshSecret: 'unit-queue-key' } }));
  const payload = { password: 'secret-password', resetUrl: 'https://example.invalid/?token=reset-secret' };
  it('encrypts secrets, authenticates the job namespace, and uses fresh IVs', () => {
    const one = crypto.seal(payload, 'test/email/job'), two = crypto.seal(payload, 'test/email/job');
    expect(one).not.toEqual(two);
    expect(one).not.toContain(payload.password);
    expect(crypto.open(one, 'test/email/job')).toEqual(payload);
    expect(() => crypto.open(one, 'other/email/job')).toThrow();
    const corrupt = Buffer.from(one, 'base64'); corrupt[corrupt.length - 1]! ^= 1;
    expect(() => crypto.open(corrupt.toString('base64'), 'test/email/job')).toThrow();
  });
  it('treats reordered filter keys as the same business intent', () => {
    expect(canonicalPayload({ format: 'pdf', filters: { semester: '1', classId: 'x' } }))
      .toEqual(canonicalPayload({ filters: { classId: 'x', semester: '1' }, format: 'pdf' }));
    expect(canonicalPayload({ format: 'pdf' })).not.toEqual(canonicalPayload({ format: 'docx' }));
  });
});
