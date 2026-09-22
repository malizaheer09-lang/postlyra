// routes/social.js
//
// Handles:
//   - OAuth initiation  (GET /auth/meta, GET /auth/google)
//   - OAuth callbacks   (GET /auth/meta/callback, GET /auth/google/callback)
//   - Account listing   (GET /api/social/accounts)
//   - Account removal   (DELETE /api/social/accounts/:provider/:accountId)
//   - Publishing        (POST /api/social/publish)

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const authenticate = require('../middleware/authenticate');
const { upsertAccount, getAccountsByUser, getAccount, deleteAccount, toPublicAccount } = require('../socialAccountsDb');
const { publish, DEMO_MODE_META, DEMO_MODE_GOOGLE } = require('../services/publisher');
const { findUploadById } = require('../uploadsDb');

const router = express.Router();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

const jwt = require('jsonwebtoken');

// ─── OAuth state store ────────────────────────────────────────────────────────
// We sign the state as a JWT so it survives server restarts — unlike an
// in-memory Map which is wiped every time npm start is run. The state is
// short-lived (10 minutes) and verified on the callback.

function generateState(userId, provider) {
  return jwt.sign(
    { userId, provider },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function consumeState(state) {
  try {
    const data = jwt.verify(state, process.env.JWT_SECRET);
    return { userId: data.userId, provider: data.provider };
  } catch {
    return null;
  }
}

// ─── Meta OAuth ──────────────────────────────────────────────────────────────

router.get('/auth/meta', authenticate, (req, res) => {
  if (DEMO_MODE_META) {
    // In demo mode, skip the real OAuth and create fake connected accounts
    upsertAccount({
      userId: req.user.id,
      provider: 'meta_facebook',
      providerAccountId: `demo_fb_page_${req.user.id}`,
      accessToken: 'demo_token',
      accountName: 'My Facebook Page (Demo)',
      accountType: 'facebook_page',
    });
    upsertAccount({
      userId: req.user.id,
      provider: 'meta_instagram',
      providerAccountId: `demo_ig_${req.user.id}`,
      accessToken: 'demo_token',
      accountName: '@mybusiness (Demo)',
      accountType: 'instagram_business',
    });
    return res.redirect('/accounts.html?connected=meta');
  }

  const state = generateState(req.user.id, 'meta');
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${BASE_URL}/auth/meta/callback`,
    scope: 'instagram_basic, instagram_content_publish,pages_read_engagement,business_management,pages_show_list',
    response_type: 'code',
    state,
  });
  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
});

router.get('/auth/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect(`/accounts.html?error=${encodeURIComponent(error)}`);

  const stateData = consumeState(state);
  if (!stateData) return res.redirect('/accounts.html?error=invalid_state');

  try {
    // Exchange code for access token
    const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: `${BASE_URL}/auth/meta/callback`,
        code,
      },
    });
    const userToken = tokenRes.data.access_token;

    // Get list of pages the user manages
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: userToken, fields: 'id,name,access_token,instagram_business_account' },
    });

    for (const page of pagesRes.data.data) {
      upsertAccount({
        userId: stateData.userId,
        provider: 'meta_facebook',
        providerAccountId: page.id,
        accessToken: page.access_token, // page-level token, doesn't expire
        accountName: page.name,
        accountType: 'facebook_page',
      });

      // If this page has a linked Instagram Business account, save that too
      if (page.instagram_business_account) {
        const igRes = await axios.get(`https://graph.facebook.com/v19.0/${page.instagram_business_account.id}`, {
          params: { fields: 'id,username', access_token: page.access_token },
        });
        upsertAccount({
          userId: stateData.userId,
          provider: 'meta_instagram',
          providerAccountId: igRes.data.id,
          accessToken: page.access_token,
          accountName: `@${igRes.data.username}`,
          accountType: 'instagram_business',
        });
      }
    }

    res.redirect('/accounts.html?connected=meta');
  } catch (err) {
    console.error('Meta OAuth callback error:', err.response?.data || err.message);
    res.redirect(`/accounts.html?error=${encodeURIComponent('Failed to connect Meta account.')}`);
  }
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────

