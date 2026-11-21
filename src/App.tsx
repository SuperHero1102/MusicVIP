import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compass,
  Library,
  Loader2,
  Minimize2,
  Moon,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { LibraryView } from './components/LibraryView';
import { MiniPlayer } from './components/MiniPlayer';
import { PlayerPanel } from './components/PlayerPanel';
import { PlaylistModal } from './components/PlaylistModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { SettingsView } from './components/SettingsView';
import { TrackRow } from './components/TrackRow';
import { useLibrary } from './hooks/useLibrary';
import { useMediaEngine } from './hooks/useMediaEngine';
import type { NavTab, PlayMode, TrackItem } from './types/media';

const DISCOVER_CATEGORIES = [
  { id: 'trending', label: 'Thịnh hành' },
  { id: 'lofi', label: 'Lo-fi' },
  { id: 'acoustic', label: 'Acoustic' },
  { id: 'chill', label: 'Nhạc Chill' },
  { id: 'podcast', label: 'Podcast' },
  { id: 'focus', label: 'Tập trung' },
];

const QUICK_SEARCH_SUGGESTIONS = [
  'Nhạc acoustic không lời làm việc',
  'Lofi chill study beats',
  'Podcast phát triển bản thân',
  'Nhạc Việt chill 2025',
  'Piano thư giãn ngủ ngon',
];

