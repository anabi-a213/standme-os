import { google, Auth } from 'googleapis';
import { logger } from '../../utils/logger';

let _auth: Auth.OAuth2Client | null = null;

export function getGoogleAuth(): Auth.OAuth2Client {
  if (!_auth) {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost'
    );

    client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    _auth = client;
  }
  return _auth;
}

// Call at startup to exchange the refresh token for an access token eagerly,
// so the first real Sheets/Drive call doesn't pay the token-refresh latency.
export async function warmGoogleAuth(): Promise<void> {
  try {
    const auth = getGoogleAuth();
    await auth.getAccessToken();
    logger.info('[Google Auth] Token pre-warmed successfully');
  } catch (err: any) {
    logger.warn(`[Google Auth] Pre-warm failed — Sheets/Drive may be slow on first call: ${err.message}`);
  }
}
