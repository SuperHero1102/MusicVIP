import React, { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { Playlist, TrackItem } from '../types/media';

interface PlaylistModalProps {
  track: TrackItem | null;
  playlists: Playlist[];
  onClose: () => void;
  onAddTrack: (playlistId: string, track: TrackItem) => void;
  onCreatePlaylist: (name: string, track: TrackItem) => void;
}

export const PlaylistModal: React.FC<PlaylistModalProps> = ({
  track,
  playlists,
  onClose,
  onAddTrack,
  onCreatePlaylist,
}) => {
  const [name, setName] = useState('');

  if (!track) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreatePlaylist(name.trim(), track);
    setName('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#14171D] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Lưu vào danh sách phát
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
          {track.title}
        </p>

        {/* Existing playlists */}
        <div className="mt-4 max-h-52 space-y-1.5 overflow-y-auto">
          {playlists.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
              Chưa có danh sách phát nào. Tạo mới ngay bên dưới.
            </p>
          ) : (
            playlists.map((pl) => {
              const exists = pl.tracks.some((t) => t.id === track.id);
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => {
                    onAddTrack(pl.id, track);
                    onClose();
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {pl.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {pl.tracks.length} bài
                    </p>
                  </div>
                  {exists && <Check className="h-4 w-4 text-[#E11D48] dark:text-[#F43F5E]" />}
                </button>
              );
            })
          )}
        </div>

        {/* Create new playlist inline */}
        <form onSubmit={handleCreate} className="mt-4 flex items-center gap-2 border-t border-slate-200 dark:border-white/[0.08] pt-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên danh sách phát mới..."
            className="h-11 flex-1 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0B0D10] px-3.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#E11D48] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#E11D48] px-4 text-sm font-medium text-white hover:bg-[#BE123C] disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Tạo</span>
          </button>
        </form>
      </div>
    </div>
  );
};
