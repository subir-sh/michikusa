import type sharpFactory from 'sharp';

// sharp 0.35 exposes different type/runtime interop shapes for CJS.
// Keep the runtime require callable on Windows while preserving the package's factory type.
export const sharp = require('sharp') as typeof sharpFactory;
