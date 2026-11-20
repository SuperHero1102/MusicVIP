import React from 'react';
import { Moon, ShieldCheck, Smartphone, Sun } from 'lucide-react';
import {
  SPONSOR_CATEGORY_LABELS,
  type SponsorCategory,
  type SponsorSettings,
} from '../types/media';
import type { SkipStats } from '../hooks/useLibrary';
import { formatSavedTime } from '../utils/format';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsViewProps {
  sponsorSettings: SponsorSettings;
  skipStats: SkipStats;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onToggleSponsorMaster: () => void;
  onToggleSponsorCategory: (cat: SponsorCategory) => void;
}

const CATEGORIES: SponsorCategory[] = [
  'sponsor',
  'selfpromo',
  'interaction',
  'music_offtopic',
  'intro',
  'outro',
  'preview',
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  sponsorSettings,
  skipStats,
  theme,
  onToggleTheme,
  onToggleSponsorMaster,
  onToggleSponsorCategory,
}) => {
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Cài đặt & Chặn quảng cáo
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Tùy chỉnh bộ lọc bỏ qua quảng cáo SponsorBlock, nghe nền khi tắt màn hình và giao diện.
        </p>
      </div>

      {/* SponsorBlock Section */}
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-white/[0.08] pb-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#E11D48] dark:text-[#F43F5E]" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Tự động bỏ qua đoạn quảng cáo (SponsorBlock)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Đã bỏ qua{' '}
                <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-200">
                  {skipStats.segmentsSkipped}
                </span>{' '}
                đoạn · Tiết kiệm{' '}
                <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-200">
                  {formatSavedTime(skipStats.secondsSaved)}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={sponsorSettings.enabled}
            onClick={onToggleSponsorMaster}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
              sponsorSettings.enabled ? 'bg-[#E11D48]' : 'bg-slate-300 dark:bg-white/15'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                sponsorSettings.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className={`divide-y divide-slate-100 dark:divide-white/[0.06] ${sponsorSettings.enabled ? '' : 'opacity-45 pointer-events-none'}`}>
          {CATEGORIES.map((cat) => {
            const info = SPONSOR_CATEGORY_LABELS[cat];
            const active = sponsorSettings.categories[cat];
            return (
              <div key={cat} className="flex items-center justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: info.color }}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {info.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {info.description}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  onClick={() => onToggleSponsorCategory(cat)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    active ? 'bg-[#E11D48]' : 'bg-slate-300 dark:bg-white/15'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      active ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Background playback & PWA install */}
      <section className="space-y-4 border-t border-slate-200 dark:border-white/[0.08] pt-6">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Nghe nền khi tắt màn hình trên mọi thiết bị
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Music Tube phát luồng âm thanh gốc kết hợp chuẩn Media Session API. Khi ở chế độ <strong>Âm thanh</strong>, bạn có thể khóa màn hình hoặc chuyển sang ứng dụng khác mà nhạc vẫn chạy liên tục cùng nút điều khiển trên màn hình khóa.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <PWAInstallButton />
            </div>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="flex items-center justify-between gap-4 border-t border-slate-200 dark:border-white/[0.08] pt-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Giao diện hiển thị
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Đang sử dụng chế độ {theme === 'dark' ? 'Tối sâu dịu mắt' : 'Sáng tối giản'}
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#14171D] px-4 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1C212A] transition-colors whitespace-nowrap shrink-0"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="h-4 w-4 text-amber-400" />
              <span>Chuyển sang Sáng</span>
            </>
          ) : (
            <>
              <Moon className="h-4 w-4 text-slate-600" />
              <span>Chuyển sang Tối</span>
            </>
          )}
        </button>
      </section>
    </div>
  );
};
