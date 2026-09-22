// routes/uploads.js

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const authenticate = require('../middleware/authenticate');
const { generatePlatformVersions, prepareVisionCopy } = require('../services/imageProcessor');
const { generateCaptions } = require('../services/captionGenerator');
const { createUpload, listUploadsByUser, findUploadById, deleteUpload } = require('../uploadsDb');
const { PLATFORMS, getFormat, resolveVariants } = require('../config/platforms');

const router = express.Router();

const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Store the original to a temp location first; we move/rename it once we
// know the upload's id.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tmpDir = path.join(UPLOADS_ROOT, '_tmp');
      fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${crypto.randomUUID()}-${file.originalname}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, or WEBP images are supported.'));
    }
    cb(null, true);
  },
});

// All routes here require a signed-in user.
router.use(authenticate);

// GET /api/uploads/platforms — platforms + their available formats (for the upload form)
router.get('/platforms', (req, res) => {
  res.json({
    platforms: PLATFORMS.map(({ id, label, formats }) => ({
      id,
      label,
      formats: formats.map(({ id: formatId, label: formatLabel, width, height, ratio, default: isDefault }) => ({
        id: formatId,
        label: formatLabel,
        width,
        height,
        ratio,
        default: !!isDefault,
      })),
    })),
  });
});

// GET /api/uploads — this user's upload history
router.get('/', (req, res) => {
  const uploads = listUploadsByUser(req.user.id);
  res.json({ uploads });
});

// POST /api/uploads — upload a photo, generate selected size variants + captions
router.post('/', upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No photo was uploaded.' });
  }

  const tempPath = req.file.path;

  try {
    const uploadId = crypto.randomUUID();
    const outputDir = path.join(UPLOADS_ROOT, req.user.id, uploadId);
    fs.mkdirSync(outputDir, { recursive: true });

    // Keep the original alongside the generated crops.
    const originalExt = path.extname(req.file.originalname) || '.jpg';
    const originalFilename = `original${originalExt}`;
    fs.renameSync(tempPath, path.join(outputDir, originalFilename));
    const originalPath = path.join(outputDir, originalFilename);

    let requestedVariants;
    try {
      requestedVariants = req.body.variants ? JSON.parse(req.body.variants) : undefined;
    } catch {
      requestedVariants = undefined; // fall back to defaults if parsing fails
    }
    const variants = resolveVariants(requestedVariants);
    const distinctPlatformIds = [...new Set(variants.map((v) => v.platformId))];

    const [platformVersions, visionImage] = await Promise.all([
      generatePlatformVersions(originalPath, outputDir, variants),
      prepareVisionCopy(originalPath),
    ]);

    const captions = await generateCaptions(visionImage, distinctPlatformIds);

    const record = createUpload({
      id: uploadId,
      userId: req.user.id,
      originalFilename: req.file.originalname,
      platformVersions,
      captions,
    });

    return res.status(201).json({ upload: record });
  } catch (err) {
    // Clean up the temp file if something failed before it was moved.
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    console.error('Upload processing failed:', err);
    return res.status(500).json({ error: 'Something went wrong processing that photo. Please try again.' });
  }
});

// GET /api/uploads/:uploadId/file/:platformId/:formatId — fetch one rendered image
router.get('/:uploadId/file/:platformId/:formatId', (req, res) => {
  const { uploadId, platformId, formatId } = req.params;

  const record = findUploadById(uploadId);
  if (!record || record.userId !== req.user.id) {
    return res.status(404).json({ error: 'Upload not found.' });
  }

  const format = getFormat(platformId, formatId);
  const version = record.platformVersions.find((v) => v.platformId === platformId && v.formatId === formatId);
  if (!format || !version) {
    return res.status(404).json({ error: 'That platform/format version was not found.' });
  }

  const filePath = path.join(UPLOADS_ROOT, req.user.id, uploadId, version.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Image file is missing on disk.' });
  }

  res.sendFile(filePath);
});

// DELETE /api/uploads/:uploadId — remove a past upload (files + record)
router.delete('/:uploadId', (req, res) => {
  const { uploadId } = req.params;

  const record = findUploadById(uploadId);
  if (!record || record.userId !== req.user.id) {
    return res.status(404).json({ error: 'Upload not found.' });
  }

  const dir = path.join(UPLOADS_ROOT, req.user.id, uploadId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  deleteUpload(uploadId, req.user.id);

  return res.json({ ok: true });
});

module.exports = router;
