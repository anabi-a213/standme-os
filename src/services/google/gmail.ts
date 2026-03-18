import { google, gmail_v1 } from 'googleapis';
import { getGoogleAuth } from './auth';
import { retry } from '../../utils/retry';

let _gmail: gmail_v1.Gmail | null = null;

function getGmailClient(): gmail_v1.Gmail {
  if (!_gmail) {
    _gmail = google.gmail({ version: 'v1', auth: getGoogleAuth() });
  }
  return _gmail;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  labels: string[];
}

export async function getEmailsByLabel(label: string, maxResults = 20): Promise<EmailMessage[]> {
  return retry(async () => {
    // First find the label ID
    const labelsResp = await getGmailClient().users.labels.list({ userId: 'me' });
    const labelObj = labelsResp.data.labels?.find(l => l.name === label);
    if (!labelObj) return [];

    const response = await getGmailClient().users.messages.list({
      userId: 'me',
      labelIds: [labelObj.id!],
      maxResults,
    });

    if (!response.data.messages) return [];

    const emails: EmailMessage[] = [];
    for (const msg of response.data.messages) {
      const full = await getGmailClient().users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'full',
      });

      const headers = full.data.payload?.headers || [];
      const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      let body = '';
      if (full.data.payload?.body?.data) {
        body = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
      } else if (full.data.payload?.parts) {
        const textPart = full.data.payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      }

      emails.push({
        id: msg.id!,
        threadId: msg.threadId || '',
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        body,
        date: getHeader('Date'),
        labels: full.data.labelIds || [],
      });
    }
    return emails;
  }, 'getEmailsByLabel');
}

export async function sendEmail(to: string, subject: string, body: string): Promise<string> {
  return retry(async () => {
    const fromEmail = process.env.SEND_FROM_EMAIL || 'info@standme.de';
    const raw = Buffer.from(
      `From: ${fromEmail}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const response = await getGmailClient().users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return response.data.id || '';
  }, 'sendEmail');
}

export async function searchEmailsByQuery(query: string, maxResults = 20): Promise<EmailMessage[]> {
  return retry(async () => {
    const response = await getGmailClient().users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    if (!response.data.messages) return [];

    const emails: EmailMessage[] = [];
    for (const msg of response.data.messages) {
      const full = await getGmailClient().users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'full',
      });

      const headers = full.data.payload?.headers || [];
      const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      let body = '';
      if (full.data.payload?.body?.data) {
        body = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
      } else if (full.data.payload?.parts) {
        const textPart = full.data.payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      }

      emails.push({
        id: msg.id!,
        threadId: msg.threadId || '',
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        body,
        date: getHeader('Date'),
        labels: full.data.labelIds || [],
      });
    }
    return emails;
  }, 'searchEmailsByQuery');
}

export async function createDraft(to: string, subject: string, body: string): Promise<string> {
  return retry(async () => {
    const fromEmail = process.env.SEND_FROM_EMAIL || 'info@standme.de';
    const raw = Buffer.from(
      `From: ${fromEmail}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const response = await getGmailClient().users.drafts.create({
      userId: 'me',
      requestBody: {
        message: { raw },
      },
    });
    return response.data.id || '';
  }, 'createDraft');
}
