import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Headphones,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  Moon,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ActiveEngine } from '../hooks/useMediaEngine';
import type {
  PlayMode,
  RepeatMode,
  SponsorSegment,
  SponsorSettings,
  TrackItem,
} from '../types/media';
import { formatTime } from '../utils/format';
import { TimelineScrubber } from './TimelineScrubber';
import { TrackThumbnail } from './TrackThumbnail';

interface PlayerPanelProps {
  currentTrack: TrackItem | null;
  queue: TrackItem[];
  currentIndex: number;
  playMode: PlayMode;
  activeEngine: ActiveEngine;
  streamSourceLabel: string | null;
  isPiPSupported: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  repeatMode: RepeatMode;
  isShuffled: boolean;
  segments: SponsorSegment[];
  sponsorSettings: SponsorSettings;
  sleepRemainingSec: number;
  sleepEndOfTrack: boolean;
  isFavorite: boolean;
  isMobileSheet?: boolean;
  onCloseSheet?: () => void;
  onVideoSlotRectChange?: (rect: DOMRect | null) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (seconds: number) => void;
  onSkipBy: (delta: number) => void;
  onSwitchPlayMode: (mode: PlayMode) => void;
  onTogglePiP: () => void;
  onVolumeChange: (val: number) => void;
  onToggleMute: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onCycleRepeat: () => void;
  onToggleShuffle: () => void;
  onSetSleepTimer: (minutes: number | 'end-of-track' | null) => void;
  onToggleFavorite: () => void;
  onOpenPlaylistModal: (track: TrackItem) => void;
  onSelectQueueIndex: (index: number) => void;
  onRemoveFromQueue: (index: number) => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export const PlayerPanel: React.FC<PlayerPanelProps> = ({
  currentTrack,
  queue,
  currentIndex,
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
  sponsorSettings,
  sleepRemainingSec,
  sleepEndOfTrack,
  isFavorite,
  isMobileSheet = false,
  onCloseSheet,
  onVideoSlotRectChange,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onSkipBy,
  onSwitchPlayMode,
  onTogglePiP,
  onVolumeChange,
  onToggleMute,
  onPlaybackRateChange,
  onCycleRepeat,
  onToggleShuffle,
  onSetSleepTimer,
  onToggleFavorite,
  onOpenPlaylistModal,
  onSelectQueueIndex,
  onRemoveFromQueue,
}) => {
  const [panelTab, setPanelTab] = useState<'player' | 'queue'>('player');
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [customHours, setCustomHours] = useState('0');
  const [customMinutes, setCustomMinutes] = useState('20');
  const videoSlotRef = useRef<HTMLDivElement | null>(null);

  const hasSleepTimer = sleepRemainingSec > 0 || sleepEndOfTrack;

  const handleCustomSleepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = Math.max(0, parseInt(customHours || '0', 10) || 0);
    const m = Math.max(0, parseInt(customMinutes || '0', 10) || 0);
    const totalMinutes = Math.min(720, h * 60 + m);
    if (totalMinutes <= 0) return;
    onSetSleepTimer(totalMinutes);
    setShowSleepMenu(false);
  };

