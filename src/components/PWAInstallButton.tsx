import React, { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[#E11D48] font-medium text-white hover:bg-[#BE123C] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
          compact ? 'px-3.5 py-2 text-xs' : 'px-4 py-2.5 text-sm'
        }`}
      >
        <Download className="h-4 w-4" />
        <span>Cài ứng dụng</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-white/15 font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
            compact ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'
          }`}
        >
          <Download className="h-4 w-4" />
          <span>Cài trên iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#14171D] border border-slate-200 dark:border-white/10 p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Cài Music Tube trên iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Đóng"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Cài lên màn hình chính giúp nghe nhạc nền ổn định hơn ngay cả khi tắt màn hình:
              </p>
              <ol className="mt-3 space-y-2.5 text-sm text-slate-700 dark:text-slate-200">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#F43F5E] mt-0.5">1.</span>
                  <span>
                    Chạm nút <Share className="inline h-4 w-4 mx-0.5 align-text-bottom" /> <strong>Chia sẻ</strong> ở thanh công cụ Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#F43F5E] mt-0.5">2.</span>
                  <span>
                    Cuộn xuống và chọn <strong>Thêm vào MH chính</strong> (Add to Home Screen).
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-slate-900 dark:bg-white py-2.5 text-sm font-medium text-white dark:text-slate-900 hover:opacity-90 transition-opacity"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>Đang ngoại tuyến — Danh sách cục bộ vẫn khả dụng</span>
    </div>
  );
};
