import axios from 'axios';
import { logger } from '../utils/logger';

const BASE = 'https://api.freepik.com/v1/ai';
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 15;

export function isFreepikConfigured(): boolean {
  return !!process.env.FREEPIK_API_KEY;
}

function headers(): Record<string, string> {
  const key = process.env.FREEPIK_API_KEY;
  if (!key) throw new Error('FREEPIK_API_KEY is not set in environment variables.');
  return { 'x-freepik-api-key': key, 'Content-Type': 'application/json' };
}

/**
 * Generate a single master image from a text prompt.
 * Returns:
 *   base64  — raw base64 JPEG (for Drive upload)
 *   cdnUrl  — Freepik CDN URL if the API returned one (preferred input for changeCameraAngle)
 *   seed    — pass to changeCameraAngle for consistent lighting
 */
export async function generateMasterImage(
  prompt: string,
): Promise<{ base64: string; cdnUrl: string; seed: number | undefined }> {
  const resp = await axios.post(
    `${BASE}/text-to-image`,
    {
      prompt,
      num_images: 1,
      image: { size: 'landscape_4_3' },
      styling: { style: 'photo' },
    },
    { headers: headers(), timeout: 60_000 },
  );

  const data = resp.data?.data;
  const base64: string  = data?.[0]?.base64 ?? '';
  const cdnUrl: string  = data?.[0]?.url    ?? '';

  if (!base64 && !cdnUrl) {
    throw new Error('Freepik text-to-image returned no image data. Check your API plan limits.');
  }

  // Only pass seed when it's a valid value — change-camera requires seed >= 1
  const rawSeed = resp.data?.meta?.seed;
  const seed: number | undefined = (typeof rawSeed === 'number' && rawSeed >= 1) ? rawSeed : undefined;
  logger.info(`[Freepik] Master image generated (seed: ${seed ?? 'none'}) — CDN URL: ${cdnUrl ? 'yes' : 'no'}`);
  return { base64, cdnUrl, seed };
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
  // Pass URLs as-is. Pass base64 as raw string — do NOT wrap in data:image/jpeg;base64,
  // Freepik's API rejects the data URI format and returns HTTP 400.
  const imageField = imageData; // URL or raw base64, both sent directly

  logger.info(
    `[Freepik] Submitting change-camera (h=${horizontalAngle} v=${verticalAngle} z=${zoom}) ` +
    `via ${imageData.startsWith('http') ? 'URL' : 'base64'}`
  );

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
        ...(seed !== undefined && seed >= 1 ? { seed } : {}),
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
      const url: string = pollResp.data?.data?.generated?.[0]?.url ?? '';
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
