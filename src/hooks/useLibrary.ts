import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SPONSOR_SETTINGS,
  type Playlist,
  type SponsorCategory,
  type SponsorSettings,
  type TrackItem,
} from '../types/media';
import { readStorage, writeStorage } from '../utils/format';

const KEYS = {
  favorites: 'purestream_favorites_v1',
  history: 'purestream_history_v1',
  playlists: 'purestream_playlists_v1',
  sponsor: 'purestream_sponsor_v1',
  stats: 'purestream_skip_stats_v1',
  theme: 'purestream_theme_v1',
  recentSearches: 'purestream_searches_v1',
};

export interface SkipStats {
  segmentsSkipped: number;
  secondsSaved: number;
}

export function useLibrary() {
  const [favorites, setFavorites] = useState<TrackItem[]>(() => readStorage(KEYS.favorites, []));
  const [history, setHistory] = useState<TrackItem[]>(() => readStorage(KEYS.history, []));
  const [playlists, setPlaylists] = useState<Playlist[]>(() => readStorage(KEYS.playlists, []));
  const [sponsorSettings, setSponsorSettings] = useState<SponsorSettings>(() =>
    readStorage(KEYS.sponsor, DEFAULT_SPONSOR_SETTINGS)
  );
  const [skipStats, setSkipStats] = useState<SkipStats>(() =>
    readStorage(KEYS.stats, { segmentsSkipped: 0, secondsSaved: 0 })
  );
  const [theme, setTheme] = useState<'dark' | 'light'>(() => readStorage(KEYS.theme, 'dark'));
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    readStorage(KEYS.recentSearches, [])
  );

  // Sync dark mode class on <html> and browser theme-color meta
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0B0D10' : '#F8F9FB');
    }
    writeStorage(KEYS.theme, theme);
  }, [theme]);

  useEffect(() => writeStorage(KEYS.favorites, favorites), [favorites]);
  useEffect(() => writeStorage(KEYS.history, history), [history]);
  useEffect(() => writeStorage(KEYS.playlists, playlists), [playlists]);
  useEffect(() => writeStorage(KEYS.sponsor, sponsorSettings), [sponsorSettings]);
  useEffect(() => writeStorage(KEYS.stats, skipStats), [skipStats]);
  useEffect(() => writeStorage(KEYS.recentSearches, recentSearches), [recentSearches]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const isFavorite = useCallback(
    (id: string) => favorites.some((t) => t.id === id),
    [favorites]
  );

  const toggleFavorite = useCallback((track: TrackItem) => {
    setFavorites((prev) => {
      if (prev.some((t) => t.id === track.id)) {
        return prev.filter((t) => t.id !== track.id);
      }
      return [track, ...prev];
    });
  }, []);

  const addToHistory = useCallback((track: TrackItem) => {
    setHistory((prev) => [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 50));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const addRecentSearch = useCallback((term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setRecentSearches((prev) => [clean, ...prev.filter((s) => s.toLowerCase() !== clean.toLowerCase())].slice(0, 8));
  }, []);

  const removeRecentSearch = useCallback((term: string) => {
    setRecentSearches((prev) => prev.filter((s) => s !== term));
  }, []);

  const createPlaylist = useCallback((name: string, initialTrack?: TrackItem) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const pl: Playlist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      createdAt: Date.now(),
      tracks: initialTrack ? [initialTrack] : [],
    };
    setPlaylists((prev) => [pl, ...prev]);
    return pl;
  }, []);

  const deletePlaylist = useCallback((playlistId: string) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
  }, []);

  const addTrackToPlaylist = useCallback((playlistId: string, track: TrackItem) => {
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        if (p.tracks.some((t) => t.id === track.id)) return p;
        return { ...p, tracks: [...p.tracks, track] };
      })
    );
  }, []);

  const removeTrackFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p
      )
    );
  }, []);

  const toggleSponsorMaster = useCallback(() => {
    setSponsorSettings((prev) => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  const toggleSponsorCategory = useCallback((category: SponsorCategory) => {
    setSponsorSettings((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [category]: !prev.categories[category],
      },
    }));
  }, []);

  const recordSkip = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    setSkipStats((prev) => ({
      segmentsSkipped: prev.segmentsSkipped + 1,
      secondsSaved: prev.secondsSaved + seconds,
    }));
  }, []);

  return {
    favorites,
    history,
    playlists,
    sponsorSettings,
    skipStats,
    theme,
    recentSearches,
    toggleTheme,
    isFavorite,
    toggleFavorite,
    addToHistory,
    clearHistory,
    addRecentSearch,
    removeRecentSearch,
    createPlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    toggleSponsorMaster,
    toggleSponsorCategory,
    recordSkip,
  };
}
