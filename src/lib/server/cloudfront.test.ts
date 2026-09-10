import { afterEach, describe, expect, test, vi } from 'vitest';

// Mock the cloudfront-signer module
const mockGetSignedCookies = vi.fn();
vi.mock('@aws-sdk/cloudfront-signer', () => ({
  getSignedCookies: mockGetSignedCookies,
}));

// Mock $env/dynamic/private
vi.mock('$env/dynamic/private', () => ({
  env: {
    APP_URL: 'https://app.example.com',
    CLOUDFRONT_KEY_PAIR_ID: 'K2EXAMPLE',
    CLOUDFRONT_PRIVATE_KEY:
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
  },
}));

describe('getCloudFrontSignedCookies', () => {
  afterEach(() => {
    // `restoreAllMocks` only restores `vi.spyOn` spies in Vitest 4; it no longer clears
    // `vi.fn()` call history. Reset instead, so each test reads its own `mock.calls[0]`.
    vi.resetAllMocks();
  });

  test('returns signed cookies built from a custom policy', async () => {
    mockGetSignedCookies.mockReturnValue({
      'CloudFront-Policy': 'test-policy',
      'CloudFront-Signature': 'test-signature',
      'CloudFront-Key-Pair-Id': 'K2EXAMPLE',
    });

    const { getCloudFrontSignedCookies } = await import('./cloudfront.js');
    const cookies = getCloudFrontSignedCookies(3600);

    expect(mockGetSignedCookies).toHaveBeenCalledWith({
      policy: expect.any(String),
      keyPairId: 'K2EXAMPLE',
      privateKey:
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
    });

    const callArgs = mockGetSignedCookies.mock.calls[0][0];
    const parsedPolicy = JSON.parse(callArgs.policy);
    expect(parsedPolicy).toMatchObject({
      Statement: [
        {
          Resource: 'https://app.example.com/*',
          Condition: {
            DateLessThan: {
              'AWS:EpochTime': expect.any(Number),
            },
          },
        },
      ],
    });

    expect(cookies).toEqual({
      'CloudFront-Policy': 'test-policy',
      'CloudFront-Signature': 'test-signature',
      'CloudFront-Key-Pair-Id': 'K2EXAMPLE',
    });
  });

  test('honors the provided TTL in the policy expiration', async () => {
    mockGetSignedCookies.mockReturnValue({
      'CloudFront-Policy': 'p',
      'CloudFront-Signature': 's',
      'CloudFront-Key-Pair-Id': 'k',
    });

    const { getCloudFrontSignedCookies } = await import('./cloudfront.js');

    const ttlSeconds = 12345;
    const beforeEpoch = Math.floor(Date.now() / 1000);
    getCloudFrontSignedCookies(ttlSeconds);
    const afterEpoch = Math.floor(Date.now() / 1000);

    const callArgs = mockGetSignedCookies.mock.calls[0][0];
    const parsedPolicy = JSON.parse(callArgs.policy);
    const expiration = parsedPolicy.Statement[0].Condition.DateLessThan['AWS:EpochTime'];

    expect(expiration).toBeGreaterThanOrEqual(beforeEpoch + ttlSeconds);
    expect(expiration).toBeLessThanOrEqual(afterEpoch + ttlSeconds);
  });
});
