import React from 'react';
import { Heart, ListPlus, Play } from 'lucide-react';
import type { TrackItem } from '../types/media';
import { TrackThumbnail } from './TrackThumbnail';

interface TrackRowProps {
  track: TrackItem;
  isActive: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  isActive,
  isPlaying,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onAddToQueue,
  onAddToPlaylist,
}) => {
  const metaParts = [track.author, track.viewsText, track.publishedText].filter(Boolean);

  return (
    <div
      className={`group flex items-center gap-3.5 rounded-xl p-2.5 transition-colors duration-150 ${
        isActive
          ? 'bg-[#E11D48]/[0.08] dark:bg-[#F43F5E]/[0.12]'
          : 'hover:bg-slate-100/90 dark:hover:bg-[#14171D]'
      }`}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] rounded-lg"
      >
        <TrackThumbnail
          src={track.thumbnail}
          alt={track.title}
          durationText={track.durationText}
          isActive={isActive}
          isPlaying={isPlaying}
          className="w-28 sm:w-32 rounded-lg"
        />

        <div className="min-w-0 flex-1 py-0.5">
          <h3
            className={`line-clamp-2 text-sm sm:text-[15px] font-semibold leading-snug ${
              isActive
                ? 'text-[#E11D48] dark:text-[#FB7185]'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {track.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {metaParts.map((part, idx) => (
              <React.Fragment key={`${part}-${idx}`}>
                {idx > 0 && <span aria-hidden="true">·</span>}
                <span className="truncate max-w-[180px]">{part}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </button>

      {/* Action buttons with >= 44px touch target on mobile */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={onToggleFavorite}
          title={isFavorite ? 'Bỏ yêu thích' : 'Yêu thích'}
          aria-label={isFavorite ? 'Bỏ yêu thích' : 'Yêu thích'}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
            isFavorite
              ? 'text-[#E11D48] dark:text-[#F43F5E]'
              : 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-200'
          }`}
        >
          <Heart className="h-[18px] w-[18px]" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>

        <button
          type="button"
          onClick={onAddToQueue}
          title="Thêm vào hàng đợi"
          aria-label="Thêm vào hàng đợi"
          className="hidden sm:flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E]"
        >
          <Play className="h-[16px] w-[16px]" />
        </button>

        <button
          type="button"
          onClick={onAddToPlaylist}
          title="Lưu vào danh sách phát"
          aria-label="Lưu vào danh sách phát"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E]"
        >
          <ListPlus className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
};
