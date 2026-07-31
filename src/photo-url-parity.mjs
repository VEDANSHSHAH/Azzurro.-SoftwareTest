export const CANONICAL_REVIEW_PHOTO_HOSTNAME =
  "booking-photo-cdn.invalid";

const BOOKING_PHOTO_CDN_ROOT = "bstatic.com";
const BOOKING_PHOTO_CDN_SUFFIX = `.${BOOKING_PHOTO_CDN_ROOT}`;
const FORBIDDEN_RAW_URL_CHARACTERS = /[\u0000-\u0020\u007f]/;

export class PhotoUrlParityError extends Error {
  constructor(message) {
    super(message);
    this.name = "PhotoUrlParityError";
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isApprovedBookingPhotoHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === BOOKING_PHOTO_CDN_ROOT ||
    normalized.endsWith(BOOKING_PHOTO_CDN_SUFFIX)
  );
}

function rawAuthorityBounds(value) {
  const schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) {
    throw new PhotoUrlParityError(
      "review photo URL must be an absolute HTTPS URL",
    );
  }
  const start = schemeEnd + 3;
  const suffixStart = value.slice(start).search(/[/?#]/);
  return {
    start,
    end: suffixStart < 0 ? value.length : start + suffixStart,
  };
}

/**
 * Produces a stable photo asset URL while preserving every byte except the
 * Booking CDN hostname. Live parity diagnostics proved that the CDN hostname
 * rotates while protocol, port, path, query and fragment remain stable.
 */
export function canonicalizeReviewPhotoUrl(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    FORBIDDEN_RAW_URL_CHARACTERS.test(value)
  ) {
    throw new PhotoUrlParityError(
      "review photo URL must be a non-empty URL without raw whitespace",
    );
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new PhotoUrlParityError(
      "review photo URL must be an absolute HTTPS URL",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new PhotoUrlParityError(
      "review photo URL must use HTTPS",
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new PhotoUrlParityError(
      "review photo URL must not contain credentials",
    );
  }
  if (!isApprovedBookingPhotoHostname(parsed.hostname)) {
    throw new PhotoUrlParityError(
      "review photo URL must use an approved Booking CDN hostname",
    );
  }

  const { start, end } = rawAuthorityBounds(value);
  const authority = value.slice(start, end);
  const authorityMatch = /^([^:]+)(:\d+)?$/.exec(authority);
  if (
    authorityMatch == null ||
    authorityMatch[1].toLowerCase() !== parsed.hostname.toLowerCase()
  ) {
    throw new PhotoUrlParityError(
      "review photo URL has an unsupported authority",
    );
  }

  const port = authorityMatch[2] ?? "";
  return (
    value.slice(0, start) +
    CANONICAL_REVIEW_PHOTO_HOSTNAME +
    port +
    value.slice(end)
  );
}

export function canonicalizeReviewPhotosForParity(photos) {
  if (!Array.isArray(photos)) {
    throw new PhotoUrlParityError(
      "review photos must be an array",
    );
  }
  return photos.map((photo, photoIndex) => {
    if (!isObject(photo) || !Array.isArray(photo.urls)) {
      throw new PhotoUrlParityError(
        `review photo at index ${photoIndex} is malformed`,
      );
    }
    return {
      ...photo,
      urls: photo.urls.map((url, urlIndex) => {
        if (!isObject(url)) {
          throw new PhotoUrlParityError(
            `review photo URL at index ${photoIndex}.${urlIndex} is malformed`,
          );
        }
        return {
          ...url,
          url: canonicalizeReviewPhotoUrl(url.url),
        };
      }),
    };
  });
}

export function canonicalizeReviewSourceCardForParity(sourceCard) {
  if (!isObject(sourceCard)) {
    throw new PhotoUrlParityError(
      "review source card must be an object",
    );
  }
  if (sourceCard.photos == null) {
    return { ...sourceCard };
  }
  return {
    ...sourceCard,
    photos: canonicalizeReviewPhotosForParity(sourceCard.photos),
  };
}
