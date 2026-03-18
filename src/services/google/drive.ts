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
  driveId?: string; // for shared drives
}

// ---- List files (personal + all shared drives) ----

export async function listFiles(folderId?: string, query?: string): Promise<DriveFile[]> {
  return retry(async () => {
    let q = 'trashed = false';
    if (folderId) q += ` and '${folderId}' in parents`;
    if (query) q += ` and ${query}`;

    const response = await getDriveClient().files.list({
      q,
      fields: 'files(id, name, mimeType, webViewLink, parents, modifiedTime, driveId)',
      pageSize: 200,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    return (response.data.files || []).map(f => ({
      id: f.id || '',
      name: f.name || '',
      mimeType: f.mimeType || '',
      webViewLink: f.webViewLink || '',
      parents: (f.parents || []) as string[],
      modifiedTime: f.modifiedTime || '',
      driveId: f.driveId || '',
    }));
  }, 'listFiles');
}

// ---- List all shared drives ----

export async function listSharedDrives(): Promise<{ id: string; name: string }[]> {
  return retry(async () => {
    const response = await getDriveClient().drives.list({
      pageSize: 50,
      fields: 'drives(id, name)',
    });
    return (response.data.drives || []).map(d => ({ id: d.id || '', name: d.name || '' }));
  }, 'listSharedDrives');
}

// ---- List files inside a shared drive ----

export async function listSharedDriveFiles(driveId: string): Promise<DriveFile[]> {
  return retry(async () => {
    const response = await getDriveClient().files.list({
      q: `trashed = false and '${driveId}' in parents`,
      fields: 'files(id, name, mimeType, webViewLink, parents, modifiedTime, driveId)',
      pageSize: 200,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      driveId,
      corpora: 'drive',
    });

    return (response.data.files || []).map(f => ({
      id: f.id || '',
      name: f.name || '',
      mimeType: f.mimeType || '',
      webViewLink: f.webViewLink || '',
      parents: (f.parents || []) as string[],
      modifiedTime: f.modifiedTime || '',
      driveId: f.driveId || driveId,
    }));
  }, 'listSharedDriveFiles');
}

// ---- Read Google Doc content as plain text ----

export async function readDocContent(fileId: string): Promise<string> {
  return retry(async () => {
    const response = await getDriveClient().files.export({
      fileId,
      mimeType: 'text/plain',
      supportsAllDrives: true,
    } as any);

    const text = response.data as string;
    return typeof text === 'string' ? text.slice(0, 8000) : '';
  }, 'readDocContent');
}

// ---- Read Google Sheet as CSV text ----

export async function readSheetAsText(fileId: string): Promise<string> {
  return retry(async () => {
    const response = await getDriveClient().files.export({
      fileId,
      mimeType: 'text/csv',
      supportsAllDrives: true,
    } as any);

    const text = response.data as string;
    return typeof text === 'string' ? text.slice(0, 4000) : '';
  }, 'readSheetAsText');
}

// ---- Export PDF as plain text ----

export async function readPdfAsText(fileId: string): Promise<string> {
  return retry(async () => {
    const response = await getDriveClient().files.export({
      fileId,
      mimeType: 'text/plain',
      supportsAllDrives: true,
    } as any).catch(() => null);

    if (!response) return '';
    const text = response.data as string;
    return typeof text === 'string' ? text.slice(0, 4000) : '';
  }, 'readPdfAsText');
}

// ---- Get folder name by ID ----

export async function getFolderName(folderId: string): Promise<string> {
  try {
    const response = await getDriveClient().files.get({
      fileId: folderId,
      fields: 'name',
      supportsAllDrives: true,
    });
    return response.data.name || folderId;
  } catch {
    return '';
  }
}

// ---- Build full folder path for a file ----

export async function buildFolderPath(file: DriveFile): Promise<string> {
  if (!file.parents || file.parents.length === 0) return '/';
  try {
    const parentName = await getFolderName(file.parents[0]);
    return parentName ? `/${parentName}` : '/';
  } catch {
    return '/';
  }
}

// ---- Search Drive (personal + shared) ----

export async function searchFiles(query: string): Promise<DriveFile[]> {
  return retry(async () => {
    const response = await getDriveClient().files.list({
      q: `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
      fields: 'files(id, name, mimeType, webViewLink, parents, modifiedTime, driveId)',
      pageSize: 20,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    return (response.data.files || []).map(f => ({
      id: f.id || '',
      name: f.name || '',
      mimeType: f.mimeType || '',
      webViewLink: f.webViewLink || '',
      parents: (f.parents || []) as string[],
      modifiedTime: f.modifiedTime || '',
      driveId: f.driveId || '',
    }));
  }, 'searchFiles');
}

// ---- Read any file content based on type ----

export async function readFileContent(file: DriveFile): Promise<string> {
  const mime = file.mimeType;

  if (mime === 'application/vnd.google-apps.document') {
    return readDocContent(file.id);
  }
  if (mime === 'application/vnd.google-apps.spreadsheet') {
    return readSheetAsText(file.id);
  }
  if (mime === 'application/pdf') {
    return readPdfAsText(file.id);
  }
  // Folder or unsupported
  return '';
}

// ---- Create folder ----

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
      supportsAllDrives: true,
    });
    return response.data.id || '';
  }, 'createFolder');
}

// ---- Create Google Doc ----

export async function createGoogleDoc(name: string, content: string, folderId?: string): Promise<{ id: string; url: string }> {
  return retry(async () => {
    const docs = google.docs({ version: 'v1', auth: getGoogleAuth() });

    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.document',
    };
    if (folderId) fileMetadata.parents = [folderId];

    const file = await getDriveClient().files.create({
      requestBody: fileMetadata,
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });

    const docId = file.data.id || '';

    if (content) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{ insertText: { location: { index: 1 }, text: content } }],
        },
      });
    }

    return {
      id: docId,
      url: file.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`,
    };
  }, 'createGoogleDoc');
}
