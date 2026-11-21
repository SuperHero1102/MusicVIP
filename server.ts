import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import yts from 'yt-search';
import { Innertube, Log, Platform } from 'youtubei.js';
import { JSDOM } from 'jsdom';
import { BotGuardClient, getChallenge } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, getHeaders } from 'bgutils-js/utils';

Log.setLevel(Log.Level.NONE);

Platform.shim.eval = async (data, env) => {
  const props: string[] = [];
  if (env.n) props.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (env.sig) props.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  if (props.length === 0) return {};
  return new Function(`${data.output}\nreturn { ${props.join(', ')} };`)() as Record<string, unknown>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface TrackDTO {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSeconds: number;
  durationText: string;
  viewsText: string;
  publishedText: string;
}

interface StreamDescriptor {
  url: string;
  mimeType: string;
  quality?: string;
  contentLength?: number;
  source: string;
}

interface CachedMediaBundle {
  audio: StreamDescriptor | null;
  video: StreamDescriptor | null;
  botCheckBlocked: boolean;
  expiresAt: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const searchCache = new Map<string, CacheEntry<TrackDTO[]>>();
const mediaBundleCache = new Map<string, CachedMediaBundle>();
const inflightBundles = new Map<string, Promise<CachedMediaBundle>>();
const sponsorCache = new Map<
  string,
  CacheEntry<Array<{ uuid: string; category: string; start: number; end: number }>>
>();

interface BufferedMediaEntry {
  buffer: Buffer;
  mimeType: string;
  lastAccessed: number;
}
const MAX_BUFFERED_TRACK_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BUFFERED_BYTES = 100 * 1024 * 1024;
const mediaDataCache = new Map<string, BufferedMediaEntry>();
const mediaWarmingPromises = new Map<string, Promise<void>>();

function evictMediaDataCacheIfNeeded(incomingBytes: number): void {
  let total = incomingBytes;
  for (const entry of mediaDataCache.values()) {
    total += entry.buffer.byteLength;
  }
  if (total <= MAX_TOTAL_BUFFERED_BYTES) return;
  const sorted = Array.from(mediaDataCache.entries()).sort(
    (a, b) => a[1].lastAccessed - b[1].lastAccessed
  );
  for (const [key, entry] of sorted) {
    if (total <= MAX_TOTAL_BUFFERED_BYTES) break;
    mediaDataCache.delete(key);
    total -= entry.buffer.byteLength;
  }
}

function warmFullMediaBuffer(
  cacheKey: string,
  descriptor: StreamDescriptor
): void {
  if (mediaDataCache.has(cacheKey) || mediaWarmingPromises.has(cacheKey)) return;
  if (descriptor.contentLength && descriptor.contentLength > MAX_BUFFERED_TRACK_BYTES) return;

  const task = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      let resp = await fetch(descriptor.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        },
        signal: ctrl.signal,
      });
      if (resp.status === 403) {
        resp = await fetch(descriptor.url, { signal: ctrl.signal });
      }
      if (!resp.ok || !resp.body) return;
      const declaredLen = Number(resp.headers.get('content-length') || '0');
      if (declaredLen > MAX_BUFFERED_TRACK_BYTES) {
        void resp.body.cancel().catch(() => {});
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const reader = resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_BUFFERED_TRACK_BYTES) {
          void reader.cancel().catch(() => {});
          return;
        }
        chunks.push(Buffer.from(value));
      }
      if (totalBytes === 0) return;

      const fullBuffer = Buffer.concat(chunks, totalBytes);
      evictMediaDataCacheIfNeeded(fullBuffer.byteLength);
      mediaDataCache.set(cacheKey, {
        buffer: fullBuffer,
        mimeType: resp.headers.get('content-type') || descriptor.mimeType || 'audio/mp4',
        lastAccessed: Date.now(),
      });
    } catch {
      // Background warm-up failure is harmless; Range proxy handles live requests
    } finally {
      clearTimeout(timer);
      mediaWarmingPromises.delete(cacheKey);
    }
  })();

  mediaWarmingPromises.set(cacheKey, task);
}

