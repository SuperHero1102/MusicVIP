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

/**
 * Tier-2 residential-IP fallback: runs in the user's browser (residential/mobile IP)
 * when the cloud server IP is rate-limited by YouTube anti-bot checks.
 */
async function probeClientDirectStreams(videoId: string): Promise<{ audioUrl: string | null; videoUrl: string | null } | null> {
  const pipedHosts = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
  ];

  const probes = pipedHosts.map(async (host) => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2400);
    try {
      const r = await fetch(`${host}/streams/${videoId}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error('status');
      const data = (await r.json()) as {
        audioStreams?: Array<{ url?: string; mimeType?: string; bitrate?: number }>;
        videoStreams?: Array<{ url?: string; mimeType?: string; videoOnly?: boolean; quality?: string }>;
      };
      const bestAudio = (data.audioStreams || [])
        .filter((s) => s.url)
        .sort((a, b) => {
          const aMp4 = a.mimeType?.includes('mp4') || a.mimeType?.includes('m4a') ? 1 : 0;
          const bMp4 = b.mimeType?.includes('mp4') || b.mimeType?.includes('m4a') ? 1 : 0;
          if (aMp4 !== bMp4) return bMp4 - aMp4;
          return (b.bitrate || 0) - (a.bitrate || 0);
        })[0];
      const bestVideo = (data.videoStreams || [])
        .filter((s) => s.url && !s.videoOnly && s.mimeType?.includes('mp4'))
        .sort((a, b) => parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10))[0];

      if (!bestAudio?.url && !bestVideo?.url) throw new Error('empty');
      return {
        audioUrl: bestAudio?.url || bestVideo?.url || null,
        videoUrl: bestVideo?.url || null,
      };
    } finally {
      window.clearTimeout(timer);
    }
  });

  try {
    return await Promise.any(probes);
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

  const mediaUrlsRef = useRef<ResolvedMediaUrls>({
    audioUrl: null,
    videoUrl: null,
    sourceLabel: null,
    botCheckBlocked: false,
  });

  const [queue, setQueue] = useState<TrackItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [playMode, setPlayMode] = useState<PlayMode>('audio');
  const [activeEngine, setActiveEngine] = useState<ActiveEngine>('native-audio');
  const [streamSourceLabel, setStreamSourceLabel] = useState<string | null>(null);
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
  };

  const currentTrack: TrackItem | null =
    currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  // Initialize hidden native <audio> element once for guaranteed background lock-screen playback
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audioRef.current = audio;

    setIsPiPSupported(
      typeof document !== 'undefined' &&
        ('pictureInPictureEnabled' in document ||
          typeof (HTMLVideoElement.prototype as unknown as { webkitSetPresentationMode?: unknown })
            .webkitSetPresentationMode === 'function')
    );

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  const stopAllEngines = useCallback(() => {
    if (audioRef.current) {
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
  }, []);

  const playNext = useCallback(() => {
    setQueue((q) => {
      if (q.length === 0) return q;
      const { isShuffled: shuf, repeatMode: rep } = stateRef.current;
      setCurrentIndex((idx) => {
        if (shuf && q.length > 1) {
          let nextIdx = idx;
          while (nextIdx === idx) {
            nextIdx = Math.floor(Math.random() * q.length);
          }
          return nextIdx;
        }
        if (idx < q.length - 1) return idx + 1;
        if (rep === 'all') return 0;
        setIsPlaying(false);
        return idx;
      });
      return q;
    });
  }, []);

  const playPrev = useCallback(() => {
    const eng = stateRef.current.activeEngine;
    const nowTime =
      eng === 'native-audio'
        ? audioRef.current?.currentTime || 0
        : eng === 'native-video'
        ? videoRef.current?.currentTime || 0
        : ytPlayerRef.current?.getCurrentTime?.() || 0;

    if (nowTime > 4) {
      if (eng === 'native-audio' && audioRef.current) audioRef.current.currentTime = 0;
      else if (eng === 'native-video' && videoRef.current) videoRef.current.currentTime = 0;
      else ytPlayerRef.current?.seekTo(0, true);
      setCurrentTime(0);
      return;
    }

    if (queue.length === 0) return;
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    } else if (repeatMode === 'all') {
      setCurrentIndex(queue.length - 1);
    }
  }, [currentIndex, queue.length, repeatMode]);

  const handleTrackEnded = useCallback(() => {
    const { sleepEndOfTrack: stopAtEnd, repeatMode: rep, activeEngine: eng } = stateRef.current;
    if (stopAtEnd) {
      setSleepEndOfTrack(false);
      setIsPlaying(false);
      onNotice('Hẹn giờ tắt: đã dừng phát khi kết thúc bài.');
      return;
    }
    if (rep === 'one') {
      skippedUuidsRef.current.clear();
      if (eng === 'native-audio' && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      } else if (eng === 'native-video' && videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
      } else if (ytPlayerRef.current) {
        ytPlayerRef.current.seekTo(0, true);
        ytPlayerRef.current.playVideo();
      }
      return;
    }
    playNext();
  }, [onNotice, playNext]);

  const handleTrackEndedRef = useRef(handleTrackEnded);
  handleTrackEndedRef.current = handleTrackEnded;

  const startNativeAudio = useCallback(
    (url: string, startAt = 0, shouldPlay = true) => {
      const audio = audioRef.current;
      if (!audio) return;
      videoRef.current?.pause();
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        // Ignore
      }
      setActiveEngine('native-audio');
      const needsLoad = audio.getAttribute('data-stream-url') !== url;
      if (needsLoad) {
        audio.setAttribute('data-stream-url', url);
        audio.src = url;
        audio.load();
      }
      audio.playbackRate = stateRef.current.playbackRate;
      audio.volume = stateRef.current.isMuted ? 0 : stateRef.current.volume;

      const finishStart = () => {
        if (startAt > 0.5 && Number.isFinite(audio.duration) && startAt < audio.duration) {
          audio.currentTime = startAt;
        }
        if (shouldPlay) {
          audio
            .play()
            .then(() => {
              setIsPlaying(true);
              setIsLoading(false);
            })
            .catch(() => {
              setIsLoading(false);
              setIsPlaying(false);
            });
        } else {
          setIsLoading(false);
        }
      };

      if (!needsLoad && audio.readyState >= 1) {
        finishStart();
      } else {
        const onMeta = () => {
          audio.removeEventListener('loadedmetadata', onMeta);
          finishStart();
        };
        audio.addEventListener('loadedmetadata', onMeta);
      }
    },
    []
  );

  const startNativeVideo = useCallback(
    (url: string, startAt = 0, shouldPlay = true) => {
      const video = videoRef.current;
      if (!video) return;
      audioRef.current?.pause();
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        // Ignore
      }
      setActiveEngine('native-video');
      const needsLoad = video.getAttribute('data-stream-url') !== url;
      if (needsLoad) {
        video.setAttribute('data-stream-url', url);
        video.src = url;
        video.load();
      }
      video.playbackRate = stateRef.current.playbackRate;
      video.volume = stateRef.current.isMuted ? 0 : stateRef.current.volume;
      video.muted = stateRef.current.isMuted;

      const finishStart = () => {
        if (startAt > 0.5 && Number.isFinite(video.duration) && startAt < video.duration) {
          video.currentTime = startAt;
        }
        if (shouldPlay) {
          video
            .play()
            .then(() => {
              setIsPlaying(true);
              setIsLoading(false);
            })
            .catch(() => {
              setIsLoading(false);
              setIsPlaying(false);
            });
        } else {
          setIsLoading(false);
        }
      };

      if (!needsLoad && video.readyState >= 1) {
        finishStart();
      } else {
        const onMeta = () => {
          video.removeEventListener('loadedmetadata', onMeta);
          finishStart();
        };
        video.addEventListener('loadedmetadata', onMeta);
      }
    },
    []
  );

  // Persistent singleton YT.Player fallback when both Tier-1 server and Tier-2 browser streams are blocked
  const ensureYtPlayer = useCallback(
    async (videoId: string, startSeconds = 0) => {
      pendingYtTrackRef.current = videoId;
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
            if (d && d > 0) setDuration(d);
            setIsLoading(false);
          },
          onStateChange: (e) => {
            if (stateRef.current.activeEngine !== 'yt-privacy') return;
            const st = e.data;
            if (st === 1) {
              setIsPlaying(true);
              setIsLoading(false);
              const d = e.target.getDuration?.();
              if (d && d > 0) setDuration(d);
            } else if (st === 2) {
              setIsPlaying(false);
            } else if (st === 3) {
              setIsLoading(true);
            } else if (st === 0) {
              handleTrackEndedRef.current();
            }
          },
          onError: () => {
            setIsLoading(false);
            setIsPlaying(false);
            onNotice('Video này bị chủ sở hữu hạn chế nhúng — vui lòng chọn bài khác.');
          },
        },
      });
    },
    [onNotice]
  );

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
          doSeek(target);
          setCurrentTime(target);
          const saved = Math.max(1, Math.round(seg.end - now));
          const label = SPONSOR_CATEGORY_LABELS[seg.category]?.label || 'Quảng cáo';
          onSponsorSkip(saved, label);
          break;
        }
      }
    },
    [onSponsorSkip]
  );

  // Load track streams (Tier 1 Server Proxy -> Tier 2 Client Residential IP -> Tier 3 YT Privacy)
  useEffect(() => {
    if (!currentTrack) return;

    let cancelled = false;
    skippedUuidsRef.current.clear();
    backgroundHandoffActiveRef.current = false;
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

    (async () => {
      // Tier 1: Server-side verified YouTube direct HTTP 206 Audio & Video streams
      let audioUrl: string | null = null;
      let videoUrl: string | null = null;
      let sourceLabel: string | null = null;
      let botCheckBlocked = false;

      try {
        const resp = await fetch(`/api/media-meta/${currentTrack.id}`);
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
          if (audioUrl || videoUrl) {
            sourceLabel = meta.videoQuality
              ? `Luồng gốc không quảng cáo (${meta.videoQuality})`
              : 'Luồng gốc không quảng cáo';
          }
        }
      } catch {
        // Proceed to Tier 2
      }

      if (cancelled) return;

      // Tier 2: Browser residential-IP direct stream probe when Cloud IP hit YouTube anti-bot wall
      if (!audioUrl && !videoUrl) {
        const clientResolved = await probeClientDirectStreams(currentTrack.id);
        if (cancelled) return;
        if (clientResolved) {
          audioUrl = clientResolved.audioUrl;
          videoUrl = clientResolved.videoUrl;
          sourceLabel = 'Luồng trực tiếp không quảng cáo';
        }
      }

      mediaUrlsRef.current = { audioUrl, videoUrl, sourceLabel, botCheckBlocked };
      setStreamSourceLabel(sourceLabel);

      const desiredMode = stateRef.current.playMode;
      if (desiredMode === 'video' && videoUrl) {
        startNativeVideo(videoUrl, 0, true);
      } else if (desiredMode === 'audio' && audioUrl) {
        startNativeAudio(audioUrl, 0, true);
      } else if (audioUrl) {
        startNativeAudio(audioUrl, 0, true);
      } else if (videoUrl) {
        startNativeVideo(videoUrl, 0, true);
      } else {
        // Tier 3: Honest YouTube Privacy fallback (still runs live SponsorBlock auto-skip)
        setStreamSourceLabel('Nguồn dự phòng YouTube (IP đám mây bị giới hạn trích xuất gốc)');
        void ensureYtPlayer(currentTrack.id, 0);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // REAL LOCK-SCREEN / SCREEN-OFF CONTINUITY FOR VIDEO MODE:
  // On mobile browsers (iOS Safari / Android Chrome), locking the screen pauses <video>.
  // When hidden while playing native-video (and not in PiP), seamlessly hand off to native <audio>
  // at the exact timestamp so audio NEVER stops when the screen turns off!
  useEffect(() => {
    const handleVisibilityChange = () => {
      const video = videoRef.current;
      const audio = audioRef.current;
      const { audioUrl, videoUrl } = mediaUrlsRef.current;
      if (!video || !audio) return;

      if (document.hidden) {
        const isInPiP = document.pictureInPictureElement === video;
        if (
          stateRef.current.activeEngine === 'native-video' &&
          !video.paused &&
          !isInPiP &&
          (audioUrl || videoUrl)
        ) {
          const resumeAt = video.currentTime;
          backgroundHandoffActiveRef.current = true;
          video.pause();
          startNativeAudio(audioUrl || videoUrl!, resumeAt, true);
        }
      } else if (backgroundHandoffActiveRef.current) {
        backgroundHandoffActiveRef.current = false;
        if (stateRef.current.playMode === 'video' && videoUrl) {
          const resumeAt = audio.currentTime;
          const wasPlaying = !audio.paused;
          audio.pause();
          startNativeVideo(videoUrl, resumeAt, wasPlaying);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [startNativeAudio, startNativeVideo]);

  // Attach native <audio> listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (stateRef.current.activeEngine !== 'native-audio') return;
      const now = audio.currentTime;
      setCurrentTime(now);
      if (audio.buffered.length > 0) {
        setBuffered(audio.buffered.end(audio.buffered.length - 1));
      }
      checkSponsorSkip(now, audio.duration, (target) => {
        audio.currentTime = target;
      });
    };

    const onLoadedMeta = () => {
      if (stateRef.current.activeEngine !== 'native-audio') return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      setIsLoading(false);
    };

    const onPlay = () => {
      if (stateRef.current.activeEngine === 'native-audio') {
        setIsPlaying(true);
        setIsLoading(false);
      }
    };
    const onPause = () => {
      if (stateRef.current.activeEngine === 'native-audio') setIsPlaying(false);
    };
    const onWaiting = () => {
      if (stateRef.current.activeEngine === 'native-audio') setIsLoading(true);
    };
    const onCanPlay = () => {
      if (stateRef.current.activeEngine === 'native-audio') setIsLoading(false);
    };
    const onEnded = () => {
      if (stateRef.current.activeEngine === 'native-audio') handleTrackEndedRef.current();
    };
    const onError = () => {
      if (!currentTrack || stateRef.current.activeEngine !== 'native-audio') return;
      if (mediaUrlsRef.current.videoUrl && audio.getAttribute('data-stream-url') !== mediaUrlsRef.current.videoUrl) {
        startNativeAudio(mediaUrlsRef.current.videoUrl, currentTime, true);
      } else {
        setStreamSourceLabel('Nguồn dự phòng YouTube (luồng âm thanh gặp sự cố)');
        void ensureYtPlayer(currentTrack.id, currentTime);
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [checkSponsorSkip, currentTime, currentTrack, ensureYtPlayer, startNativeAudio]);

  // Attach native <video> listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      const now = video.currentTime;
      setCurrentTime(now);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
      checkSponsorSkip(now, video.duration, (target) => {
        video.currentTime = target;
      });
    };

    const onLoadedMeta = () => {
      if (stateRef.current.activeEngine !== 'native-video') return;
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
      setIsLoading(false);
    };

    const onPlay = () => {
      if (stateRef.current.activeEngine === 'native-video') {
        setIsPlaying(true);
        setIsLoading(false);
      }
    };
    const onPause = () => {
      if (stateRef.current.activeEngine === 'native-video' && !backgroundHandoffActiveRef.current) {
        setIsPlaying(false);
      }
    };
    const onWaiting = () => {
      if (stateRef.current.activeEngine === 'native-video') setIsLoading(true);
    };
    const onCanPlay = () => {
      if (stateRef.current.activeEngine === 'native-video') setIsLoading(false);
    };
    const onEnded = () => {
      if (stateRef.current.activeEngine === 'native-video') handleTrackEndedRef.current();
    };
    const onError = () => {
      if (!currentTrack || stateRef.current.activeEngine !== 'native-video') return;
      setStreamSourceLabel('Nguồn dự phòng YouTube (luồng video gặp sự cố)');
      void ensureYtPlayer(currentTrack.id, currentTime);
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMeta);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [checkSponsorSkip, currentTime, currentTrack, ensureYtPlayer]);

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
          setCurrentTime(now);
          checkSponsorSkip(now, dur, (target) => p.seekTo(target, true));
        }
        if (Number.isFinite(dur) && dur > 0) {
          setDuration(dur);
          if (Number.isFinite(frac)) setBuffered(dur * frac);
        }
      } catch {
        // Player transitioning
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [activeEngine, checkSponsorSkip, currentTrack]);

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
        stopAllEngines();
        setIsPlaying(false);
        onNotice('Hẹn giờ tắt đã dừng phát nhạc.');
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sleepEndsAt, onNotice, stopAllEngines]);

  // Unified Transport Controls
  const togglePlay = useCallback(() => {
    if (!currentTrack) return;
    const eng = stateRef.current.activeEngine;
    if (eng === 'native-audio' && audioRef.current) {
      if (audioRef.current.paused) audioRef.current.play().catch(() => {});
      else audioRef.current.pause();
    } else if (eng === 'native-video' && videoRef.current) {
      if (videoRef.current.paused) videoRef.current.play().catch(() => {});
      else videoRef.current.pause();
    } else if (ytPlayerRef.current && ytReadyRef.current) {
      if (isPlaying) ytPlayerRef.current.pauseVideo();
      else ytPlayerRef.current.playVideo();
    }
  }, [currentTrack, isPlaying]);

  const seekTo = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, duration || seconds));
      const eng = stateRef.current.activeEngine;
      if (eng === 'native-audio' && audioRef.current) {
        audioRef.current.currentTime = clamped;
      } else if (eng === 'native-video' && videoRef.current) {
        videoRef.current.currentTime = clamped;
      } else if (ytPlayerRef.current && ytReadyRef.current) {
        ytPlayerRef.current.seekTo(clamped, true);
      }
      setCurrentTime(clamped);
    },
    [duration]
  );

  const skipBy = useCallback(
    (delta: number) => {
      seekTo(currentTime + delta);
    },
    [currentTime, seekTo]
  );

  // Seamless Audio <-> Video switch preserving exact playback second
  const switchPlayMode = useCallback(
    (targetMode: PlayMode) => {
      if (targetMode === playMode) return;
      setPlayMode(targetMode);
      if (!currentTrack) return;

      const { audioUrl, videoUrl } = mediaUrlsRef.current;
      const wasPlaying = stateRef.current.isPlaying;

      if (targetMode === 'video') {
        if (videoUrl) {
          const resumeAt =
            stateRef.current.activeEngine === 'native-audio'
              ? audioRef.current?.currentTime || currentTime
              : currentTime;
          setIsLoading(true);
          startNativeVideo(videoUrl, resumeAt, wasPlaying);
        } else if (stateRef.current.activeEngine !== 'yt-privacy') {
          const resumeAt = audioRef.current?.currentTime || currentTime;
          void ensureYtPlayer(currentTrack.id, resumeAt);
        }
      } else {
        if (audioUrl) {
          const resumeAt =
            stateRef.current.activeEngine === 'native-video'
              ? videoRef.current?.currentTime || currentTime
              : stateRef.current.activeEngine === 'yt-privacy'
              ? ytPlayerRef.current?.getCurrentTime?.() || currentTime
              : currentTime;
          setIsLoading(true);
          startNativeAudio(audioUrl, resumeAt, wasPlaying);
        }
        // If only yt-privacy is available, playMode switches cleanly to Audio-Focus view with 0ms reload
      }
    },
    [currentTime, currentTrack, ensureYtPlayer, playMode, startNativeAudio, startNativeVideo]
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

  // Lock-Screen Media Session API (iOS, Android, macOS, Windows)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    const thumb =
      currentTrack.thumbnail || `https://i.ytimg.com/vi/${currentTrack.id}/hqdefault.jpg`;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.author,
      album: 'PureStream · Không quảng cáo',
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

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    const safeSet = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported
      }
    };

    safeSet('play', () => {
      const eng = stateRef.current.activeEngine;
      if (eng === 'native-audio') audioRef.current?.play().catch(() => {});
      else if (eng === 'native-video') videoRef.current?.play().catch(() => {});
      else ytPlayerRef.current?.playVideo?.();
      setIsPlaying(true);
    });
    safeSet('pause', () => {
      stopAllEngines();
      setIsPlaying(false);
    });
    safeSet('previoustrack', () => playPrev());
    safeSet('nexttrack', () => playNext());
    safeSet('seekbackward', (d) => skipBy(-(d.seekOffset || 10)));
    safeSet('seekforward', (d) => skipBy(d.seekOffset || 10));
    safeSet('seekto', (d) => {
      if (typeof d.seekTime === 'number') seekTo(d.seekTime);
    });
    safeSet('stop', () => {
      stopAllEngines();
      setIsPlaying(false);
    });
  }, [currentTrack, isPlaying, playNext, playPrev, seekTo, skipBy, stopAllEngines]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    if (!duration || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position: Math.min(Math.max(0, currentTime), duration),
      });
    } catch {
      // Ignore transient invalid state
    }
  }, [currentTime, duration, playbackRate]);

  useEffect(() => {
    return () => {
      ytPlayerRef.current?.destroy?.();
      ytPlayerRef.current = null;
    };
  }, []);

  // Queue Actions
  const playTrack = useCallback((track: TrackItem, list?: TrackItem[]) => {
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
  }, []);

  const addToQueue = useCallback(
    (track: TrackItem) => {
      setQueue((prev) => {
        if (prev.some((t) => t.id === track.id)) {
          onNotice('Bài này đã có trong hàng đợi phát.');
          return prev;
        }
        onNotice('Đã thêm vào hàng đợi phát.');
        if (prev.length === 0) setCurrentIndex(0);
        return [...prev, track];
      });
    },
    [onNotice]
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      setQueue((prev) => {
        const next = prev.filter((_, i) => i !== index);
        if (index < currentIndex) {
          setCurrentIndex((c) => c - 1);
        } else if (index === currentIndex) {
          if (next.length === 0) {
            setCurrentIndex(-1);
            stopAllEngines();
            setIsPlaying(false);
          } else {
            setCurrentIndex(Math.min(index, next.length - 1));
          }
        }
        return next;
      });
    },
    [currentIndex, stopAllEngines]
  );

  const selectQueueIndex = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

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
    videoRef,
    ytContainerRef,
    queue,
    currentIndex,
    currentTrack,
    playMode,
    activeEngine,
    streamSourceLabel,
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
    togglePictureInPicture,
    setSleepTimerMinutes,
  };
}
