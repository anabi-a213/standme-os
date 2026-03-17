import { google, Auth } from 'googleapis';

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