const WEBPO_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

interface PoMinterEntry {
  minter: WebPoMinter;
  expiresAt: number;
}

let poDom: JSDOM | null = null;
let poMinterEntry: PoMinterEntry | null = null;
let poMinterPromise: Promise<PoMinterEntry | null> | null = null;

async function getPoMinter(): Promise<WebPoMinter | null> {
  if (poMinterEntry && poMinterEntry.expiresAt > Date.now()) {
    return poMinterEntry.minter;
  }
  if (poMinterPromise) {
    const res = await poMinterPromise;
    return res?.minter ?? null;
  }

  poMinterPromise = (async () => {
    try {
      if (!poDom) {
        poDom = new JSDOM('<!doctype html><html><body></body></html>', {
          url: 'https://www.youtube.com/',
        });
      }
      const g = globalThis as Record<string, unknown>;
      if (!g.window) g.window = poDom.window;
      if (!g.document) g.document = poDom.window.document;

      const challenge = await getChallenge({
        requestKey: WEBPO_REQUEST_KEY,
        fetchFunction: fetch,
        useYouTubeAPI: true,
      });

      let scriptTxt =
        challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
      if (!scriptTxt && challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue) {
        const rawUrl =
          challenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
        const fullUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
        const scriptResp = await fetch(fullUrl);
        if (scriptResp.ok) {
          scriptTxt = await scriptResp.text();
        }
      }
      if (!scriptTxt || !challenge.program || !challenge.globalName) {
        return null;
      }

      // Execute interpreter in Node global realm so WebPoMinter callback passes instanceof Function
      new Function(scriptTxt)();

      const bgClient = await BotGuardClient.create({
        globalName: challenge.globalName,
        globalObject: globalThis,
        program: challenge.program,
      });

      const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
      const bgResponse = await bgClient.snapshot({ webPoSignalOutput });

      const itResp = await fetch(buildURL('GenerateIT', true), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify([WEBPO_REQUEST_KEY, bgResponse]),
      });
      if (!itResp.ok) {
        return null;
      }

      const itJson = (await itResp.json()) as [string?, number?, number?, string?];
      const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] =
        itJson;
      if (!integrityToken) {
        return null;
      }

      const minter = await WebPoMinter.create(
        {
          integrityToken,
          estimatedTtlSecs,
          mintRefreshThreshold,
          websafeFallbackToken,
        },
        webPoSignalOutput
      );

      const ttlSecs = Math.max(120, Math.min(21_600, (estimatedTtlSecs || 3600) - 120));
      const entry: PoMinterEntry = {
        minter,
        expiresAt: Date.now() + ttlSecs * 1000,
      };
      poMinterEntry = entry;
      return entry;
    } catch (err) {
      console.warn('[media] PoToken minter init skipped:', (err as Error).message);
      return null;
    } finally {
      poMinterPromise = null;
    }
  })();

  const res = await poMinterPromise;
  return res?.minter ?? null;
}

async function mintVideoPoToken(videoId: string): Promise<string | undefined> {
  if (process.env.YOUTUBE_PO_TOKEN) {
    return process.env.YOUTUBE_PO_TOKEN;
  }
  try {
    const minter = await Promise.race([
      getPoMinter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2600)),
    ]);
    if (!minter) return undefined;
    return await minter.mintAsWebsafeString(videoId);
  } catch {
    return undefined;
  }
}

