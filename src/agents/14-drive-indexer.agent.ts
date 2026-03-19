import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { appendRow, appendRows, readSheet, objectToRow } from '../services/google/sheets';
import { listAllPersonalFiles, listSharedDrives, listSharedDriveFiles, readFileContent, buildFolderMap, resolveFullPath, searchFiles, listAllFilesInFolder, enableLinkSharing, listStandMeSubfolders, resolveAgentFolder, invalidateFolderCache, setupDriveFolderTree, createProjectFolderTree, createShowFolder, createContractorFolder, STANDME_ROOT, DriveFile } from '../services/google/drive';
import { generateText } from '../services/ai/client';
import { saveKnowledge, searchKnowledge, buildKnowledgeContext } from '../services/knowledge';
import { sendToMo, formatType2 } from '../services/telegram/bot';
import { logger } from '../utils/logger';

export class DriveIndexerAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Drive Indexer',
    id: 'agent-14',
    description: 'Index all Google Drive files (personal + shared) with content understanding and growing knowledge base',
    commands: ['/indexdrive', '/reindexdrive', '/findfile', '/readfile', '/knowledge', '/shareallfiles', '/foldertree', '/setupdrive', '/newprojectfolder', '/newshowfolder', '/newcontractorfolder'],
    schedule: '0 8 * * 1',
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/reindexdrive') return this.indexDrive(ctx, true);
    if (ctx.command === '/findfile') return this.findFile(ctx);
    if (ctx.command === '/readfile') return this.readFile(ctx);
    if (ctx.command === '/knowledge') return this.queryKnowledge(ctx);
    if (ctx.command === '/shareallfiles') return this.shareAllFiles(ctx);
    if (ctx.command === '/foldertree') return this.showFolderTree(ctx);
    if (ctx.command === '/setupdrive') return this.setupDriveTree(ctx);
    if (ctx.command === '/newprojectfolder') return this.newProjectFolder(ctx);
    if (ctx.command === '/newshowfolder') return this.newShowFolder(ctx);
    if (ctx.command === '/newcontractorfolder') return this.newContractorFolder(ctx);
    return this.indexDrive(ctx);
  }

  // ── /setupdrive — Build the entire static folder tree in Google Drive ──
  // Usage: /setupdrive
  // Creates all 31 static folders (idempotent — safe to re-run).
  // Outputs a .env block with all the folder IDs to paste in.

  private async setupDriveTree(ctx: AgentContext): Promise<AgentResponse> {
    await this.respond(ctx.chatId,
      'Setting up StandMe OS folder tree in Google Drive...\n' +
      'This creates 31 folders and is safe to re-run (existing folders are found, not duplicated).'
    );

    let resolved: Record<string, string>;
    try {
      resolved = await setupDriveFolderTree();
    } catch (err: any) {
      await this.respond(ctx.chatId, `Setup failed: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    const count = Object.keys(resolved).length - 1; // exclude ROOT

    // Folder IDs are auto-saved to Knowledge Base by setupDriveFolderTree().
    // They are loaded back into memory at every bot startup via loadRuntimeConfig().
    // No Railway variable update or restart needed.
    const msg =
      `*Drive folder tree ready!* ${count} folders created/verified.\n\n` +
      `All folder IDs *automatically saved* to Knowledge Base.\n` +
      `Bot loads them at startup — no Railway update, no restart needed.\n\n` +
      `Agents now route files to:\n` +
      `  • Concept briefs → /01_Sales/Proposals\n` +
      `  • Lessons Won → /06_Lessons_Learned/Won_Deals\n` +
      `  • Lessons Lost → /06_Lessons_Learned/Lost_Deals\n` +
      `  • Marketing → /01_Sales/Outreach_Assets\n\n` +
      `Run /foldertree to verify the full structure.`;

    await this.respond(ctx.chatId, msg);
    return { success: true, message: `Drive tree set up: ${count} folders, auto-saved`, confidence: 'HIGH' };
  }

  // ── /newprojectfolder — Create project folder + 11 subfolders ──
  // Usage: /newprojectfolder P001 | ClientName | ShowName
  // Creates under /02_Projects/ACTIVE/

  private async newProjectFolder(ctx: AgentContext): Promise<AgentResponse> {
    const parts = (ctx.args || '').split('|').map(p => p.trim());
    if (parts.length < 3) {
      await this.respond(ctx.chatId,
        'Usage: /newprojectfolder [ProjectID] | [Client Name] | [Show Name]\n' +
        'Example: /newprojectfolder P001 | Pharma Corp | Arab Health'
      );
      return { success: false, message: 'Missing args', confidence: 'HIGH' };
    }

    const [projectId, client, show] = parts;
    await this.respond(ctx.chatId, `Creating project folder for *${client}* at *${show}*...`);

    try {
      const { projectFolderId, url, subfolders } = await createProjectFolderTree(projectId, client, show);
      const subList = Object.keys(subfolders).map(s => `  • ${s}`).join('\n');
      const msg =
        `*Project folder created!*\n\n` +
        `📁 ${projectId}_${client}_${show}\n` +
        `${subList}\n\n` +
        `[Open in Drive](${url})`;
      await this.respond(ctx.chatId, msg);
      return { success: true, message: `Project folder: ${projectFolderId}`, confidence: 'HIGH' };
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to create project folder: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ── /newshowfolder — Create show folder + 4 subfolders ──
  // Usage: /newshowfolder Arab Health | 2026
  // Creates under /03_Events_And_Venues/

  private async newShowFolder(ctx: AgentContext): Promise<AgentResponse> {
    const parts = (ctx.args || '').split('|').map(p => p.trim());
    const showName = parts[0];
    const year = parts[1] ? parseInt(parts[1]) : undefined;

    if (!showName) {
      await this.respond(ctx.chatId, 'Usage: /newshowfolder [Show Name] | [Year]\nExample: /newshowfolder Arab Health | 2026');
      return { success: false, message: 'Missing show name', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `Creating show folder for *${showName}*...`);
    try {
      const { showFolderId, url, subfolders } = await createShowFolder(showName, year);
      const subList = Object.keys(subfolders).map(s => `  • ${s}`).join('\n');
      const msg =
        `*Show folder created!*\n\n` +
        `📁 ${showName} ${year || new Date().getFullYear()}\n${subList}\n\n` +
        `[Open in Drive](${url})`;
      await this.respond(ctx.chatId, msg);
      return { success: true, message: `Show folder: ${showFolderId}`, confidence: 'HIGH' };
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ── /newcontractorfolder — Create contractor folder + 4 subfolders ──
  // Usage: /newcontractorfolder Ahmed Al Rashidi
  // Creates under /04_Contractors/

  private async newContractorFolder(ctx: AgentContext): Promise<AgentResponse> {
    const name = (ctx.args || '').trim();
    if (!name) {
      await this.respond(ctx.chatId, 'Usage: /newcontractorfolder [Contractor Name]\nExample: /newcontractorfolder Ahmed Al Rashidi');
      return { success: false, message: 'Missing name', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `Creating contractor folder for *${name}*...`);
    try {
      const { contractorFolderId, url, subfolders } = await createContractorFolder(name);
      const subList = Object.keys(subfolders).map(s => `  • ${s}`).join('\n');
      const msg =
        `*Contractor folder created!*\n\n` +
        `📁 ${name}\n${subList}\n\n` +
        `[Open in Drive](${url})`;
      await this.respond(ctx.chatId, msg);
      return { success: true, message: `Contractor folder: ${contractorFolderId}`, confidence: 'HIGH' };
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  private async showFolderTree(ctx: AgentContext): Promise<AgentResponse> {
    await this.respond(ctx.chatId, '🗂 Scanning StandMe OS folder tree...');
    invalidateFolderCache(); // always fresh scan for this command

    const folders = await listStandMeSubfolders();

    if (folders.length === 0) {
      await this.respond(ctx.chatId, '⚠️ No subfolders found. Check that the service account has access to the StandMe OS folder.');
      return { success: false, message: 'No folders found', confidence: 'LOW' };
    }

    // Show full tree
    const treeLines = folders.map(f => `📁 ${f.path}`);

    // Show what each agent would route to
    const [briefFolder, lessonsFolder, marketingFolder] = await Promise.all([
      resolveAgentFolder(['brief', 'concept', 'proposal', 'quote', 'client', 'sales', 'design']),
      resolveAgentFolder(['lesson', 'learned', 'debrief', 'review', 'retrospective', 'post', 'project', 'archive', 'completed', 'operation']),
      resolveAgentFolder(['marketing', 'content', 'social', 'brand', 'media', 'post', 'campaign', 'communication']),
    ]);

    const routingLines = [
      `📝 *Concept Briefs (Agent 03)* → ${briefFolder.path || briefFolder.name}`,
      `📚 *Lessons Learned (Agent 11)* → ${lessonsFolder.path || lessonsFolder.name}`,
      `📣 *Marketing Content (Agent 15)* → ${marketingFolder.path || marketingFolder.name}`,
    ];

    const msg =
      `*StandMe OS Folder Tree (${folders.length} folders):*\n\n` +
      treeLines.join('\n') +
      `\n\n*Agent Routing:*\n` +
      routingLines.join('\n') +
      `\n\n_If any routing is wrong, rename the folder so it contains a matching keyword._`;

    await this.respond(ctx.chatId, msg);
    return { success: true, message: `${folders.length} folders found`, confidence: 'HIGH' };
  }

  private async shareAllFiles(ctx: AgentContext): Promise<AgentResponse> {
    const folderId = process.env.DRIVE_FOLDER_AGENTS || '19FU-EKvNdpiOjjUBWafQWVoo2YTGDZsl';
    await this.respond(ctx.chatId, `Opening all files in StandMe OS folder to "anyone with the link can edit"...`);

    let done = 0;
    let failed = 0;

    try {
      const files = await listAllFilesInFolder(folderId);
      await this.respond(ctx.chatId, `Found ${files.length} files. Applying link sharing...`);

      for (const file of files) {
        try {
          await enableLinkSharing(file.id);
          done++;
        } catch {
          failed++;
        }
      }
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to list folder: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    const summary = `Done. ${done} files are now open to edit by link.${failed > 0 ? ` (${failed} failed — check logs)` : ''}`;
    await this.respond(ctx.chatId, `✅ ${summary}`);
    return { success: true, message: summary, confidence: 'HIGH' };
  }

  private async indexDrive(ctx: AgentContext, forceReindex = false): Promise<AgentResponse> {
    await this.respond(ctx.chatId,
      forceReindex
        ? '🔄 Force re-indexing all drives (ignoring existing index)...'
        : '🔍 Building full folder tree and indexing all drives (personal + shared)...'
    );

    try {
      // 1. Build complete folder map first (one pass, used for all path resolution)
      await this.respond(ctx.chatId, '📂 Mapping folder structure...');
      const folderMap = await buildFolderMap();
      logger.info(`[Drive] Folder map built: ${folderMap.size} folders`);

      const allFiles: DriveFile[] = [];

      // 2. Personal Drive — all files, paginated
      const personalFiles = await listAllPersonalFiles();
      allFiles.push(...personalFiles);
      logger.info(`[Drive] Personal drive: ${personalFiles.length} files`);

      // 3. Shared Drives — all files in each, paginated
      const sharedDrives = await listSharedDrives();
      for (const drive of sharedDrives) {
        try {
          const driveFiles = await listSharedDriveFiles(drive.id);
          allFiles.push(...driveFiles);
          logger.info(`[Drive] Shared drive "${drive.name}": ${driveFiles.length} files`);
        } catch (err: any) {
          logger.warn(`[Drive] Could not index shared drive "${drive.name}": ${err.message}`);
        }
      }

      // Skip folders — only index actual files
      const actualFiles = allFiles.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

      // 4. Read existing index to skip already-indexed files (incremental mode)
      let alreadyIndexedIds = new Set<string>();
      if (!forceReindex) {
        try {
          const existingIndex = await readSheet(SHEETS.DRIVE_INDEX);
          // fileId is column B (index 1)
          for (const row of existingIndex.slice(1)) {
            if (row[1]) alreadyIndexedIds.add(row[1]);
          }
        } catch { /* first run — no existing index */ }
      }

      const newFiles = actualFiles.filter(f => !alreadyIndexedIds.has(f.id));
      const skipped = actualFiles.length - newFiles.length;

      await this.respond(ctx.chatId,
        `Found ${actualFiles.length} files across ${1 + sharedDrives.length} drives.\n` +
        `${skipped > 0 ? `⏭ Skipping ${skipped} already indexed. ` : ''}` +
        `Processing ${newFiles.length} new files...`
      );

      if (newFiles.length === 0) {
        const summary = `✅ Drive index up to date — all ${actualFiles.length} files already indexed.`;
        await this.respond(ctx.chatId, summary);
        return { success: true, message: summary, confidence: 'HIGH' };
      }

      // 5. Read existing leads for project matching
      const leads = await readSheet(SHEETS.LEAD_MASTER);
      const companyNames = leads.slice(1).map(r => (r[2] || '').toLowerCase()).filter(Boolean);

      let indexed = 0;
      let withContent = 0;
      let knowledgeSaved = 0;
      const indexRows: string[][] = []; // batch Sheets writes

      for (const file of newFiles) {
        try {
          const category = this.categorizeFile(file);
          const linkedProject = this.matchToProject(file, companyNames);
          // Resolve full path using pre-built folder map (no API calls per file)
          const folderPath = resolveFullPath(file.parents?.[0], folderMap);

          // Read content for docs, sheets, PDFs
          const isReadable = [
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf',
          ].includes(file.mimeType);

          if (isReadable) {
            try {
              const rawContent = await readFileContent(file);
              if (rawContent && rawContent.length > 50) {
                withContent++;

                // Extract and save knowledge to the knowledge base
                const knowledge = await this.extractKnowledge(file, rawContent, linkedProject, folderPath);
                if (knowledge) {
                  await saveKnowledge(knowledge);
                  knowledgeSaved++;
                }
              }
            } catch { /* content read failed, continue */ }
          } else {
            // Even for non-readable files (images, videos, folders, CAD files, etc.)
            // we can still save metadata knowledge based on filename + folder context
            const metaKnowledge = this.extractMetadataKnowledge(file, linkedProject, folderPath, category);
            if (metaKnowledge) {
              await saveKnowledge(metaKnowledge);
              knowledgeSaved++;
            }
          }

          // Collect row for batch write
          indexRows.push(objectToRow(SHEETS.DRIVE_INDEX, {
            fileName: file.name,
            fileId: file.id,
            fileUrl: file.webViewLink,
            folderPath,
            parentFolder: file.parents?.[0] || file.driveId || '',
            fileType: this.friendlyType(file.mimeType),
            lastModified: file.modifiedTime,
            linkedProject: linkedProject || '',
            category,
          }));

          indexed++;

          // Progress update every 20 files
          if (indexed % 20 === 0) {
            await this.respond(ctx.chatId, `⏳ Progress: ${indexed}/${newFiles.length} files processed...`);
          }
        } catch (err: any) {
          logger.warn(`[Drive] Failed to index "${file.name}": ${err.message}`);
        }
      }

      // Single batch write to Sheets (replaces N individual appendRow calls)
      if (indexRows.length > 0) {
        await appendRows(SHEETS.DRIVE_INDEX, indexRows);
      }

      const summary = `✅ Indexed ${indexed} new files (${withContent} with content, ${knowledgeSaved} knowledge entries). ${skipped > 0 ? `${skipped} already indexed, skipped.` : ''} Drives: ${1 + sharedDrives.length}, folders mapped: ${folderMap.size}.`;
      await sendToMo(formatType2('Drive Index Complete', summary));
      await this.respond(ctx.chatId, summary);

      return { success: true, message: summary, confidence: 'HIGH' };

    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to index Drive: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ---- Extract structured knowledge from readable file content ----

  private async extractKnowledge(
    file: DriveFile,
    rawContent: string,
    linkedProject: string | null,
    folderPath: string
  ): Promise<{ source: string; sourceType: string; topic: string; tags: string; content: string } | null> {
    try {
      const extracted = await generateText(
        `File: "${file.name}" (in folder: ${folderPath})\n\nContent:\n${rawContent.slice(0, 4000)}\n\n` +
        `Extract the most important business knowledge from this file. Return a JSON object with:\n` +
        `- topic: the main entity (company name, show name, project name, or "general")\n` +
        `- tags: 3-6 comma-separated keywords\n` +
        `- content: 1-3 sentence summary of the key facts, decisions, or actionable info (max 400 chars)\n` +
        `\nReturn ONLY valid JSON, no other text.`,
        'You extract structured business knowledge from documents. Return only valid JSON.',
        200
      );

      const parsed = JSON.parse(extracted);
      if (!parsed.content) return null;

      return {
        source: file.webViewLink || file.name,
        sourceType: 'drive',
        topic: parsed.topic || linkedProject || 'general',
        tags: parsed.tags || '',
        content: String(parsed.content).slice(0, 500),
      };
    } catch {
      // If AI extraction fails, save a basic entry with the filename + category
      return {
        source: file.webViewLink || file.name,
        sourceType: 'drive',
        topic: linkedProject || 'general',
        tags: `${this.categorizeFile(file)}, ${this.friendlyType(file.mimeType)}`,
        content: `File "${file.name}" in ${folderPath} — ${this.categorizeFile(file)} document.`,
      };
    }
  }

  // ---- Extract metadata knowledge from non-readable files (images, CAD, video, etc.) ----

  private extractMetadataKnowledge(
    file: DriveFile,
    linkedProject: string | null,
    folderPath: string,
    category: string
  ): { source: string; sourceType: string; topic: string; tags: string; content: string } | null {
    // Only save if there's something meaningful to know
    if (file.mimeType === 'application/vnd.google-apps.folder') return null; // skip folders

    const mime = file.mimeType.toLowerCase();
    const name = file.name.toLowerCase();

    let typeLabel = this.friendlyType(file.mimeType);
    let extraContext = '';

    if (mime.includes('image')) {
      extraContext = 'Visual asset — may be a stand photo, render, design, or site image.';
    } else if (mime.includes('video')) {
      extraContext = 'Video file — may be a project walkthrough, site recording, or stand tour.';
    } else if (name.includes('.skp') || name.includes('3d') || name.includes('cad')) {
      extraContext = '3D/CAD design file — stand design model.';
    } else if (name.includes('.zip') || name.includes('.rar')) {
      extraContext = 'Archive file — may contain project assets.';
    } else {
      // Not interesting enough to save
      if (!linkedProject && category === 'Other') return null;
    }

    return {
      source: file.webViewLink || file.name,
      sourceType: 'drive',
      topic: linkedProject || category,
      tags: `${category}, ${typeLabel}, ${folderPath}`,
      content: `${typeLabel} file "${file.name}" in ${folderPath}. Modified: ${file.modifiedTime?.split('T')[0] || '?'}. ${extraContext}`.slice(0, 500),
    };
  }

  // ---- /findfile command ----

  private async findFile(ctx: AgentContext): Promise<AgentResponse> {
    const query = ctx.args.trim();
    if (!query) {
      await this.respond(ctx.chatId, 'Usage: /findfile [search term]');
      return { success: false, message: 'No query', confidence: 'LOW' };
    }

    // Search index first (fast)
    const index = await readSheet(SHEETS.DRIVE_INDEX);
    const matches = index.slice(1).filter(r =>
      r.some(cell => cell?.toLowerCase().includes(query.toLowerCase()))
    ).slice(0, 8);

    // Also search Drive directly for fresh results
    let liveMatches: DriveFile[] = [];
    try {
      liveMatches = await searchFiles(query);
    } catch { /* silent */ }

    if (matches.length === 0 && liveMatches.length === 0) {
      await this.respond(ctx.chatId, `No files found matching "${query}".`);
      return { success: true, message: 'No matches', confidence: 'HIGH' };
    }

    let response = `*Files matching "${query}":*\n\n`;

    if (matches.length > 0) {
      response += matches.map(r =>
        `📄 *${r[0] || '?'}*\n   Type: ${r[5] || '?'} | ${r[7] ? `Project: ${r[7]}` : 'Unlinked'}\n   ${r[2] || 'No URL'}`
      ).join('\n\n');
    }

    if (liveMatches.length > 0 && matches.length === 0) {
      response += liveMatches.map(f =>
        `📄 *${f.name}*\n   ${f.webViewLink}`
      ).join('\n\n');
      response += '\n\n_Run /indexdrive to cache these for faster future searches._';
    }

    await this.respond(ctx.chatId, response);
    return { success: true, message: `${matches.length + liveMatches.length} files found`, confidence: 'HIGH' };
  }

  // ---- /readfile command ----

  private async readFile(ctx: AgentContext): Promise<AgentResponse> {
    const query = ctx.args.trim();
    if (!query) {
      await this.respond(ctx.chatId, 'Usage: /readfile [file name or search term]');
      return { success: false, message: 'No query', confidence: 'LOW' };
    }

    await this.respond(ctx.chatId, `Reading "${query}"...`);

    try {
      const files = await searchFiles(query);
      if (files.length === 0) {
        await this.respond(ctx.chatId, `No file found matching "${query}".`);
        return { success: true, message: 'Not found', confidence: 'HIGH' };
      }

      const file = files[0];
      const content = await readFileContent(file);

      if (!content) {
        await this.respond(ctx.chatId, `*${file.name}*\n\nCan't read content (binary or unsupported format).\n${file.webViewLink}`);
        return { success: true, message: 'Unreadable', confidence: 'MEDIUM' };
      }

      const summary = await generateText(
        `File: "${file.name}"\n\nContent:\n${content.slice(0, 6000)}\n\nProvide a clear, detailed summary of what this document contains and its key information.`,
        'You are StandMe Brain reading a business document. Extract the key facts, decisions, and actionable info.',
        800
      );

      // Save this reading to the knowledge base
      const knowledge = await this.extractKnowledge(file, content, null, '');
      if (knowledge) await saveKnowledge(knowledge);

      await this.respond(ctx.chatId, `📄 *${file.name}*\n${file.webViewLink}\n\n${summary}`);
      return { success: true, message: `Read ${file.name}`, confidence: 'HIGH' };

    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to read file: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ---- /knowledge command — query the knowledge base ----

  private async queryKnowledge(ctx: AgentContext): Promise<AgentResponse> {
    const query = ctx.args.trim();
    if (!query) {
      await this.respond(ctx.chatId, 'Usage: /knowledge [search term]\n\nSearches the knowledge base built from all Drive files, Trello, and other sources.');
      return { success: false, message: 'No query', confidence: 'LOW' };
    }

    const entries = await searchKnowledge(query, 10);

    if (entries.length === 0) {
      await this.respond(ctx.chatId, `No knowledge found for "${query}". Run /indexdrive to build the knowledge base.`);
      return { success: true, message: 'No results', confidence: 'HIGH' };
    }

    let response = `*Knowledge base results for "${query}":*\n\n`;
    response += entries.map(e =>
      `🧠 *${e.topic}* [${e.sourceType}]\n${e.content}\n_Tags: ${e.tags}_`
    ).join('\n\n');

    await this.respond(ctx.chatId, response);
    return { success: true, message: `${entries.length} knowledge entries found`, confidence: 'HIGH' };
  }

  // ---- Helpers ----

  private categorizeFile(file: DriveFile): string {
    const name = file.name.toLowerCase();
    const mime = file.mimeType.toLowerCase();

    if (name.includes('brief') || name.includes('concept')) return 'Brief';
    if (name.includes('proposal') || name.includes('quote') || name.includes('offer')) return 'Proposal';
    if (name.includes('contract') || name.includes('agreement')) return 'Contract';
    if (name.includes('contractor') || name.includes('supplier')) return 'Contractor';
    if (name.includes('lesson') || name.includes('review') || name.includes('debrief')) return 'Lessons Learned';
    if (name.includes('design') || name.includes('render') || name.includes('3d')) return 'Design';
    if (name.includes('invoice') || name.includes('payment') || name.includes('finance')) return 'Finance';
    if (name.includes('photo') || name.includes('image') || name.includes('stand')) return 'Portfolio';
    if (name.includes('manual') || name.includes('guide') || name.includes('info')) return 'Organiser Info';
    if (mime.includes('pdf')) return 'PDF Document';
    if (mime.includes('spreadsheet') || mime.includes('excel')) return 'Spreadsheet';
    return 'Other';
  }

  private friendlyType(mimeType: string): string {
    const map: Record<string, string> = {
      'application/vnd.google-apps.document': 'Google Doc',
      'application/vnd.google-apps.spreadsheet': 'Google Sheet',
      'application/vnd.google-apps.presentation': 'Google Slides',
      'application/vnd.google-apps.folder': 'Folder',
      'application/pdf': 'PDF',
      'image/jpeg': 'Image',
      'image/png': 'Image',
    };
    return map[mimeType] || mimeType.split('/').pop() || 'File';
  }

  private matchToProject(file: DriveFile, companyNames: string[]): string | null {
    const fileName = file.name.toLowerCase();
    for (const company of companyNames) {
      if (company && company.length > 2 && fileName.includes(company)) {
        return company;
      }
    }
    return null;
  }
}
