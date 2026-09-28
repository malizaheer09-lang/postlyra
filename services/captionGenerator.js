// services/captionGenerator.js
//
// Sends the uploaded photo to Google's Gemini API (vision) once, and asks
// for TWO caption + hashtag options per platform in a single call — cheaper
// and faster than separate calls, and lets the model keep the options
// thematically consistent with each other. The business owner picks
// whichever option they like, or edits it (or writes their own from
// scratch) before copying it — see public/upload.html.
//
// Runs on Gemini's free tier (Google AI Studio) — no billing required to
// start. Two things worth knowing about that free tier:
//   1. Rate limits are tight and Google has cut them more than once in
//      2026, so heavy real-world usage may need a paid tier eventually.
//   2. Google's free-tier terms exclude commercial use and may use your
//      inputs to improve their models — read https://ai.google.dev/gemini-api/terms
//      before relying on this for paying customers.
//
// If GEMINI_API_KEY isn't set, this returns clearly-labeled placeholder
// options instead of failing the whole upload — the resize pipeline still
// works on its own, and real captions appear automatically the moment a
// key is added to .env. No code changes needed to upgrade.

const { GoogleGenAI } = require('@google/genai');
const { getPlatform } = require('../config/platforms');

const MODEL = 'gemini-2.5-flash';
const OPTIONS_PER_PLATFORM = 2;

function resolvePlatforms(platformIds) {
  return platformIds.map((id) => getPlatform(id)).filter(Boolean);
}

function buildPrompt(platforms) {
  const platformList = platforms.map(
    (p) => `- "${p.id}" (${p.label}): ${p.tone}`
  ).join('\n');

  return `You are writing social media captions for a small business's photo.

Write ${OPTIONS_PER_PLATFORM} DIFFERENT caption + hashtag options for EACH of these platforms, matching the tone described for each. The two options should take genuinely different angles (e.g. one direct/descriptive, one more playful or story-driven) — not just reworded versions of the same sentence.
${platformList}

Rules:
- Base every caption on what's actually visible in the photo — be specific, not generic.
- Hashtags should be relevant to the photo's actual content, not filler.
- Google Business gets an empty hashtags array for both options — that platform doesn't use them.
- Respond with ONLY a JSON object matching this shape exactly:
{
  "platform_id": {
    "options": [
      { "caption": "string", "hashtags": ["#tag1", "#tag2"] },
      { "caption": "string", "hashtags": ["#tag1", "#tag2"] }
    ]
  },
  ...
}`;
}

function extractJson(text) {
  // Defensive fallback in case the model wraps JSON in markdown fences
  // despite responseMimeType being set to application/json.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonText = fenceMatch ? fenceMatch[1] : text;
  return JSON.parse(jsonText.trim());
}

function placeholderOptions(platform, reason) {
  return {
    options: Array.from({ length: OPTIONS_PER_PLATFORM }, (_, i) => ({
      caption: `[Add GEMINI_API_KEY in .env to generate a real ${platform.label} caption — option ${i + 1}] ${reason || ''}`.trim(),
      hashtags: [],
    })),
  };
}

function placeholderCaptions(platforms, reason) {
  const captions = {};
  for (const platform of platforms) {
    captions[platform.id] = placeholderOptions(platform, reason);
  }
  return captions;
}

// Gemini's free tier is occasionally slow or briefly rate-limited. Rather
// than let a hung request drag the whole upload down with it, give it a
// generous window and fall back to a placeholder if it doesn't answer in
// time — the photo and its resized versions still come back successfully
// either way.
const AI_TIMEOUT_MS = 25_000;

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`AI request timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// Gemini's free tier gets slower and flakier the bigger a single request
// is. Asking for captions for every selected platform in one giant call
// scales badly — the more platforms picked, the slower and more
// failure-prone that one call gets. Splitting into smaller batches run in
// parallel keeps each individual call fast and simple regardless of how
// many platforms the user selects overall.
const PLATFORMS_PER_BATCH = 3;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function generateCaptionsForBatch(ai, base64Image, platforms) {
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPrompt(platforms) },
              { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
        },
      }),
      AI_TIMEOUT_MS
    );

    const parsed = extractJson(response.text);

    for (const platform of platforms) {
      const entry = parsed[platform.id];
      if (!entry || !Array.isArray(entry.options) || entry.options.length === 0) {
        parsed[platform.id] = placeholderOptions(platform, 'The AI response was missing this platform.');
      }
    }
    return parsed;
  } catch (err) {
    console.error('Caption generation failed for a batch:', err.message);
    return placeholderCaptions(platforms, `AI caption generation failed: ${err.message}`);
  }
}

/**
 * @param {string} base64Image - base64-encoded JPEG (see imageProcessor.prepareVisionCopy)
 * @param {string[]} platformIds - distinct platform ids to generate captions for
 * @returns {Promise<Record<string, { options: Array<{ caption: string, hashtags: string[] }> }>>}
 */
async function generateCaptions(base64Image, platformIds) {
  const platforms = resolvePlatforms(platformIds);
  if (platforms.length === 0) return {};

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.includes('replace_this')) {
    return placeholderCaptions(platforms, 'No API key configured yet.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const batches = chunk(platforms, PLATFORMS_PER_BATCH);

  // Each batch is independent, so a slow/failed batch can never block or
  // break the others — every platform still gets *something* back.
  const batchResults = await Promise.all(
    batches.map((batchPlatforms) => generateCaptionsForBatch(ai, base64Image, batchPlatforms))
  );

  return Object.assign({}, ...batchResults);
}

module.exports = { generateCaptions };
