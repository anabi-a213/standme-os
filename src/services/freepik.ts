import axios from 'axios';
import { logger } from '../utils/logger';

const BASE = 'https://api.freepik.com/v1/ai';
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 30;

export function isFreepikConfigured(): boolean {
  return !!process.env.FREEPIK_API_KEY;
}

function headers(): Record<string, string> {
  const key = process.env.FREEPIK_API_KEY;
  if (!key) throw new Error('FREEPIK_API_KEY is not set in environment variables.');
  return { 'x-freepik-api-key': key, 'Content-Type': 'application/json' };
}

const MYSTIC_POLL_INTERVAL_MS = 5000;
const MYSTIC_MAX_POLLS = 24; // 120s

/**
 * Generate a single master image from a text prompt using the Mystic API.
 * Mystic is async: submit → poll until COMPLETED → extract CDN URL.
 * Returns:
 *   base64  — always empty string (Mystic returns a URL, not base64)
 *   cdnUrl  — Freepik CDN URL of the generated image (passed to changeCameraAngle)
 *   seed    — always undefined (Mystic does not expose a seed)
 */
export async function generateMasterImage(
  prompt: string,
): Promise<{ base64: string; cdnUrl: string; seed: number | undefined }> {
  // Submit to Mystic
  let submitResp: any;
  try {
    submitResp = await axios.post(
      `${BASE}/mystic`,
      {
        prompt,
        resolution: '2k',
        aspect_ratio: 'widescreen_16_9',
        model: 'realism',
        hdr: 60,
        creative_detailing: 40,
        filter_nsfw: true,
      },
      { headers: headers(), timeout: 60_000 },
    );
  } catch (err: any) {
    const detail = err.response
      ? JSON.stringify(err.response.data).slice(0, 800)
      : err.message;
    logger.error(`[Freepik] Mystic submit HTTP ${err.response?.status ?? '?'}: ${detail}`);
    throw new Error(`Freepik Mystic submit failed (${err.response?.status ?? 'network'}): ${detail}`);
  }

  const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id ?? '';
  if (!taskId) {
    throw new Error(`Freepik Mystic: no task_id returned. Response: ${JSON.stringify(submitResp.data).slice(0, 500)}`);
  }
  logger.info(`[Freepik] Mystic task submitted: ${taskId}`);

  // Poll until COMPLETED
  for (let poll = 0; poll < MYSTIC_MAX_POLLS; poll++) {
    await new Promise(r => setTimeout(r, MYSTIC_POLL_INTERVAL_MS));

    const pollResp = await axios.get(
      `${BASE}/mystic/${taskId}`,
      { headers: headers(), timeout: 15_000 },
    );

    const status: string = pollResp.data?.data?.status ?? pollResp.data?.status ?? '';
    logger.info(`[Freepik] Mystic task ${taskId} poll ${poll + 1}/${MYSTIC_MAX_POLLS}: ${status}`);

    if (status === 'COMPLETED') {
      // Dump full response so we can verify the real shape in Railway logs
      logger.info(`[Freepik] Mystic COMPLETED response: ${JSON.stringify(pollResp.data).slice(0, 1500)}`);

      const d = pollResp.data?.data;
      // Mystic returns generated as an array of strings: ["https://..."]
      // Other Freepik endpoints return objects: [{url:"..."}]
      // Handle both formats.
      const gen0: any = d?.generated?.[0];
      const rawUrl: string =
        (typeof gen0 === 'string' ? gen0 : gen0?.url as string | undefined) ??
        pollResp.data?.generated?.[0]?.url ??
        d?.images?.[0]?.url ??
        d?.url ??
        '';

      if (!rawUrl) {
        throw new Error(`Freepik Mystic task ${taskId} completed but returned no URL.`);
      }

      // Freepik change-camera rejects HTTP URLs — always upgrade to HTTPS
      const cdnUrl = rawUrl.replace(/^http:\/\//i, 'https://');
      logger.info(`[Freepik] Mystic master image ready — CDN URL: ${cdnUrl.slice(0, 80)}`);
      return { base64: '', cdnUrl, seed: undefined };
    }

    if (status === 'FAILED') {
      const detail = JSON.stringify(pollResp.data).slice(0, 500);
      logger.error(`[Freepik] Mystic task ${taskId} FAILED: ${detail}`);
      throw new Error(`Freepik Mystic task ${taskId} failed: ${detail}`);
    }
    // PENDING / IN_PROGRESS — keep polling
  }

  throw new Error(
    `Freepik Mystic task ${taskId} timed out after ${MYSTIC_MAX_POLLS * MYSTIC_POLL_INTERVAL_MS / 1000}s.`,
  );
}

/**
 * Submit a change-camera request, then poll until COMPLETED.
 *
 * imageData priority (caller should pass the best available):
 *   1. Freepik CDN URL (cdnUrl from generateMasterImage) — always works
 *   2. Any other public HTTPS URL
 *   3. Raw base64 string (no data URI prefix — Freepik rejects data: URIs)
 *
 * Returns the Freepik CDN URL of the angle-shifted image.
 */
export async function changeCameraAngle(
  imageData: string,
  horizontalAngle: number,
  verticalAngle: number,
  zoom: number,
  seed?: number,
): Promise<{ url: string }> {
  // Pass base64 as raw string — do NOT wrap in data:image/jpeg;base64,
  // URLs must be HTTPS — Freepik rejects HTTP URLs with 400.
  const imageField = imageData.startsWith('http://')
    ? imageData.replace(/^http:\/\//i, 'https://')
    : imageData;

  logger.info(
    `[Freepik] Submitting change-camera (h=${horizontalAngle} v=${verticalAngle} z=${zoom}) ` +
    `via ${imageData.startsWith('http') ? 'URL' : 'base64'}`
  );

  // Freepik requires seed >= 1. Use the master seed for visual consistency across
  // angles; generate a cryptographically random valid seed when unavailable or invalid.
  const effectiveSeed: number = (typeof seed === 'number' && seed >= 1)
    ? seed
    : Math.floor(Math.random() * 999998) + 1;

  logger.info(`[Freepik] Using seed ${effectiveSeed} (${typeof seed === 'number' && seed >= 1 ? 'from master' : 'generated'})`);

  // Submit — capture Freepik's error body on failure for real diagnostics
  let submitResp: any;
  try {
    submitResp = await axios.post(
      `${BASE}/image-change-camera`,
      {
        image: imageField,
        horizontal_angle: horizontalAngle,
        vertical_angle: verticalAngle,
        zoom,
        seed: effectiveSeed,
      },
      { headers: headers(), timeout: 30_000 },
    );
  } catch (err: any) {
    const detail = err.response
      ? JSON.stringify(err.response.data).slice(0, 800)
      : err.message;
    logger.error(`[Freepik] change-camera submit HTTP ${err.response?.status ?? '?'}: ${detail}`);
    throw new Error(`Freepik change-camera submit failed (${err.response?.status ?? 'network'}): ${detail}`);
  }

  const taskId: string = submitResp.data?.data?.task_id ?? '';
  if (!taskId) {
    throw new Error('Freepik change-camera: no task_id returned from submit call.');
  }

  logger.info(`[Freepik] change-camera task submitted: ${taskId} (h=${horizontalAngle} v=${verticalAngle} z=${zoom})`);

  // Poll
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const pollResp = await axios.get(
      `${BASE}/image-change-camera/${taskId}`,
      { headers: headers(), timeout: 15_000 },
    );

    const status: string = pollResp.data?.data?.status ?? '';
    logger.info(`[Freepik] task ${taskId} poll ${poll + 1}/${MAX_POLLS}: ${status}`);

    if (status === 'COMPLETED') {
      // Dump full response once so we can see the real shape in production logs
      logger.info(`[Freepik] COMPLETED response: ${JSON.stringify(pollResp.data).slice(0, 1500)}`);

      // Defensive fallback chain — Freepik has changed the response shape across API versions
      const d = pollResp.data?.data;
      const url: string =
        d?.generated?.[0]?.url       ??
        d?.images?.[0]?.url          ??
        d?.output?.[0]?.url          ??
        d?.result?.url               ??
        d?.url                       ??
        pollResp.data?.generated?.[0]?.url ??
        '';
      if (!url) throw new Error(`Freepik change-camera task ${taskId} completed but returned no URL.`);
      return { url };
    }

    if (status === 'FAILED') {
      const detail = JSON.stringify(pollResp.data).slice(0, 500);
      logger.error(`[Freepik] Task ${taskId} FAILED: ${detail}`);
      throw new Error(`Freepik task ${taskId} failed: ${detail}`);
    }
    // PENDING / IN_PROGRESS — keep polling
  }

  throw new Error(
    `Freepik change-camera task ${taskId} timed out after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s.`,
  );
}
