export interface NewsAnalysis {
  url: string;
  headline: string;
  summary5W1H: string;
  implications: string;
  date?: string;
  originalTitle?: string;
  tags?: string[];
}

export interface FetchResponse {
  url: string;
  title: string;
  metaDescription: string;
  bodyText: string;
}

export interface SavedReport {
  id: string;
  createdAt: string; // ISO string
  articleCount: number;
  analyses: NewsAnalysis[];
  sources?: NewsSource[];
}

export interface NewsSource {
  id: string;
  type: 'url' | 'text';
  url: string;
  title: string;
  text: string;
}