router.get('/auth/google', authenticate, (req, res) => {
  if (DEMO_MODE_GOOGLE) {
    upsertAccount({
      userId: req.user.id,
      provider: 'google_business',
      providerAccountId: `demo_gbp_${req.user.id}`,
      accessToken: 'demo_token',
      accountName: 'My Business (Demo)',
      accountType: 'google_business',
    });
    upsertAccount({
      userId: req.user.id,
      provider: 'youtube',
      providerAccountId: `demo_yt_${req.user.id}`,
      accessToken: 'demo_token',
      accountName: 'My YouTube Channel (Demo)',
      accountType: 'youtube_channel',
    });
    return res.redirect('/accounts.html?connected=google');
  }

  const state = generateState(req.user.id, 'google');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/google/callback`,
    scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/business.manage',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect(`/accounts.html?error=${encodeURIComponent(error)}`);

  const stateData = consumeState(state);
  if (!stateData) return res.redirect('/accounts.html?error=invalid_state');

  try {
    // Exchange code for tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${BASE_URL}/auth/google/callback`,
      grant_type: 'authorization_code',
    });
    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Get YouTube channel info
    try {
      const ytRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'snippet', mine: true, access_token },
      });
      if (ytRes.data.items?.[0]) {
        const channel = ytRes.data.items[0];
        upsertAccount({
          userId: stateData.userId,
          provider: 'youtube',
          providerAccountId: channel.id,
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt,
          accountName: channel.snippet.title,
          accountType: 'youtube_channel',
        });
      }
    } catch (e) { console.warn('Could not fetch YouTube channel:', e.message); }

    // Get Google Business accounts
    try {
      const gbpRes = await axios.get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      for (const account of (gbpRes.data.accounts || [])) {
        upsertAccount({
          userId: stateData.userId,
          provider: 'google_business',
          providerAccountId: account.name,
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt,
          accountName: account.accountName,
          accountType: 'google_business',
        });
      }
    } catch (e) { console.warn('Could not fetch Google Business accounts:', e.message); }

    res.redirect('/accounts.html?connected=google');
  } catch (err) {
    console.error('Google OAuth callback error:', err.response?.data || err.message);
    res.redirect(`/accounts.html?error=${encodeURIComponent('Failed to connect Google account.')}`);
  }
});

// ─── Account management API ───────────────────────────────────────────────────

router.get('/api/social/accounts', authenticate, (req, res) => {
  const accounts = getAccountsByUser(req.user.id).map(toPublicAccount);
  res.json({ accounts });
});

router.delete('/api/social/accounts/:provider/:accountId', authenticate, (req, res) => {
  const { provider, accountId } = req.params;
  const deleted = deleteAccount(req.user.id, provider, decodeURIComponent(accountId));
  if (!deleted) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true });
});

// ─── Publish ─────────────────────────────────────────────────────────────────

router.post('/api/social/publish', authenticate, async (req, res) => {
  const { uploadId, platformVersionId, caption, targets } = req.body;
  // targets: [{ provider, providerAccountId }]

  if (!uploadId || !caption || !Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({ error: 'Missing required fields: uploadId, caption, targets.' });
  }

  const upload = findUploadById(uploadId);
  if (!upload || upload.userId !== req.user.id) {
    return res.status(404).json({ error: 'Upload not found.' });
  }

  // Find the platform version to use
  const version = platformVersionId
    ? upload.platformVersions.find((v) => `${v.platformId}__${v.formatId}` === platformVersionId)
    : upload.platformVersions[0];

  if (!version) return res.status(404).json({ error: 'Platform version not found.' });

  const imagePath = path.join(UPLOADS_ROOT, req.user.id, uploadId, version.filename);
  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: 'Image file not found on disk.' });
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const imageUrl = `${BASE_URL}/api/uploads/${uploadId}/file/${version.platformId}/${version.formatId}`;

  const results = [];

  for (const target of targets) {
    const account = getAccount(req.user.id, target.provider, target.providerAccountId);
    if (!account) {
      results.push({ provider: target.provider, providerAccountId: target.providerAccountId, ok: false, error: 'Account not connected.' });
      continue;
    }
    try {
      const result = await publish({ provider: target.provider, account, imageBuffer, imageUrl, caption });
      results.push({ provider: target.provider, providerAccountId: target.providerAccountId, ok: true, ...result });
    } catch (err) {
      results.push({ provider: target.provider, providerAccountId: target.providerAccountId, ok: false, error: err.message });
    }
  }

  res.json({ results });
});

module.exports = router;
