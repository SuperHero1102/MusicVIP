import React from 'react';
import { Loader2, Pause, Play, SkipForward } from 'lucide-react';
import type { TrackItem } from '../types/media';
import { TrackThumbnail } from './TrackThumbnail';

interface MiniPlayerProps {
  track: TrackItem;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  onExpand: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  track,
  isPlaying,
  isLoading,
  currentTime,
  duration,
  onExpand,
  onTogglePlay,
  onNext,
}) => {
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="lg:hidden fixed left-3 right-3 bottom-[68px] z-30 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-[#14171D]/95 backdrop-blur-md shadow-xl shadow-black/20">
      {/* Slim progress hairline */}
      <div className="h-[2px] w-full bg-slate-200 dark:bg-white/10">
        <div
          className="h-full bg-[#E11D48] dark:bg-[#F43F5E] transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-2.5 py-2">
        <button
          type="button"
          onClick={onExpand}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <TrackThumbnail
            src={track.thumbnail}
            alt={track.title}
            aspect="square"
            className="h-10 w-10 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
              {track.title}
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {track.author}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-900 dark:text-white active:scale-95 transition-transform"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[#F43F5E]" />
            ) : isPlaying ? (
              <Pause className="h-5 w-5" fill="currentColor" />
            ) : (
              <Play className="h-5 w-5 translate-x-0.5" fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Bài tiếp theo"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 active:scale-95 transition-transform"
          >
            <SkipForward className="h-5 w-5" fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
};
