import { google, drive_v3 } from 'googleapis';
import { getGoogleAuth } from './auth';
import { retry } from '../../utils/retry';
import { logger } from '../../utils/logger';
import { saveRuntimeConfigs } from '../runtime-config';

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

// ---- Find or create a folder (by name under a specific parent) ----
// If a folder with this exact name already exists under parentId, return its ID.
// Otherwise create it. This makes all setup operations idempotent.

export async function ensureFolder(name: string, parentId: string): Promise<string> {
  return retry(async () => {
    // Search for existing folder with this name under this parent
    const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;
    const resp = await getDriveClient().files.list({
      q,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = resp.data.files || [];
    if (files.length > 0 && files[0].id) {
      return files[0].id;
    }
    // Doesn't exist — create it
    return createFolder(name, parentId);
  }, `ensureFolder(${name})`);
}

// ---- Set up the entire static StandMe OS folder tree in Google Drive ----
// Idempotent: uses ensureFolder so existing folders are found, not duplicated.
// Returns a map of envKey → folderId for pasting into .env

export async function setupDriveFolderTree(): Promise<Record<string, string>> {
  const { STATIC_FOLDER_TREE, DRIVE_FOLDERS } = await import('../../config/drive-folders');
  const ROOT_ID = DRIVE_FOLDERS.ROOT;

  // We track resolved IDs in this run (envKey → id)
  const resolved: Record<string, string> = { ROOT: ROOT_ID };

  logger.info('[Drive] Starting folder tree setup...');

  for (const folder of STATIC_FOLDER_TREE) {
    // Find parent ID: either ROOT or a previously resolved folder
    const parentId = resolved[folder.parentEnvKey];
    if (!parentId) {
      logger.warn(`[Drive] Cannot create "${folder.name}" — parent "${folder.parentEnvKey}" not resolved yet. Check tree order.`);
      continue;
    }

    try {
      const id = await ensureFolder(folder.name, parentId);
      resolved[folder.envKey] = id;
      logger.info(`[Drive] ✓ ${folder.name} → ${id}`);
    } catch (err: any) {
      logger.error(`[Drive] ✗ Failed to create "${folder.name}": ${err.message}`);
    }
  }

  // Invalidate cache so agents see the new folders
  invalidateFolderCache();

  // Auto-save all folder IDs to Knowledge Base so Railway never needs updating
  await saveRuntimeConfigs(resolved);
  logger.info('[Drive] Folder IDs auto-saved to Knowledge Base — no .env update needed');

  return resolved;
}

// ---- Create a full project folder tree under /02_Projects/ACTIVE/ ----
// Creates: [ProjectID]_[Client]_[Show]_[YYYY-MM]/ + all 11 standard subfolders.
// Returns: { projectFolderId, subfolders: { subfolder → id } }

export async function createProjectFolderTree(
  projectId: string,
  client: string,
  show: string,
  date?: Date,
): Promise<{ projectFolderId: string; url: string; subfolders: Record<string, string> }> {
  const { makeProjectFolderName, PROJECT_SUBFOLDERS, DRIVE_FOLDERS } = await import('../../config/drive-folders');

  const activeId = DRIVE_FOLDERS.PROJECTS.ACTIVE();
  const parentId = activeId || DRIVE_FOLDERS.PROJECTS._id() || STANDME_ROOT;

  const folderName = makeProjectFolderName(projectId, client, show, date);
  const projectFolderId = await ensureFolder(folderName, parentId);

  const subfolders: Record<string, string> = {};
  for (const sub of PROJECT_SUBFOLDERS) {
    const subId = await ensureFolder(sub, projectFolderId);
    subfolders[sub] = subId;
  }

  invalidateFolderCache();
  // Save project folder ID to Knowledge Base for persistence
  const projectKey = `DRIVE_PROJECT_${projectId.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
  await saveRuntimeConfigs({ [projectKey]: projectFolderId, ...Object.fromEntries(Object.entries(subfolders).map(([k, v]) => [`${projectKey}_${k.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`, v])) });

  const url = `https://drive.google.com/drive/folders/${projectFolderId}`;
  logger.info(`[Drive] Project folder created: ${folderName} (${projectFolderId})`);
  return { projectFolderId, url, subfolders };
}

// ---- Create a show/event folder under /03_Events_And_Venues/ ----
// Creates: [ShowName]_[YYYY]/ + Portal_Docs, Deadlines, Rules_Regulations, Rigging_Electrical_Orders
// Returns: { showFolderId, subfolders }

export async function createShowFolder(
  showName: string,
  year?: number,
): Promise<{ showFolderId: string; url: string; subfolders: Record<string, string> }> {
  const { makeShowFolderName, SHOW_SUBFOLDERS, DRIVE_FOLDERS } = await import('../../config/drive-folders');

  const parentId = DRIVE_FOLDERS.EVENTS._id() || STANDME_ROOT;
  const folderName = makeShowFolderName(showName, year);
  const showFolderId = await ensureFolder(folderName, parentId);

  const subfolders: Record<string, string> = {};
  for (const sub of SHOW_SUBFOLDERS) {
    const subId = await ensureFolder(sub, showFolderId);
    subfolders[sub] = subId;
  }

  invalidateFolderCache();
  const url = `https://drive.google.com/drive/folders/${showFolderId}`;
  logger.info(`[Drive] Show folder created: ${folderName} (${showFolderId})`);
  return { showFolderId, url, subfolders };
}

// ---- Create a contractor folder under /04_Contractors/ ----
// Creates: [ContractorName]/ + Contacts, Rates, Past_Projects, Performance_Notes

export async function createContractorFolder(
  contractorName: string,
): Promise<{ contractorFolderId: string; url: string; subfolders: Record<string, string> }> {
  const { CONTRACTOR_SUBFOLDERS, DRIVE_FOLDERS } = await import('../../config/drive-folders');

  const parentId = DRIVE_FOLDERS.CONTRACTORS._id() || STANDME_ROOT;
  const safeName = contractorName.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
  const contractorFolderId = await ensureFolder(safeName, parentId);

  const subfolders: Record<string, string> = {};
  for (const sub of CONTRACTOR_SUBFOLDERS) {
    const subId = await ensureFolder(sub, contractorFolderId);
    subfolders[sub] = subId;
  }

  invalidateFolderCache();
  const url = `https://drive.google.com/drive/folders/${contractorFolderId}`;
  logger.info(`[Drive] Contractor folder created: ${safeName} (${contractorFolderId})`);
  return { contractorFolderId, url, subfolders };
}

// ---- Create Google Doc ----

// ---- Make a file editable by anyone with the link ----
// Returns true if it succeeded, false if the org policy blocks it.

export async function enableLinkSharing(fileId: string): Promise<boolean> {
  try {
    await getDriveClient().permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: { type: 'anyone', role: 'writer' },
    });
    return true;
  } catch (err: any) {
    logger.error(`[Drive] enableLinkSharing FAILED for ${fileId}: ${err.message} (code: ${err.code}) — org policy may block public sharing`);
    return false;
  }
}

// ---- Share a file with the StandMe team ----
// Tries: (1) anyone-with-link, (2) standme.de domain, (3) TEAM_SHARE_EMAILS,
// (4) DRIVE_OWNER_EMAIL. At least one must succeed or we log an error.

export async function shareWithTeam(fileId: string): Promise<void> {
  const drive = getDriveClient();
  let anySucceeded = false;

  // 1. Anyone with the link can edit
  const linkOk = await enableLinkSharing(fileId);
  if (linkOk) anySucceeded = true;

  // 2. standme.de domain — shows the file in every team member's Drive
  try {
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      sendNotificationEmail: false,
      requestBody: { type: 'domain', domain: 'standme.de', role: 'writer' },
    });
    anySucceeded = true;
  } catch (err: any) {
    logger.warn(`[Drive] Could not share ${fileId} with standme.de domain: ${err.message}`);
  }

  // 3. Extra individual emails from TEAM_SHARE_EMAILS
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
      anySucceeded = true;
    } catch (err: any) {
      logger.warn(`[Drive] Could not share ${fileId} with ${email}: ${err.message}`);
    }
  }

  // 4. DRIVE_OWNER_EMAIL — explicit fallback for the file owner / main admin
  const ownerEmail = process.env.DRIVE_OWNER_EMAIL;
  if (ownerEmail && !extras.includes(ownerEmail)) {
    try {
      await drive.permissions.create({
        fileId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: { type: 'user', emailAddress: ownerEmail, role: 'writer' },
      });
      anySucceeded = true;
    } catch (err: any) {
      logger.warn(`[Drive] Could not share ${fileId} with DRIVE_OWNER_EMAIL (${ownerEmail}): ${err.message}`);
    }
  }

  if (!anySucceeded) {
    logger.error(`[Drive] shareWithTeam: ALL sharing methods failed for ${fileId}. File may only be accessible to the bot account. Set DRIVE_OWNER_EMAIL or TEAM_SHARE_EMAILS in .env to fix this.`);
  }
}