export default function App() {
  const library = useLibrary();

  const [activeTab, setActiveTab] = useState<NavTab>('discover');
  const [discoverCategory, setDiscoverCategory] = useState<string>('trending');
  const [discoverTracks, setDiscoverTracks] = useState<TrackItem[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState<boolean>(true);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [submittedQuery, setSubmittedQuery] = useState<string>('');
  const [searchTracks, setSearchTracks] = useState<TrackItem[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [mobilePlayerOpen, setMobilePlayerOpen] = useState<boolean>(false);
  const [videoFullscreen, setVideoFullscreen] = useState<boolean>(false);
  const [desktopVideoRect, setDesktopVideoRect] = useState<DOMRect | null>(null);
  const [mobileVideoRect, setMobileVideoRect] = useState<DOMRect | null>(null);
  const [fullscreenVideoRect, setFullscreenVideoRect] = useState<DOMRect | null>(null);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<TrackItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fullscreenSlotRef = useRef<HTMLDivElement | null>(null);
  const nativeFullscreenAttemptedRef = useRef<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 3400);
  }, []);

  const handleSponsorSkip = useCallback(
    (secondsSaved: number, label: string) => {
      library.recordSkip(secondsSaved);
      showToast(`Đã bỏ qua ${label} · Tiết kiệm ${secondsSaved}s`);
    },
    [library, showToast]
  );

  const engine = useMediaEngine({
    sponsorSettings: library.sponsorSettings,
    onTrackPlay: library.addToHistory,
    onSponsorSkip: handleSponsorSkip,
    onNotice: showToast,
  });

  const {
    activeEngine,
    currentIndex,
    currentTrack,
    exitNativeVideoFullscreen,
    playMode,
    playTrack,
    prefetchTracks,
    queue,
    requestNativeVideoFullscreen,
    switchPlayMode,
    togglePlay,
    videoRef,
  } = engine;

  const isVideoFullscreenActive = Boolean(
    videoFullscreen && playMode === 'video' && currentTrack
  );
  const activeVideoRect = isVideoFullscreenActive
    ? fullscreenVideoRect
    : mobilePlayerOpen
    ? mobileVideoRect
    : desktopVideoRect;

  const handleExitVideoFullscreen = useCallback(() => {
    setVideoFullscreen(false);
    exitNativeVideoFullscreen();
  }, [exitNativeVideoFullscreen]);

  // Automatically close video fullscreen if user switches to audio mode or clears queue
  useEffect(() => {
    if (engine.playMode !== 'video' || !engine.currentTrack) {
      setVideoFullscreen(false);
      nativeFullscreenAttemptedRef.current = null;
    }
  }, [engine.playMode, engine.currentTrack]);

  // Track edge-to-edge fullscreen viewport rect so persistent <video>/YT iframe expands with 0ms reload
  useEffect(() => {
    if (!isVideoFullscreenActive || !fullscreenSlotRef.current) {
      setFullscreenVideoRect(null);
      return;
    }
    const update = () => {
      const el = fullscreenSlotRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setFullscreenVideoRect(rect.width > 0 && rect.height > 0 ? rect : null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(fullscreenSlotRef.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      setFullscreenVideoRect(null);
    };
  }, [isVideoFullscreenActive]);

  // Attempt native iOS/OS video fullscreen at earliest metadata readiness while gesture token may still be warm
  useEffect(() => {
    if (!isVideoFullscreenActive || !currentTrack) return;
    if (activeEngine !== 'native-video') return;
    const trackId = currentTrack.id;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const tryNativeFs = () => {
      if (nativeFullscreenAttemptedRef.current === trackId) return;
      if (videoEl.readyState < 1) return;
      nativeFullscreenAttemptedRef.current = trackId;
      void requestNativeVideoFullscreen();
    };

    if (videoEl.readyState >= 1) {
      tryNativeFs();
      return;
    }

    videoEl.addEventListener('loadedmetadata', tryNativeFs);
    return () => {
      videoEl.removeEventListener('loadedmetadata', tryNativeFs);
    };
  }, [activeEngine, currentTrack, isVideoFullscreenActive, requestNativeVideoFullscreen, videoRef]);

  // Sync Escape key and iOS native fullscreen dismissal cleanly
  useEffect(() => {
    if (!isVideoFullscreenActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExitVideoFullscreen();
      }
    };
    const videoEl = engine.videoRef.current;
    const onWebkitEndFullscreen = () => {
      setVideoFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    videoEl?.addEventListener('webkitendfullscreen', onWebkitEndFullscreen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      videoEl?.removeEventListener('webkitendfullscreen', onWebkitEndFullscreen);
    };
  }, [engine.videoRef, handleExitVideoFullscreen, isVideoFullscreenActive]);

  // Load Discover tracks by category
  const fetchDiscover = useCallback(async (category: string) => {
    setDiscoverLoading(true);
    setDiscoverError(null);
    try {
      const resp = await fetch(`/api/discover?category=${encodeURIComponent(category)}`);
      const data = (await resp.json()) as { tracks?: TrackItem[]; error?: string };
      if (!resp.ok) {
        throw new Error(data.error || 'Không thể tải nội dung.');
      }
      setDiscoverTracks(data.tracks || []);
    } catch (err) {
      setDiscoverError((err as Error).message || 'Lỗi kết nối máy chủ.');
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiscover(discoverCategory);
  }, [discoverCategory, fetchDiscover]);

  // Prefetch top tracks in background so tapping in Video mode starts instantaneously
  useEffect(() => {
    if (discoverTracks.length > 0) {
      prefetchTracks(discoverTracks, 3);
    }
  }, [discoverTracks, prefetchTracks]);

  useEffect(() => {
    if (searchTracks.length > 0) {
      prefetchTracks(searchTracks, 3);
    }
  }, [prefetchTracks, searchTracks]);

  useEffect(() => {
    const nextTrack = queue[currentIndex + 1];
    if (nextTrack) {
      prefetchTracks([nextTrack], 1);
    }
  }, [currentIndex, prefetchTracks, queue]);

  // Execute search on YouTube (keywords or pasted URL)
  const runSearch = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (!q) return;
      setActiveTab('search');
      setSearchQuery(q);
      setSubmittedQuery(q);
      library.addRecentSearch(q);
      setSearchLoading(true);
      setSearchError(null);

      try {
        const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = (await resp.json()) as { tracks?: TrackItem[]; error?: string };
        if (!resp.ok) {
          throw new Error(data.error || 'Không thể tìm kiếm lúc này.');
        }
        const results = data.tracks || [];
        setSearchTracks(results);

        // If user pasted a direct YouTube link (single exact match), auto-play immediately
        const looksLikeUrl = /youtu(\.be|be\.com)/i.test(q);
        if (looksLikeUrl && results.length === 1) {
          nativeFullscreenAttemptedRef.current = null;
          playTrack(results[0], results);
          if (playMode === 'video') {
            setMobilePlayerOpen(true);
            setVideoFullscreen(true);
          }
          showToast('Đã nhận diện liên kết YouTube — đang phát không quảng cáo.');
        }
      } catch (err) {
        setSearchError((err as Error).message || 'Lỗi tìm kiếm.');
      } finally {
        setSearchLoading(false);
      }
    },
    [library, playMode, playTrack, showToast]
  );

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(searchQuery);
  };

  // Global keyboard shortcuts (Space = Play/Pause, / = Search)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space' && currentTrack) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === '/') {
        e.preventDefault();
        setActiveTab('search');
        setTimeout(() => searchInputRef.current?.focus(), 20);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentTrack, togglePlay]);

  const handleSelectTrack = useCallback(
    (track: TrackItem, list?: TrackItem[]) => {
      nativeFullscreenAttemptedRef.current = null;
      playTrack(track, list);
      if (playMode === 'video') {
        setMobilePlayerOpen(true);
        setVideoFullscreen(true);
      }
    },
    [playMode, playTrack]
  );

  const handleSwitchPlayMode = useCallback(
    (mode: PlayMode) => {
      nativeFullscreenAttemptedRef.current = null;
      switchPlayMode(mode);
      if (mode === 'video' && currentTrack) {
        setVideoFullscreen(true);
      } else if (mode === 'audio') {
        setVideoFullscreen(false);
      }
    },
    [currentTrack, switchPlayMode]
  );

  const navItems: Array<{ id: NavTab; label: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'discover', label: 'Khám phá', icon: Compass },
    { id: 'search', label: 'Tìm kiếm', icon: Search },
    { id: 'library', label: 'Thư viện', icon: Library },
    { id: 'settings', label: 'Cài đặt', icon: Settings },
  ];

  return (
    <div className="relative z-[1] flex min-h-screen w-full bg-[#F8F9FB] text-slate-900 dark:bg-[#0B0D10] dark:text-slate-100">
      <OfflineIndicator />

      {/* Desktop Left Navigation Rail */}
      <aside className="hidden lg:flex lg:w-60 shrink-0 flex-col justify-between border-r border-slate-200 dark:border-white/[0.07] bg-white dark:bg-[#0E1116] px-4 py-5 sticky top-0 h-screen">
        <div>
          {/* Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className="flex items-center gap-2.5 px-2.5 py-1 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] rounded-lg"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black ring-1 ring-black/10 dark:ring-white/15 shadow-sm">
              <img src="/pwa-192x192.png" alt="Music Tube" className="h-full w-full object-contain" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Music Tube
            </span>
          </button>

          {/* Primary Navigation */}
          <nav className="mt-7 space-y-1" aria-label="Điều hướng chính">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#E11D48]/10 text-[#E11D48] dark:bg-[#F43F5E]/15 dark:text-[#FB7185]'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Quiet Utilities */}
        <div className="space-y-3 border-t border-slate-200 dark:border-white/[0.07] pt-4">
          <div className="flex items-center gap-2 px-2 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#E11D48] dark:text-[#F43F5E]" />
            <span className="truncate">
              {library.sponsorSettings.enabled ? 'Chặn quảng cáo đang bật' : 'Đã tắt lọc tài trợ'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={library.toggleTheme}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#14171D] px-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212A] transition-colors whitespace-nowrap"
            >
              {library.theme === 'dark' ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                  <span>Giao diện Sáng</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-slate-600" />
                  <span>Giao diện Tối</span>
                </>
              )}
            </button>
          </div>

          <PWAInstallButton compact />
        </div>
      </aside>

      {/* Center Content Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile Compact Top Bar */}
        <header className="lg:hidden sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200/80 dark:border-white/[0.07] bg-[#F8F9FB]/90 dark:bg-[#0B0D10]/90 backdrop-blur-md px-4">
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black ring-1 ring-black/10 dark:ring-white/15 shadow-sm">
              <img src="/pwa-192x192.png" alt="Music Tube" className="h-full w-full object-contain" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
              Music Tube
            </span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={library.toggleTheme}
              aria-label="Đổi giao diện Sáng/Tối"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-white/5"
            >
              {library.theme === 'dark' ? (
                <Sun className="h-[18px] w-[18px] text-amber-400" />
              ) : (
                <Moon className="h-[18px] w-[18px]" />
              )}
            </button>
          </div>
        </header>

        {/* Main Scrollable Workspace */}
        <main
          className={`mx-auto w-full max-w-4xl flex-1 px-4 sm:px-6 lg:px-8 py-5 ${
            engine.currentTrack ? 'main-pb-miniplayer' : 'main-pb-nav'
          } lg:pb-10`}
        >
          {/* Persistent Search Input for Discover & Search Tabs */}
          {(activeTab === 'discover' || activeTab === 'search') && (
            <form onSubmit={handleSearchSubmit} className="mb-6">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-4 h-4 w-4 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm nhạc, podcast trên YouTube hoặc dán link trực tiếp..."
                  className="h-12 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#14171D] pl-11 pr-24 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#E11D48] focus:outline-none transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Xóa từ khóa"
                    className="absolute right-16 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="submit"
                  className="absolute right-1.5 h-9 rounded-xl bg-[#E11D48] px-4 text-xs font-semibold text-white hover:bg-[#BE123C] transition-colors whitespace-nowrap"
                >
                  Tìm
                </button>
              </div>
            </form>
          )}

          {/* DISCOVER VIEW */}
          {activeTab === 'discover' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
                  Nghe YouTube không quảng cáo
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Phát âm thanh nền ổn định ngay cả khi tắt màn hình · Tự động bỏ qua đoạn tài trợ
                </p>
              </div>

              {/* Interactive Category Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {DISCOVER_CATEGORIES.map((cat) => {
                  const active = discoverCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setDiscoverCategory(cat.id)}
                      className={`h-10 rounded-xl px-4 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        active
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 dark:bg-[#14171D] dark:text-slate-300 dark:hover:bg-[#1C212A]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              {/* Track List */}
              {discoverLoading ? (
                <div className="space-y-3" aria-label="Đang tải danh sách">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3.5 p-2.5 animate-pulse">
                      <div className="aspect-video w-28 sm:w-32 rounded-lg bg-slate-200 dark:bg-[#181C24]" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-[#181C24]" />
                        <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-[#181C24]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : discoverError ? (
                <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] py-12 px-6 text-center">
                  <p className="text-sm text-slate-600 dark:text-slate-300">{discoverError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchDiscover(discoverCategory)}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-white px-4 py-2 text-xs font-medium text-white dark:text-slate-900"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Thử tải lại</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {discoverTracks.map((track) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      isActive={engine.currentTrack?.id === track.id}
                      isPlaying={engine.isPlaying}
                      isFavorite={library.isFavorite(track.id)}
                      onPlay={() => handleSelectTrack(track, discoverTracks)}
                      onToggleFavorite={() => library.toggleFavorite(track)}
                      onAddToQueue={() => engine.addToQueue(track)}
                      onAddToPlaylist={() => setPlaylistModalTrack(track)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SEARCH VIEW */}
          {activeTab === 'search' && (
            <div className="space-y-6">
              {!submittedQuery && (
                <div className="space-y-6">
                  {library.recentSearches.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Tìm kiếm gần đây
                      </h2>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {library.recentSearches.map((term) => (
                          <div
                            key={term}
                            className="inline-flex items-center rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#14171D] overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() => void runSearch(term)}
                              className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                            >
                              {term}
                            </button>
                            <button
                              type="button"
                              onClick={() => library.removeRecentSearch(term)}
                              aria-label={`Xóa ${term}`}
                              className="px-2 py-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Gợi ý nghe nền nhanh
                    </h2>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {QUICK_SEARCH_SUGGESTIONS.map((term) => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => void runSearch(term)}
                          className="rounded-xl bg-slate-100 dark:bg-[#14171D] px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-[#1C212A] transition-colors"
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {searchLoading && (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3.5 p-2.5 animate-pulse">
                      <div className="aspect-video w-28 sm:w-32 rounded-lg bg-slate-200 dark:bg-[#181C24]" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-[#181C24]" />
                        <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-[#181C24]" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!searchLoading && searchError && (
                <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] py-12 px-6 text-center">
                  <p className="text-sm text-slate-600 dark:text-slate-300">{searchError}</p>
                  <button
                    type="button"
                    onClick={() => void runSearch(submittedQuery)}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-white px-4 py-2 text-xs font-medium text-white dark:text-slate-900"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Tìm lại</span>
                  </button>
                </div>
              )}

              {!searchLoading && !searchError && submittedQuery && (
                <div>
                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                    Kết quả cho <span className="font-semibold text-slate-900 dark:text-white">“{submittedQuery}”</span> · {searchTracks.length} mục
                  </p>
                  {searchTracks.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
                      Không tìm thấy nội dung phù hợp. Hãy thử từ khóa khác hoặc dán link YouTube trực tiếp.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {searchTracks.map((track) => (
                        <TrackRow
                          key={track.id}
                          track={track}
                          isActive={engine.currentTrack?.id === track.id}
                          isPlaying={engine.isPlaying}
                          isFavorite={library.isFavorite(track.id)}
                          onPlay={() => handleSelectTrack(track, searchTracks)}
                          onToggleFavorite={() => library.toggleFavorite(track)}
                          onAddToQueue={() => engine.addToQueue(track)}
                          onAddToPlaylist={() => setPlaylistModalTrack(track)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* LIBRARY VIEW */}
          {activeTab === 'library' && (
            <LibraryView
              favorites={library.favorites}
              history={library.history}
              playlists={library.playlists}
              currentTrackId={engine.currentTrack?.id || null}
              isPlaying={engine.isPlaying}
              isFavorite={library.isFavorite}
              onPlayTrack={handleSelectTrack}
              onToggleFavorite={library.toggleFavorite}
              onAddToQueue={engine.addToQueue}
              onOpenPlaylistModal={setPlaylistModalTrack}
              onCreatePlaylist={(name) => {
                library.createPlaylist(name);
                showToast(`Đã tạo danh sách phát “${name}”.`);
              }}
              onDeletePlaylist={(id) => {
                library.deletePlaylist(id);
                showToast('Đã xóa danh sách phát.');
              }}
              onRemoveTrackFromPlaylist={library.removeTrackFromPlaylist}
              onClearHistory={() => {
                library.clearHistory();
                showToast('Đã xóa lịch sử nghe.');
              }}
            />
          )}

          {/* SETTINGS VIEW */}
          {activeTab === 'settings' && (
            <SettingsView
              sponsorSettings={library.sponsorSettings}
              skipStats={library.skipStats}
              theme={library.theme}
              onToggleTheme={library.toggleTheme}
              onToggleSponsorMaster={library.toggleSponsorMaster}
              onToggleSponsorCategory={library.toggleSponsorCategory}
            />
          )}

          <footer className="mt-10 border-t border-slate-200/70 dark:border-white/[0.06] pt-6 text-center text-xs text-slate-400 dark:text-slate-500">
            © Bản quyền thuộc Hải An Group
          </footer>
        </main>
      </div>

      {/* Desktop Persistent Right Player & Queue Panel */}
      <aside className="hidden lg:flex lg:w-[380px] xl:w-[420px] shrink-0 flex-col border-l border-slate-200 dark:border-white/[0.07] bg-white dark:bg-[#0F1217] sticky top-0 z-10 h-screen">
        <PlayerPanel
          currentTrack={engine.currentTrack}
          queue={engine.queue}
          currentIndex={engine.currentIndex}
          playMode={engine.playMode}
          activeEngine={engine.activeEngine}
          streamSourceLabel={engine.streamSourceLabel}
          isPiPSupported={engine.isPiPSupported}
          isPlaying={engine.isPlaying}
          isLoading={engine.isLoading}
          currentTime={engine.currentTime}
          duration={engine.duration}
          buffered={engine.buffered}
          volume={engine.volume}
          isMuted={engine.isMuted}
          playbackRate={engine.playbackRate}
          repeatMode={engine.repeatMode}
          isShuffled={engine.isShuffled}
          segments={engine.segments}
          sponsorSettings={library.sponsorSettings}
          sleepRemainingSec={engine.sleepRemainingSec}
          sleepEndOfTrack={engine.sleepEndOfTrack}
          isFavorite={engine.currentTrack ? library.isFavorite(engine.currentTrack.id) : false}
          onVideoSlotRectChange={setDesktopVideoRect}
          onTogglePlay={engine.togglePlay}
          onNext={engine.playNext}
          onPrev={engine.playPrev}
          onSeek={engine.seekTo}
          onSkipBy={engine.skipBy}
          onSwitchPlayMode={handleSwitchPlayMode}
          onTogglePiP={() => void engine.togglePictureInPicture()}
          onVolumeChange={(v) => {
            engine.setVolume(v);
            if (v > 0 && engine.isMuted) engine.setIsMuted(false);
          }}
          onToggleMute={() => engine.setIsMuted((m) => !m)}
          onPlaybackRateChange={engine.setPlaybackRate}
          onCycleRepeat={engine.cycleRepeatMode}
          onToggleShuffle={() => engine.setIsShuffled((s) => !s)}
          onSetSleepTimer={engine.setSleepTimerMinutes}
          onToggleFavorite={() => engine.currentTrack && library.toggleFavorite(engine.currentTrack)}
          onOpenPlaylistModal={setPlaylistModalTrack}
          onSelectQueueIndex={(idx) => {
            nativeFullscreenAttemptedRef.current = null;
            engine.selectQueueIndex(idx);
            if (engine.playMode === 'video') {
              setVideoFullscreen(true);
            }
          }}
          onRemoveFromQueue={engine.removeFromQueue}
        />
      </aside>

      {/* Mobile Full-Screen Player Sheet */}
      {mobilePlayerOpen && engine.currentTrack && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col bg-white dark:bg-[#0F1217]">
          <PlayerPanel
            isMobileSheet
            onCloseSheet={() => setMobilePlayerOpen(false)}
            onVideoSlotRectChange={setMobileVideoRect}
            currentTrack={engine.currentTrack}
            queue={engine.queue}
            currentIndex={engine.currentIndex}
            playMode={engine.playMode}
            activeEngine={engine.activeEngine}
            streamSourceLabel={engine.streamSourceLabel}
            isPiPSupported={engine.isPiPSupported}
            isPlaying={engine.isPlaying}
            isLoading={engine.isLoading}
            currentTime={engine.currentTime}
            duration={engine.duration}
            buffered={engine.buffered}
            volume={engine.volume}
            isMuted={engine.isMuted}
            playbackRate={engine.playbackRate}
            repeatMode={engine.repeatMode}
            isShuffled={engine.isShuffled}
            segments={engine.segments}
            sponsorSettings={library.sponsorSettings}
            sleepRemainingSec={engine.sleepRemainingSec}
            sleepEndOfTrack={engine.sleepEndOfTrack}
            isFavorite={library.isFavorite(engine.currentTrack.id)}
            onTogglePlay={engine.togglePlay}
            onNext={engine.playNext}
            onPrev={engine.playPrev}
            onSeek={engine.seekTo}
            onSkipBy={engine.skipBy}
            onSwitchPlayMode={handleSwitchPlayMode}
            onTogglePiP={() => void engine.togglePictureInPicture()}
            onVolumeChange={engine.setVolume}
            onToggleMute={() => engine.setIsMuted((m) => !m)}
            onPlaybackRateChange={engine.setPlaybackRate}
            onCycleRepeat={engine.cycleRepeatMode}
            onToggleShuffle={() => engine.setIsShuffled((s) => !s)}
            onSetSleepTimer={engine.setSleepTimerMinutes}
            onToggleFavorite={() => engine.currentTrack && library.toggleFavorite(engine.currentTrack)}
            onOpenPlaylistModal={setPlaylistModalTrack}
            onSelectQueueIndex={(idx) => {
              nativeFullscreenAttemptedRef.current = null;
              engine.selectQueueIndex(idx);
              if (engine.playMode === 'video') {
                setVideoFullscreen(true);
              }
            }}
            onRemoveFromQueue={engine.removeFromQueue}
          />
        </div>
      )}

      {/* Auto Edge-to-Edge Fullscreen Video Stage (instant 0ms on track select in Video mode) */}
      {isVideoFullscreenActive && engine.currentTrack && (
        <div
          className="fixed inset-0 z-[48] bg-black"
          role="dialog"
          aria-modal="true"
          aria-label="Trình phát video toàn màn hình"
        >
          <div ref={fullscreenSlotRef} className="h-full w-full" />
          {(engine.isLoading ||
            (engine.activeEngine !== 'native-video' && engine.activeEngine !== 'yt-privacy')) && (
            <div className="pointer-events-none fixed inset-0 z-[50] flex items-center justify-center bg-black">
              <img
                src={engine.currentTrack.thumbnail}
                alt={engine.currentTrack.title}
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain opacity-35"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-9 w-9 animate-spin text-white" />
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={handleExitVideoFullscreen}
            aria-label="Thu gọn video toàn màn hình"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
            className="fixed left-4 z-[60] flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white ring-1 ring-white/25 backdrop-blur-md hover:bg-black/85 active:scale-95 transition-all"
          >
            <Minimize2 className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Persistent DOM-Mounted Native <audio> Element (always rendered, never display:none/opacity-0 for iOS lock-screen playback) */}
      <audio
        ref={engine.audioRef}
        playsInline
        preload="auto"
        className="fixed left-0 top-0 z-0 h-1 w-1 pointer-events-none"
      />

      {/* Persistent Native Ad-Free HTML5 <video> Viewport (supports PiP & lock-screen audio handoff) */}
      <video
        ref={engine.videoRef}
        playsInline
        preload="auto"
        controls={isVideoFullscreenActive}
        onClick={isVideoFullscreenActive ? undefined : engine.togglePlay}
        aria-hidden={!(activeVideoRect && engine.playMode === 'video' && engine.activeEngine === 'native-video')}
        className={
          activeVideoRect && engine.playMode === 'video' && engine.activeEngine === 'native-video'
            ? isVideoFullscreenActive
              ? 'fixed z-[55] overflow-hidden bg-black object-contain'
              : 'fixed z-[45] overflow-hidden rounded-2xl bg-black object-contain cursor-pointer'
            : 'fixed left-0 top-0 z-0 h-1 w-1 pointer-events-none'
        }
        style={
          activeVideoRect && engine.playMode === 'video' && engine.activeEngine === 'native-video'
            ? {
                left: activeVideoRect.left,
                top: activeVideoRect.top,
                width: activeVideoRect.width,
                height: activeVideoRect.height,
              }
            : undefined
        }
      />

      {/* Persistent Fallback YouTube Privacy Player Host (always rendered with real dimensions, never display:none/opacity-0) */}
      <div
        ref={engine.ytContainerRef}
        aria-hidden={!(activeVideoRect && engine.playMode === 'video' && engine.activeEngine === 'yt-privacy')}
        className={
          activeVideoRect && engine.playMode === 'video' && engine.activeEngine === 'yt-privacy'
            ? isVideoFullscreenActive
              ? 'fixed z-[55] overflow-hidden bg-black'
              : 'fixed z-[45] overflow-hidden rounded-2xl bg-black'
            : activeVideoRect && engine.playMode === 'audio' && engine.activeEngine === 'yt-privacy'
            ? 'fixed z-0 overflow-hidden rounded-2xl bg-black pointer-events-none'
            : 'fixed left-0 top-0 z-0 h-4 w-4 overflow-hidden pointer-events-none'
        }
        style={
          activeVideoRect && engine.activeEngine === 'yt-privacy'
            ? {
                left: activeVideoRect.left,
                top: activeVideoRect.top,
                width: activeVideoRect.width,
                height: activeVideoRect.height,
              }
            : undefined
        }
      />

      {/* Unified Mobile Bottom Stack: Mini-Player directly above Navigation Bar (Thumb Zone) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex flex-col pointer-events-none">
        {engine.currentTrack && !mobilePlayerOpen && (
          <div className="pointer-events-auto">
            <MiniPlayer
              track={engine.currentTrack}
              isPlaying={engine.isPlaying}
              isLoading={engine.isLoading}
              currentTime={engine.currentTime}
              duration={engine.duration}
              onExpand={() => {
                setMobilePlayerOpen(true);
                if (engine.playMode === 'video') {
                  nativeFullscreenAttemptedRef.current = null;
                  setVideoFullscreen(true);
                }
              }}
              onTogglePlay={engine.togglePlay}
              onNext={engine.playNext}
            />
          </div>
        )}

        <nav
          aria-label="Điều hướng di động"
          className="pointer-events-auto border-t border-slate-200/90 dark:border-white/[0.08] bg-white/95 dark:bg-[#0E1116]/95 backdrop-blur-md pb-safe"
        >
          <div className="grid h-15 grid-cols-4 items-center">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex h-full flex-col items-center justify-center gap-1 transition-colors ${
                    active
                      ? 'text-[#E11D48] dark:text-[#F43F5E]'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium tracking-tight leading-none">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Add-to-Playlist Modal */}
      <PlaylistModal
        track={playlistModalTrack}
        playlists={library.playlists}
        onClose={() => setPlaylistModalTrack(null)}
        onAddTrack={(playlistId, track) => {
          library.addTrackToPlaylist(playlistId, track);
          showToast('Đã lưu vào danh sách phát.');
        }}
        onCreatePlaylist={(name, track) => {
          library.createPlaylist(name, track);
          showToast(`Đã tạo danh sách phát “${name}”.`);
        }}
      />

      {/* Non-intrusive Toast Notification */}
      {toast && (
        <div
          role="status"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] rounded-xl border border-slate-200 dark:border-white/10 bg-slate-900 dark:bg-[#1C212A] px-4 py-2.5 text-xs font-medium text-white shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
