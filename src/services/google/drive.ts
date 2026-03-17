import { google, drive_v3 } from 'googleapis';
import { getGoogleAuth } from './auth';
import { retry } from '../../utils/retry';

let _drive: drive_v3.Drive | null = null;

function getDriveClient(): drive_v3.Drive {
  if (!_drive) {
    _drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
  }
  return _drive;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  parents: string[];
  modifiedTime: string;
}

export async function listFiles(folderId?: string, query?: string): Promise<DriveFile[]> {
  return retry(async () => {
    let q = "trashed = false";
    if (folderId) q += ` and '${folderId}' in parents`;
    if (query) q += ` and ${query}`;

    const response = await getDriveClient().files.list({
      q,
      fields: 'files(id, name, mimeType, webViewLink, parents, modifiedTime)',
      pageSize: 100,
    });

    return (response.data.files || []).map(f => ({
      id: f.id || '',
      name: f.name || '',
      mimeType: f.mimeType || '',
      webViewLink: f.webViewLink || '',
      parents: (f.parents || []) as string[],
      modifiedTime: f.modifiedTime || '',
    }));
  }, 'listFiles');
}

export async function createFolder(name: string, parentId?: string): Promise<string> {
  return retry(async () => {
    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) fileMetadata.parents = [parentId];

    const response = await getDriveClient().files.create({
      requestBody: fileMetadata,
      fields: 'id',
    });
    return response.data.id || '';
  }, 'createFolder');
}

export async function createGoogleDoc(name: string, content: string, folderId?: string): Promise<{ id: string; url: string }> {
  return retry(async () => {
    const docs = google.docs({ version: 'v1', auth: getGoogleAuth() });

    // Create the doc
    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.document',
    };
    if (folderId) fileMetadata.parents = [folderId];

    const file = await getDriveClient().files.create({
      requestBody: fileMetadata,
      fields: 'id, webViewLink',
    });

    const docId = file.data.id || '';

    // Insert content
    if (content) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{
            insertText: {
              location: { index: 1 },
              text: content,
            },
          }],
        },
      });
    }

    return {
      id: docId,
      url: file.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`,
    };
  }, 'createGoogleDoc');
}

export async function searchFiles(query: string): Promise<DriveFile[]> {
  return retry(async () => {
    const response = await getDriveClient().files.list({
      q: `name contains '${query}' and trashed = false`,
      fields: 'files(id, name, mimeType, webViewLink, parents, modifiedTime)',
      pageSize: 20,
    });

    return (response.data.files || []).map(f => ({
      id: f.id || '',
      name: f.name || '',
      mimeType: f.mimeType || '',
      webViewLink: f.webViewLink || '',
      parents: (f.parents || []) as string[],
      modifiedTime: f.modifiedTime || '',
    }));
  }, 'searchFiles');
}
