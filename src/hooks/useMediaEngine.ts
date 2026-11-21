import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SPONSOR_CATEGORY_LABELS,
  type PlayMode,
  type RepeatMode,
  type SponsorSegment,
  type SponsorSettings,
  type TrackItem,
} from '../types/media';

export type ActiveEngine = 'native-audio' | 'native-video' | 'yt-privacy';

const MAX_RECOVERY_ATTEMPTS = 3;
const STALL_WATCHDOG_MS = 3000;
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQgAAAAAAAAAAAAAAA==';

interface ResolvedMediaUrls {
  audioUrl: string | null;
  videoUrl: string | null;
  sourceLabel: string | null;
  botCheckBlocked: boolean;
}

interface YTPlayerInstance {
  loadVideoById: (options: { videoId: string; startSeconds?: number } | string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getVideoLoadedFraction: () => number;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        config: {
          host?: string;
          width?: string | number;
          height?: string | number;
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: { target: YTPlayerInstance }) => void;
            onStateChange?: (e: { data: number; target: YTPlayerInstance }) => void;
            onError?: (e: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeIframeAPI(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

function appendCacheBusterIfLocal(url: string | null): string | null {
  if (!url) return null;
  if (!url.startsWith('/api/')) return url;
  const base = url.split('?')[0];
  return `${base}?r=${Date.now()}`;
}

const PIPED_HOSTS = [
  'https://pipedapi.ducks.party',
  'https://api.piped.private.coffee',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.kavin.rocks',
];

const INVIDIOUS_FALLBACK_HOSTS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.tiekoetter.com',
];

const PLAY_MODE_STORAGE_KEY = 'musictube_play_mode';
const HEALTHY_TIER2_STORAGE_KEY = 'musictube_healthy_tier2_hosts';

function getSavedHealthyHosts(): { piped: string[]; invidious: string[] } {
  try {
    const raw = localStorage.getItem(HEALTHY_TIER2_STORAGE_KEY);
    if (!raw) return { piped: [], invidious: [] };
    const parsed = JSON.parse(raw) as { piped?: string[]; invidious?: string[] };
    return {
      piped: Array.isArray(parsed.piped) ? parsed.piped.filter(Boolean) : [],
      invidious: Array.isArray(parsed.invidious) ? parsed.invidious.filter(Boolean) : [],
    };
  } catch {
    return { piped: [], invidious: [] };
  }
}

function recordHealthyHost(kind: 'piped' | 'invidious', host: string): void {
  try {
    const saved = getSavedHealthyHosts();
    const list = [host, ...saved[kind].filter((h) => h !== host)].slice(0, 6);
    saved[kind] = list;
    localStorage.setItem(HEALTHY_TIER2_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Ignore storage quota errors
  }
}

let discoveredPipedHosts: string[] = [];
let discoveredInvidiousHosts: string[] = [];
let directoryWarmStarted = false;

/**
 * Refreshes public Piped/Invidious host directory purely in the background
 * without ever blocking track playback or stream resolution.
 */
function warmTier2HostDirectory(): void {
  if (directoryWarmStarted || typeof window === 'undefined') return;
  directoryWarmStarted = true;

  void (async () => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 3000);
    try {
      const [pResp, iResp] = await Promise.allSettled([
        fetch(
          'https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md',
          { signal: ctrl.signal }
        ),
        fetch(
          'https://raw.githubusercontent.com/iv-org/documentation/master/docs/instances.md',
          { signal: ctrl.signal }
        ),
      ]);

      if (pResp.status === 'fulfilled' && pResp.value.ok) {
        const text = await pResp.value.text();
        const matches = text.match(/https:\/\/[a-z0-9.-]+/gi) || [];
        discoveredPipedHosts = Array.from(
          new Set(
            matches.filter(
              (u) =>
                !u.includes('github') &&
                !u.includes('piped.video') &&
                !u.includes('duckduckgo') &&
                (u.includes('api') || u.includes('pa.') || u.includes('pdapi'))
            )
          )
        ).slice(0, 10);
      }

      if (iResp.status === 'fulfilled' && iResp.value.ok) {
        const text = await iResp.value.text();
        const matches = text.match(/https:\/\/[a-z0-9.-]+/gi) || [];
        discoveredInvidiousHosts = Array.from(
          new Set(
            matches.filter(
              (u) =>
                !u.includes('github') &&
                !u.includes('invidious.io') &&
                !u.includes('updown.io') &&
                !u.includes('.onion') &&
                !u.includes('.i2p')
            )
          )
        ).slice(0, 8);
      }
    } catch {
      // Non-blocking background discovery
    } finally {
      window.clearTimeout(timer);
    }
  })();
}

function getImmediatePipedHosts(): string[] {
  const saved = getSavedHealthyHosts().piped;
  return Array.from(new Set([...saved, ...discoveredPipedHosts, ...PIPED_HOSTS])).slice(0, 10);
}

function getImmediateInvidiousHosts(): string[] {
  const saved = getSavedHealthyHosts().invidious;
  return Array.from(
    new Set([...saved, ...discoveredInvidiousHosts, ...INVIDIOUS_FALLBACK_HOSTS])
  ).slice(0, 6);
}

function isAppleTouchBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Tier-2 residential-IP fallback: runs immediately in parallel across candidate hosts
 * with a tight 1.6s deadline so track switching never stalls on dead public endpoints.
 */
async function probeClientDirectStreams(
  videoId: string
): Promise<{ audioUrl: string | null; videoUrl: string | null } | null> {
  const apple = isAppleTouchBrowser();
  const pipedHosts = getImmediatePipedHosts();
  const invHosts = getImmediateInvidiousHosts();

  const pipedProbes = pipedHosts.map(async (host) => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 1600);
    try {
      const r = await fetch(`${host}/streams/${videoId}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error('status');
      const ct = r.headers.get('content-type') || '';
      if (ct && !ct.includes('json')) throw new Error('non-json');
      const data = (await r.json()) as {
        audioStreams?: Array<{ url?: string; mimeType?: string; bitrate?: number }>;
        videoStreams?: Array<{ url?: string; mimeType?: string; videoOnly?: boolean; quality?: string }>;
      };
      const mp4Audio = (data.audioStreams || [])
        .filter((s) => s.url && (s.mimeType?.includes('mp4') || s.mimeType?.includes('m4a')))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      const anyAudio = apple
        ? null
        : (data.audioStreams || [])
            .filter((s) => s.url)
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

      const bestVideo = (data.videoStreams || [])
        .filter((s) => s.url && !s.videoOnly && s.mimeType?.includes('mp4'))
        .sort((a, b) => parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10))[0];

      const chosenAudioUrl = mp4Audio?.url || bestVideo?.url || anyAudio?.url || null;
      if (!chosenAudioUrl && !bestVideo?.url) throw new Error('empty');
      recordHealthyHost('piped', host);
      return {
        audioUrl: chosenAudioUrl,
        videoUrl: bestVideo?.url || null,
      };
    } finally {
      window.clearTimeout(timer);
    }
  });

  const invidiousProbes = invHosts.map(async (host) => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 1600);
    try {
      const r = await fetch(`${host}/api/v1/videos/${videoId}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error('status');
      const ct = r.headers.get('content-type') || '';
      if (ct && !ct.includes('json')) throw new Error('non-json');
      const data = (await r.json()) as {
        adaptiveFormats?: Array<{ url?: string; type?: string; bitrate?: string | number }>;
        formatStreams?: Array<{ url?: string; type?: string; qualityLabel?: string }>;
      };
      const mp4Audio = (data.adaptiveFormats || [])
        .filter((f) => f.url && f.type?.includes('audio/mp4'))
        .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))[0];
      const bestVideo = (data.formatStreams || [])
        .filter((f) => f.url && f.type?.includes('video/mp4'))
        .sort((a, b) => parseInt(b.qualityLabel || '0', 10) - parseInt(a.qualityLabel || '0', 10))[0];

      const chosenAudioUrl = mp4Audio?.url || bestVideo?.url || null;
      if (!chosenAudioUrl && !bestVideo?.url) throw new Error('empty');
      recordHealthyHost('invidious', host);
      return {
        audioUrl: chosenAudioUrl,
        videoUrl: bestVideo?.url || null,
      };
    } finally {
      window.clearTimeout(timer);
    }
  });

  try {
    return await Promise.any([...pipedProbes, ...invidiousProbes]);
  } catch {
    return null;
  }
}

interface UseMediaEngineOptions {
  sponsorSettings: SponsorSettings;
  onTrackPlay: (track: TrackItem) => void;
  onSponsorSkip: (secondsSaved: number, label: string) => void;
  onNotice: (message: string) => void;
}

