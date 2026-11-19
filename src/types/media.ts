export type SponsorCategory =
  | 'sponsor'
  | 'selfpromo'
  | 'interaction'
  | 'intro'
  | 'outro'
  | 'music_offtopic'
  | 'preview';

export interface SponsorSegment {
  uuid: string;
  category: SponsorCategory;
  start: number;
  end: number;
}

export interface TrackItem {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSeconds: number;
  durationText: string;
  viewsText: string;
  publishedText: string;
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  tracks: TrackItem[];
}

export interface SponsorSettings {
  enabled: boolean;
  categories: Record<SponsorCategory, boolean>;
}

export type PlayMode = 'audio' | 'video';
export type RepeatMode = 'off' | 'all' | 'one';
export type NavTab = 'discover' | 'search' | 'library' | 'settings';

export const SPONSOR_CATEGORY_LABELS: Record<
  SponsorCategory,
  { label: string; description: string; color: string }
> = {
  sponsor: {
    label: 'Quảng cáo tài trợ',
    description: 'Đoạn giới thiệu sản phẩm hoặc dịch vụ được trả tiền trong video',
    color: '#F59E0B',
  },
  selfpromo: {
    label: 'Tự quảng bá',
    description: 'Đoạn bán hàng, khóa học hoặc quảng cáo kênh phụ của tác giả',
    color: '#EAB308',
  },
  interaction: {
    label: 'Nhắc tương tác',
    description: 'Lời kêu gọi bấm thích, đăng ký kênh và bật chuông thông báo',
    color: '#EC4899',
  },
  intro: {
    label: 'Đoạn mở đầu (Intro)',
    description: 'Phần giới thiệu hoặc khoảng lặng dài trước nội dung chính',
    color: '#06B6D4',
  },
  outro: {
    label: 'Đoạn kết (Outro)',
    description: 'Màn hình kết thúc, cảm ơn và danh sách đề xuất cuối video',
    color: '#6366F1',
  },
  music_offtopic: {
    label: 'Đoạn không có nhạc',
    description: 'Cảnh thoại hoặc đoạn cắt giữa MV không thuộc phần âm nhạc',
    color: '#F97316',
  },
  preview: {
    label: 'Xem trước / Tóm tắt',
    description: 'Đoạn tóm tắt nội dung cũ hoặc giới thiệu tập tiếp theo',
    color: '#3B82F6',
  },
};

export const DEFAULT_SPONSOR_SETTINGS: SponsorSettings = {
  enabled: true,
  categories: {
    sponsor: true,
    selfpromo: true,
    interaction: true,
    intro: false,
    outro: false,
    music_offtopic: true,
    preview: false,
  },
};
