/**
 * Safe upload defaults shared by the browser and server.
 *
 * These values are not credentials. Keeping them in code means a deployment
 * can use direct Storage uploads without requiring extra feature-flag env vars.
 * The environment variables remain as emergency overrides for rollback.
 */
export const UPLOAD_DEFAULTS = {
  directStorageUploads: true,
  storageBucket: "notebook-uploads",
  signedUrlTtlSeconds: 900,
  directUploadThresholdBytes: 4 * 1024 * 1024,
} as const;