let innertubePromise: Promise<Innertube> | null = null;
function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({
      retrieve_player: true,
      cookie: process.env.YOUTUBE_COOKIE || undefined,
      po_token: process.env.YOUTUBE_PO_TOKEN || undefined,
      visitor_data: process.env.YOUTUBE_VISITOR_DATA || undefined,
    }).catch((err) => {
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

// Pre-warm Innertube session + PoToken minter on server boot so first track resolves fast
void getInnertube().catch(() => {});
void getPoMinter().catch(() => {});

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatViews(views?: number | string): string {
  const num = typeof views === 'string' ? parseInt(views.replace(/\D/g, ''), 10) : views;
  if (!num || Number.isNaN(num)) return '';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B lượt xem`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}Tr lượt xem`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}N lượt xem`;
  return `${num} lượt xem`;
}

function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    // Not a URL
  }
  return null;
}

const DISCOVER_QUERIES: Record<string, string> = {
  trending: 'nhac tre viet nam hot 2025 official mv',
  lofi: 'lofi hip hop chill beats study music',
  acoustic: 'nhac acoustic viet nam nhe nhang thu gian',
  podcast: 'podcast tieng viet phat trien ban than',
  focus: 'deep focus ambient instrumental music work',
  chill: 'nhac chill indie viet nam tuyen chon',
};

async function searchYouTubeTracks(query: string): Promise<TrackDTO[]> {
  const key = query.trim().toLowerCase();
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const directId = extractYouTubeId(query);
  if (directId) {
    try {
      const v = await yts({ videoId: directId });
      if (v && v.videoId) {
        const track: TrackDTO = {
          id: v.videoId,
          title: v.title || 'Video YouTube',
          author: v.author?.name || 'Kênh YouTube',
          thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          durationSeconds: v.seconds || 0,
          durationText: v.timestamp || formatDuration(v.seconds || 0),
          viewsText: formatViews(v.views),
          publishedText: v.ago || '',
        };
        searchCache.set(key, { data: [track], expiresAt: Date.now() + 10 * 60_000 });
        return [track];
      }
    } catch {
      // Fall through to standard search
    }
  }

  try {
    const result = await yts(query);
    const tracks: TrackDTO[] = (result.videos || [])
      .filter((v) => v.videoId && v.seconds > 0)
      .slice(0, 20)
      .map((v) => ({
        id: v.videoId,
        title: v.title,
        author: v.author?.name || 'YouTube',
        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        durationSeconds: v.seconds || 0,
        durationText: v.timestamp || formatDuration(v.seconds || 0),
        viewsText: formatViews(v.views),
        publishedText: v.ago || '',
      }));

    if (tracks.length > 0) {
      searchCache.set(key, { data: tracks, expiresAt: Date.now() + 10 * 60_000 });
      return tracks;
    }
  } catch {
    // Fall back to youtubei.js
  }

  const yt = await getInnertube();
  const res = await yt.search(query, { type: 'video' });
  const tracks: TrackDTO[] = [];
  for (const item of res.videos || []) {
    const anyItem = item as unknown as Record<string, unknown>;
    const id = typeof anyItem.id === 'string' ? anyItem.id : '';
    if (!id) continue;
    const titleObj = anyItem.title as { toString?: () => string } | undefined;
    const authorObj = anyItem.author as { name?: string } | undefined;
    const durObj = anyItem.duration as { seconds?: number; text?: string } | undefined;
    const thumbs = anyItem.thumbnails as Array<{ url: string }> | undefined;
    tracks.push({
      id,
      title: titleObj?.toString?.() || 'YouTube Audio',
      author: authorObj?.name || 'YouTube',
      thumbnail: thumbs?.[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      durationSeconds: durObj?.seconds || 0,
      durationText: durObj?.text || formatDuration(durObj?.seconds || 0),
      viewsText: '',
      publishedText: '',
    });
    if (tracks.length >= 20) break;
  }
  if (tracks.length > 0) {
    searchCache.set(key, { data: tracks, expiresAt: Date.now() + 10 * 60_000 });
  }
  return tracks;
}

type InnertubeClientName = NonNullable<
  NonNullable<Parameters<Innertube['getBasicInfo']>[1]>['client']
>;

async function resolveFormatUrl(
  format: {
    url?: string;
    signature_cipher?: string;
    cipher?: string;
    decipher?: (player?: Innertube['session']['player']) => Promise<string>;
  },
  yt: Innertube
): Promise<string | null> {
  if (format.url) return format.url;
  if ((format.signature_cipher || format.cipher) && typeof format.decipher === 'function' && yt.session.player) {
    try {
      const deciphered = await format.decipher(yt.session.player);
      return deciphered || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function verifyStreamUrl(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: ctrl.signal,
    });
    if (resp.body) {
      void resp.body.cancel().catch(() => {});
    }
    return resp.status === 200 || resp.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function extractFromClients(
  yt: Innertube,
  videoId: string,
  clients: InnertubeClientName[],
  poToken?: string
): Promise<{
  audio: StreamDescriptor | null;
  video: StreamDescriptor | null;
  botCheckBlocked: boolean;
}> {
  let audio: StreamDescriptor | null = null;
  let video: StreamDescriptor | null = null;
  let botCheckBlocked = false;

  const settled = await Promise.allSettled(
    clients.map(async (client) => {
      const info = await Promise.race([
        yt.getBasicInfo(videoId, {
          client,
          ...(poToken ? { po_token: poToken } : {}),
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2600)),
      ]);
      return { client, info };
    })
  );

  const audioCandidates: Array<{ urlPromise: Promise<string | null>; mime: string; contentLength?: number; client: string }> = [];
  const videoCandidates: Array<{ urlPromise: Promise<string | null>; mime: string; quality: string; contentLength?: number; client: string }> = [];

  for (const res of settled) {
    if (res.status !== 'fulfilled') continue;
    const { client, info } = res.value;
    const status = info.playability_status?.status;
    if (status === 'LOGIN_REQUIRED') {
      botCheckBlocked = true;
    }

    if (audioCandidates.length < 3) {
      const adaptive = (info.streaming_data?.adaptive_formats || [])
        .filter((f) => f.has_audio && !f.has_video && (f.url || f.signature_cipher || f.cipher))
        .sort((a, b) => {
          const aMp4 = a.mime_type?.includes('audio/mp4') ? 1 : 0;
          const bMp4 = b.mime_type?.includes('audio/mp4') ? 1 : 0;
          if (aMp4 !== bMp4) return bMp4 - aMp4;
          return (b.bitrate || 0) - (a.bitrate || 0);
        });

      for (const candidate of adaptive.slice(0, 2)) {
        const mime = (candidate.mime_type || '').split(';')[0];
        if (!mime.includes('mp4')) continue;
        audioCandidates.push({
          urlPromise: resolveFormatUrl(candidate, yt),
          mime: mime || 'audio/mp4',
          contentLength: candidate.content_length ? Number(candidate.content_length) : undefined,
          client: client.toLowerCase(),
        });
      }
    }

    if (videoCandidates.length < 3) {
      const muxed = (info.streaming_data?.formats || [])
        .filter((f) => f.has_video && f.has_audio && (f.url || f.signature_cipher || f.cipher))
        .sort((a, b) => {
          const aMp4 = a.mime_type?.includes('video/mp4') ? 1 : 0;
          const bMp4 = b.mime_type?.includes('video/mp4') ? 1 : 0;
          if (aMp4 !== bMp4) return bMp4 - aMp4;
          return (b.height || 0) - (a.height || 0);
        });

      for (const candidate of muxed.slice(0, 2)) {
        videoCandidates.push({
          urlPromise: resolveFormatUrl(candidate, yt),
          mime: (candidate.mime_type || 'video/mp4').split(';')[0],
          quality: candidate.quality_label || `${candidate.height || 360}p`,
          contentLength: candidate.content_length ? Number(candidate.content_length) : undefined,
          client: client.toLowerCase(),
        });
      }
    }
  }

  const [verifiedAudioList, verifiedVideoList] = await Promise.all([
    Promise.all(
      audioCandidates.slice(0, 3).map(async (c) => {
        const url = await c.urlPromise;
        if (url && (await verifyStreamUrl(url))) {
          return {
            url,
            mimeType: c.mime,
            contentLength: c.contentLength,
            source: `youtubei-${c.client}`,
          } satisfies StreamDescriptor;
        }
        return null;
      })
    ),
    Promise.all(
      videoCandidates.slice(0, 3).map(async (c) => {
        const url = await c.urlPromise;
        if (url && (await verifyStreamUrl(url))) {
          return {
            url,
            mimeType: c.mime,
            quality: c.quality,
            contentLength: c.contentLength,
            source: `youtubei-${c.client}`,
          } satisfies StreamDescriptor;
        }
        return null;
      })
    ),
  ]);

  audio = verifiedAudioList.find(Boolean) || null;
  video = verifiedVideoList.find(Boolean) || null;

  return { audio, video, botCheckBlocked };
}

/**
 * Extracts BOTH real direct ad-free audio/mp4 AND muxed video/mp4
 * using multi-client Innertube + BotGuard PoToken + JS player signature deciphering.
 */
async function resolveMediaBundle(
  videoId: string,
  forceFresh = false
): Promise<CachedMediaBundle> {
  const cached = mediaBundleCache.get(videoId);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    (!forceFresh || Boolean(cached.audio || cached.video))
  ) {
    return cached;
  }

  if (!forceFresh) {
    const inflight = inflightBundles.get(videoId);
    if (inflight) return inflight;
  }

  const task = (async (): Promise<CachedMediaBundle> => {
    let audio: StreamDescriptor | null = null;
    let video: StreamDescriptor | null = null;
    let botCheckBlocked = false;

    try {
      const [yt, poToken] = await Promise.all([getInnertube(), mintVideoPoToken(videoId)]);

      const extracted = await extractFromClients(
        yt,
        videoId,
        ['IOS', 'ANDROID', 'ANDROID_VR', 'TV', 'MWEB', 'WEB', 'WEB_CREATOR'],
        poToken
      );
      audio = extracted.audio;
      video = extracted.video;
      botCheckBlocked = extracted.botCheckBlocked;

      // Muxed MP4 also plays reliably inside iOS native <audio> when adaptive M4A is absent
      if (!audio && video) {
        audio = { ...video, source: `${video.source}-muxed` };
      }
    } catch (err) {
      console.warn('[media] Innertube resolution error:', (err as Error).message);
    }

    const bundle: CachedMediaBundle = {
      audio,
      video,
      botCheckBlocked: !audio && !video && botCheckBlocked,
      expiresAt: Date.now() + (audio || video ? 25 * 60_000 : 45_000),
    };
    mediaBundleCache.set(videoId, bundle);

    if (audio) {
      warmFullMediaBuffer(`audio:${videoId}`, audio);
    }
    return bundle;
  })();

  if (!forceFresh) {
    inflightBundles.set(videoId, task);
  }
  try {
    return await task;
  } finally {
    if (inflightBundles.get(videoId) === task) {
      inflightBundles.delete(videoId);
    }
  }
}

async function proxyRangeMedia(
  req: Request,
  res: Response,
  videoId: string,
  kind: 'audio' | 'video'
): Promise<void> {
  let bundle = await resolveMediaBundle(videoId);
  let descriptor = kind === 'audio' ? bundle.audio : bundle.video;

  if (!descriptor) {
    res.status(503).json({
      error: 'Luồng media gốc tạm thời bị giới hạn từ IP máy chủ đám mây.',
      botCheckBlocked: bundle.botCheckBlocked,
    });
    return;
  }

  const isHead = req.method === 'HEAD';
  const cacheKey = `${kind}:${videoId}`;
  const memEntry = mediaDataCache.get(cacheKey);
  if (memEntry) {
    memEntry.lastAccessed = Date.now();
    const totalLen = memEntry.buffer.byteLength;
    res.setHeader('Content-Type', memEntry.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=1800');

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? Math.min(parseInt(match[2], 10), totalLen - 1) : totalLen - 1;
        if (start >= 0 && start <= end && start < totalLen) {
          const slice = memEntry.buffer.subarray(start, end + 1);
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLen}`);
          res.setHeader('Content-Length', String(slice.byteLength));
          if (isHead) res.end();
          else res.end(slice);
          return;
        }
      }
    }

    res.status(200);
    res.setHeader('Content-Length', String(totalLen));
    if (isHead) res.end();
    else res.end(memEntry.buffer);
    return;
  }

  // Trigger background full-file warm-up so subsequent ranges & screen-off playback read from RAM in <1ms
  warmFullMediaBuffer(cacheKey, descriptor);

  const forwardHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  };
  if (req.headers.range) {
    forwardHeaders.Range = req.headers.range;
  }

  // googlevideo signed URLs reject HTTP HEAD with 403; probe 1 byte via GET for HEAD requests
  if (isHead && !forwardHeaders.Range) {
    forwardHeaders.Range = 'bytes=0-0';
  }

  try {
    let upstream = await fetch(descriptor.url, { headers: forwardHeaders });

    // Some non-iOS client URLs (e.g. ANDROID/ANDROID_VR) reject mismatched mobile UA; retry without custom UA first
    if (upstream.status === 403) {
      const minimalHeaders: Record<string, string> = {};
      if (forwardHeaders.Range) minimalHeaders.Range = forwardHeaders.Range;
      upstream = await fetch(descriptor.url, { headers: minimalHeaders });
    }

    // Retry once with fresh extraction if signed URL expired
    if (upstream.status === 403 || upstream.status === 410) {
      mediaBundleCache.delete(videoId);
      bundle = await resolveMediaBundle(videoId);
      descriptor = kind === 'audio' ? bundle.audio : bundle.video;
      if (!descriptor) {
        res.status(503).end();
        return;
      }
      upstream = await fetch(descriptor.url, { headers: forwardHeaders });
    }

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).end();
      return;
    }

    const contentRange = upstream.headers.get('content-range');
    const contentLength = upstream.headers.get('content-length');

    res.status(isHead && !req.headers.range ? 200 : upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') ||
        descriptor.mimeType ||
        (kind === 'audio' ? 'audio/mp4' : 'video/mp4')
    );
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=1800');

    if (isHead && !req.headers.range && contentRange) {
      const totalMatch = contentRange.match(/\/(\d+)$/);
      if (totalMatch?.[1]) {
        res.setHeader('Content-Length', totalMatch[1]);
      } else if (descriptor.contentLength) {
        res.setHeader('Content-Length', String(descriptor.contentLength));
      }
    } else {
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentRange) res.setHeader('Content-Range', contentRange);
    }

    if (isHead || !upstream.body) {
      if (upstream.body) {
        void upstream.body.cancel().catch(() => {});
      }
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    req.on('close', () => {
      nodeStream.destroy();
    });
    nodeStream.on('error', () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) {
      res.status(502).end();
    }
  }
}

