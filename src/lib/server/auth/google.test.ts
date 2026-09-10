import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mutable env object: google.ts reads `env.GOOGLE_HOSTED_DOMAIN` at call time,
// so mutating this between tests is enough — no need to re-import the module.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const mockVerifyIdToken = vi.fn();
const mockGenerateAuthUrl = vi.fn();
const mockGetToken = vi.fn();
vi.mock('google-auth-library', () => ({
  CodeChallengeMethod: { S256: 'S256' },
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
  })),
}));

function payloadWithHd(hd: string | undefined) {
  return {
    getPayload: () => ({ sub: 'user-id', email: 'a@b.com', name: 'Test', picture: null, hd }),
  };
}

beforeEach(() => {
  delete env.GOOGLE_HOSTED_DOMAIN;
  delete env.GOOGLE_CLIENT_ID;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('verifyIdToken hosted-domain enforcement', () => {
  test('accepts a token whose hd matches the single configured domain', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'moe.edu.sg';
    mockVerifyIdToken.mockResolvedValue(payloadWithHd('moe.edu.sg'));

    const { verifyIdToken } = await import('./google.js');
    await expect(verifyIdToken('token')).resolves.toMatchObject({ email: 'a@b.com' });
  });

  test('rejects a token whose hd does not match the single configured domain', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'moe.edu.sg';
    mockVerifyIdToken.mockResolvedValue(payloadWithHd('gmail.com'));

    const { verifyIdToken, HostedDomainMismatchError, InvalidIdTokenError } = await import(
      './google.js'
    );
    // A subclass of InvalidIdTokenError so existing catch-all handling still applies,
    // but distinguishable so the callback can show a domain-specific message.
    await expect(verifyIdToken('token')).rejects.toBeInstanceOf(HostedDomainMismatchError);
    await expect(verifyIdToken('token')).rejects.toBeInstanceOf(InvalidIdTokenError);
  });

  test('accepts a token whose hd matches any of multiple configured domains', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'moe.edu.sg,hci.edu.sg';
    mockVerifyIdToken.mockResolvedValue(payloadWithHd('hci.edu.sg'));

    const { verifyIdToken } = await import('./google.js');
    await expect(verifyIdToken('token')).resolves.toMatchObject({ email: 'a@b.com' });
  });

  test('rejects a token whose hd is in none of the multiple configured domains', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'moe.edu.sg,hci.edu.sg';
    mockVerifyIdToken.mockResolvedValue(payloadWithHd('nus.edu.sg'));

    const { verifyIdToken, HostedDomainMismatchError } = await import('./google.js');
    await expect(verifyIdToken('token')).rejects.toBeInstanceOf(HostedDomainMismatchError);
  });

  test('tolerates whitespace around comma-separated domains', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'moe.edu.sg , hci.edu.sg';
    mockVerifyIdToken.mockResolvedValue(payloadWithHd('hci.edu.sg'));

    const { verifyIdToken } = await import('./google.js');
    await expect(verifyIdToken('token')).resolves.toMatchObject({ email: 'a@b.com' });
  });

  test('matches domains case-insensitively', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'MOE.edu.sg';
    mockVerifyIdToken.mockResolvedValue(payloadWithHd('moe.edu.sg'));

    const { verifyIdToken } = await import('./google.js');
    await expect(verifyIdToken('token')).resolves.toMatchObject({ email: 'a@b.com' });
  });

  test('rejects a token with no hd claim when a domain is configured', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'moe.edu.sg';
    mockVerifyIdToken.mockResolvedValue(payloadWithHd(undefined));

    const { verifyIdToken, HostedDomainMismatchError } = await import('./google.js');
    await expect(verifyIdToken('token')).rejects.toBeInstanceOf(HostedDomainMismatchError);
  });

  test('accepts any hd when no domain is configured', async () => {
    mockVerifyIdToken.mockResolvedValue(payloadWithHd('gmail.com'));

    const { verifyIdToken } = await import('./google.js');
    await expect(verifyIdToken('token')).resolves.toMatchObject({ email: 'a@b.com' });
  });
});

describe('verifyIdToken audience binding', () => {
  /**
   * Stands in for `google-auth-library`'s own `aud` check: the real verifier
   * compares the claim against the supplied `audience` and throws on a
   * mismatch. Without an `audience` it skips the comparison, which is the
   * behaviour this binding exists to prevent.
   */
  function mockVerifierCheckingAudience(aud: string) {
    mockVerifyIdToken.mockImplementation(({ audience }: { audience?: string }) => {
      if (audience !== undefined && audience !== aud) {
        throw new Error('Wrong recipient, payload audience != requiredAudience');
      }
      return {
        getPayload: () => ({ sub: 'user-id', email: 'a@b.com', name: 'Test', picture: null, aud }),
      };
    });
  }

  test('passes the configured client id as the audience', async () => {
    env.GOOGLE_CLIENT_ID = 'this-client.apps.googleusercontent.com';
    mockVerifierCheckingAudience('this-client.apps.googleusercontent.com');

    const { verifyIdToken } = await import('./google.js');
    await verifyIdToken('token');

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'token',
      audience: 'this-client.apps.googleusercontent.com',
    });
  });

  test('rejects a token whose aud names a different client', async () => {
    env.GOOGLE_CLIENT_ID = 'this-client.apps.googleusercontent.com';
    mockVerifierCheckingAudience('other-client.apps.googleusercontent.com');

    const { verifyIdToken, InvalidIdTokenError } = await import('./google.js');
    await expect(verifyIdToken('token')).rejects.toBeInstanceOf(InvalidIdTokenError);
  });

  test('accepts a token whose aud names this client', async () => {
    env.GOOGLE_CLIENT_ID = 'this-client.apps.googleusercontent.com';
    mockVerifierCheckingAudience('this-client.apps.googleusercontent.com');

    const { verifyIdToken } = await import('./google.js');
    await expect(verifyIdToken('token')).resolves.toMatchObject({ email: 'a@b.com' });
  });
});

describe('generateAuthURL hosted-domain hint', () => {
  function hdArg() {
    return mockGenerateAuthUrl.mock.calls[0][0].hd;
  }

  async function callGenerate() {
    const { generateAuthURL } = await import('./google.js');
    generateAuthURL({ origin: 'https://app.example.com', state: 's', codeVerifier: 'v' });
  }

  test('passes the single configured domain as the hd hint', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'moe.edu.sg';
    await callGenerate();
    expect(hdArg()).toBe('moe.edu.sg');
  });

  test('passes the wildcard hint when multiple domains are configured', async () => {
    env.GOOGLE_HOSTED_DOMAIN = 'moe.edu.sg,hci.edu.sg';
    await callGenerate();
    expect(hdArg()).toBe('*');
  });

  test('passes no hd hint when no domain is configured', async () => {
    await callGenerate();
    expect(hdArg()).toBeUndefined();
  });
});
