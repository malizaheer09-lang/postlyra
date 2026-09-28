// services/imageProcessor.js
//
// Takes one uploaded photo and produces a correctly-sized version for every
// selected platform+format variant (e.g. "instagram:square",
// "instagram:story"). Uses sharp's "attention" strategy for the background
// fill, which detects the most visually interesting region of the photo
// (faces, edges, high-contrast areas) — and never crops the actual photo
// itself, so nothing in it is ever cut off.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getFormat } = require('../config/platforms');

const JPEG_QUALITY = 88;

function variantFilename(platformId, formatId) {
  return `${platformId}__${formatId}.jpg`;
}

/**
 * @param {string} originalPath - absolute path to the uploaded original file
 * @param {string} outputDir - absolute path to the directory to write results into
 * @param {Array<{platformId: string, formatId: string}>} variants - which exact sizes to generate
 * @returns {Promise<Array<{ platformId, formatId, filename, width, height, label, ratio }>>}
 */
async function generatePlatformVersions(originalPath, outputDir, variants) {
  fs.mkdirSync(outputDir, { recursive: true });

  const results = [];

  for (const { platformId, formatId } of variants) {
    const format = getFormat(platformId, formatId);
    if (!format) continue; // already validated upstream, but stay defensive

    const filename = variantFilename(platformId, formatId);
    const outputPath = path.join(outputDir, filename);

    // Foreground: the full original photo, scaled down to fit entirely
    // inside the target frame — nothing is ever cropped or cut off.
    const foreground = await sharp(originalPath)
      .rotate()
      .resize(format.width, format.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    // Background: a blurred, slightly darkened, full-bleed version of the
    // same photo, filling any leftover space behind the foreground so
    // there are no empty bars — same technique Instagram Stories uses for
    // photos that don't match the frame's aspect ratio.
    const background = await sharp(originalPath)
      .rotate()
      .resize(format.width, format.height, {
        fit: 'cover',
        position: sharp.strategy.attention,
      })
      .blur(36)
      .modulate({ brightness: 0.82 })
      .toBuffer();

    await sharp(background)
      .composite([{ input: foreground, gravity: 'centre' }])
      .jpeg({ quality: JPEG_QUALITY })
      .toFile(outputPath);

    results.push({
      platformId,
      formatId,
      filename,
      width: format.width,
      height: format.height,
      label: format.label,
      ratio: format.ratio,
    });
  }

  return results;
}

/**
 * Produces a small JPEG copy suitable for sending to a vision model —
 * keeps the longest edge under ~1568px, which is enough detail for caption
 * writing while keeping token cost (and upload time) down.
 */
async function prepareVisionCopy(originalPath) {
  const buffer = await sharp(originalPath)
    .rotate()
    .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return buffer.toString('base64');
}

module.exports = { generatePlatformVersions, prepareVisionCopy, variantFilename };
