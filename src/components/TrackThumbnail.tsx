import React, { useState } from 'react';
import { Headphones } from 'lucide-react';

interface TrackThumbnailProps {
  src: string;
  alt: string;
  durationText?: string;
  isActive?: boolean;
  isPlaying?: boolean;
  aspect?: 'video' | 'square';
  className?: string;
}

export const TrackThumbnail: React.FC<TrackThumbnailProps> = ({
  src,
  alt,
  durationText,
  isActive = false,
  isPlaying = false,
  aspect = 'video',
  className = '',
}) => {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`relative overflow-hidden bg-slate-200 dark:bg-[#1C212A] shrink-0 select-none ${
        aspect === 'square' ? 'aspect-square' : 'aspect-video'
      } ${className}`}
    >
      {!failed && src ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 ease-out"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 dark:from-[#181C24] dark:to-[#0F1218]">
          <Headphones className="h-6 w-6 text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex items-end gap-[3px] h-4" aria-label={isPlaying ? 'Đang phát' : 'Tạm dừng'}>
            <span
              className={`w-[3px] rounded-full bg-[#F43F5E] transition-all ${
                isPlaying ? 'h-4 animate-bounce' : 'h-1.5'
              }`}
              style={{ animationDuration: '680ms' }}
            />
            <span
              className={`w-[3px] rounded-full bg-[#F43F5E] transition-all ${
                isPlaying ? 'h-2.5 animate-bounce' : 'h-2.5'
              }`}
              style={{ animationDuration: '520ms', animationDelay: '120ms' }}
            />
            <span
              className={`w-[3px] rounded-full bg-[#F43F5E] transition-all ${
                isPlaying ? 'h-3.5 animate-bounce' : 'h-1.5'
              }`}
              style={{ animationDuration: '620ms', animationDelay: '220ms' }}
            />
          </div>
        </div>
      )}

      {durationText && !isActive && (
        <span className="absolute bottom-1.5 right-1.5 rounded px-1.5 py-0.5 bg-black/80 text-[11px] font-mono tabular-nums font-medium text-white leading-none">
          {durationText}
        </span>
      )}
    </div>
  );
};