  // Report live bounding rect of the video slot so the persistent YT player aligns with 0ms reload
  useEffect(() => {
    if (!onVideoSlotRectChange) return;
    const isVisibleSlot = Boolean(
      currentTrack && (playMode === 'video' || activeEngine === 'yt-privacy') && panelTab === 'player'
    );
    if (!isVisibleSlot || !videoSlotRef.current) {
      onVideoSlotRectChange(null);
      return;
    }

    const update = () => {
      const el = videoSlotRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        onVideoSlotRectChange(rect);
      } else {
        onVideoSlotRectChange(null);
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(videoSlotRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      onVideoSlotRectChange(null);
    };
  }, [activeEngine, currentTrack, onVideoSlotRectChange, panelTab, playMode]);

  if (!currentTrack) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-[#14171D] border border-slate-200 dark:border-white/10 text-slate-400 dark:text-slate-500">
          <Headphones className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
          Sẵn sàng phát nhạc nền
        </h3>
        <p className="mt-1.5 max-w-[260px] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Chọn một bài hát hoặc dán link YouTube để nghe không quảng cáo ngay cả khi tắt màn hình.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#0F1217]">
      {/* Mobile sheet header */}
      {isMobileSheet ? (
        <div className="shrink-0 px-4 pt-safe-header pb-2">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onCloseSheet}
              aria-label="Thu gọn trình phát"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            >
              <ChevronDown className="h-6 w-6" />
            </button>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#181C24] p-1">
              <button
                type="button"
                onClick={() => onSwitchPlayMode('audio')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  playMode === 'audio'
                    ? 'bg-white dark:bg-[#242A36] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Headphones className="h-3.5 w-3.5" />
                <span>Âm thanh</span>
              </button>
              <button
                type="button"
                onClick={() => onSwitchPlayMode('video')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  playMode === 'video'
                    ? 'bg-white dark:bg-[#242A36] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Video className="h-3.5 w-3.5" />
                <span>Video</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setPanelTab((t) => (t === 'player' ? 'queue' : 'player'))}
              aria-label="Hàng đợi phát"
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                panelTab === 'queue'
                  ? 'bg-[#E11D48]/10 text-[#E11D48] dark:text-[#F43F5E]'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5'
              }`}
            >
              <ListMusic className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : (
        /* Desktop panel top bar */
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 dark:border-white/[0.07] px-5 py-3.5">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#161A22] p-1">
            <button
              type="button"
              onClick={() => setPanelTab('player')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                panelTab === 'player'
                  ? 'bg-white dark:bg-[#222834] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Đang phát
            </button>
            <button
              type="button"
              onClick={() => setPanelTab('queue')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                panelTab === 'queue'
                  ? 'bg-white dark:bg-[#222834] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Tiếp theo ({queue.length})
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#161A22] p-1">
            <button
              type="button"
              onClick={() => onSwitchPlayMode('audio')}
              title="Chế độ chỉ nghe âm thanh nền"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                playMode === 'audio'
                  ? 'bg-white dark:bg-[#222834] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Headphones className="h-3.5 w-3.5" />
              <span>Âm thanh</span>
            </button>
            <button
              type="button"
              onClick={() => onSwitchPlayMode('video')}
              title="Chế độ xem video"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                playMode === 'video'
                  ? 'bg-white dark:bg-[#222834] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Video className="h-3.5 w-3.5" />
              <span>Video</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Scrollable Body */}
      {panelTab === 'player' ? (
        <div className="flex flex-1 flex-col justify-between overflow-y-auto px-5 py-5">
          {/* Media Stage */}
          <div>
            {playMode === 'video' ? (
              <div
                ref={videoSlotRef}
                className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-lg"
              />
            ) : (
              <div ref={videoSlotRef} className="relative mx-auto w-full max-w-[340px]">
                <TrackThumbnail
                  src={currentTrack.thumbnail}
                  alt={currentTrack.title}
                  aspect="video"
                  className="relative z-[46] w-full rounded-2xl shadow-xl shadow-black/25"
                />
                {isLoading && (
                  <div className="absolute inset-0 z-[47] flex items-center justify-center rounded-2xl bg-black/45">
                    <Loader2 className="h-7 w-7 animate-spin text-white" />
                  </div>
                )}
              </div>
            )}

            {/* Track Info & Unboxed Status Line */}
            <div className="mt-5 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="line-clamp-2 text-base sm:text-lg font-semibold leading-snug text-slate-900 dark:text-white">
                  {currentTrack.title}
                </h2>
                <p className="mt-1 truncate text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  {currentTrack.author}
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span>
                    {activeEngine === 'native-audio'
                      ? 'Luồng âm thanh gốc không quảng cáo · Chạy nền tắt màn hình'
                      : activeEngine === 'native-video'
                      ? `${streamSourceLabel || 'Video gốc không quảng cáo'} · Tự chuyển âm thanh khi khóa máy`
                      : streamSourceLabel || 'Nguồn dự phòng YouTube · Lọc tài trợ SponsorBlock'}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isPiPSupported && activeEngine === 'native-video' && playMode === 'video' && (
                  <button
                    type="button"
                    onClick={onTogglePiP}
                    title="Cửa sổ nổi (Picture-in-Picture)"
                    aria-label="Cửa sổ nổi Picture-in-Picture"
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200 transition-colors"
                  >
                    <PictureInPicture2 className="h-[18px] w-[18px]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onToggleFavorite}
                  aria-label={isFavorite ? 'Bỏ yêu thích' : 'Yêu thích'}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                    isFavorite
                      ? 'text-[#E11D48] dark:text-[#F43F5E]'
                      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-200'
                  }`}
                >
                  <Heart className="h-5 w-5" fill={isFavorite ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPlaylistModal(currentTrack)}
                  aria-label="Lưu vào danh sách phát"
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-200 transition-colors"
                >
                  <ListPlus className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Controls Block */}
          <div className="mt-6 space-y-5">
            <TimelineScrubber
              currentTime={currentTime}
              duration={duration}
              buffered={buffered}
              segments={segments}
              sponsorSettings={sponsorSettings}
              onSeek={onSeek}
            />

            {/* Main Transport Controls */}
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={onToggleShuffle}
                aria-label="Phát ngẫu nhiên"
                title="Phát ngẫu nhiên"
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                  isShuffled
                    ? 'text-[#E11D48] dark:text-[#F43F5E]'
                    : 'text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200'
                }`}
              >
                <Shuffle className="h-[18px] w-[18px]" />
              </button>

              <button
                type="button"
                onClick={onPrev}
                aria-label="Bài trước"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5 transition-colors"
              >
                <SkipBack className="h-5 w-5" fill="currentColor" />
              </button>

              <button
                type="button"
                onClick={() => onSkipBy(-10)}
                aria-label="Lùi 10 giây"
                title="Lùi 10 giây"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200 transition-colors"
              >
                <RotateCcw className="h-[18px] w-[18px]" />
              </button>

              <button
                type="button"
                onClick={onTogglePlay}
                aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E11D48] text-white shadow-lg shadow-[#E11D48]/25 hover:bg-[#BE123C] active:scale-95 transition-all"
              >
                {isLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-6 w-6" fill="currentColor" />
                ) : (
                  <Play className="h-6 w-6 translate-x-0.5" fill="currentColor" />
                )}
              </button>

              <button
                type="button"
                onClick={() => onSkipBy(10)}
                aria-label="Tua tới 10 giây"
                title="Tua tới 10 giây"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200 transition-colors"
              >
                <RotateCw className="h-[18px] w-[18px]" />
              </button>

              <button
                type="button"
                onClick={onNext}
                aria-label="Bài tiếp theo"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5 transition-colors"
              >
                <SkipForward className="h-5 w-5" fill="currentColor" />
              </button>

              <button
                type="button"
                onClick={onCycleRepeat}
                aria-label="Chế độ lặp lại"
                title={
                  repeatMode === 'one'
                    ? 'Đang lặp 1 bài'
                    : repeatMode === 'all'
                    ? 'Đang lặp danh sách'
                    : 'Tắt lặp lại'
                }
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                  repeatMode !== 'off'
                    ? 'text-[#E11D48] dark:text-[#F43F5E]'
                    : 'text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="h-[18px] w-[18px]" />
                ) : (
                  <Repeat className="h-[18px] w-[18px]" />
                )}
              </button>
            </div>

            {/* Secondary Utilities: Speed, Sleep Timer, Volume */}
            <div className="relative flex items-center justify-between gap-3 border-t border-slate-200 dark:border-white/[0.07] pt-4">
              {/* Speed selector */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowSpeedMenu((s) => !s);
                    setShowSleepMenu(false);
                  }}
                  className="flex h-10 items-center gap-1 rounded-lg px-2.5 text-xs font-mono tabular-nums font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 whitespace-nowrap"
                >
                  <span>{playbackRate}x</span>
                </button>
                {showSpeedMenu && (
                  <div className="absolute bottom-12 left-0 z-30 flex items-center gap-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#181C24] p-1.5 shadow-xl">
                    {RATES.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => {
                          onPlaybackRateChange(rate);
                          setShowSpeedMenu(false);
                        }}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-mono tabular-nums transition-colors ${
                          playbackRate === rate
                            ? 'bg-[#E11D48] text-white'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Sleep timer */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowSleepMenu((s) => !s);
                    setShowSpeedMenu(false);
                  }}
                  className={`flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    hasSleepTimer
                      ? 'bg-[#E11D48]/10 text-[#E11D48] dark:text-[#F43F5E]'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5'
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" />
                  <span className="font-mono tabular-nums">
                    {sleepRemainingSec > 0
                      ? formatTime(sleepRemainingSec)
                      : sleepEndOfTrack
                      ? 'Hết bài'
                      : 'Hẹn giờ'}
                  </span>
                </button>
                {showSleepMenu && (
                  <div className="absolute bottom-12 right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-30 w-64 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#181C24] p-2.5 shadow-2xl">
                    <p className="px-1.5 pb-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Hẹn giờ tự động tắt
                    </p>

                    <div className="grid grid-cols-2 gap-1.5">
                      {[15, 30, 45, 60].map((min) => (
                        <button
                          key={min}
                          type="button"
                          onClick={() => {
                            onSetSleepTimer(min);
                            setShowSleepMenu(false);
                          }}
                          className="rounded-lg bg-slate-100 dark:bg-white/[0.06] px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200/80 dark:text-slate-200 dark:hover:bg-white/10 transition-colors"
                        >
                          {min} phút
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onSetSleepTimer('end-of-track');
                        setShowSleepMenu(false);
                      }}
                      className="mt-1.5 flex w-full items-center justify-center rounded-lg bg-slate-100 dark:bg-white/[0.06] px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200/80 dark:text-slate-200 dark:hover:bg-white/10 transition-colors"
                    >
                      Khi hết bài hiện tại
                    </button>

                    {/* Custom time entry */}
                    <form
                      onSubmit={handleCustomSleepSubmit}
                      className="mt-2.5 border-t border-slate-200 dark:border-white/10 pt-2.5"
                    >
                      <p className="mb-1.5 px-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Nhập thời gian tùy chỉnh
                      </p>
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                          <input
                            type="number"
                            min={0}
                            max={12}
                            inputMode="numeric"
                            value={customHours}
                            onChange={(e) => setCustomHours(e.target.value)}
                            aria-label="Số giờ hẹn tắt"
                            className="h-9 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0F1217] pl-2.5 pr-7 text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:border-[#E11D48] focus:outline-none"
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                            giờ
                          </span>
                        </div>

                        <div className="relative flex-1">
                          <input
                            type="number"
                            min={0}
                            max={720}
                            inputMode="numeric"
                            value={customMinutes}
                            onChange={(e) => setCustomMinutes(e.target.value)}
                            aria-label="Số phút hẹn tắt"
                            className="h-9 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0F1217] pl-2.5 pr-9 text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:border-[#E11D48] focus:outline-none"
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                            phút
                          </span>
                        </div>

                        <button
                          type="submit"
                          disabled={
                            (parseInt(customHours || '0', 10) || 0) * 60 +
                              (parseInt(customMinutes || '0', 10) || 0) <=
                            0
                          }
                          className="h-9 rounded-lg bg-[#E11D48] px-3 text-xs font-semibold text-white hover:bg-[#BE123C] disabled:opacity-40 whitespace-nowrap shrink-0 transition-colors"
                        >
                          Đặt
                        </button>
                      </div>
                    </form>

                    {hasSleepTimer && (
                      <button
                        type="button"
                        onClick={() => {
                          onSetSleepTimer(null);
                          setShowSleepMenu(false);
                        }}
                        className="mt-2 flex w-full items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-medium text-[#E11D48] dark:text-[#FB7185] hover:bg-rose-500/15 transition-colors"
                      >
                        Hủy hẹn giờ
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Volume control */}
              <div className="hidden sm:flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-label={isMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={isMuted ? 0 : volume}
                  aria-label="Âm lượng"
                  onChange={(e) => onVolumeChange(Number(e.target.value))}
                  className="pure-range h-1.5 w-20 rounded-full bg-slate-200 dark:bg-white/15"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Queue List Tab */
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Hàng đợi phát · {queue.length} bài
            </span>
          </div>
          <div className="space-y-1">
            {queue.map((item, idx) => {
              const active = idx === currentIndex;
              return (
                <div
                  key={`${item.id}-${idx}`}
                  className={`flex items-center gap-3 rounded-xl p-2 transition-colors ${
                    active
                      ? 'bg-[#E11D48]/[0.09] dark:bg-[#F43F5E]/[0.12]'
                      : 'hover:bg-slate-100 dark:hover:bg-[#161A22]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectQueueIndex(idx)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <TrackThumbnail
                      src={item.thumbnail}
                      alt={item.title}
                      durationText={item.durationText}
                      isActive={active}
                      isPlaying={active && isPlaying}
                      className="w-16 rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-xs font-semibold ${
                          active
                            ? 'text-[#E11D48] dark:text-[#FB7185]'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {item.author}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveFromQueue(idx)}
                    aria-label="Xóa khỏi hàng đợi"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
