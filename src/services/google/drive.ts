import { google, drive_v3 } from 'googleapis';
import { getGoogleAuth } from './auth';
import { retry } from '../../utils/retry';
import { logger } from '../../utils/logger';

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
  driveId?: string;
}

function mapFile(f: drive_v3.Schema$File, fallbackDriveId = ''): DriveFile {
  return {
    id: f.id || '',
    name: f.name || '',
    mimeType: f.mimeType || '',
    webViewLink: f.webViewLink || '',
    parents: (f.parents || []) as string[],
    modifiedTime: f.modifiedTime || '',
    driveId: f.driveId || fallbackDriveId,
  };
}

const FILE_FIELDS = 'nextPageToken, files(id, name, mimeType, webViewLink, parents, modifiedTime, driveId)';

// ---- Paginated fetch helper ----

async function fetchAllPages(
  params: drive_v3.Params$Resource$Files$List,
  fallbackDriveId = ''
): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await getDriveClient().files.list({
      ...params,
      fields: FILE_FIELDS,
      pageSize: 1000,
      pageToken,
    });
    const files = response.data.files || [];
    allFiles.push(...files.map(f => mapFile(f, fallbackDriveId)));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return allFiles;
}

// ---- List ALL personal drive files (paginated, no folder filter) ----

export async function listFiles(folderId?: string, query?: string): Promise<DriveFile[]> {
  return retry(async () => {
    let q = 'trashed = false';
    if (folderId) q += ` and '${folderId}' in parents`;
    if (query) q += ` and ${query}`;

    return fetchAllPages({
      q,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
  }, 'listFiles');
}

// ---- List ALL files inside a folder recursively (not just direct children) ----

export async function listAllFilesInFolder(folderId: string): Promise<DriveFile[]> {
  return retry(async () => {
    return fetchAllPages({
      q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
  }, 'listAllFilesInFolder');
}

// ---- StandMe OS folder tree: full recursive scan and smart routing ----
// BFS-scans the entire StandMe OS folder tree (all levels deep),
// caches results, and routes agent docs to the best-matching subfolder.

export const STANDME_ROOT = '19FU-EKvNdpiOjjUBWafQWVoo2YTGDZsl';

export interface FolderEntry {
  id: string;
  name: string;
  parentId: string;
  path: string; // full path from root, e.g. "Sales / Briefs"
}

let _folderCache: FolderEntry[] | null = null;
let _folderCacheTime = 0;
const FOLDER_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Full BFS scan of the StandMe OS folder tree (all levels deep)
export async function listStandMeSubfolders(): Promise<FolderEntry[]> {
  const now = Date.now();
  if (_folderCache && now - _folderCacheTime < FOLDER_CACHE_TTL) return _folderCache;

  const result: FolderEntry[] = [];
  // Queue entries: [folderId, pathSoFar]
  const queue: Array<{ id: string; path: string }> = [{ id: STANDME_ROOT, path: '' }];
  const visited = new Set<string>([STANDME_ROOT]);

  try {
    while (queue.length > 0) {
      const { id: parentId, path: parentPath } = queue.shift()!;

      const resp = await getDriveClient().files.list({
        q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 100,
      } as any);

      const children: Array<{ id: string; name: string }> = ((resp.data as any).files || []);
      for (const f of children) {
        if (visited.has(f.id)) continue;
        visited.add(f.id);
        const fullPath = parentPath ? `${parentPath} / ${f.name}` : f.name;
        result.push({ id: f.id, name: f.name, parentId, path: fullPath });
        queue.push({ id: f.id, path: fullPath });
      }
    }

    _folderCache = result;
    _folderCacheTime = now;
    logger.info(`[Drive] StandMe folder tree (${result.length} folders): ${result.map(f => f.path).join(' | ')}`);
  } catch (err: any) {
    logger.warn(`[Drive] Could not read StandMe folder tree: ${err.message}`);
    _folderCache = _folderCache || []; // keep stale cache on error
  }

  return _folderCache!;
}

// Invalidate the folder cache (e.g. after creating a new subfolder)
export function invalidateFolderCache(): void {
  _folderCache = null;
  _folderCacheTime = 0;
}

// Find the deepest best-matching subfolder for a set of keywords.
// Matches against both folder name and full path. Falls back to StandMe OS root.
export async function resolveAgentFolder(keywords: string[]): Promise<{ id: string; name: string; path: string }> {
  const folders = await listStandMeSubfolders();

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    // Prefer an exact name match first, then partial name, then path match
    const exact  = folders.find(f => f.name.toLowerCase() === kwLower);
    if (exact) return exact;
    const partial = folders.find(f => f.name.toLowerCase().includes(kwLower));
    if (partial) return partial;
    const inPath = folders.find(f => f.path.toLowerCase().includes(kwLower));
    if (inPath) return inPath;
  }

  return { id: STANDME_ROOT, name: 'StandMe OS', path: '' };
}

// ---- List ALL files in personal drive (full tree, paginated) ----

export async function listAllPersonalFiles(): Promise<DriveFile[]> {
  return retry(async () => {
    return fetchAllPages({
      q: 'trashed = false',
      corpora: 'user',
      includeItemsFromAllDrives: false,
      supportsAllDrives: true,
    });
  }, 'listAllPersonalFiles');
}

// ---- List all shared drives ----

export async function listSharedDrives(): Promise<{ id: string; name: string }[]> {
  const allDrives: { id: string; name: string }[] = [];
  let pageToken: string | undefined;

  do {
    const response = await getDriveClient().drives.list({
      pageSize: 100,
      fields: 'nextPageToken, drives(id, name)',
      pageToken,
    } as any);
    const drives = response.data.drives || [];
    allDrives.push(...drives.map((d: any) => ({ id: d.id || '', name: d.name || '' })));
    pageToken = (response.data as any).nextPageToken || undefined;
  } while (pageToken);

  return allDrives;
}

// ---- List ALL files in a shared drive (full tree, paginated) ----

export async function listSharedDriveFiles(driveId: string): Promise<DriveFile[]> {
  return retry(async () => {
    // corpora: 'drive' + driveId gets EVERYTHING in the shared drive, not just root
    return fetchAllPages({
      q: 'trashed = false',
      corpora: 'drive',
      driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    }, driveId);
  }, 'listSharedDriveFiles');
}

// ---- Build complete folder map: id -> { name, parentId } ----
// Used to resolve full paths like /Projects/Arab Health 2025/Briefs/

export interface FolderNode {
  name: string;
  parentId: string | null;
}

export async function buildFolderMap(): Promise<Map<string, FolderNode>> {
  const map = new Map<string, FolderNode>();

  try {
    // Personal drive folders
    const personalFolders = await fetchAllPages({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      corpora: 'user',
      includeItemsFromAllDrives: false,
      supportsAllDrives: true,
    });

    for (const f of personalFolders) {
      map.set(f.id, { name: f.name, parentId: f.parents?.[0] || null });
    }

    // Shared drive folders
    const sharedDrives = await listSharedDrives();
    for (const drive of sharedDrives) {
      try {
        const sharedFolders = await fetchAllPages({
          q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
          corpora: 'drive',
          driveId: drive.id,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        }, drive.id);

        for (const f of sharedFolders) {
          map.set(f.id, { name: f.name, parentId: f.parents?.[0] || null });
        }
        // Add the shared drive root itself
        map.set(drive.id, { name: drive.name, parentId: null });
      } catch (err: any) {
        logger.warn(`[Drive] Could not index folders in "${drive.name}": ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.warn(`[Drive] buildFolderMap partial error: ${err.message}`);
  }

  return map;
}

// ---- Resolve full folder path using the pre-built map ----
// Returns something like: /StandMe GmbH/Arab Health 2025/Client Briefs

export function resolveFullPath(parentId: string | undefined, folderMap: Map<string, FolderNode>): string {
  if (!parentId) return '/';
  const parts: string[] = [];
  let currentId: string | null = parentId;
  let depth = 0;

  while (currentId && depth < 12) {
    const node = folderMap.get(currentId);
    if (!node) break;
    parts.unshift(node.name);
    currentId = node.parentId;
    depth++;
  }

  return parts.length > 0 ? '/' + parts.join('/') : '/';
}

// ---- Build full folder path for a single file (legacy, one level) ----

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

export async function buildFolderPath(file: DriveFile): Promise<string> {
  if (!file.parents || file.parents.length === 0) return '/';
  try {
    const parentName = await getFolderName(file.parents[0]);
    return parentName ? `/${parentName}` : '/';
  } catch {
    return '/';
  }
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

// ---- Read Google Slides as plain text ----

export async function readSlidesAsText(fileId: string): Promise<string> {
  return retry(async () => {
    const response = await getDriveClient().files.export({
      fileId,
      mimeType: 'text/plain',
      supportsAllDrives: true,
    } as any).catch(() => null);

    if (!response) return '';
    const text = response.data as string;
    return typeof text === 'string' ? text.slice(0, 6000) : '';
  }, 'readSlidesAsText');
}

// ---- Read any file content based on type ----

export async function readFileContent(file: DriveFile): Promise<string> {
  const mime = file.mimeType;
  if (mime === 'application/vnd.google-apps.document') return readDocContent(file.id);
  if (mime === 'application/vnd.google-apps.spreadsheet') return readSheetAsText(file.id);
  if (mime === 'application/vnd.google-apps.presentation') return readSlidesAsText(file.id);
  if (mime === 'application/pdf') return readPdfAsText(file.id);
  return '';
}

// ---- Search Drive (personal + shared) ----

export async function searchFiles(query: string): Promise<DriveFile[]> {
  return retry(async () => {
    return fetchAllPages({
      q: `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
      pageSize: 20,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    } as any);
  }, 'searchFiles');
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

// ---- Make a file editable by anyone with the link ----

export async function enableLinkSharing(fileId: string): Promise<void> {
  try {
    await getDriveClient().permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: { type: 'anyone', role: 'writer' },
    });
  } catch (err: any) {
    logger.warn(`[Drive] Could not enable link sharing for ${fileId}: ${err.message}`);
  }
}

// ---- Share a file with the StandMe team ----
// Enables "anyone with the link can edit" + grants domain-level access
// to standme.de and any extra emails in TEAM_SHARE_EMAILS. Non-fatal.

export async function shareWithTeam(fileId: string): Promise<void> {
  const drive = getDriveClient();

  // Anyone with the link can edit (covers team + external reviewers)
  await enableLinkSharing(fileId);

  // Also explicitly share with standme.de domain so it shows in their Drive
  try {
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      sendNotificationEmail: false,
      requestBody: { type: 'domain', domain: 'standme.de', role: 'writer' },
    });
  } catch (err: any) {
    logger.warn(`[Drive] Could not share ${fileId} with standme.de domain: ${err.message}`);
  }

  // Extra individual emails outside the domain — no notification emails
  const extras = (process.env.TEAM_SHARE_EMAILS || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

  for (const email of extras) {
    try {
      await drive.permissions.create({
        fileId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: { type: 'user', emailAddress: email, role: 'writer' },
      });
    } catch (err: any) {
      logger.warn(`[Drive] Could not share ${fileId} with ${email}: ${err.message}`);
    }
  }
}

// ---- Create Google Doc ----

export async function createGoogleDoc(name: string, content: string, folderId?: string): Promise<{ id: string; url: string }> {
  return retry(async () => {
    const docs = google.docs({ version: 'v1', auth: getGoogleAuth() });

    // Use explicit arg → env var → known StandMe OS Drive folder
    const resolvedFolder = folderId || process.env.DRIVE_FOLDER_AGENTS || '19FU-EKvNdpiOjjUBWafQWVoo2YTGDZsl';
    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.document',
    };
    if (resolvedFolder) fileMetadata.parents = [resolvedFolder];

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

    // Share with the full team — non-blocking, errors are logged not thrown
    shareWithTeam(docId).catch(() => {});

    return {
      id: docId,
      url: file.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`,
    };
  }, 'createGoogleDoc');
}
