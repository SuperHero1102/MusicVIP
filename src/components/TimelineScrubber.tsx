import React from 'react';
import {
  SPONSOR_CATEGORY_LABELS,
  type SponsorSegment,
  type SponsorSettings,
} from '../types/media';
import { formatTime } from '../utils/format';

interface TimelineScrubberProps {
  currentTime: number;
  duration: number;
  buffered: number;
  segments: SponsorSegment[];
  sponsorSettings: SponsorSettings;
  disabled?: boolean;
  onSeek: (seconds: number) => void;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  currentTime,
  duration,
  buffered,
  segments,
  sponsorSettings,
  disabled = false,
  onSeek,
}) => {
  const safeDuration = duration > 0 ? duration : 1;
  const progressPct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));
  const bufferedPct = Math.min(100, Math.max(0, (buffered / safeDuration) * 100));

  const activeSegments = sponsorSettings.enabled
    ? segments.filter((s) => sponsorSettings.categories[s.category])
    : [];

  return (
    <div className="w-full select-none">
      <div className="relative flex h-7 items-center">
        {/* Track base */}
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
          {/* Buffered progress */}
          <div
            className="absolute inset-y-0 left-0 bg-slate-300 dark:bg-white/20 transition-[width] duration-200"
            style={{ width: `${bufferedPct}%` }}
          />
          {/* Played progress */}
          <div
            className="absolute inset-y-0 left-0 bg-[#E11D48] dark:bg-[#F43F5E]"
            style={{ width: `${progressPct}%` }}
          />
          {/* SponsorBlock skip markers */}
          {duration > 0 &&
            activeSegments.map((seg) => {
              const leftPct = Math.min(100, (seg.start / safeDuration) * 100);
              const widthPct = Math.max(
                0.8,
                Math.min(100 - leftPct, ((seg.end - seg.start) / safeDuration) * 100)
              );
              const color = SPONSOR_CATEGORY_LABELS[seg.category]?.color || '#F59E0B';
              return (
                <div
                  key={seg.uuid}
                  title={`${SPONSOR_CATEGORY_LABELS[seg.category]?.label || 'Tài trợ'} (${formatTime(seg.start)} – ${formatTime(seg.end)})`}
                  className="absolute inset-y-0 opacity-90"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: color,
                  }}
                />
              );
            })}
        </div>

        {/* Native accessible range input overlay */}
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.5}
          value={Math.min(currentTime, duration || 100)}
          disabled={disabled || duration <= 0}
          aria-label="Thanh tiến trình phát"
          onChange={(e) => onSeek(Number(e.target.value))}
          className="pure-range absolute inset-0 h-full w-full opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
        />
      </div>

      {/* Time readouts + clean unboxed SponsorBlock summary */}
      <div className="mt-1 flex items-center justify-between text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
        <span>{formatTime(currentTime)}</span>
        {activeSegments.length > 0 && (
          <span className="font-sans text-[11px] text-amber-600 dark:text-amber-400 truncate max-w-[190px]">
            Tự bỏ qua {activeSegments.length} đoạn quảng cáo
          </span>
        )}
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};