async function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/api/discover', async (req: Request, res: Response) => {
    const category = String(req.query.category || 'trending').toLowerCase();
    const query = DISCOVER_QUERIES[category] || DISCOVER_QUERIES.trending;
    try {
      const tracks = await searchYouTubeTracks(query);
      res.json({ category, tracks });
    } catch (err) {
      res
        .status(500)
        .json({ error: 'Không thể tải danh sách khám phá lúc này.', detail: (err as Error).message });
    }
  });

  app.get('/api/search', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ tracks: [] });
      return;
    }
    try {
      const tracks = await searchYouTubeTracks(q);
      res.json({ query: q, tracks });
    } catch (err) {
      res
        .status(500)
        .json({ error: 'Không thể tìm kiếm trên YouTube lúc này.', detail: (err as Error).message });
    }
  });

  app.get('/api/related/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const seedTitle = String(req.query.title || '').trim();
    const seedAuthor = String(req.query.author || '').trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
      res.status(400).json({ error: 'Video ID không hợp lệ' });
      return;
    }

    const query = seedAuthor
      ? `${seedAuthor} ${seedTitle.split(/[-|([]/)[0] || ''}`.trim()
      : seedTitle || 'music mix';

    try {
      const results = await searchYouTubeTracks(query);
      const filtered = results.filter((t) => t.id !== id).slice(0, 10);
      res.json({ tracks: filtered });
    } catch {
      res.json({ tracks: [] });
    }
  });

  app.get('/api/sponsorblock/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
      res.status(400).json({ segments: [] });
      return;
    }

    const cached = sponsorCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({ segments: cached.data });
      return;
    }

    const categories = encodeURIComponent(
      JSON.stringify([
        'sponsor',
        'selfpromo',
        'interaction',
        'intro',
        'outro',
        'music_offtopic',
        'preview',
      ])
    );
    const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${id}&categories=${categories}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'PureStream/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.status === 404 || !resp.ok) {
        sponsorCache.set(id, { data: [], expiresAt: Date.now() + 20 * 60_000 });
        res.json({ segments: [] });
        return;
      }

      const raw = (await resp.json()) as Array<{
        UUID: string;
        category: string;
        segment: [number, number];
      }>;

      const segments = (raw || [])
        .filter((s) => Array.isArray(s.segment) && s.segment.length === 2 && s.segment[1] > s.segment[0])
        .map((s) => ({
          uuid: s.UUID,
          category: s.category,
          start: s.segment[0],
          end: s.segment[1],
        }))
        .sort((a, b) => a.start - b.start);

      sponsorCache.set(id, { data: segments, expiresAt: Date.now() + 30 * 60_000 });
      res.json({ segments });
    } catch {
      res.json({ segments: [] });
    }
  });

  // Unified verified media metadata endpoint (both native native audio + native video)
  app.get('/api/media-meta/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
      res.status(400).json({ audioAvailable: false, videoAvailable: false });
      return;
    }
    const forceFresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const bundle = await resolveMediaBundle(id, forceFresh);
    res.json({
      audioAvailable: Boolean(bundle.audio),
      videoAvailable: Boolean(bundle.video),
      audioUrl: bundle.audio ? `/api/audio/${id}` : null,
      videoUrl: bundle.video ? `/api/video/${id}` : null,
      audioMimeType: bundle.audio?.mimeType || null,
      videoMimeType: bundle.video?.mimeType || null,
      videoQuality: bundle.video?.quality || null,
      source: bundle.audio?.source || bundle.video?.source || null,
      botCheckBlocked: bundle.botCheckBlocked,
    });
  });

  // Backwards-compatible alias
  app.get('/api/audio-meta/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
      res.status(400).json({ available: false });
      return;
    }
    const forceFresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const bundle = await resolveMediaBundle(id, forceFresh);
    res.json({
      available: Boolean(bundle.audio),
      streamUrl: bundle.audio ? `/api/audio/${id}` : null,
      videoAvailable: Boolean(bundle.video),
      videoUrl: bundle.video ? `/api/video/${id}` : null,
      botCheckBlocked: bundle.botCheckBlocked,
    });
  });

  // Ad-free HTTP 206 Range Audio Proxy (native <audio> for lock-screen background playback)
  app.get('/api/audio/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
      res.status(400).end();
      return;
    }
    await proxyRangeMedia(req, res, id, 'audio');
  });

  // Ad-free HTTP 206 Range Video Proxy (native <video> with PiP + seamless background handoff)
  app.get('/api/video/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
      res.status(400).end();
      return;
    }
    await proxyRangeMedia(req, res, id, 'video');
  });

  if (IS_PROD) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });

    // Serve WebSocket-free /@vite/client shim in dev middleware mode so no WS errors ever occur
    app.get('/@vite/client', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== '.' && url[0] !== '/')) return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PureStream server running on http://0.0.0.0:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
