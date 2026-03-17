/**
 * StandMe OS — One-time Google OAuth2 Setup
 * Run this once: node --require ts-node/register src/setup/oauth-setup.ts
 * It will print a URL, you visit it, paste the code back, and get your refresh token.
 */

import { google } from 'googleapis';
import readline from 'readline';
import dotenv from 'dotenv';
dotenv.config();

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

async function setup() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || clientId === 'PLACEHOLDER' || !clientSecret || clientSecret === 'PLACEHOLDER') {
    console.error('\n❌ GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in your .env file.');
    console.error('   Follow the instructions to create OAuth2 credentials first.\n');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost'
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n==========================================');
  console.log('  StandMe OS — Google OAuth2 Setup');
  console.log('==========================================\n');
  console.log('Step 1: Open this URL in your browser (standme.de account):\n');
  console.log(authUrl);
  console.log('\nStep 2: Sign in with info@standme.de');
  console.log('Step 3: Allow all permissions');
  console.log('Step 4: Copy the authorization code shown\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question('Paste the authorization code here: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oauth2Client.getToken(code.trim());

      console.log('\n==========================================');
      console.log('  SUCCESS! Add this to your .env file:');
      console.log('==========================================\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
      console.log('Then restart the server.\n');
    } catch (err: any) {
      console.error('\n❌ Failed to get token:', err.message);
      console.error('   Make sure you pasted the full code correctly.\n');
    }
  });
}

setup();
