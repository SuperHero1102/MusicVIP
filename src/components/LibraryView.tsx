import React, { useState } from 'react';
import { Clock, Heart, ListMusic, Play, Plus, Trash2 } from 'lucide-react';
import type { Playlist, TrackItem } from '../types/media';
import { TrackRow } from './TrackRow';

interface LibraryViewProps {
  favorites: TrackItem[];
  history: TrackItem[];
  playlists: Playlist[];
  currentTrackId: string | null;
  isPlaying: boolean;
  isFavorite: (id: string) => boolean;
  onPlayTrack: (track: TrackItem, list?: TrackItem[]) => void;
  onToggleFavorite: (track: TrackItem) => void;
  onAddToQueue: (track: TrackItem) => void;
  onOpenPlaylistModal: (track: TrackItem) => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (id: string) => void;
  onRemoveTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  onClearHistory: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  favorites,
  history,
  playlists,
  currentTrackId,
  isPlaying,
  isFavorite,
  onPlayTrack,
  onToggleFavorite,
  onAddToQueue,
  onOpenPlaylistModal,
  onCreatePlaylist,
  onDeletePlaylist,
  onRemoveTrackFromPlaylist,
  onClearHistory,
}) => {
  const [subTab, setSubTab] = useState<'favorites' | 'playlists' | 'history'>('favorites');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) || null;

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    onCreatePlaylist(newPlaylistName.trim());
    setNewPlaylistName('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Thư viện cá nhân
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Lưu trữ cục bộ trên thiết bị · Không cần đăng nhập
          </p>
        </div>

        {/* Segmented filter tabs */}
        <div className="inline-flex self-start items-center gap-1 rounded-xl bg-slate-100 dark:bg-[#14171D] p-1">
          <button
            type="button"
            onClick={() => {
              setSubTab('favorites');
              setSelectedPlaylistId(null);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              subTab === 'favorites'
                ? 'bg-white dark:bg-[#222834] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Heart className="h-3.5 w-3.5" />
            <span>Yêu thích ({favorites.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('playlists')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              subTab === 'playlists'
                ? 'bg-white dark:bg-[#222834] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <ListMusic className="h-3.5 w-3.5" />
            <span>Playlist ({playlists.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSubTab('history');
              setSelectedPlaylistId(null);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              subTab === 'history'
                ? 'bg-white dark:bg-[#222834] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Gần đây ({history.length})</span>
          </button>
        </div>
      </div>

      {/* Favorites */}
      {subTab === 'favorites' && (
        <div>
          {favorites.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] py-14 px-6 text-center">
              <Heart className="mx-auto h-7 w-7 text-slate-400 dark:text-slate-500" />
              <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                Chưa có bài hát yêu thích
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Chạm biểu tượng trái tim trên bất kỳ bài hát nào để lưu nhanh tại đây.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onPlayTrack(favorites[0], favorites)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#BE123C] transition-colors"
                >
                  <Play className="h-3.5 w-3.5" fill="currentColor" />
                  <span>Phát tất cả ({favorites.length})</span>
                </button>
              </div>
              {favorites.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  isActive={currentTrackId === track.id}
                  isPlaying={isPlaying}
                  isFavorite={true}
                  onPlay={() => onPlayTrack(track, favorites)}
                  onToggleFavorite={() => onToggleFavorite(track)}
                  onAddToQueue={() => onAddToQueue(track)}
                  onAddToPlaylist={() => onOpenPlaylistModal(track)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Playlists */}
      {subTab === 'playlists' && (
        <div className="space-y-5">
          {!selectedPlaylist ? (
            <>
              <form onSubmit={handleCreatePlaylist} className="flex items-center gap-2 max-w-md">
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="Tạo danh sách phát mới..."
                  className="h-11 flex-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#14171D] px-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#E11D48] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newPlaylistName.trim()}
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white px-4 text-sm font-medium text-white dark:text-slate-900 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  <span>Tạo mới</span>
                </button>
              </form>

              {playlists.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] py-14 px-6 text-center">
                  <ListMusic className="mx-auto h-7 w-7 text-slate-400 dark:text-slate-500" />
                  <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                    Chưa có danh sách phát nào
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Tạo danh sách phát riêng để nghe liên tục khi làm việc hoặc đi ngủ.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {playlists.map((pl) => (
                    <div
                      key={pl.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#14171D] p-4"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPlaylistId(pl.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                          {pl.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {pl.tracks.length} bài hát
                        </p>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {pl.tracks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onPlayTrack(pl.tracks[0], pl.tracks)}
                            aria-label={`Phát ${pl.name}`}
                            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E11D48] text-white hover:bg-[#BE123C]"
                          >
                            <Play className="h-4 w-4 translate-x-0.5" fill="currentColor" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeletePlaylist(pl.id)}
                          aria-label={`Xóa ${pl.name}`}
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-white/5"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-white/[0.08] pb-4">
                <div>
                  <button
                    type="button"
                    onClick={() => setSelectedPlaylistId(null)}
                    className="text-xs font-medium text-[#E11D48] dark:text-[#F43F5E] hover:underline"
                  >
                    ← Tất cả danh sách phát
                  </button>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {selectedPlaylist.name}
                  </h2>
                </div>
                {selectedPlaylist.tracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onPlayTrack(selectedPlaylist.tracks[0], selectedPlaylist.tracks)}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#BE123C]"
                  >
                    <Play className="h-3.5 w-3.5" fill="currentColor" />
                    <span>Phát tất cả</span>
                  </button>
                )}
              </div>

              {selectedPlaylist.tracks.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Danh sách phát này đang trống.
                </p>
              ) : (
                <div className="space-y-1">
                  {selectedPlaylist.tracks.map((track) => (
                    <div key={track.id} className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <TrackRow
                          track={track}
                          isActive={currentTrackId === track.id}
                          isPlaying={isPlaying}
                          isFavorite={isFavorite(track.id)}
                          onPlay={() => onPlayTrack(track, selectedPlaylist.tracks)}
                          onToggleFavorite={() => onToggleFavorite(track)}
                          onAddToQueue={() => onAddToQueue(track)}
                          onAddToPlaylist={() => onOpenPlaylistModal(track)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveTrackFromPlaylist(selectedPlaylist.id, track.id)}
                        aria-label="Gỡ khỏi danh sách phát"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-rose-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {subTab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] py-14 px-6 text-center">
              <Clock className="mx-auto h-7 w-7 text-slate-400 dark:text-slate-500" />
              <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                Lịch sử nghe đang trống
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="text-xs font-medium text-slate-500 hover:text-rose-500 dark:text-slate-400"
                >
                  Xóa toàn bộ lịch sử
                </button>
              </div>
              {history.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  isActive={currentTrackId === track.id}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite(track.id)}
                  onPlay={() => onPlayTrack(track, history)}
                  onToggleFavorite={() => onToggleFavorite(track)}
                  onAddToQueue={() => onAddToQueue(track)}
                  onAddToPlaylist={() => onOpenPlaylistModal(track)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
