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
 * Returns the base64-encoded JPEG and the seed used (pass seed to
 * changeCameraAngle for consistent lighting across all angles).
 */
export async function generateMasterImage(
  prompt: string,
): Promise<{ base64: string; seed: number }> {
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
  const base64: string = data?.[0]?.base64 ?? data?.[0]?.url ?? '';
  if (!base64) {
    throw new Error('Freepik text-to-image returned no image data. Check your API plan limits.');
  }

  const seed: number = resp.data?.meta?.seed ?? 0;
  logger.info(`[Freepik] Master image generated (seed: ${seed})`);
  return { base64, seed };
}

/**
 * Submit a change-camera request, then poll until COMPLETED.
 * imageUrl must be a public HTTPS URL (NOT base64).
 * Returns the public URL of the angle-shifted image.
 */
export async function changeCameraAngle(
  imageUrl: string,
  horizontalAngle: number,
  verticalAngle: number,
  zoom: number,
  seed?: number,
): Promise<{ url: string }> {
  logger.info(`[Freepik] Submitting change-camera for: ${imageUrl}`);

  // Submit
  const submitResp = await axios.post(
    `${BASE}/image-change-camera`,
    {
      image: imageUrl,
      horizontal_angle: horizontalAngle,
      vertical_angle: verticalAngle,
      zoom,
      output_format: 'jpeg',
      ...(seed !== undefined ? { seed } : {}),
    },
    { headers: headers(), timeout: 30_000 },
  );

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