export function useMediaEngine({
  sponsorSettings,
  onTrackPlay,
  onSponsorSkip,
  onNotice,
}: UseMediaEngineOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const ytReadyRef = useRef<boolean>(false);
  const pendingYtTrackRef = useRef<string | null>(null);
  const skippedUuidsRef = useRef<Set<string>>(new Set());
  const backgroundHandoffActiveRef = useRef<boolean>(false);

  // Background playback intent & recovery refs
  const userWantsPlayingRef = useRef<boolean>(false);
  const lastKnownTimeRef = useRef<number>(0);
  const recoveryAttemptsRef = useRef<number>(0);
  const stallWatchdogRef = useRef<number | null>(null);
  const isRecoveringRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);
  const isUnlockingAudioRef = useRef<boolean>(false);
  const isRetryingNativeRef = useRef<boolean>(false);
  const lastPositionSyncAtRef = useRef<number>(0);
  const audioMetaCleanupRef = useRef<(() => void) | null>(null);
  const videoMetaCleanupRef = useRef<(() => void) | null>(null);

  const streamCacheRef = useRef<
    Map<string, { resolved: ResolvedMediaUrls; expiresAt: number }>
  >(new Map());
  const negativeResolveCacheRef = useRef<Map<string, number>>(new Map());
  const inflightResolveRef = useRef<Map<string, Promise<ResolvedMediaUrls>>>(new Map());
  const prefetchAttemptedRef = useRef<Map<string, number>>(new Map());
  const lastTier1BlockedAtRef = useRef<number>(0);
  const blobCacheRef = useRef<Map<string, { blobUrl: string; lastUsed: number }>>(new Map());
  const blobInflightRef = useRef<Map<string, Promise<string | null>>>(new Map());

  const mediaUrlsRef = useRef<ResolvedMediaUrls>({
    audioUrl: null,
    videoUrl: null,
    sourceLabel: null,
    botCheckBlocked: false,
  });

  const [queue, setQueue] = useState<TrackItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [playMode, setPlayMode] = useState<PlayMode>(() => {
    try {
      return localStorage.getItem(PLAY_MODE_STORAGE_KEY) === 'video' ? 'video' : 'audio';
    } catch {
      return 'audio';
    }
  });
  const [activeEngine, setActiveEngine] = useState<ActiveEngine>('native-audio');
  const [streamSourceLabel, setStreamSourceLabel] = useState<string | null>(null);
  const [isRetryingNative, setIsRetryingNative] = useState<boolean>(false);
  const [isPiPSupported, setIsPiPSupported] = useState<boolean>(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [isShuffled, setIsShuffled] = useState(false);

  const [segments, setSegments] = useState<SponsorSegment[]>([]);
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
  const [sleepEndOfTrack, setSleepEndOfTrack] = useState(false);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number>(0);

  const currentTrack: TrackItem | null =
    currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const currentTrackRef = useRef<TrackItem | null>(currentTrack);
  currentTrackRef.current = currentTrack;

  const stateRef = useRef({
    repeatMode,
    sleepEndOfTrack,
    isShuffled,
    currentIndex,
    queueLength: queue.length,
    volume,
    isMuted,
    playbackRate,
    sponsorSettings,
    segments,
    activeEngine,
    playMode,
    isPlaying,
    duration,
  });
  stateRef.current = {
    repeatMode,
    sleepEndOfTrack,
    isShuffled,
    currentIndex,
    queueLength: queue.length,
    volume,
    isMuted,
    playbackRate,
    sponsorSettings,
    segments,
    activeEngine,
    playMode,
    isPlaying,
    duration,
  };

  // Create or resume AudioContext on user gesture and foreground return
  const ensureAudioContext = useCallback(() => {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
        void ctx.resume().catch(() => {});
      }
    } catch {
      // Ignore AudioContext restriction errors
    }
  }, []);

  // Synchronously prime the DOM-mounted <audio> element inside a user tap gesture for iOS Safari
  const unlockAudioSync = useCallback(() => {
    ensureAudioContext();
    const audio = audioRef.current;
    if (!audio || audioUnlockedRef.current) return;
    const currentSrc = audio.getAttribute('src') || '';
    const hasRealStream = Boolean(currentSrc && !currentSrc.startsWith('data:audio/wav'));
    if (hasRealStream && !audio.paused) {
      audioUnlockedRef.current = true;
      return;
    }
    if (!hasRealStream) {
      try {
        isUnlockingAudioRef.current = true;
        audio.src = SILENT_WAV_DATA_URI;
        const p = audio.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            audioUnlockedRef.current = true;
            isUnlockingAudioRef.current = false;
          }).catch(() => {
            isUnlockingAudioRef.current = false;
          });
        } else {
          audioUnlockedRef.current = true;
          isUnlockingAudioRef.current = false;
        }
      } catch {
        isUnlockingAudioRef.current = false;
      }
    }
  }, [ensureAudioContext]);

  const clearStallWatchdog = useCallback(() => {
    if (stallWatchdogRef.current !== null) {
      window.clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
  }, []);

  const syncMediaSessionPosition = useCallback((positionSeconds: number, durOverride?: number) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!('setPositionState' in navigator.mediaSession)) return;
    const dur = durOverride && durOverride > 0 ? durOverride : stateRef.current.duration;
    const rate = stateRef.current.playbackRate;
    if (!dur || !Number.isFinite(dur) || dur <= 0 || !Number.isFinite(rate) || rate <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: rate,
        position: Math.min(Math.max(0, Number.isFinite(positionSeconds) ? positionSeconds : 0), dur),
      });
    } catch {
      // Ignore transient invalid state
    }
  }, []);

  // Pre-warm YT Iframe API, Tier-2 host directory, and <audio> element on mount; revoke blob URLs on unmount
  useEffect(() => {
    warmTier2HostDirectory();
    void loadYouTubeIframeAPI();

    const audio = audioRef.current;
    if (audio) {
      audio.preload = 'auto';
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
    }

    setIsPiPSupported(
      typeof document !== 'undefined' &&
        ('pictureInPictureEnabled' in document ||
          typeof (HTMLVideoElement.prototype as unknown as { webkitSetPresentationMode?: unknown })
            .webkitSetPresentationMode === 'function')
    );

    const blobMap = blobCacheRef.current;
    return () => {
      clearStallWatchdog();
      audioMetaCleanupRef.current?.();
      videoMetaCleanupRef.current?.();
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close().catch(() => {});
      }
      audioCtxRef.current = null;
      for (const entry of blobMap.values()) {
        try {
          URL.revokeObjectURL(entry.blobUrl);
        } catch {
          // Ignore
        }
      }
      blobMap.clear();
    };
  }, [clearStallWatchdog]);

  const stopAllEngines = useCallback(() => {
    clearStallWatchdog();
    if (audioRef.current && !isUnlockingAudioRef.current) {
      audioRef.current.pause();
    }
    if (videoRef.current) {
      videoRef.current.pause();
    }
    try {
      ytPlayerRef.current?.pauseVideo?.();
    } catch {
      // Ignore
    }
  }, [clearStallWatchdog]);

  const getCachedResolvedStreams = useCallback((videoId: string): ResolvedMediaUrls | null => {
    const entry = streamCacheRef.current.get(videoId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      streamCacheRef.current.delete(videoId);
      return null;
    }
    return entry.resolved;
  }, []);

  const getCachedBlobUrl = useCallback((cacheKey: string): string | null => {
    const entry = blobCacheRef.current.get(cacheKey);
    if (!entry) return null;
    entry.lastUsed = Date.now();
    return entry.blobUrl;
  }, []);

  /**
   * Downloads the full audio/video stream in the background at maximum Wi-Fi / cellular speed
   * into an in-memory Blob URL so locked-screen background playback never depends on live network chunks.
   */
  const preloadMediaBlob = useCallback(
    (cacheKey: string, url: string | null, onReady?: (blobUrl: string) => void): void => {
      if (!url || typeof window === 'undefined') return;
      const existing = getCachedBlobUrl(cacheKey);
      if (existing) {
        onReady?.(existing);
        return;
      }
      const inflight = blobInflightRef.current.get(cacheKey);
      if (inflight) {
        if (onReady) {
          void inflight.then((b) => {
            if (b) onReady(b);
          });
        }
        return;
      }

      const task = (async (): Promise<string | null> => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) return null;
          const len = Number(resp.headers.get('content-length') || '0');
          if (len > 60 * 1024 * 1024) return null;
          const blob = await resp.blob();
          if (blob.size === 0 || blob.size > 60 * 1024 * 1024) return null;

          const blobUrl = URL.createObjectURL(blob);
          const map = blobCacheRef.current;
          if (map.size >= 4) {
            const oldest = Array.from(map.entries()).sort(
              (a, b) => a[1].lastUsed - b[1].lastUsed
            )[0];
            if (oldest) {
              map.delete(oldest[0]);
              try {
                URL.revokeObjectURL(oldest[1].blobUrl);
              } catch {
                // Ignore
              }
            }
          }
          map.set(cacheKey, { blobUrl, lastUsed: Date.now() });
          onReady?.(blobUrl);
          return blobUrl;
        } catch {
          // Cross-origin streams without CORS fall back cleanly to native <audio>/<video preload="auto">
          return null;
        } finally {
          blobInflightRef.current.delete(cacheKey);
        }
      })();

      blobInflightRef.current.set(cacheKey, task);
    },
    [getCachedBlobUrl]
  );

  const resolveTrackStreams = useCallback(
    async (videoId: string, forceFresh = false): Promise<ResolvedMediaUrls> => {
      if (!forceFresh) {
        const cached = getCachedResolvedStreams(videoId);
        if (cached && (cached.audioUrl || cached.videoUrl)) {
          return cached;
        }
        const negUntil = negativeResolveCacheRef.current.get(videoId);
        if (negUntil && negUntil > Date.now()) {
          return { audioUrl: null, videoUrl: null, sourceLabel: null, botCheckBlocked: true };
        }
        const inflight = inflightResolveRef.current.get(videoId);
        if (inflight) return inflight;
      }

      const task = (async (): Promise<ResolvedMediaUrls> => {
        let audioUrl: string | null = null;
        let videoUrl: string | null = null;
        let sourceLabel: string | null = null;
        let botCheckBlocked = false;

        // If Tier 1 recently reported cloud-IP bot blocking, race Tier 2 concurrently so 0ms is wasted
        const tier1RecentlyBlocked = Date.now() - lastTier1BlockedAtRef.current < 60_000;
        const earlyTier2Promise = tier1RecentlyBlocked
          ? probeClientDirectStreams(videoId).catch(() => null)
          : null;

        try {
          const query = forceFresh ? '?fresh=1' : '';
          const resp = await fetch(`/api/media-meta/${videoId}${query}`);
          if (resp.ok) {
            const meta = (await resp.json()) as {
              audioAvailable?: boolean;
              videoAvailable?: boolean;
              audioUrl?: string | null;
              videoUrl?: string | null;
              videoQuality?: string | null;
              botCheckBlocked?: boolean;
            };
            audioUrl = meta.audioAvailable ? meta.audioUrl || null : null;
            videoUrl = meta.videoAvailable ? meta.videoUrl || null : null;
            botCheckBlocked = Boolean(meta.botCheckBlocked);
            if (botCheckBlocked && !audioUrl && !videoUrl) {
              lastTier1BlockedAtRef.current = Date.now();
            }
            if (audioUrl || videoUrl) {
              sourceLabel = meta.videoQuality
                ? `Luồng gốc không quảng cáo (${meta.videoQuality})`
                : 'Luồng gốc không quảng cáo';
            }
          }
        } catch {
          // Proceed to Tier 2
        }

        if (!audioUrl && !videoUrl) {
          const clientResolved = earlyTier2Promise
            ? await earlyTier2Promise
            : await probeClientDirectStreams(videoId);
          if (clientResolved) {
            audioUrl = clientResolved.audioUrl;
            videoUrl = clientResolved.videoUrl;
            sourceLabel = 'Luồng trực tiếp không quảng cáo';
          }
        }

        const result: ResolvedMediaUrls = { audioUrl, videoUrl, sourceLabel, botCheckBlocked };
        if (audioUrl || videoUrl) {
          negativeResolveCacheRef.current.delete(videoId);
          streamCacheRef.current.set(videoId, {
            resolved: result,
            expiresAt: Date.now() + 15 * 60_000,
          });
        } else if (!forceFresh) {
          negativeResolveCacheRef.current.set(videoId, Date.now() + 25_000);
        }
        return result;
      })();

      if (!forceFresh) {
        inflightResolveRef.current.set(videoId, task);
      }
      try {
        return await task;
      } finally {
        if (inflightResolveRef.current.get(videoId) === task) {
          inflightResolveRef.current.delete(videoId);
        }
      }
    },
    [getCachedResolvedStreams]
  );

  const prefetchTracks = useCallback(
    (tracks: TrackItem[], limit = 3) => {
      const now = Date.now();
      const candidates = tracks.slice(0, limit).filter((t) => {
        if (getCachedResolvedStreams(t.id)) return false;
        if (inflightResolveRef.current.has(t.id)) return false;
        const negUntil = negativeResolveCacheRef.current.get(t.id);
        if (negUntil && negUntil > now) return false;
        const lastTried = prefetchAttemptedRef.current.get(t.id);
        if (lastTried && now - lastTried < 30_000) return false;
        return true;
      });
      if (candidates.length === 0) return;
      for (const t of candidates) {
        prefetchAttemptedRef.current.set(t.id, now);
      }
      void Promise.allSettled(
        candidates.map(async (t) => {
          const resolved = await resolveTrackStreams(t.id).catch(() => null);
          if (resolved?.audioUrl) {
            preloadMediaBlob(`audio:${t.id}`, resolved.audioUrl);
          }
          if (limit === 1 && stateRef.current.playMode === 'video' && resolved?.videoUrl) {
            preloadMediaBlob(`video:${t.id}`, resolved.videoUrl);
          }
        })
      );
    },
    [getCachedResolvedStreams, preloadMediaBlob, resolveTrackStreams]
  );

  const recoverPlaybackRef = useRef<(reason: string) => Promise<void>>(async () => {});

  const scheduleStallWatchdog = useCallback(() => {
    clearStallWatchdog();
    if (!userWantsPlayingRef.current || !currentTrackRef.current) return;
    if (stateRef.current.activeEngine === 'yt-privacy') return;

    stallWatchdogRef.current = window.setTimeout(() => {
      stallWatchdogRef.current = null;
      if (!userWantsPlayingRef.current || !currentTrackRef.current) return;
      const eng = stateRef.current.activeEngine;
      const el =
        eng === 'native-audio'
          ? audioRef.current
          : eng === 'native-video'
          ? videoRef.current
          : null;
      if (!el) return;

      const stillStuck =
        el.paused ||
        el.readyState < 3 ||
        el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
      if (stillStuck) {
        void recoverPlaybackRef.current('watchdog');
      } else {
        setIsLoading(false);
      }
    }, STALL_WATCHDOG_MS);
  }, [clearStallWatchdog]);

  const playNext = useCallback(() => {
    unlockAudioSync();
    recoveryAttemptsRef.current = 0;
    setQueue((q) => {
      if (q.length === 0) return q;
      const { isShuffled: shuf, repeatMode: rep } = stateRef.current;
      setCurrentIndex((idx) => {
        if (shuf && q.length > 1) {
          let nextIdx = idx;
          while (nextIdx === idx) {
            nextIdx = Math.floor(Math.random() * q.length);
          }
          userWantsPlayingRef.current = true;
          return nextIdx;
        }
        if (idx < q.length - 1) {
          userWantsPlayingRef.current = true;
          return idx + 1;
        }
        if (rep === 'all') {
          userWantsPlayingRef.current = true;
          return 0;
        }
        userWantsPlayingRef.current = false;
        setIsPlaying(false);
        setIsLoading(false);
        return idx;
      });
      return q;
    });
  }, [unlockAudioSync]);

  const playPrev = useCallback(() => {
    unlockAudioSync();
    recoveryAttemptsRef.current = 0;
    const eng = stateRef.current.activeEngine;
    const nowTime =
      eng === 'native-audio'
        ? audioRef.current?.currentTime || lastKnownTimeRef.current || 0
        : eng === 'native-video'
        ? videoRef.current?.currentTime || lastKnownTimeRef.current || 0
        : ytPlayerRef.current?.getCurrentTime?.() || lastKnownTimeRef.current || 0;

    if (nowTime > 4) {
      if (eng === 'native-audio' && audioRef.current) audioRef.current.currentTime = 0;
      else if (eng === 'native-video' && videoRef.current) videoRef.current.currentTime = 0;
      else ytPlayerRef.current?.seekTo(0, true);
      lastKnownTimeRef.current = 0;
      setCurrentTime(0);
      syncMediaSessionPosition(0);
      return;
    }

    if (queue.length === 0) return;
    if (currentIndex > 0) {
      userWantsPlayingRef.current = true;
      setCurrentIndex((i) => i - 1);
    } else if (repeatMode === 'all') {
      userWantsPlayingRef.current = true;
      setCurrentIndex(queue.length - 1);
    }
  }, [currentIndex, queue.length, repeatMode, syncMediaSessionPosition, unlockAudioSync]);

  const handleTrackEnded = useCallback(() => {
    clearStallWatchdog();
    const { sleepEndOfTrack: stopAtEnd, repeatMode: rep, activeEngine: eng } = stateRef.current;
    if (stopAtEnd) {
      userWantsPlayingRef.current = false;
      setSleepEndOfTrack(false);
      setIsPlaying(false);
      setIsLoading(false);
      onNotice('Hẹn giờ tắt: đã dừng phát khi kết thúc bài.');
      return;
    }
    if (rep === 'one') {
      skippedUuidsRef.current.clear();
      userWantsPlayingRef.current = true;
      lastKnownTimeRef.current = 0;
      if (eng === 'native-audio' && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {
          void recoverPlaybackRef.current('repeat-one');
        });
      } else if (eng === 'native-video' && videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {
          void recoverPlaybackRef.current('repeat-one');
        });
      } else if (ytPlayerRef.current) {
        ytPlayerRef.current.seekTo(0, true);
        ytPlayerRef.current.playVideo();
      }
      return;
    }
    playNext();
  }, [clearStallWatchdog, onNotice, playNext]);

  const handleTrackEndedRef = useRef(handleTrackEnded);
  handleTrackEndedRef.current = handleTrackEnded;

  const startNativeAudio = useCallback(
    (url: string, startAt = 0, shouldPlay = true, forceReload = false) => {
      const audio = audioRef.current;
      if (!audio) return;

      audioMetaCleanupRef.current?.();
      audioMetaCleanupRef.current = null;
      isUnlockingAudioRef.current = false;

      videoRef.current?.pause();
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        // Ignore
      }
      setActiveEngine('native-audio');

      const trackId = currentTrackRef.current?.id;
      const cachedBlob = !forceReload && trackId ? getCachedBlobUrl(`audio:${trackId}`) : null;
      const effectiveUrl =
        cachedBlob || (forceReload ? appendCacheBusterIfLocal(url) || url : url);
      const currentAttrUrl = audio.getAttribute('data-stream-url');
      const needsLoad =
        forceReload ||
        currentAttrUrl !== effectiveUrl ||
        !audio.src ||
        audio.src.startsWith('data:audio/wav') ||
        Boolean(audio.error);

      audio.preload = 'auto';
      if (needsLoad) {
        audio.setAttribute('data-stream-url', effectiveUrl);
        audio.src = effectiveUrl;
        audio.load();
      }
      if (trackId && !cachedBlob) {
        preloadMediaBlob(`audio:${trackId}`, url);
      }
      audio.playbackRate = stateRef.current.playbackRate;
      audio.volume = stateRef.current.isMuted ? 0 : stateRef.current.volume;

      const applySeek = () => {
        if (startAt > 0.5) {
          const maxSafe =
            Number.isFinite(audio.duration) && audio.duration > 1 ? audio.duration - 0.5 : startAt;
          const clampedStart = Math.min(startAt, maxSafe);
          try {
            audio.currentTime = clampedStart;
            lastKnownTimeRef.current = clampedStart;
          } catch {
            // Seek will apply when buffered
          }
        }
      };

      if (audio.readyState >= 1) {
        applySeek();
      } else if (startAt > 0.5 || !shouldPlay) {
        const onMeta = () => {
          audioMetaCleanupRef.current?.();
          audioMetaCleanupRef.current = null;
          applySeek();
          if (shouldPlay && audio.paused && userWantsPlayingRef.current) {
            audio.play().catch(() => {});
          } else if (!shouldPlay) {
            clearStallWatchdog();
            setIsLoading(false);
          }
        };
        audio.addEventListener('loadedmetadata', onMeta);
        audioMetaCleanupRef.current = () => {
          audio.removeEventListener('loadedmetadata', onMeta);
        };
      }

      if (shouldPlay) {
        userWantsPlayingRef.current = true;
        setIsLoading(audio.readyState < 3);
        scheduleStallWatchdog();
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise
            .then(() => {
              audioUnlockedRef.current = true;
              clearStallWatchdog();
              setIsPlaying(true);
              setIsLoading(false);
            })
            .catch((err: DOMException | Error) => {
              if (err?.name === 'NotAllowedError') {
                clearStallWatchdog();
                setIsLoading(false);
                setIsPlaying(false);
              } else if (err?.name !== 'AbortError') {
                void recoverPlaybackRef.current('audio-play-rejected');
              }
            });
        }
      } else {
        clearStallWatchdog();
        setIsLoading(false);
      }
    },
    [clearStallWatchdog, getCachedBlobUrl, preloadMediaBlob, scheduleStallWatchdog]
  );

  const startNativeVideo = useCallback(
    (url: string, startAt = 0, shouldPlay = true, forceReload = false) => {
      const video = videoRef.current;
      if (!video) return;

      videoMetaCleanupRef.current?.();
      videoMetaCleanupRef.current = null;

      audioRef.current?.pause();
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        // Ignore
      }
      setActiveEngine('native-video');

      // Pre-load FULL audio data into local Blob + <audio> buffer in foreground so iOS screen-off plays 100% smoothly
      const trackId = currentTrackRef.current?.id;
      const bgAudio = audioRef.current;
      const bgAudioUrl = mediaUrlsRef.current.audioUrl;
      const cachedAudioBlob = trackId ? getCachedBlobUrl(`audio:${trackId}`) : null;
      const targetBgSrc = cachedAudioBlob || bgAudioUrl;
      if (bgAudio && targetBgSrc && bgAudio.getAttribute('data-stream-url') !== targetBgSrc) {
        bgAudio.preload = 'auto';
        bgAudio.setAttribute('data-stream-url', targetBgSrc);
        bgAudio.src = targetBgSrc;
        bgAudio.load();
      }
      if (trackId && bgAudioUrl && !cachedAudioBlob) {
        preloadMediaBlob(`audio:${trackId}`, bgAudioUrl, (blobUrl) => {
          const el = audioRef.current;
          if (
            el &&
            el.paused &&
            !document.hidden &&
            currentTrackRef.current?.id === trackId &&
            stateRef.current.activeEngine === 'native-video'
          ) {
            el.preload = 'auto';
            el.setAttribute('data-stream-url', blobUrl);
            el.src = blobUrl;
            el.load();
          }
        });
      }

      const cachedVideoBlob = !forceReload && trackId ? getCachedBlobUrl(`video:${trackId}`) : null;
      const effectiveUrl =
        cachedVideoBlob || (forceReload ? appendCacheBusterIfLocal(url) || url : url);
      const needsLoad =
        forceReload ||
        video.getAttribute('data-stream-url') !== effectiveUrl ||
        !video.src ||
        Boolean(video.error);

      if (needsLoad) {
        video.preload = 'auto';
        video.setAttribute('data-stream-url', effectiveUrl);
        video.src = effectiveUrl;
        video.load();
      }
      if (trackId && !cachedVideoBlob) {
        preloadMediaBlob(`video:${trackId}`, url);
      }
      video.playbackRate = stateRef.current.playbackRate;
      video.volume = stateRef.current.isMuted ? 0 : stateRef.current.volume;
      video.muted = stateRef.current.isMuted;

      const finishStart = () => {
        if (startAt > 0.5) {
          const maxSafe =
            Number.isFinite(video.duration) && video.duration > 1 ? video.duration - 0.5 : startAt;
          const clampedStart = Math.min(startAt, maxSafe);
          try {
            video.currentTime = clampedStart;
            lastKnownTimeRef.current = clampedStart;
          } catch {
            // Seek will be applied once buffered
          }
        }
        if (shouldPlay) {
          userWantsPlayingRef.current = true;
          scheduleStallWatchdog();
          video
            .play()
            .then(() => {
              clearStallWatchdog();
              setIsPlaying(true);
              setIsLoading(false);
            })
            .catch((err: DOMException | Error) => {
              if (err?.name === 'NotAllowedError') {
                clearStallWatchdog();
                setIsLoading(false);
                setIsPlaying(false);
              } else {
                void recoverPlaybackRef.current('video-play-rejected');
              }
            });
        } else {
          clearStallWatchdog();
          setIsLoading(false);
        }
      };

      if (!needsLoad && video.readyState >= 1) {
        finishStart();
      } else {
        if (shouldPlay) {
          setIsLoading(true);
          scheduleStallWatchdog();
        }
        const onMeta = () => {
          videoMetaCleanupRef.current?.();
          videoMetaCleanupRef.current = null;
          finishStart();
        };
        video.addEventListener('loadedmetadata', onMeta);
        videoMetaCleanupRef.current = () => {
          video.removeEventListener('loadedmetadata', onMeta);
        };
      }
    },
    [clearStallWatchdog, getCachedBlobUrl, preloadMediaBlob, scheduleStallWatchdog]
  );

  // Persistent singleton YT.Player fallback when both Tier-1 server and Tier-2 browser streams are blocked
  const ensureYtPlayer = useCallback(
    async (videoId: string, startSeconds = 0) => {
      pendingYtTrackRef.current = videoId;
      clearStallWatchdog();
      audioRef.current?.pause();
      videoRef.current?.pause();
      setActiveEngine('yt-privacy');

      await loadYouTubeIframeAPI();
      if (!window.YT?.Player || !ytContainerRef.current) return;

      if (ytPlayerRef.current && ytReadyRef.current) {
        ytPlayerRef.current.loadVideoById({ videoId, startSeconds });
        ytPlayerRef.current.setVolume(
          stateRef.current.isMuted ? 0 : Math.round(stateRef.current.volume * 100)
        );
        ytPlayerRef.current.setPlaybackRate(stateRef.current.playbackRate);
        return;
      }

      if (ytPlayerRef.current) return;

      ytContainerRef.current.innerHTML = '';
      const hostEl = document.createElement('div');
      hostEl.style.width = '100%';
      hostEl.style.height = '100%';
      ytContainerRef.current.appendChild(hostEl);

      ytPlayerRef.current = new window.YT.Player(hostEl, {
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          start: Math.floor(startSeconds),
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            ytReadyRef.current = true;
            const target = e.target;
            target.setVolume(
              stateRef.current.isMuted ? 0 : Math.round(stateRef.current.volume * 100)
            );
            target.setPlaybackRate(stateRef.current.playbackRate);
            if (pendingYtTrackRef.current && pendingYtTrackRef.current !== videoId) {
              target.loadVideoById({ videoId: pendingYtTrackRef.current, startSeconds: 0 });
            } else {
              target.playVideo();
            }
            const d = target.getDuration?.();
            if (d && d > 0) {
              setDuration(d);
              syncMediaSessionPosition(target.getCurrentTime?.() || 0, d);
            }
            setIsLoading(false);
          },
          onStateChange: (e) => {
            if (stateRef.current.activeEngine !== 'yt-privacy') return;
            const st = e.data;
            if (st === 1) {
              setIsPlaying(true);
              setIsLoading(false);
              const d = e.target.getDuration?.();
              const now = e.target.getCurrentTime?.() || 0;
              if (d && d > 0) {
                setDuration(d);
                syncMediaSessionPosition(now, d);
              }
              if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
              }
            } else if (st === 2) {
              setIsPlaying(false);
              const d = e.target.getDuration?.();
              const now = e.target.getCurrentTime?.() || 0;
              if (d && d > 0) syncMediaSessionPosition(now, d);
              if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
              }
            } else if (st === 3) {
              setIsLoading(true);
            } else if (st === 0) {
              handleTrackEndedRef.current();
            }
          },
          onError: () => {
            setIsLoading(false);
            setIsPlaying(false);
            userWantsPlayingRef.current = false;
            onNotice('Video này bị chủ sở hữu hạn chế nhúng — vui lòng chọn bài khác.');
          },
        },
      });
    },
    [clearStallWatchdog, onNotice]
  );

  // Automatic stream recovery (max 3 attempts) — reloads stream, seeks to saved timestamp, resumes
  const recoverPlayback = useCallback(
    async (_reason: string) => {
      if (isRecoveringRef.current) return;
      const track = currentTrackRef.current;
      if (!track || !userWantsPlayingRef.current) {
        clearStallWatchdog();
        setIsLoading(false);
        return;
      }

      if (recoveryAttemptsRef.current >= MAX_RECOVERY_ATTEMPTS) {
        userWantsPlayingRef.current = false;
        stopAllEngines();
        setIsLoading(false);
        setIsPlaying(false);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused';
        }
        onNotice('Không thể tiếp tục phát sau 3 lần thử lại. Vui lòng bấm Phát để thử lại.');
        return;
      }

      recoveryAttemptsRef.current += 1;
      const attempt = recoveryAttemptsRef.current;
      isRecoveringRef.current = true;
      setIsLoading(true);

      const resumeAt = lastKnownTimeRef.current;
      const trackIdAtStart = track.id;

      try {
        let urls = mediaUrlsRef.current;
        if (attempt >= 2 || (!urls.audioUrl && !urls.videoUrl)) {
          const refreshed = await resolveTrackStreams(trackIdAtStart);
          if (currentTrackRef.current?.id !== trackIdAtStart || !userWantsPlayingRef.current) {
            return;
          }
          if (refreshed.audioUrl || refreshed.videoUrl) {
            urls = refreshed;
            mediaUrlsRef.current = refreshed;
            setStreamSourceLabel(refreshed.sourceLabel);
          }
        }

        if (currentTrackRef.current?.id !== trackIdAtStart || !userWantsPlayingRef.current) {
          return;
        }

        const preferAudio =
          document.hidden ||
          stateRef.current.playMode === 'audio' ||
          stateRef.current.activeEngine === 'native-audio';

        if (preferAudio && (urls.audioUrl || urls.videoUrl)) {
          if (stateRef.current.playMode === 'video' && document.hidden) {
            backgroundHandoffActiveRef.current = true;
          }
          startNativeAudio((urls.audioUrl || urls.videoUrl)!, resumeAt, true, true);
        } else if (urls.videoUrl && stateRef.current.playMode === 'video') {
          startNativeVideo(urls.videoUrl, resumeAt, true, true);
        } else if (urls.audioUrl) {
          startNativeAudio(urls.audioUrl, resumeAt, true, true);
        } else {
          // Stream unavailable after resolving — allow retry countdown to complete cleanly
          if (attempt >= MAX_RECOVERY_ATTEMPTS) {
            userWantsPlayingRef.current = false;
            setIsLoading(false);
            setIsPlaying(false);
            onNotice('Nguồn phát tạm thời gián đoạn. Vui lòng bấm Phát để thử lại.');
          } else {
            scheduleStallWatchdog();
          }
        }
      } finally {
        isRecoveringRef.current = false;
      }
    },
    [
      clearStallWatchdog,
      onNotice,
      resolveTrackStreams,
      scheduleStallWatchdog,
      startNativeAudio,
      startNativeVideo,
      stopAllEngines,
    ]
  );
  recoverPlaybackRef.current = recoverPlayback;

  // SponsorBlock live auto-skip watcher shared across ALL 3 engines
  const checkSponsorSkip = useCallback(
    (now: number, dur: number, doSeek: (target: number) => void) => {
      const { sponsorSettings: settings, segments: segs } = stateRef.current;
      if (!settings.enabled || segs.length === 0) return;

      for (const seg of segs) {
        if (!settings.categories[seg.category]) continue;
        if (skippedUuidsRef.current.has(seg.uuid)) continue;
        if (now >= seg.start && now < seg.end - 0.35) {
          skippedUuidsRef.current.add(seg.uuid);
          const target = Math.min(seg.end + 0.08, dur || seg.end);
          lastKnownTimeRef.current = target;
          doSeek(target);
          setCurrentTime(target);
          syncMediaSessionPosition(target, dur);
          const saved = Math.max(1, Math.round(seg.end - now));
          const label = SPONSOR_CATEGORY_LABELS[seg.category]?.label || 'Quảng cáo';
          onSponsorSkip(saved, label);
          break;
        }
      }
    },
    [onSponsorSkip, syncMediaSessionPosition]
  );

  // Load track streams (Tier 1 Server Proxy -> Tier 2 Client Residential IP -> Tier 3 YT Privacy)
  useEffect(() => {
    if (!currentTrack) return;

    let cancelled = false;
    skippedUuidsRef.current.clear();
    backgroundHandoffActiveRef.current = false;
    recoveryAttemptsRef.current = 0;
    lastKnownTimeRef.current = 0;
    userWantsPlayingRef.current = true;
    mediaUrlsRef.current = {
      audioUrl: null,
      videoUrl: null,
      sourceLabel: null,
      botCheckBlocked: false,
    };

    stopAllEngines();
    setSegments([]);
    setCurrentTime(0);
    setDuration(currentTrack.durationSeconds || 0);
    setBuffered(0);
    setStreamSourceLabel(null);
    setIsLoading(true);
    onTrackPlay(currentTrack);

    // Fetch SponsorBlock segments immediately in parallel
    fetch(`/api/sponsorblock/${currentTrack.id}`)
      .then((r) => (r.ok ? r.json() : { segments: [] }))
      .then((data: { segments?: SponsorSegment[] }) => {
        if (!cancelled) {
          setSegments(Array.isArray(data.segments) ? data.segments : []);
        }
      })
      .catch(() => {
        if (!cancelled) setSegments([]);
      });

    const applyResolvedStreams = (resolved: ResolvedMediaUrls) => {
      mediaUrlsRef.current = resolved;
      setStreamSourceLabel(resolved.sourceLabel);

      const { audioUrl, videoUrl } = resolved;
      const desiredMode = stateRef.current.playMode;
      const shouldStartVideo = desiredMode === 'video' && videoUrl && !document.hidden;

      if (shouldStartVideo && videoUrl) {
        startNativeVideo(videoUrl, 0, true);
      } else if (desiredMode === 'video' && document.hidden && (audioUrl || videoUrl)) {
        backgroundHandoffActiveRef.current = true;
        startNativeAudio((audioUrl || videoUrl)!, 0, true);
      } else if (desiredMode === 'audio' && audioUrl) {
        startNativeAudio(audioUrl, 0, true);
      } else if (audioUrl) {
        startNativeAudio(audioUrl, 0, true);
      } else if (videoUrl) {
        startNativeVideo(videoUrl, 0, true);
      } else {
        // Tier 3: Silent YouTube Privacy fallback while background auto-retry keeps probing native stream
        setStreamSourceLabel('Nguồn dự phòng YouTube · Lọc tài trợ SponsorBlock');
        void ensureYtPlayer(currentTrack.id, 0);
      }
    };

    const immediateCached = getCachedResolvedStreams(currentTrack.id);
    if (immediateCached && (immediateCached.audioUrl || immediateCached.videoUrl)) {
      applyResolvedStreams(immediateCached);
    } else {
      (async () => {
        const resolved = await resolveTrackStreams(currentTrack.id);
        if (cancelled) return;
        applyResolvedStreams(resolved);
      })();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // REAL LOCK-SCREEN / SCREEN-OFF CONTINUITY FOR BOTH AUDIO & VIDEO MODES:
  // 1. On screen off (document.hidden): if in Video mode (and not PiP) and userWantsPlaying,
  //    immediately hand off to native <audio> synchronously at exact timestamp (even if OS paused <video> right before).
  // 2. On screen on / tab return (visibilitychange visible, pageshow, focus):
  //    resume AudioContext, restore Video playback synced to audio timestamp if handed off,
  //    or resume paused/stalled playback if userWantsPlaying is true.
  useEffect(() => {
    const handleBackgroundTransition = () => {
      const video = videoRef.current;
      const audio = audioRef.current;
      const { audioUrl, videoUrl } = mediaUrlsRef.current;
      if (!video || !audio) return;

      if (document.hidden) {
        const isInPiP = document.pictureInPictureElement === video;
        if (
          stateRef.current.activeEngine === 'native-video' &&
          userWantsPlayingRef.current &&
          !isInPiP &&
          (audioUrl || videoUrl)
        ) {
          const resumeAt = Math.max(video.currentTime || 0, lastKnownTimeRef.current || 0);
          lastKnownTimeRef.current = resumeAt;
          backgroundHandoffActiveRef.current = true;
          video.pause();

          const targetAudioUrl = (audioUrl || videoUrl)!;
          const currentAttr = audio.getAttribute('data-stream-url') || '';
          const trackId = currentTrackRef.current?.id;
          const cachedBlob = trackId ? getCachedBlobUrl(`audio:${trackId}`) : null;
          const isPrepared =
            audio.readyState >= 1 &&
            Boolean(currentAttr) &&
            !currentAttr.startsWith('data:audio/wav') &&
            (currentAttr === targetAudioUrl ||
              (Boolean(cachedBlob) && currentAttr === cachedBlob) ||
              currentAttr.startsWith('blob:'));

          if (isPrepared) {
            // Synchronous handoff inside visibilitychange so iOS Safari / Android Chrome keep audio alive in 1 tap
            setActiveEngine('native-audio');
            audio.playbackRate = stateRef.current.playbackRate;
            audio.volume = stateRef.current.isMuted ? 0 : stateRef.current.volume;
            if (resumeAt > 0.5 && Number.isFinite(audio.duration) && resumeAt < audio.duration) {
              try {
                audio.currentTime = resumeAt;
              } catch {
                // Ignore
              }
            }
            if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
              navigator.mediaSession.playbackState = 'playing';
            }
            audio
              .play()
              .then(() => {
                clearStallWatchdog();
                setIsPlaying(true);
                setIsLoading(false);
              })
              .catch(() => {
                void recoverPlaybackRef.current('handoff-rejected');
              });
          } else {
            startNativeAudio(cachedBlob || targetAudioUrl, resumeAt, true);
          }
        }
        return;
      }

      // Foreground return: !document.hidden
      if (!currentTrackRef.current) return;

      if (userWantsPlayingRef.current) {
        ensureAudioContext();
      }

      if (backgroundHandoffActiveRef.current) {
        const resumeAt = Math.max(audio.currentTime || 0, lastKnownTimeRef.current || 0);
        lastKnownTimeRef.current = resumeAt;
        const shouldPlay = userWantsPlayingRef.current;
        if (stateRef.current.playMode === 'video' && videoUrl) {
          audio.pause();
          backgroundHandoffActiveRef.current = false;
          startNativeVideo(videoUrl, resumeAt, shouldPlay);
          return;
        }
        backgroundHandoffActiveRef.current = false;
      }

      if (userWantsPlayingRef.current) {
        const eng = stateRef.current.activeEngine;
        if (eng === 'native-audio') {
          if (audio.error || !audio.src || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
            void recoverPlaybackRef.current('foreground-error');
          } else if (audio.paused) {
            scheduleStallWatchdog();
            audio
              .play()
              .then(() => {
                clearStallWatchdog();
                setIsPlaying(true);
                setIsLoading(false);
              })
              .catch((err: DOMException | Error) => {
                if (err?.name === 'NotAllowedError') {
                  clearStallWatchdog();
                  setIsLoading(false);
                  setIsPlaying(false);
                } else {
                  void recoverPlaybackRef.current('foreground-resume');
                }
              });
          } else if (audio.readyState >= 3) {
            clearStallWatchdog();
            setIsLoading(false);
            setIsPlaying(true);
          }
        } else if (eng === 'native-video') {
          if (video.error || !video.src || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
            void recoverPlaybackRef.current('foreground-video-error');
          } else if (video.paused) {
            scheduleStallWatchdog();
            video
              .play()
              .then(() => {
                clearStallWatchdog();
                setIsPlaying(true);
                setIsLoading(false);
              })
              .catch((err: DOMException | Error) => {
                if (err?.name === 'NotAllowedError') {
                  clearStallWatchdog();
                  setIsLoading(false);
                  setIsPlaying(false);
                } else {
                  void recoverPlaybackRef.current('foreground-video-resume');
                }
              });
          } else if (video.readyState >= 3) {
            clearStallWatchdog();
            setIsLoading(false);
            setIsPlaying(true);
          }
        } else if (eng === 'yt-privacy' && ytPlayerRef.current && ytReadyRef.current) {
          try {
            ytPlayerRef.current.playVideo();
          } catch {
            // Ignore
          }
        }
      } else {
        // Ensure spinner isn't stuck if user paused while screen was off
        clearStallWatchdog();
        setIsLoading(false);
      }
    };

    const onFocusOrPageShow = () => {
      if (!document.hidden) {
        handleBackgroundTransition();
      }
    };

    document.addEventListener('visibilitychange', handleBackgroundTransition);
    window.addEventListener('pageshow', onFocusOrPageShow);
    window.addEventListener('focus', onFocusOrPageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleBackgroundTransition);
      window.removeEventListener('pageshow', onFocusOrPageShow);
      window.removeEventListener('focus', onFocusOrPageShow);
    };
  }, [
    clearStallWatchdog,
    ensureAudioContext,
    getCachedBlobUrl,
    scheduleStallWatchdog,
    startNativeAudio,
    startNativeVideo,
  ]);

  // Attach native <audio> listeners (never dependent on currentTime to avoid re-attaching every 250ms)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const isUnlockSample = () =>
      isUnlockingAudioRef.current || (audio.getAttribute('src') || '').startsWith('data:audio/wav');

    const onTimeUpdate = () => {
      if (isUnlockSample() || stateRef.current.activeEngine !== 'native-audio') return;
      const now = audio.currentTime;
      lastKnownTimeRef.current = now;
      setCurrentTime(now);
      if (audio.buffered.length > 0) {
        setBuffered(audio.buffered.end(audio.buffered.length - 1));
      }
      if (!audio.paused && audio.readyState >= 3) {
        clearStallWatchdog();
        setIsLoading(false);
      }
      const perfNow = Date.now();
      if (perfNow - lastPositionSyncAtRef.current >= 900) {
        lastPositionSyncAtRef.current = perfNow;
        syncMediaSessionPosition(now, audio.duration);
      }
      checkSponsorSkip(now, audio.duration, (target) => {
        audio.currentTime = target;
        if (userWantsPlayingRef.current && audio.paused) {
          audio.play().catch(() => {});
        }
      });
    };

    const onLoadedMeta = () => {
      if (isUnlockSample() || stateRef.current.activeEngine !== 'native-audio') return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        syncMediaSessionPosition(audio.currentTime, audio.duration);
      }
      if (!userWantsPlayingRef.current || audio.readyState >= 3) {
        setIsLoading(false);
      }
    };

    const onPlay = () => {
      if (isUnlockSample()) return;
      if (stateRef.current.activeEngine === 'native-audio') {
        setIsPlaying(true);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        syncMediaSessionPosition(audio.currentTime, audio.duration);
      }
    };

    const onPlaying = () => {
      if (isUnlockSample()) return;
      if (stateRef.current.activeEngine === 'native-audio') {
        recoveryAttemptsRef.current = 0;
        clearStallWatchdog();
        setIsPlaying(true);
        setIsLoading(false);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        syncMediaSessionPosition(audio.currentTime, audio.duration);
      }
    };

    const onPause = () => {
      if (isUnlockSample() || stateRef.current.activeEngine !== 'native-audio') return;
      // Do not clear userWantsPlayingRef here — OS pauses on screen-off / tab switch / interruption
      // must remain recoverable when returning or tapping lock-screen Play.
      if (!backgroundHandoffActiveRef.current) {
        clearStallWatchdog();
        setIsPlaying(false);
        setIsLoading(false);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused';
        }
        syncMediaSessionPosition(audio.currentTime, audio.duration);
      }
    };

    const onWaiting = () => {
      if (isUnlockSample() || stateRef.current.activeEngine !== 'native-audio') return;
      if (userWantsPlayingRef.current) {
        setIsLoading(true);
        scheduleStallWatchdog();
      }
    };

    const onStalled = () => {
      if (isUnlockSample() || stateRef.current.activeEngine !== 'native-audio') return;
      if (userWantsPlayingRef.current && (audio.paused || audio.readyState < 3)) {
        setIsLoading(true);
        scheduleStallWatchdog();
      }
    };

    const onSuspend = () => {
      if (isUnlockSample() || stateRef.current.activeEngine !== 'native-audio') return;
      // Browsers fire suspend normally when buffer is full; only schedule recovery if playback actually stopped unexpectedly
      if (userWantsPlayingRef.current && (audio.paused || audio.readyState < 2)) {
        scheduleStallWatchdog();
      }
    };

    const onCanPlay = () => {
      if (isUnlockSample() || stateRef.current.activeEngine !== 'native-audio') return;
      clearStallWatchdog();
      setIsLoading(false);
    };

    const onSeeked = () => {
      if (isUnlockSample() || stateRef.current.activeEngine !== 'native-audio') return;
      if (audio.readyState >= 3 || !userWantsPlayingRef.current) {
        clearStallWatchdog();
        setIsLoading(false);
      }
      syncMediaSessionPosition(audio.currentTime, audio.duration);
    };

    const onEnded = () => {
      if (isUnlockSample()) return;
      if (stateRef.current.activeEngine === 'native-audio') handleTrackEndedRef.current();
    };

    const onError = () => {
      if (isUnlockSample()) return;
      const track = currentTrackRef.current;
      if (!track || stateRef.current.activeEngine !== 'native-audio') return;
      if (userWantsPlayingRef.current) {
        void recoverPlaybackRef.current('audio-error');
      } else {
        clearStallWatchdog();
        setIsLoading(false);
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('stalled', onStalled);
    audio.addEventListener('suspend', onSuspend);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('stalled', onStalled);
      audio.removeEventListener('suspend', onSuspend);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [checkSponsorSkip, clearStallWatchdog, scheduleStallWatchdog, syncMediaSessionPosition]);

  // Attach native <video> listeners (never dependent on currentTime)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      const now = video.currentTime;
      lastKnownTimeRef.current = now;
      setCurrentTime(now);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
      if (!video.paused && video.readyState >= 3) {
        clearStallWatchdog();
        setIsLoading(false);
      }
      const perfNow = Date.now();
      if (perfNow - lastPositionSyncAtRef.current >= 900) {
        lastPositionSyncAtRef.current = perfNow;
        syncMediaSessionPosition(now, video.duration);
      }
      checkSponsorSkip(now, video.duration, (target) => {
        video.currentTime = target;
        if (userWantsPlayingRef.current && video.paused) {
          video.play().catch(() => {});
        }
      });
    };

    const onLoadedMeta = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
        syncMediaSessionPosition(video.currentTime, video.duration);
      }
      if (!userWantsPlayingRef.current || video.readyState >= 3) {
        setIsLoading(false);
      }
    };

    const onPlay = () => {
      if (stateRef.current.activeEngine === 'native-video') {
        setIsPlaying(true);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        syncMediaSessionPosition(video.currentTime, video.duration);
      }
    };

    const onPlaying = () => {
      if (stateRef.current.activeEngine === 'native-video') {
        recoveryAttemptsRef.current = 0;
        clearStallWatchdog();
        setIsPlaying(true);
        setIsLoading(false);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        syncMediaSessionPosition(video.currentTime, video.duration);
      }
    };

    const onPause = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      if (!backgroundHandoffActiveRef.current) {
        clearStallWatchdog();
        setIsPlaying(false);
        setIsLoading(false);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused';
        }
        syncMediaSessionPosition(video.currentTime, video.duration);
      }
    };

    const onWaiting = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      if (userWantsPlayingRef.current) {
        setIsLoading(true);
        scheduleStallWatchdog();
      }
    };

    const onStalled = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      if (userWantsPlayingRef.current && (video.paused || video.readyState < 3)) {
        setIsLoading(true);
        scheduleStallWatchdog();
      }
    };

    const onSuspend = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      if (userWantsPlayingRef.current && (video.paused || video.readyState < 2)) {
        scheduleStallWatchdog();
      }
    };

    const onCanPlay = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      clearStallWatchdog();
      setIsLoading(false);
    };

    const onSeeked = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      if (video.readyState >= 3 || !userWantsPlayingRef.current) {
        clearStallWatchdog();
        setIsLoading(false);
      }
      syncMediaSessionPosition(video.currentTime, video.duration);
    };

    const onEnded = () => {
      if (stateRef.current.activeEngine === 'native-video') handleTrackEndedRef.current();
    };

    const onError = () => {
      const track = currentTrackRef.current;
      if (!track || stateRef.current.activeEngine !== 'native-video') return;
      if (userWantsPlayingRef.current) {
        void recoverPlaybackRef.current('video-error');
      } else {
        clearStallWatchdog();
        setIsLoading(false);
        setIsPlaying(false);
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('suspend', onSuspend);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMeta);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('suspend', onSuspend);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [checkSponsorSkip, clearStallWatchdog, scheduleStallWatchdog, syncMediaSessionPosition]);

  // Poll YT Privacy Engine progress & SponsorBlock watcher at 250ms when active
  useEffect(() => {
    if (activeEngine !== 'yt-privacy' || !currentTrack) return;

    const timer = window.setInterval(() => {
      const p = ytPlayerRef.current;
      if (!p || !ytReadyRef.current) return;
      try {
        const now = p.getCurrentTime();
        const dur = p.getDuration();
        const frac = p.getVideoLoadedFraction();
        if (Number.isFinite(now)) {
          lastKnownTimeRef.current = now;
          setCurrentTime(now);
          checkSponsorSkip(now, dur, (target) => p.seekTo(target, true));
        }
        if (Number.isFinite(dur) && dur > 0) {
          setDuration(dur);
          if (Number.isFinite(frac)) setBuffered(dur * frac);
          const perfNow = Date.now();
          if (Number.isFinite(now) && perfNow - lastPositionSyncAtRef.current >= 900) {
            lastPositionSyncAtRef.current = perfNow;
            syncMediaSessionPosition(now, dur);
          }
        }
      } catch {
        // Player transitioning
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [activeEngine, checkSponsorSkip, currentTrack, syncMediaSessionPosition]);

  // Sync volume & playback rate across ALL 3 engines
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
      videoRef.current.muted = isMuted;
    }
    if (ytPlayerRef.current && ytReadyRef.current) {
      if (isMuted) ytPlayerRef.current.mute();
      else {
        ytPlayerRef.current.unMute();
        ytPlayerRef.current.setVolume(Math.round(volume * 100));
      }
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
    if (ytPlayerRef.current && ytReadyRef.current) {
      try {
        ytPlayerRef.current.setPlaybackRate(playbackRate);
      } catch {
        // Ignore
      }
    }
  }, [playbackRate]);

  // Auto-fetch related tracks near end of queue
  useEffect(() => {
    if (!currentTrack) return;
    if (queue.length - currentIndex <= 2) {
      const params = new URLSearchParams({
        title: currentTrack.title,
        author: currentTrack.author,
      });
      fetch(`/api/related/${currentTrack.id}?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : { tracks: [] }))
        .then((data: { tracks?: TrackItem[] }) => {
          const incoming = data.tracks || [];
          if (incoming.length === 0) return;
          setQueue((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const unique = incoming.filter((t) => !existingIds.has(t.id)).slice(0, 6);
            return unique.length > 0 ? [...prev, ...unique] : prev;
          });
        })
        .catch(() => {});
    }
  }, [currentTrack, currentIndex, queue.length]);

  // Sleep timer countdown
  useEffect(() => {
    if (!sleepEndsAt) {
      setSleepRemainingSec(0);
      return;
    }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((sleepEndsAt - Date.now()) / 1000));
      setSleepRemainingSec(rem);
      if (rem <= 0) {
        setSleepEndsAt(null);
        userWantsPlayingRef.current = false;
        stopAllEngines();
        setIsPlaying(false);
        setIsLoading(false);
        onNotice('Hẹn giờ tắt đã dừng phát nhạc.');
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sleepEndsAt, onNotice, stopAllEngines]);

  // Try upgrading from fallback yt-privacy iframe back to native background-capable stream
  const retryNativeStream = useCallback(
    async (options?: { fresh?: boolean; fromUserGesture?: boolean }): Promise<boolean> => {
      const track = currentTrackRef.current;
      if (!track || isRetryingNativeRef.current) return false;

      if (options?.fromUserGesture) {
        unlockAudioSync();
      }
      isRetryingNativeRef.current = true;
      setIsRetryingNative(true);

      const trackIdAtStart = track.id;
      const resumeAt =
        stateRef.current.activeEngine === 'yt-privacy'
          ? ytPlayerRef.current?.getCurrentTime?.() || lastKnownTimeRef.current || 0
          : lastKnownTimeRef.current || 0;

      try {
        const resolved = await resolveTrackStreams(trackIdAtStart, options?.fresh ?? true);
        if (currentTrackRef.current?.id !== trackIdAtStart) return false;

        if (resolved.audioUrl || resolved.videoUrl) {
          mediaUrlsRef.current = resolved;
          setStreamSourceLabel(resolved.sourceLabel);

          const shouldPlay = userWantsPlayingRef.current;
          const preferVideo =
            stateRef.current.playMode === 'video' && !document.hidden && Boolean(resolved.videoUrl);

          if (preferVideo && resolved.videoUrl) {
            startNativeVideo(resolved.videoUrl, resumeAt, shouldPlay, true);
            return true;
          }

          const audioCandidate = resolved.audioUrl || resolved.videoUrl;
          if (audioCandidate) {
            if (stateRef.current.playMode === 'video' && document.hidden) {
              backgroundHandoffActiveRef.current = true;
            }
            startNativeAudio(audioCandidate, resumeAt, shouldPlay, true);
            return true;
          }
        }
        return false;
      } finally {
        isRetryingNativeRef.current = false;
        setIsRetryingNative(false);
      }
    },
    [resolveTrackStreams, startNativeAudio, startNativeVideo, unlockAudioSync]
  );

  const retryNativeStreamRef = useRef<
    (options?: { fresh?: boolean; fromUserGesture?: boolean }) => Promise<boolean>
  >(async () => false);
  retryNativeStreamRef.current = retryNativeStream;

  // Silent automatic background retry loop whenever falling back to yt-privacy (Audio & Video modes)
  useEffect(() => {
    if (activeEngine !== 'yt-privacy' || !currentTrack?.id) return;

    let cancelled = false;
    let timerId: number | null = null;
    let attemptIndex = 0;
    const RETRY_DELAYS_MS = [4000, 10000, 20000, 35000, 60000];

    const runAutoRetry = async () => {
      if (cancelled || !currentTrackRef.current) return;
      if (stateRef.current.activeEngine !== 'yt-privacy') return;

      const ok = await retryNativeStreamRef.current({ fresh: true, fromUserGesture: false });
      if (cancelled || ok || stateRef.current.activeEngine !== 'yt-privacy') return;

      const delay = RETRY_DELAYS_MS[Math.min(attemptIndex, RETRY_DELAYS_MS.length - 1)];
      attemptIndex += 1;
      timerId = window.setTimeout(() => {
        void runAutoRetry();
      }, delay);
    };

    timerId = window.setTimeout(() => {
      void runAutoRetry();
    }, RETRY_DELAYS_MS[0]);

    const onReconnectOrWake = () => {
      if (cancelled || stateRef.current.activeEngine !== 'yt-privacy') return;
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      void runAutoRetry();
    };

    window.addEventListener('online', onReconnectOrWake);
    document.addEventListener('visibilitychange', onReconnectOrWake);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener('online', onReconnectOrWake);
      document.removeEventListener('visibilitychange', onReconnectOrWake);
    };
  }, [activeEngine, currentTrack?.id]);

  // Unified Transport Controls
  const togglePlay = useCallback(() => {
    if (!currentTrackRef.current) return;
    unlockAudioSync();
    const eng = stateRef.current.activeEngine;

    if (eng === 'native-audio' && audioRef.current) {
      const audio = audioRef.current;
      if (audio.paused) {
        userWantsPlayingRef.current = true;
        recoveryAttemptsRef.current = 0;
        if (!audio.src || audio.src.startsWith('data:audio/wav') || audio.error || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
          void recoverPlaybackRef.current('toggle-play-empty');
          return;
        }
        scheduleStallWatchdog();
        audio
          .play()
          .then(() => {
            clearStallWatchdog();
            setIsPlaying(true);
            setIsLoading(false);
          })
          .catch(() => {
            void recoverPlaybackRef.current('toggle-play-rejected');
          });
      } else {
        userWantsPlayingRef.current = false;
        clearStallWatchdog();
        setIsLoading(false);
        audio.pause();
      }
    } else if (eng === 'native-video' && videoRef.current) {
      const video = videoRef.current;
      if (video.paused) {
        userWantsPlayingRef.current = true;
        recoveryAttemptsRef.current = 0;
        if (!video.src || video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
          void recoverPlaybackRef.current('toggle-video-empty');
          return;
        }
        scheduleStallWatchdog();
        video
          .play()
          .then(() => {
            clearStallWatchdog();
            setIsPlaying(true);
            setIsLoading(false);
          })
          .catch(() => {
            void recoverPlaybackRef.current('toggle-video-rejected');
          });
      } else {
        userWantsPlayingRef.current = false;
        clearStallWatchdog();
        setIsLoading(false);
        video.pause();
      }
    } else if (eng === 'yt-privacy') {
      if (stateRef.current.isPlaying) {
        userWantsPlayingRef.current = false;
        ytPlayerRef.current?.pauseVideo?.();
      } else {
        userWantsPlayingRef.current = true;
        if (ytPlayerRef.current && ytReadyRef.current) {
          ytPlayerRef.current.playVideo();
        }
        // Automatically try upgrading from iframe fallback to native stream on Play tap
        void retryNativeStream();
      }
    }
  }, [clearStallWatchdog, retryNativeStream, scheduleStallWatchdog, unlockAudioSync]);

  const seekTo = useCallback(
    (seconds: number) => {
      ensureAudioContext();
      const dur = stateRef.current.duration;
      const clamped = Math.max(0, Math.min(seconds, dur || seconds));
      const eng = stateRef.current.activeEngine;
      if (eng === 'native-audio' && audioRef.current) {
        audioRef.current.currentTime = clamped;
      } else if (eng === 'native-video' && videoRef.current) {
        videoRef.current.currentTime = clamped;
      } else if (ytPlayerRef.current && ytReadyRef.current) {
        ytPlayerRef.current.seekTo(clamped, true);
      }
      lastKnownTimeRef.current = clamped;
      setCurrentTime(clamped);
      syncMediaSessionPosition(clamped);
    },
    [ensureAudioContext, syncMediaSessionPosition]
  );

  const skipBy = useCallback(
    (delta: number) => {
      seekTo(lastKnownTimeRef.current + delta);
    },
    [seekTo]
  );

  // Seamless Audio <-> Video switch preserving exact playback second
  const switchPlayMode = useCallback(
    (targetMode: PlayMode) => {
      if (targetMode === playMode) return;
      unlockAudioSync();
      setPlayMode(targetMode);
      try {
        localStorage.setItem(PLAY_MODE_STORAGE_KEY, targetMode);
      } catch {
        // Ignore storage errors
      }
      const track = currentTrackRef.current;
      if (!track) return;

      recoveryAttemptsRef.current = 0;
      backgroundHandoffActiveRef.current = false;
      const { audioUrl, videoUrl } = mediaUrlsRef.current;
      const wasPlaying = userWantsPlayingRef.current || stateRef.current.isPlaying;

      if (targetMode === 'video') {
        if (videoUrl) {
          const resumeAt =
            stateRef.current.activeEngine === 'native-audio'
              ? audioRef.current?.currentTime || lastKnownTimeRef.current
              : lastKnownTimeRef.current;
          setIsLoading(true);
          startNativeVideo(videoUrl, resumeAt, wasPlaying);
        } else if (stateRef.current.activeEngine !== 'yt-privacy') {
          const resumeAt = audioRef.current?.currentTime || lastKnownTimeRef.current;
          void ensureYtPlayer(track.id, resumeAt);
        }
      } else {
        if (audioUrl) {
          const resumeAt =
            stateRef.current.activeEngine === 'native-video'
              ? videoRef.current?.currentTime || lastKnownTimeRef.current
              : stateRef.current.activeEngine === 'yt-privacy'
              ? ytPlayerRef.current?.getCurrentTime?.() || lastKnownTimeRef.current
              : lastKnownTimeRef.current;
          setIsLoading(true);
          startNativeAudio(audioUrl, resumeAt, wasPlaying);
        }
        // If only yt-privacy is available, playMode switches cleanly to Audio-Focus view with 0ms reload
      }
    },
    [ensureYtPlayer, playMode, startNativeAudio, startNativeVideo, unlockAudioSync]
  );

  // Native Picture-in-Picture (floating video window on Desktop & iOS/Android)
  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || stateRef.current.activeEngine !== 'native-video') {
      onNotice('Chế độ cửa sổ nổi (PiP) khả dụng khi đang phát Video gốc.');
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture();
      } else {
        const webkitVideo = video as unknown as {
          webkitSetPresentationMode?: (mode: string) => void;
          webkitPresentationMode?: string;
        };
        if (typeof webkitVideo.webkitSetPresentationMode === 'function') {
          webkitVideo.webkitSetPresentationMode(
            webkitVideo.webkitPresentationMode === 'picture-in-picture'
              ? 'inline'
              : 'picture-in-picture'
          );
        }
      }
    } catch {
      onNotice('Trình duyệt hiện tại không cho phép bật cửa sổ nổi PiP.');
    }
  }, [onNotice]);

  // Attempt native OS / iOS fullscreen cleanly when permitted without showing errors if blocked
  const requestNativeVideoFullscreen = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitDisplayingFullscreen?: boolean;
        })
      | null;
    if (!video || stateRef.current.activeEngine !== 'native-video') return false;
    try {
      if (typeof video.webkitEnterFullscreen === 'function') {
        if (!video.webkitDisplayingFullscreen) {
          video.webkitEnterFullscreen();
        }
        return true;
      }
      if (typeof video.requestFullscreen === 'function' && !document.fullscreenElement) {
        await video.requestFullscreen();
        return true;
      }
    } catch {
      // Async native fullscreen can be blocked by iOS/browser; in-app edge-to-edge fullscreen remains active
    }
    return false;
  }, []);

  const exitNativeVideoFullscreen = useCallback(() => {
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitExitFullscreen?: () => void;
          webkitDisplayingFullscreen?: boolean;
        })
      | null;
    try {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        void document.exitFullscreen().catch(() => {});
      }
      if (video?.webkitDisplayingFullscreen && typeof video.webkitExitFullscreen === 'function') {
        video.webkitExitFullscreen();
      }
    } catch {
      // Ignore
    }
  }, []);

  // 1. Lock-Screen Media Session Metadata (updates only when track changes)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }

    const thumb =
      currentTrack.thumbnail || `https://i.ytimg.com/vi/${currentTrack.id}/hqdefault.jpg`;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.author,
      album: 'Music Tube · Không quảng cáo',
      artwork: [
        { src: thumb, sizes: '320x180', type: 'image/jpeg' },
        {
          src: `https://i.ytimg.com/vi/${currentTrack.id}/hqdefault.jpg`,
          sizes: '480x360',
          type: 'image/jpeg',
        },
        {
          src: `https://i.ytimg.com/vi/${currentTrack.id}/maxresdefault.jpg`,
          sizes: '1280x720',
          type: 'image/jpeg',
        },
      ],
    });
  }, [currentTrack]);

  // 2. Lock-Screen Media Session PlaybackState sync
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = currentTrack
      ? isPlaying
        ? 'playing'
        : 'paused'
      : 'none';
  }, [currentTrack, isPlaying]);

  // 3. Stable Lock-Screen Media Session Action Handlers (never torn down on timeupdate)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!currentTrack) return;

    const safeSet = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported action on this browser
      }
    };

    safeSet('play', () => {
      ensureAudioContext();
      userWantsPlayingRef.current = true;
      recoveryAttemptsRef.current = 0;

      const eng = stateRef.current.activeEngine;
      const audio = audioRef.current;
      const video = videoRef.current;

      if (eng === 'yt-privacy') {
        if (!document.hidden) {
          ytPlayerRef.current?.playVideo?.();
        } else {
          navigator.mediaSession.playbackState = 'paused';
          setIsPlaying(false);
        }
        void retryNativeStreamRef.current({ fresh: true, fromUserGesture: true }).then((ok) => {
          if (!ok && document.hidden) {
            navigator.mediaSession.playbackState = 'paused';
            setIsPlaying(false);
          }
        });
        return;
      }

      // If locked/hidden while in native-video mode (not PiP), hand off and call audio.play() SYNCHRONOUSLY
      const isInPiP = video ? document.pictureInPictureElement === video : false;

      if (document.hidden && eng === 'native-video' && !isInPiP && audio) {
        const { audioUrl, videoUrl } = mediaUrlsRef.current;
        const targetAudioUrl = audioUrl || videoUrl;
        const trackId = currentTrackRef.current?.id;
        const cachedBlob = trackId ? getCachedBlobUrl(`audio:${trackId}`) : null;
        const preferredUrl = cachedBlob || targetAudioUrl;
        const resumeAt = Math.max(video?.currentTime || 0, lastKnownTimeRef.current || 0);
        lastKnownTimeRef.current = resumeAt;
        backgroundHandoffActiveRef.current = true;
        video?.pause();
        setActiveEngine('native-audio');

        const currentAttr = audio.getAttribute('data-stream-url') || '';
        const alreadyPrepared =
          audio.readyState >= 1 &&
          Boolean(currentAttr) &&
          !currentAttr.startsWith('data:audio/wav') &&
          (currentAttr === targetAudioUrl ||
            (Boolean(cachedBlob) && currentAttr === cachedBlob) ||
            currentAttr.startsWith('blob:'));

        if (!alreadyPrepared && preferredUrl && currentAttr !== preferredUrl) {
          audio.preload = 'auto';
          audio.setAttribute('data-stream-url', preferredUrl);
          audio.src = preferredUrl;
        }
        if (resumeAt > 0.5 && Number.isFinite(audio.duration) && resumeAt < audio.duration) {
          try {
            audio.currentTime = resumeAt;
          } catch {
            // Seek after reload if needed
          }
        }
        navigator.mediaSession.playbackState = 'playing';
        const p = audio.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            clearStallWatchdog();
            setIsPlaying(true);
            setIsLoading(false);
          }).catch(() => {
            void recoverPlaybackRef.current('mediasession-play-video-handoff');
          });
        }
        return;
      }

      const activeEl = eng === 'native-video' ? video : audio;
      if (!activeEl) return;

      // Always call play() SYNCHRONOUSLY first inside the handler before any async recovery
      const currentSrc = activeEl.getAttribute('src') || '';
      if (!currentSrc || currentSrc.startsWith('data:audio/wav')) {
        void recoverPlaybackRef.current('mediasession-play-empty');
        return;
      }

      navigator.mediaSession.playbackState = 'playing';
      scheduleStallWatchdog();
      const playPromise = activeEl.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            clearStallWatchdog();
            setIsPlaying(true);
            setIsLoading(false);
          })
          .catch(() => {
            void recoverPlaybackRef.current('mediasession-play-rejected');
          });
      }
    });

    safeSet('pause', () => {
      userWantsPlayingRef.current = false;
      clearStallWatchdog();
      stopAllEngines();
      setIsPlaying(false);
      setIsLoading(false);
      navigator.mediaSession.playbackState = 'paused';
    });

    safeSet('previoustrack', () => playPrev());
    safeSet('nexttrack', () => playNext());
    safeSet('seekbackward', (d) => skipBy(-(d.seekOffset || 10)));
    safeSet('seekforward', (d) => skipBy(d.seekOffset || 10));
    safeSet('seekto', (d) => {
      if (typeof d.seekTime === 'number') seekTo(d.seekTime);
    });
    safeSet('stop', () => {
      userWantsPlayingRef.current = false;
      clearStallWatchdog();
      stopAllEngines();
      setIsPlaying(false);
      setIsLoading(false);
      navigator.mediaSession.playbackState = 'none';
    });
  }, [
    clearStallWatchdog,
    currentTrack,
    ensureAudioContext,
    getCachedBlobUrl,
    onNotice,
    playNext,
    playPrev,
    scheduleStallWatchdog,
    seekTo,
    skipBy,
    stopAllEngines,
  ]);

  // 4. Lock-Screen Media Session PositionState sync
  useEffect(() => {
    syncMediaSessionPosition(currentTime, duration);
  }, [currentTime, duration, playbackRate, syncMediaSessionPosition]);

  useEffect(() => {
    return () => {
      ytPlayerRef.current?.destroy?.();
      ytPlayerRef.current = null;
    };
  }, []);

  // Queue Actions
  const playTrack = useCallback(
    (track: TrackItem, list?: TrackItem[]) => {
      unlockAudioSync();
      userWantsPlayingRef.current = true;
      recoveryAttemptsRef.current = 0;

      if (list && list.length > 0) {
        const idx = list.findIndex((t) => t.id === track.id);
        if (idx >= 0) {
          setQueue(list);
          setCurrentIndex(idx);
          return;
        }
        setQueue([track, ...list]);
        setCurrentIndex(0);
        return;
      }

      setQueue((prev) => {
        const existing = prev.findIndex((t) => t.id === track.id);
        if (existing >= 0) {
          setCurrentIndex(existing);
          return prev;
        }
        const nextQueue = [...prev, track];
        setCurrentIndex(nextQueue.length - 1);
        return nextQueue;
      });
    },
    [unlockAudioSync]
  );

  const addToQueue = useCallback(
    (track: TrackItem) => {
      setQueue((prev) => {
        if (prev.some((t) => t.id === track.id)) {
          onNotice('Bài này đã có trong hàng đợi phát.');
          return prev;
        }
        onNotice('Đã thêm vào hàng đợi phát.');
        if (prev.length === 0) {
          unlockAudioSync();
          userWantsPlayingRef.current = true;
          setCurrentIndex(0);
        }
        return [...prev, track];
      });
    },
    [onNotice, unlockAudioSync]
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      setQueue((prev) => {
        const next = prev.filter((_, i) => i !== index);
        if (index < currentIndex) {
          setCurrentIndex((c) => c - 1);
        } else if (index === currentIndex) {
          if (next.length === 0) {
            userWantsPlayingRef.current = false;
            setCurrentIndex(-1);
            stopAllEngines();
            setIsPlaying(false);
            setIsLoading(false);
          } else {
            userWantsPlayingRef.current = true;
            setCurrentIndex(Math.min(index, next.length - 1));
          }
        }
        return next;
      });
    },
    [currentIndex, stopAllEngines]
  );

  const selectQueueIndex = useCallback(
    (index: number) => {
      unlockAudioSync();
      userWantsPlayingRef.current = true;
      recoveryAttemptsRef.current = 0;
      setCurrentIndex(index);
    },
    [unlockAudioSync]
  );

  const setSleepTimerMinutes = useCallback(
    (minutes: number | 'end-of-track' | null) => {
      if (minutes === null) {
        setSleepEndsAt(null);
        setSleepEndOfTrack(false);
        onNotice('Đã tắt hẹn giờ.');
        return;
      }
      if (minutes === 'end-of-track') {
        setSleepEndsAt(null);
        setSleepEndOfTrack(true);
        onNotice('Sẽ tự động dừng khi hết bài hiện tại.');
        return;
      }
      const clamped = Math.max(1, Math.min(720, Math.round(minutes)));
      setSleepEndOfTrack(false);
      setSleepEndsAt(Date.now() + clamped * 60_000);
      const hrs = Math.floor(clamped / 60);
      const mins = clamped % 60;
      const label =
        hrs > 0
          ? mins > 0
            ? `${hrs} giờ ${mins} phút`
            : `${hrs} giờ`
          : `${mins} phút`;
      onNotice(`Đã đặt hẹn giờ tắt sau ${label}.`);
    },
    [onNotice]
  );

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  }, []);

  return {
    audioRef,
    videoRef,
    ytContainerRef,
    queue,
    currentIndex,
    currentTrack,
    playMode,
    activeEngine,
    streamSourceLabel,
    isRetryingNative,
    isPiPSupported,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    buffered,
    volume,
    isMuted,
    playbackRate,
    repeatMode,
    isShuffled,
    segments,
    sleepEndsAt,
    sleepEndOfTrack,
    sleepRemainingSec,
    setVolume,
    setIsMuted,
    setPlaybackRate,
    setIsShuffled,
    cycleRepeatMode,
    playTrack,
    addToQueue,
    removeFromQueue,
    selectQueueIndex,
    togglePlay,
    playNext,
    playPrev,
    seekTo,
    skipBy,
    switchPlayMode,
    retryNativeStream,
    prefetchTracks,
    togglePictureInPicture,
    requestNativeVideoFullscreen,
    exitNativeVideoFullscreen,
    setSleepTimerMinutes,
  };
}
