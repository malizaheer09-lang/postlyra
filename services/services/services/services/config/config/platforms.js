// config/platforms.js
//
// One entry per platform Postlyra supports. Each platform lists every
// format it actually supports (a business posting on Instagram might want
// a square feed post AND a Story, for example) instead of one fixed size.
// Dimensions are pulled from each platform's official current guidance.
// One format per platform is marked `default: true` — that's what's
// pre-checked in the upload form so the experience doesn't get
// overwhelming, but every format is selectable.

const PLATFORMS = [
  {
    id: 'instagram',
    label: 'Instagram',
    tone: 'Warm and visual, light emoji use is welcome, 3-5 relevant hashtags.',
    formats: [
      { id: 'square', label: 'Square Post', width: 1080, height: 1080, ratio: '1:1', default: true },
      { id: 'portrait', label: 'Portrait Post', width: 1080, height: 1350, ratio: '4:5' },
      { id: 'landscape', label: 'Landscape Post', width: 1080, height: 566, ratio: '1.91:1' },
      { id: 'story', label: 'Story / Reel', width: 1080, height: 1920, ratio: '9:16' },
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    tone: 'Punchy and trend-aware, hook in the first line, casual and emoji-heavy, 3-5 hashtags.',
    formats: [
      { id: 'primary', label: 'Video (Primary)', width: 1080, height: 1920, ratio: '9:16', default: true },
      { id: 'square', label: 'Video (Square)', width: 1080, height: 1080, ratio: '1:1' },
      { id: 'landscape', label: 'Video (Landscape)', width: 1920, height: 1080, ratio: '16:9' },
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    tone: 'Descriptive, can run a bit longer, include a soft call-to-action, 3-5 hashtags.',
    formats: [
      { id: 'thumbnail', label: 'Thumbnail', width: 1280, height: 720, ratio: '16:9', default: true },
      { id: 'shorts', label: 'Shorts', width: 1080, height: 1920, ratio: '9:16' },
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    tone: 'Warm, conversational, a little longer is fine, light emoji.',
    formats: [
      { id: 'landscape', label: 'Feed Photo (Landscape)', width: 1200, height: 630, ratio: '1.91:1', default: true },
      { id: 'square', label: 'Feed Photo (Square)', width: 1080, height: 1080, ratio: '1:1' },
      { id: 'story', label: 'Story / Reel', width: 1080, height: 1920, ratio: '9:16' },
    ],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    tone: 'Professional, value- or insight-oriented, minimal or no emoji, 3-5 professional hashtags.',
    formats: [
      { id: 'landscape', label: 'Post Image (Landscape)', width: 1200, height: 627, ratio: '1.91:1', default: true },
      { id: 'square', label: 'Post Image (Square)', width: 1080, height: 1080, ratio: '1:1' },
      { id: 'portrait', label: 'Post Image (Portrait)', width: 1080, height: 1350, ratio: '4:5' },
    ],
  },
  {
    id: 'x',
    label: 'X',
    tone: 'Short and punchy, under 200 characters, 1-3 hashtags at most.',
    formats: [
      { id: 'infeed', label: 'In-feed Image', width: 1600, height: 900, ratio: '16:9', default: true },
    ],
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    tone: 'Descriptive and keyword-rich (this is searched, not just scrolled), 3-5 hashtags.',
    formats: [
      { id: 'standard', label: 'Standard Pin', width: 1000, height: 1500, ratio: '2:3', default: true },
      { id: 'square', label: 'Square Pin', width: 1000, height: 1000, ratio: '1:1' },
      { id: 'long', label: 'Long Pin (Infographic)', width: 1000, height: 2100, ratio: '1:2.1' },
    ],
  },
  {
    id: 'threads',
    label: 'Threads',
    tone: 'Casual and conversational, similar to X but a bit more relaxed in length.',
    formats: [
      { id: 'square', label: 'Post Image', width: 1080, height: 1080, ratio: '1:1', default: true },
    ],
  },
  {
    id: 'snapchat',
    label: 'Snapchat',
    tone: 'Very casual, fun, minimal text — this audience skims fast.',
    formats: [
      { id: 'story', label: 'Snap / Story', width: 1080, height: 1920, ratio: '9:16', default: true },
    ],
  },
  {
    id: 'google_business',
    label: 'Google Business',
    tone: 'Factual and local-business in tone — mention what\'s offered if visible. No hashtags; Google Business posts don\'t use them.',
    formats: [
      { id: 'standard', label: 'Post Photo', width: 1200, height: 900, ratio: '4:3', default: true },
    ],
  },
];

const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));

function getPlatform(id) {
  return PLATFORM_BY_ID[id] || null;
}

function getFormat(platformId, formatId) {
  const platform = getPlatform(platformId);
  if (!platform) return null;
  return platform.formats.find((f) => f.id === formatId) || null;
}

// The format pre-checked in the upload form for each platform.
function getDefaultVariants() {
  return PLATFORMS.map((p) => ({
    platformId: p.id,
    formatId: (p.formats.find((f) => f.default) || p.formats[0]).id,
  }));
}

// Validates and normalizes a list of { platformId, formatId } pairs from
// the client, dropping anything that doesn't match a real platform/format.
// Falls back to getDefaultVariants() if the list is empty/invalid.
function resolveVariants(requested) {
  if (!Array.isArray(requested) || requested.length === 0) {
    return getDefaultVariants();
  }
  const resolved = requested
    .map((v) => ({ platformId: v.platformId, formatId: v.formatId, format: getFormat(v.platformId, v.formatId) }))
    .filter((v) => v.format)
    .map((v) => ({ platformId: v.platformId, formatId: v.formatId }));
  return resolved.length > 0 ? resolved : getDefaultVariants();
}

module.exports = { PLATFORMS, getPlatform, getFormat, getDefaultVariants, resolveVariants };
