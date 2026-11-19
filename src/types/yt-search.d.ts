declare module 'yt-search' {
  export interface YtsAuthor {
    name?: string;
    url?: string;
  }

  export interface YtsVideo {
    videoId: string;
    title: string;
    thumbnail?: string;
    seconds: number;
    timestamp?: string;
    views?: number;
    ago?: string;
    author?: YtsAuthor;
  }

  export interface YtsSearchResult {
    videos: YtsVideo[];
  }

  function yts(query: string): Promise<YtsSearchResult>;
  function yts(options: { videoId: string }): Promise<YtsVideo>;
  export default yts;
}
