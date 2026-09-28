// services/publisher.js
//
// Makes the actual API calls to publish content to each connected
// social platform. Each platform has its own API shape:
//
// Meta (Facebook/Instagram): Graph API v19.0
//   - Facebook: POST /me/feed + photo upload
//   - Instagram: two-step (create container -> publish)
//
// Google (YouTube Community / Google Business):
//   - YouTube Community Posts: not yet public API — stubbed
//   - Google Business: My Business API v4
//
// In DEMO MODE (no real credentials in .env), publish() returns a
// simulated success response so the whole UI flow can be tested
// without real platform connections.

const axios = require('axios');
const fs = require('fs');

const DEMO_MODE_META = !process.env.META_APP_ID || process.env.META_APP_ID === 'your_meta_app_id';
const DEMO_MODE_GOOGLE = !process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'your_google_client_id';

// ─── Facebook ────────────────────────────────────────────────────────────────

async function publishToFacebook({ accessToken, pageId, imageBuffer, caption }) {
  if (DEMO_MODE_META) {
    return { demo: true, id: `demo_fb_${Date.now()}`, url: 'https://facebook.com' };
  }
  try {
    // Upload photo to the page
    const formData = new (require('form-data'))();
    formData.append('source', imageBuffer, { filename: 'post.jpg', contentType: 'image/jpeg' });
    formData.append('caption', caption);
    formData.append('access_token', accessToken);

    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/photos`,
      formData,
      { headers: formData.getHeaders() }
    );
    return { id: res.data.id, url: `https://facebook.com/${res.data.id}` };
  } catch (err) {
    throw new Error(`Facebook publish failed: ${err.response?.data?.error?.message || err.message}`);
  }
}

// ─── Instagram ───────────────────────────────────────────────────────────────

async function publishToInstagram({ accessToken, igUserId, imageUrl, caption }) {
  if (DEMO_MODE_META) {
    return { demo: true, id: `demo_ig_${Date.now()}`, url: 'https://instagram.com' };
  }
  try {
    // Step 1: create media container
    const containerRes = await axios.post(
      `https://graph.facebook.com/v19.0/${igUserId}/media`,
      { image_url: imageUrl, caption, access_token: accessToken }
    );
    const creationId = containerRes.data.id;

    // Step 2: publish the container
    const publishRes = await axios.post(
      `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
      { creation_id: creationId, access_token: accessToken }
    );
    return { id: publishRes.data.id, url: `https://instagram.com/p/${publishRes.data.id}` };
  } catch (err) {
    throw new Error(`Instagram publish failed: ${err.response?.data?.error?.message || err.message}`);
  }
}

// ─── Google Business ─────────────────────────────────────────────────────────

async function publishToGoogleBusiness({ accessToken, accountId, imageBuffer, caption }) {
  if (DEMO_MODE_GOOGLE) {
    return { demo: true, id: `demo_gbp_${Date.now()}`, url: 'https://business.google.com' };
  }
  try {
    // Upload image first
    const uploadRes = await axios.post(
      `https://mybusiness.googleapis.com/v4/${accountId}/media`,
      { mediaFormat: 'PHOTO', sourceUrl: '' },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    // Create post with uploaded media
    const postRes = await axios.post(
      `https://mybusiness.googleapis.com/v4/${accountId}/localPosts`,
      {
        languageCode: 'en-US',
        summary: caption,
        media: [{ mediaFormat: 'PHOTO', sourceUrl: uploadRes.data.googleUrl }],
        topicType: 'STANDARD',
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return { id: postRes.data.name, url: postRes.data.searchUrl || 'https://business.google.com' };
  } catch (err) {
    throw new Error(`Google Business publish failed: ${err.response?.data?.error?.message || err.message}`);
  }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

async function publishToYouTube({ accessToken, caption, imageBuffer }) {
  if (DEMO_MODE_GOOGLE) {
    return { demo: true, id: `demo_yt_${Date.now()}`, url: 'https://youtube.com' };
  }
  // YouTube Community Posts API is not yet publicly available via the
  // Data API — this is stubbed until Google opens it up.
  return {
    stub: true,
    message: 'YouTube Community Posts API is not yet publicly available. Your content was saved but not posted to YouTube.',
  };
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {string} params.provider - 'meta_facebook' | 'meta_instagram' | 'google_business' | 'youtube'
 * @param {object} params.account - the connected account record from socialAccountsDb
 * @param {Buffer} params.imageBuffer - the resized image bytes
 * @param {string} params.imageUrl - public URL of the image (needed for Instagram container)
 * @param {string} params.caption - the approved caption text
 */
async function publish({ provider, account, imageBuffer, imageUrl, caption }) {
  switch (provider) {
    case 'meta_facebook':
      return publishToFacebook({ accessToken: account.accessToken, pageId: account.providerAccountId, imageBuffer, caption });
    case 'meta_instagram':
      return publishToInstagram({ accessToken: account.accessToken, igUserId: account.providerAccountId, imageUrl, caption });
    case 'google_business':
      return publishToGoogleBusiness({ accessToken: account.accessToken, accountId: account.providerAccountId, imageBuffer, caption });
    case 'youtube':
      return publishToYouTube({ accessToken: account.accessToken, caption, imageBuffer });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

module.exports = { publish, DEMO_MODE_META, DEMO_MODE_GOOGLE };
