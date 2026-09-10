import { TimeUnit } from '@valkey/valkey-glide';

import { db } from '../db';
import { logger } from '../logger';
import { valkey } from '../valkey';

/**
 * The namespace used for storing base64-encoded avatar in Valkey.
 */
const AVATAR_NAMESPACE = 'avatar';
/**
 * The time-to-live (TTL) for base64-encoded avatar in Valkey.
 */
const AVATAR_TTL = 24 * 60 * 60;
/**
 * The maximum time allowed for the outbound avatar fetch, in milliseconds. The abort signal applies
 * to the whole request, so this bound covers the response body as well as the headers.
 */
const AVATAR_FETCH_TIMEOUT = 5000;
/**
 * The maximum size of an avatar response, in bytes. A larger response is rejected before the whole
 * body is held in memory.
 */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/**
 * The domains that an avatar URL is allowed to point at. Google serves the `picture` claim of a
 * verified ID token from `googleusercontent.com`, and that claim is the only writer of
 * `User.avatarURL` today. The allowlist is defence in depth: it keeps this fetch away from internal
 * addresses if `avatarURL` ever becomes user-settable.
 */
const AVATAR_ALLOWED_DOMAINS = ['googleusercontent.com'];

/**
 * Reports whether an avatar URL is safe to fetch. The URL must use HTTPS, and its host must be an
 * allowed domain or a subdomain of one.
 *
 * @param avatarURL - The avatar URL stored on the user.
 * @returns `true` if the URL may be fetched.
 */
function isFetchableAvatarURL(avatarURL: string): boolean {
  let url: URL;
  try {
    url = new URL(avatarURL);
  } catch {
    // A stored value that does not parse is not fetchable. The caller logs the rejection, so this
    // branch stays silent instead of logging the same rejection twice.
    return false;
  }

  if (url.protocol !== 'https:') {
    return false;
  }

  return AVATAR_ALLOWED_DOMAINS.some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  );
}

/**
 * Reads the media type of a response and reports whether it is an image. Parameters such as
 * `charset` are dropped, so the result is safe to place in a data URL.
 *
 * @param resp - The avatar response.
 * @returns The media type without its parameters, or `null` if the header is absent or not an
 *   image.
 */
function readImageMediaType(resp: Response): string | null {
  const contentType = resp.headers.get('content-type');
  if (contentType === null) {
    return null;
  }

  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if (!mediaType.startsWith('image/') || mediaType === 'image/') {
    return null;
  }

  return mediaType;
}

/**
 * Reads a response body into memory, up to a maximum size. The read stops as soon as the maximum is
 * exceeded, so an oversized body never reaches memory in full.
 *
 * @param resp - The avatar response.
 * @param maxBytes - The maximum number of bytes to accept.
 * @returns The body, or `null` if the body is absent or larger than the maximum.
 */
async function readCappedBody(resp: Response, maxBytes: number): Promise<Buffer | null> {
  const declaredSize = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    await resp.body?.cancel();
    return null;
  }

  if (resp.body === null) {
    return null;
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

/**
 * Retrieves a base64-encoded avatar from Valkey. If the avatar is not found, it will be fetched
 * from the user's avatar URL and cached in Valkey. The returned base64 string is already formatted
 * for direct use as the `src` of an `<img>` element.
 *
 * The outbound fetch is bounded. The URL must be HTTPS on an allowed domain, the request has a
 * timeout, the status must be OK, the content type must be an image, and the body must be within
 * the size cap. Any failed check returns `null`, so a page still loads without the avatar.
 *
 * @param userId - The ID of the user whose avatar should be retrieved.
 * @returns The base64-encoded avatar, or `null` if the user has no usable avatar or is not found.
 */
export async function getBase64EncodedAvatar(userId: string): Promise<string | null> {
  let avatar = await valkey.get(`${AVATAR_NAMESPACE}:${userId}`);
  if (avatar) {
    return avatar.toString();
  }

  const user = await db.user.findUnique({
    select: {
      avatarURL: true,
    },
    where: {
      id: userId,
    },
  });
  if (!user || user.avatarURL === null) {
    return null;
  }

  if (!isFetchableAvatarURL(user.avatarURL)) {
    logger.warn({ userId }, 'Avatar URL is not HTTPS on an allowed domain, skipping the fetch');
    return null;
  }

  let resp: Response;
  try {
    resp = await fetch(user.avatarURL, {
      signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT),
    });
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to fetch avatar');
    return null;
  }

  if (!resp.ok) {
    await resp.body?.cancel();
    logger.warn({ userId, status: resp.status }, 'Avatar fetch returned a non-OK status');
    return null;
  }

  const mediaType = readImageMediaType(resp);
  if (mediaType === null) {
    await resp.body?.cancel();
    logger.warn(
      { userId, contentType: resp.headers.get('content-type') },
      'Avatar fetch returned a content type that is not an image',
    );
    return null;
  }

  let body: Buffer | null;
  try {
    body = await readCappedBody(resp, AVATAR_MAX_BYTES);
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read the avatar response body');
    return null;
  }

  if (body === null) {
    logger.warn({ userId, maxBytes: AVATAR_MAX_BYTES }, 'Avatar response is empty or too large');
    return null;
  }

  avatar = `data:${mediaType};base64,${body.toString('base64')}`;
  await valkey.set(`${AVATAR_NAMESPACE}:${userId}`, avatar, {
    expiry: { type: TimeUnit.Seconds, count: AVATAR_TTL },
  });

  return avatar;
}