// ---- Create Google Doc ----
// File creation and content writing are separated from retry so a failed
// batchUpdate does not create duplicate orphaned documents.

export async function createGoogleDoc(name: string, content: string, folderId?: string): Promise<{ id: string; url: string }> {
  const docs = google.docs({ version: 'v1', auth: getGoogleAuth() });

  // Use explicit arg → env var → known StandMe OS Drive folder
  const resolvedFolder = folderId || process.env.DRIVE_FOLDER_AGENTS || '19FU-EKvNdpiOjjUBWafQWVoo2YTGDZsl';
  const fileMetadata: drive_v3.Schema$File = {
    name,
    mimeType: 'application/vnd.google-apps.document',
  };
  if (resolvedFolder) fileMetadata.parents = [resolvedFolder];

  // Create the file once — not inside retry to avoid duplicate orphaned docs
  const file = await getDriveClient().files.create({
    requestBody: fileMetadata,
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  const docId = file.data.id || '';
  const url = file.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;

  // Write content — retry only this step if it fails (file already exists)
  if (content) {
    await retry(async () => {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{ insertText: { location: { index: 1 }, text: content } }],
        },
      });
    }, `writeDocContent(${docId})`);
  }

  // Share — must complete before returning the URL so clicking it works immediately
  await shareWithTeam(docId);

  return { id: docId, url };
}
