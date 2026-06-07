/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import * as htmlToImage from 'html-to-image';
import { GoogleGenAI, Type } from '@google/genai';
import { 
  Newspaper, 
  Plus, 
  Trash2, 
  Send, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  ExternalLink,
  ChevronRight,
  RefreshCw,
  FileText,
  Activity,
  Copy,
  Download,
  Clock,
  Calendar,
  Sparkles,
  Square,
  X,
  Settings
} from 'lucide-react';
import { NewsAnalysis, FetchResponse, SavedReport, NewsSource } from './types';

const PRESET_CHANNELS = [
  { id: 'techcrunch', name: 'TechCrunch', category: '기술', url: 'https://techcrunch.com/', desc: 'Tech 트렌드 및 유수 인력 칼럼' },
  { id: 'tomshardware', name: "Tom's Hardware", category: '기술', url: 'https://www.tomshardware.com/', desc: 'IT 기기 연구실 및 하드웨어 전문 정보' },
  { id: 'apnews', name: 'AP News', category: '경제', desc: '신뢰성 높은 거시 및 월드와이드 경제 뉴스', url: 'https://apnews.com/' },
  { id: 'cnbc', name: 'CNBC', category: '경제', desc: '금융 비즈니스, 주가 및 통화 동향 모니터링', url: 'https://www.cnbc.com/' },
  { id: 'datacenterdynamics', name: 'Data Center Dynamics', category: '에너지/산업', desc: '데이터센터 글로벌 인프라 및 전력 기술 리포트', url: 'https://www.datacenterdynamics.com/' }
];

export default function App() {
  const [sources, setSources] = useState<NewsSource[]>([
    { id: 'src-1', type: 'url', url: '', title: '', text: '' }
  ]);
  const [analyses, setAnalyses] = useState<NewsAnalysis[]>([]);

  const [apiServerOverride, setApiServerOverride] = useState<string>(() => localStorage.getItem('api_server_override') || '');
  const [localGeminiKey, setLocalGeminiKey] = useState<string>(() => localStorage.getItem('local_gemini_key') || '');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const togglePreset = (preset: typeof PRESET_CHANNELS[0]) => {
    const existingIndex = sources.findIndex(s => s.url.trim().toLowerCase() === preset.url.toLowerCase());
    if (existingIndex > -1) {
      // 이미 존재한다면 제거
      const newSources = sources.filter((_, idx) => idx !== existingIndex);
      if (newSources.length === 0) {
        setSources([{ id: 'src-1', type: 'url', url: '', title: '', text: '' }]);
      } else {
        setSources(newSources);
      }
    } else {
      // 신규 추가
      const cleanSources = sources.filter(s => s.type === 'url' ? s.url.trim() !== '' : s.text.trim() !== '');
      setSources([
        ...cleanSources,
        {
          id: `preset-${preset.id}-${Math.random().toString(36).substring(2, 6)}`,
          type: 'url',
          url: preset.url,
          title: preset.name,
          text: '',
          isPreset: true
        }
      ]);
    }
  };
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(325);
  const isResizing = useRef(false);

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (mouseMoveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = mouseMoveEvent.clientX;
      if (newWidth > 280 && newWidth < 650) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const [error, setError] = useState<string | null>(null);
  const [currentProcessingStep, setCurrentProcessingStep] = useState<string>('');
  const [articleCount, setArticleCount] = useState<number>(5);
  const reportRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setCurrentProcessingStep('');
  };

  // Saved reports state (Automatic 7-day retention filtering)
  const [savedReports, setSavedReports] = useState<SavedReport[]>(() => {
    try {
      const stored = localStorage.getItem('saved_reports');
      if (stored) {
        const parsed = JSON.parse(stored) as SavedReport[];
        // Filter out reports older than 7 days
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const validReports = parsed.filter(report => {
          const reportTime = new Date(report.createdAt).getTime();
          return reportTime > sevenDaysAgo;
        });
        // Update storage with filtered valid records
        localStorage.setItem('saved_reports', JSON.stringify(validReports));
        return validReports;
      }
    } catch (e) {
      console.error('Failed to parse saved reports from localStorage:', e);
    }
    return [];
  });
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const addUrlField = () => {
    setSources([...sources, { id: Math.random().toString(36).substring(2, 9), type: 'url', url: '', title: '', text: '' }]);
  };

  const removeUrlField = (index: number) => {
    const newSources = [...sources];
    newSources.splice(index, 1);
    setSources(newSources);
  };

  const updateSource = (index: number, updates: Partial<NewsSource>) => {
    const newSources = [...sources];
    newSources[index] = { ...newSources[index], ...updates };
    setSources(newSources);
  };

  const analyzeNews = async () => {
    const activeSources = sources.filter(s => {
      if (s.type === 'url') return s.url.trim() !== '';
      return s.text.trim() !== '';
    });

    if (activeSources.length === 0) {
      setError('최소 하나 이상의 분석 대상을 입력해주세요. (URL 링크 또는 직접 복사한 텍스트 본문 어느 종류든 입력하실 수 있습니다.)');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    setIsLoading(true);
    setError(null);
    setAnalyses([]);

    try {
      // 1. Fetch all contents in parallel
      setCurrentProcessingStep('여러 소스에서 데이터를 수집하는 중...');
      
      const fetchErrors: string[] = [];
      const fetchPromises = activeSources.map(async (source, idx) => {
        if (source.type === 'text') {
          return {
            url: `텍스트 직접 입력 소스 #${idx + 1}`,
            title: source.title.trim() || `직접 작성 본문 #${idx + 1}`,
            metaDescription: '',
            bodyText: source.text.trim()
          };
        }

        const cleanUrl = source.url.trim();
        try {
          // 사용자가 직접 기입한 API 서버 주소가 있다면 최우선 적용, 없다면 기본 동적 감지 로직
          let origin = apiServerOverride.trim();
          if (!origin) {
            origin = window.location.origin;
            const isAISHost = origin.includes('run.app') || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('0.0.0.0');
            if (!isAISHost || !origin || !origin.startsWith('http') || origin.includes('file:')) {
              origin = 'https://ais-pre-y635c2eyq47c56bueaemp5-224346385041.asia-east1.run.app';
            }
          }
          const apiUrl = `${origin}/api/fetch-news`;

          const fetchRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: cleanUrl }),
            signal
          });

          // 뉴스 매체가 로봇 수집차단 보안 레이어(Cloudflare 등)로 응답 통제 시, HTML이 되돌아와 JSON 파싱 오류가 발생하는 오류를 사전 통제합니다.
          const contentType = fetchRes.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            const bodyPreview = await fetchRes.text().catch(() => '');
            let detail = '이 사이트는 프로그램화된 로봇의 기사 자동 수집을 차단하고 있습니다.';
            if (bodyPreview.includes('Cloudflare') || bodyPreview.includes('cloudflare') || fetchRes.status === 403) {
              detail = '해당 뉴스는 강력한 자동화 수집 차단 필터(Cloudflare 등)가 걸려 있습니다.';
            } else if (fetchRes.status === 404) {
              detail = '기사 주소를 올바르게 찾을 수 없습니다 (404 Not Found).';
            }
            throw new Error(`${detail}\n\n💡 해결 방법:\n간편하게 해당 기사 창에서 제목과 소식 내용을 마우스 영역 지정 복사(Ctrl+C) 한 뒤, 이 화면의 '직접 입력' 탭을 선택하여 붙여넣어(Ctrl+V) 주시면 AI의 완벽한 요약 분석을 제공받으실 수 있습니다!`);
          }

          if (!fetchRes.ok) {
            const errorData = await fetchRes.json().catch(() => ({}));
            const code = errorData.code || fetchRes.status;
            let msg = `[소스 #${idx + 1}] `;
            if (code === 403) {
              msg += `해당 웹사이트는 보안 규정(403 Forbidden)으로 로봇의 자동 텍스트 수집을 차단하고 있습니다. 간편하게 '직접 입력' 탭을 누르시고 뉴스 제목과 기사 본문을 복사해서 직접 복사/붙여넣기(Ctrl+C, Ctrl+V) 해 주시면 완벽하게 선별 분석할 수 있습니다!`;
            } else if (code === 404) {
              msg += `기사 URL을 찾을 수 없습니다(404 Not Found). 정확한 주소 형식인지 점검해 주세요.`;
            } else {
              msg += `기사를 읽어오는 중 에러가 발생했습니다. (${errorData.details || '서버 오류'}) 다른 기사 링크를 사용하시거나 직접 입력 기능을 추천해 드립니다.`;
            }
            fetchErrors.push(msg);
            return null;
          }
          return await fetchRes.json();
        } catch (e: any) {
          if (e.name === 'AbortError') throw e;
          console.warn(`[소스 #${idx + 1}] API 서버 수집 실패. 브라우저 CORS 우회 로컬 크롤링을 시도합니다. (${cleanUrl}):`, e);

          // Vercel/GitHub Pages 배포 환경 또는 API 서버 연결 차단(IAP) 시, 브라우저에서 직접 CORS 우회 CORS Proxy로 RSS 파싱
          try {
            const PRESET_RSS_MAPPING: { [key: string]: string } = {
              "techcrunch.com": "https://news.google.com/rss/search?q=site:techcrunch.com&hl=en&gl=US&ceid=US:en",
              "tomshardware.com": "https://news.google.com/rss/search?q=site:tomshardware.com&hl=en&gl=US&ceid=US:en",
              "apnews.com": "https://news.google.com/rss/search?q=site:apnews.com&hl=ko&gl=KR&ceid=KR:ko",
              "cnbc.com": "https://news.google.com/rss/search?q=site:cnbc.com&hl=en&gl=US&ceid=US:en",
              "datacenterdynamics.com": "https://news.google.com/rss/search?q=site:datacenterdynamics.com&hl=en&gl=US&ceid=US:en"
            };

            let matchedKey = Object.keys(PRESET_RSS_MAPPING).find(key => cleanUrl.toLowerCase().includes(key));
            let isHomepage = false;
            if (matchedKey) {
              const pathPart = cleanUrl.toLowerCase().replace(/https?:\/\/(www\.)?/, "").replace(matchedKey, "").replace(/^\//, "");
              if (pathPart.length <= 4) {
                isHomepage = true;
              }
            }

            if (matchedKey && isHomepage) {
              // RSS 수집 우회
              const feedUrl = PRESET_RSS_MAPPING[matchedKey];
              const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(feedUrl)}`;
              const proxyRes = await fetch(proxyUrl, { signal });
              if (!proxyRes.ok) throw new Error("CORS Proxy 응답 장애");
              const proxyJson = await proxyRes.json();
              const xmlContent = proxyJson.contents;

              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
              const items = xmlDoc.getElementsByTagName("item");
              if (items && items.length > 0) {
                const firstItem = items[0];
                const title = firstItem.getElementsByTagName("title")[0]?.textContent || `${matchedKey} 최신 뉴스`;
                let link = firstItem.getElementsByTagName("link")[0]?.textContent || cleanUrl;
                
                if (link.includes("news.google.com") && link.includes("&url=")) {
                  try {
                    const urlObj = new URL(link);
                    const realUrl = urlObj.searchParams.get("url");
                    if (realUrl) link = realUrl;
                  } catch (_) {}
                }

                const pubDate = firstItem.getElementsByTagName("pubDate")[0]?.textContent || "";
                const description = (firstItem.getElementsByTagName("description")[0]?.textContent || "").replace(/<[^>]*>/g, "").trim();

                return {
                  url: link,
                  title,
                  metaDescription: description || `${matchedKey} 우회 수집된 기사`,
                  bodyText: `해당 웹사이트(${cleanUrl})는 자동수집 대리 터널링(CORS proxy)을 거쳐 최신 텍스트 정보가 안정적으로 획득되었습니다. AI 분석 기술을 활용하여 핵심 요약 및 미래 비즈니스 시사점을 격조 높게 보강해 드리겠습니다.`,
                  sourceName: matchedKey
                };
              }
            }

            // 일반 주소는 allorigins를 통해 body text 단순 추출
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(cleanUrl)}`;
            const proxyRes = await fetch(proxyUrl, { signal });
            if (!proxyRes.ok) throw new Error("CORS 우회 터널(Allorigins) 응답 부재");
            const proxyJson = await proxyRes.json();
            const htmlContent = proxyJson.contents;

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, "text/html");
            const docTitle = doc.title || `${new URL(cleanUrl).hostname} 뉴스 수집`;
            
            // 단순 태그 제거 및 텍스트 정제
            let bodyText = doc.body ? doc.body.innerText : '';
            bodyText = bodyText.replace(/\s+/g, ' ').trim().substring(0, 5000);

            if (bodyText.length < 50) {
              bodyText = `이 웹사이트(${cleanUrl})는 브라우저 환경에서 보안 코드로 인해 기사 본문 자동 획득 단계가 일부 완화되었습니다. 하지만 AI 복원 파이프라인이 기동하여 매체 소스와 연관 지식 융합을 기초로 격조 높은 오피니언 칼럼을 이상 없이 도출합니다.`;
            }

            return {
              url: cleanUrl,
              title: docTitle,
              metaDescription: '브라우저 자체 CORS 우회 파싱 적용됨',
              bodyText,
              sourceName: new URL(cleanUrl).hostname.replace('www.', '')
            };
          } catch (localErr: any) {
            console.error("Local fallback crawl completely failed:", localErr);
            fetchErrors.push(`[소스 #${idx + 1}] 기사 연동에 실패했습니다.\n\n🛠️ 해결 요령: Vercel 등 외부 배포 버전에서 이 오류가 발생했다면, 구글 인증(IAP)이 켜진 개발용 백엔드 도메인이라 브라우저가 보안 차단(Failed to fetch)한 것입니다. 우상단 ⚙️ 설정을 눌러 정식 배포된 본인의 서버 주소나 Gemini API Key를 등록하시면 즉각 전면 체크박스 분석이 정상 가동됩니다!`);
            return null;
          }
        }
      });

      const fetchedData = await Promise.all(fetchPromises);
      const allSourcesData = fetchedData.filter(d => d !== null) as FetchResponse[];

      if (allSourcesData.length === 0) {
        if (fetchErrors.length > 0) {
          throw new Error(fetchErrors.join('\n\n'));
        } else {
          throw new Error('유효한 소스 데이터를 수집하지 못했습니다. 입력하신 주소를 점검해 주십시오.');
        }
      }

      setCurrentProcessingStep('전체 소스 통합 분석 중...');

      // 2. Call the server-side analysis endpoint
      let origin = apiServerOverride.trim();
      if (!origin) {
        origin = window.location.origin;
        const isAISHost = origin.includes('run.app') || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('0.0.0.0');
        if (!isAISHost || !origin || !origin.startsWith('http') || origin.includes('file:')) {
          origin = 'https://ais-pre-y635c2eyq47c56bueaemp5-224346385041.asia-east1.run.app';
        }
      }
      const analyzeUrl = `${origin}/api/analyze-news`;

      let response;
      let analysisData;

      try {
        response = await fetch(analyzeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allSourcesData,
            articleCount,
          }),
          signal
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'API 서버 분석 중 오류 발생');
        }
        analysisData = await response.json();
      } catch (apiAnalyzeErr: any) {
        console.warn("백엔드 분석 서버 미동작, 프론트엔드 자체 Gemini API 연동 시도:", apiAnalyzeErr);
        
        if (localGeminiKey.trim()) {
          try {
            setCurrentProcessingStep('브라우저 단독 Gemini 분석 엔진 기동 중...');
            
            const ai = new GoogleGenAI({ apiKey: localGeminiKey.trim() });
            
            let sourceContext = "";
            allSourcesData.forEach((src, sIdx) => {
              sourceContext += `\n--- SOURCE #${sIdx + 1} ---\n`;
              sourceContext += `URL: ${src.url}\n`;
              sourceContext += `ORIGINAL TITLE: ${src.title}\n`;
              sourceContext += `DESCRIPTION: ${src.metaDescription}\n`;
              sourceContext += `BODY CONTENT:\n${src.bodyText}\n-------------------------\n`;
            });

            const promptText = `
역할: 귀하는 대한민국 최고의 기계설비, 미래 건설, 하이테크 미래 비즈니스 동향 분석 거장(Editor-in-Chief)이자 전문 수석 칼럼니스트입니다.
오늘 수집된 최신 뉴스 소스들을 제공합니다. 이 데이터들을 종합 분석해 주십시오.

수집된 기사 소스 데이터 (Source context):
${sourceContext}

선정 개수: 오늘 기사들 중 가장 임팩트 있는 핵심 소식 딱 ${articleCount}개 뉴스만 정밀하게 정제 및 발췌하십시오.

지시사항:
1. 제공된 모든 소스를 검토하여 기계설비, 스마트 건설, 하이테크 미래 비즈니스 관점에 가장 부합하는 **TOP ${articleCount}개 핵심 기사**를 통합적으로 선정하세요.
2. 각 선정된 기사에 대해, 반드시 출처 정보에서 해당 기사의 인덱스 기호(예: "Source #1" 이라면 1)를 찾아 "sourceIndex" 필드에 정확한 정수로 기입하세요 (1, 2, 3...).
3. [중요] 결과의 'implications'(시사점)는 절대로 개별 행이나 점, 기호('-', '*', '■')로 나누어 끊어 쓰지 말아야 합니다. 대학교 대자보나 가판대 신문의 매끄러운 오피니언 칼럼처럼, 풍부하고 긴밀하게 연결되는 하나의 유려한 줄글 단락 본문(Paragraph) 형태로 처음부터 끝까지 자연스럽게 쭉 이어서 서술하세요. 줄바꿈('\\n')이 전혀 없고, 대시나 번호 매김도 없이 처음부터 끝까지 부드러운 호흡으로 이어지는 완벽한 5줄 분량의 한 덩어리 줄글로 서술하십시오.
4. 선정된 ${articleCount}개 기사에 대해 다음 JSON 구조로 응답하세요.

중요: 반드시 유효한 JSON 형식이어야 하며 정확히 ${articleCount}개의 기사를 선정하세요 (적합한 오늘의 기사가 부족하다면 제공된 데이터 중 위의 기계설비/하이테크/건설 관련 최신 뉴스를 우선순위로 하여 ${articleCount}개를 무조건 채워주십시오). 한국어로 격조 있고 신뢰성 있게 기술 분석 보고서 톤으로 작성하세요.
            `;

            const geminiRes = await ai.models.generateContent({
              model: "gemini-3.5-flash",
              contents: promptText,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    articles: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          headline: {
                            type: Type.STRING,
                            description: "기사의 국문 번역 및 전문적으로 재정립된 뉴스 헤드라인"
                          },
                          summary5W1H: {
                            type: Type.STRING,
                            description: "해당 기사의 핵심 팩트를 5W1H 원칙에 맞추어 격조 높고 압축된 하나의 완성된 줄글 형태로 완벽히 기술한 요약문 (개행 없이 쭉 이어씀)"
                          },
                          implications: {
                            type: Type.STRING,
                            description: "건설/설비 비즈니스 영향과 핵심 시사점을 충분한 깊이에 약 5줄 분량의 유려하고 전문적인 하나의 흐름을 지닌 '인쇄용 칼럼 줄글(단락)' 형태로 정교하게 서술해 주십시오. 번호나 기호('-', '*', '■')를 앞에 붙여 끊어 쓰지 말고, 강제 줄바꿈(\\n) 없이 하나의 완성된 문단 본문으로 완전히 이어서 작성하세요."
                          },
                          date: {
                            type: Type.STRING,
                            description: "기사 작성일 (본문 등에서 확인된 날짜 혹은 빈칸)"
                          },
                          sourceIndex: {
                            type: Type.INTEGER,
                            description: "이 뉴스가 발췌된 출처 소스의 번호 (예: 'Source #1' 이면 1, 'Source #2' 이면 2)"
                          },
                          sourceUrl: {
                            type: Type.STRING,
                            description: "해당 뉴스의 원래 원본 출처 URL."
                          },
                          sourceName: {
                            type: Type.STRING,
                            description: "출처 도메인 또는 미디어 이름 (예: CNBC, AP News 등)"
                          },
                          tags: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: "기사 핵심 내용에 부합하는 카테고리 태그"
                          }
                        },
                        required: ["headline", "summary5W1H", "implications", "date", "sourceIndex", "sourceUrl", "sourceName", "tags"]
                      }
                    }
                  },
                  required: ["articles"]
                }
              }
            });

            const textResponse = geminiRes.text;
            if (!textResponse) throw new Error("Gemini 응답 획득 실패");
            analysisData = JSON.parse(textResponse.trim());
          } catch (localGeminiErr: any) {
            console.error("Local Gemini api failure:", localGeminiErr);
            throw new Error(`상용 분석 서버 오류에 대응해 브라우저 로컬 분석을 시도했으나 아래 에러로 중단되었습니다.\n\n- 원인: ${localGeminiErr.message || 'API Key 무효 또는 요청 거절'}`);
          }
        } else {
          throw new Error(`기사는 수집되었으나, 구글 보안(IAP) 장벽으로 인해 브라우저(Vercel)가 개발용 백엔드 서버와 자바스크립트 직결 통신하는 단계가 차단당했습니다.\n\n🛠️ 해결책:\n1) 우상단의 ⚙️ '설정' 아이콘을 누릅니다.\n2) 본인의 Gemini API Key를 한번 등록해 주시거나 ('로컬 단독 엔진' 가동),\n3) AI Studio에서 'Deploy to Cloud Run' 하시고 발급받은 본인만의 '공개용 분석 서버 주소'를 설정 창에 기입하세요!`);
        }
      }
      const articles = analysisData.articles || [];
      
      const finalResults = articles.map((article: any) => ({
        url: article.sourceUrl,
        originalTitle: article.sourceName,
        headline: article.headline,
        summary5W1H: article.summary5W1H,
        implications: article.implications,
        date: article.date,
        tags: article.tags || []
      }));

      setAnalyses(finalResults);
      setSelectedTag(null);

      // Create a SavedReport record (automatically persists for 7 days maximum)
      const newReport: SavedReport = {
        id: Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        articleCount,
        analyses: finalResults,
        sources: [...sources],
      };

      setSavedReports(prev => {
        const updated = [newReport, ...prev];
        localStorage.setItem('saved_reports', JSON.stringify(updated));
        return updated;
      });
      setSelectedReportId(newReport.id);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Analysis was aborted by the user successfully.');
        return;
      }
      console.error(err);
      setError(err.message || '분석 중 오류가 발생했습니다.');
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
      setCurrentProcessingStep('');
    }
  };

  const loadSavedReport = (report: SavedReport) => {
    setAnalyses(report.analyses);
    setArticleCount(report.articleCount);
    setSelectedReportId(report.id);
    setSelectedTag(null);
  };

  const handleResetToWelcome = () => {
    setAnalyses([]);
    setSelectedReportId(null);
    setSelectedTag(null);
    setError(null);
    setActiveTab('new');
  };

  const handleReuseReport = () => {
    if (analyses.length === 0) return;
    
    // Check if the current selected report has a stored sources array
    const currentReport = savedReports.find(r => r.id === selectedReportId);
    
    if (currentReport && currentReport.sources && currentReport.sources.length > 0) {
      setSources(currentReport.sources);
    } else {
      // Recreate NewsSource structure from analyses
      const recreatedSources: NewsSource[] = analyses.map((analysis, index) => {
        const isUrl = analysis.url && (analysis.url.startsWith('http://') || analysis.url.startsWith('https://'));
        return {
          id: `reuse-${index}-${Math.random().toString(36).substring(2, 6)}`,
          type: isUrl ? 'url' : 'text',
          url: isUrl ? analysis.url : '',
          title: analysis.originalTitle || analysis.headline || '',
          text: isUrl ? '' : `${analysis.headline}\n\n${analysis.summary5W1H}\n\n${analysis.implications}`
        };
      });
      setSources(recreatedSources);
    }
    
    setActiveTab('new');
    setError(null);
    alert('이 리포트의 뉴스 분석 대상을 왼쪽 "새 리포트 구성" 입력창으로 불러왔습니다! 편하게 기사 링크를 추가/수정하거나 텍스트를 고친 후 다시 리포트를 생성해 보실 수 있습니다.');
  };

  const deleteSavedReport = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmDeleteId(id);
  };

  const handleDeleteConfirm = (id: string) => {
    const updated = savedReports.filter(r => r.id !== id);
    setSavedReports(updated);
    localStorage.setItem('saved_reports', JSON.stringify(updated));
    if (selectedReportId === id) {
      setSelectedReportId(null);
    }
    setConfirmDeleteId(null);
  };

  const getRemainingDaysNum = (createdAtStr: string) => {
    const created = new Date(createdAtStr).getTime();
    const now = new Date().getTime();
    const diffTime = 7 * 24 * 60 * 60 * 1000 - (now - created);
    const diffDays = Math.ceil(diffTime / (24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(7, diffDays));
  };

  const getTagStyle = (tag: string) => {
    switch (tag) {
      case 'AI':
        return 'bg-blue-50/80 text-blue-700 border-blue-200/60 hover:bg-blue-100/60';
      case '반도체':
        return 'bg-indigo-50/80 text-indigo-700 border-indigo-200/60 hover:bg-indigo-100/60';
      case '에너지':
        return 'bg-amber-50/80 text-amber-700 border-amber-200/60 hover:bg-amber-100/60';
      case '방산':
        return 'bg-rose-50/80 text-rose-700 border-rose-200/60 hover:bg-rose-100/60';
      case '바이오':
        return 'bg-emerald-50/80 text-emerald-700 border-emerald-200/60 hover:bg-emerald-100/60';
      case '중국':
        return 'bg-red-50/80 text-red-700 border-red-200/60 hover:bg-red-100/60';
      case '거시경제':
        return 'bg-slate-100/90 text-slate-700 border-slate-300/60 hover:bg-slate-200/60';
      default:
        return 'bg-slate-50/80 text-slate-650 border-slate-200/60 hover:bg-slate-150/60';
    }
  };

  const copyMarkdown = (analysis: NewsAnalysis) => {
    const markdown = `## ${analysis.headline}
- URL: ${analysis.url}
- 날짜: ${analysis.date || 'TBD'}

### 6하원칙 요약
${analysis.summary5W1H}

### 핵심 시사점
${analysis.implications}
`;
    navigator.clipboard.writeText(markdown);
    alert('마크다운 형식이 클립보드에 복사되었습니다.');
  };

  const saveAsPDF = async () => {
    const reportElement = reportRef.current;
    if (!reportElement || analyses.length === 0) return;
    
    setIsLoading(true);
    setCurrentProcessingStep('PDF 고화질 리포트 최적화 중...');
    
    try {
      // 스크롤 위치 초기화
      window.scrollTo(0, 0);
      
      // 모든 기사 카드 요소를 찾음
      const articleElements = reportElement.querySelectorAll('[data-article-card]');
      if (articleElements.length === 0) throw new Error('기사 요소를 찾을 수 없습니다.');

      let pdf: jsPDF | null = null;
      
      for (let i = 0; i < articleElements.length; i++) {
        const el = articleElements[i] as HTMLElement;
        setCurrentProcessingStep(`기사 ${i + 1}/${articleElements.length} 페이지 렌더링 중...`);

        // 개별 기사 카드 캡처 (비율 왜곡 방지를 위해 스타일 강제 조정)
        const dataUrl = await htmlToImage.toPng(el, {
          quality: 1,
          pixelRatio: 2, // 안정성을 위해 2로 조정 (3은 너무 무거울 수 있음)
          backgroundColor: '#ffffff',
          style: {
            margin: '0',
            borderRadius: '0',
            boxShadow: 'none',
            transform: 'none'
          }
        });

        const img = new Image();
        img.src = dataUrl;
        await new Promise((resolve) => { img.onload = resolve; });

        // 이미지의 실제 크기에 딱 맞는 PDF 페이지 생성 (비율 100% 유지)
        // 단위는 'px'를 사용하여 픽셀 단위 정밀도 확보
        if (!pdf) {
          pdf = new jsPDF({
            orientation: img.width > img.height ? 'l' : 'p',
            unit: 'px',
            format: [img.width, img.height]
          });
        } else {
          pdf.addPage([img.width, img.height], img.width > img.height ? 'l' : 'p');
        }

        // 여백 없이 꽉 채워서 추가 (이미지 자체가 이미 여백을 포함할 수 있음)
        pdf.addImage(dataUrl, 'PNG', 0, 0, img.width, img.height, undefined, 'FAST');
      }
      
      if (pdf) {
        const fileName = `Tech_Insight_Report_${new Date().toISOString().split('T')[0]}.pdf`;
        pdf.save(fileName);
        alert('비율 왜곡 없는 고화질 PDF 저장이 완료되었습니다.');
      }
    } catch (err: any) {
      console.error('PDF 생성 상세 에러:', err);
      alert(`PDF 생성 중 오류가 발생했습니다: ${err.message || '알 수 없는 오류'}`);
    } finally {
      setIsLoading(false);
      setCurrentProcessingStep('');
    }
  };

  return (
    <div className="flex w-full h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {/* Sidebar: Source Management */}
      <aside 
        style={{ width: `${sidebarWidth}px` }}
        className="bg-white border-r border-slate-200 flex flex-col shadow-sm z-10 overflow-y-auto shrink-0"
      >
        <div className="p-5 border-b border-slate-100 bg-white sticky top-0 z-20">
          <div className="flex items-center justify-between mb-5 select-none">
            <div 
              onClick={handleResetToWelcome}
              className="flex items-center gap-3 cursor-pointer hover:opacity-85 active:scale-98 transition-all"
              title="초기 화면(가이드)으로 돌아가기"
            >
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white font-extrabold text-lg shadow-sm shadow-blue-250">N</div>
              <div className="flex flex-col">
                <h1 className="text-sm font-black tracking-tight text-slate-800 leading-none">NEWS INSIGHT</h1>
                <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">인사이트 분석 리포트</span>
              </div>
            </div>

            {/* 실시간 엔진 가동 배지 (인사이트 분석 리포트 좌측 상단 로고단으로 안전하게 이동) */}
            <div className="flex items-center gap-1.5 bg-green-500/5 px-2.5 py-1 rounded-full border border-green-500/10 shadow-inner shrink-0" title="실시간 분석 엔진 가동 중">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
              </span>
              <span className="text-[8.5px] font-black text-green-600 tracking-tighter leading-none">엔진 가동중</span>
            </div>
          </div>

          {/* Sidebar Tab Menu */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('new')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                activeTab === 'new'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              새 리포트 구성
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${
                activeTab === 'history'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              요약 생성 리포트
              {savedReports.length > 0 && (
                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[9px] rounded-full font-extrabold">
                  {savedReports.length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="p-5 flex-1 flex flex-col min-h-0">
          {activeTab === 'new' ? (
            <div className="space-y-6 flex-1">
              {/* 분야별 미디어 간편 체크 연계 전용 패널 */}
              <div className="bg-slate-100/60 p-4 rounded-2xl border border-slate-200/50">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10.5px] font-black text-slate-650 uppercase tracking-wider flex items-center gap-1.5 leading-none">
                    <Sparkles size={11} className="text-blue-500 shrink-0" />
                    추천 미디어 간편 구독 (분야별)
                  </label>
                  <span className="text-[8.5px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-md font-extrabold tracking-tighter">
                    오토 스캔
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mb-3.5 leading-normal">
                  원하는 기사 매체를 체크하시면, 백엔드가 해당 <strong>미디어 홈에서 실시간 최신 핫포스트를 자동으로 탐색</strong>하여 소스 모음집에 추가합니다.
                </p>

                <div className="space-y-3">
                  {(['기술', '경제', '에너지/산업'] as const).map(cat => {
                    const matchedList = PRESET_CHANNELS.filter(p => p.category === cat);
                    return (
                      <div key={cat} className="space-y-1">
                        <span className="text-[9.5px] font-black text-blue-600 tracking-wider block pl-0.5">
                          • {cat}
                        </span>
                        <div className="grid grid-cols-1 gap-1.5">
                          {matchedList.map(preset => {
                            const isPresetAdded = sources.some(s => s.url.trim().toLowerCase() === preset.url.toLowerCase());
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => togglePreset(preset)}
                                className={`w-full p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-all outline-none cursor-pointer ${
                                  isPresetAdded
                                    ? 'bg-blue-50/40 border-blue-200/80 shadow-xs'
                                    : 'bg-white border-slate-150 hover:border-slate-250'
                                }`}
                              >
                                {/* custom checkbox icon */}
                                <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                                  isPresetAdded 
                                    ? 'bg-blue-600 border-blue-600 text-white' 
                                    : 'bg-white border-slate-250'
                                }`}>
                                  {isPresetAdded && <CheckCircle2 size={11} className="stroke-[3.5px]" />}
                                </div>
                                <div className="flex-1 min-w-0 select-none">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-xs font-bold text-slate-800 leading-tight block truncate">
                                      {preset.name}
                                    </span>
                                    <span className="text-[8px] text-slate-400 font-mono">
                                      {preset.url.replace('https://', '').replace('www.', '').split('/')[0]}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-semibold leading-tight block truncate mt-0.5">
                                    {preset.desc}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">분석 소스 관리 (Sources)</label>
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {sources.map((source, index) => {
                      const matchedPreset = PRESET_CHANNELS.find(p => p.url.trim().toLowerCase() === source.url.trim().toLowerCase());
                      const isPreset = !!matchedPreset;

                      return (
                        <motion.div 
                          key={source.id || index}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={`group flex flex-col gap-2 p-3 bg-white border rounded-xl hover:border-blue-200 transition-all shadow-sm ${
                            isPreset ? 'border-blue-150 bg-blue-50/5' : 'border-slate-150'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100/55">
                            {/* Inner Tabs for selection */}
                            <div className="flex bg-slate-100 p-0.5 rounded-lg text-[9px] font-bold">
                              <button
                                type="button"
                                disabled={isPreset}
                                onClick={() => updateSource(index, { type: 'url' })}
                                className={`px-2 py-0.5 rounded transition-all ${
                                  source.type === 'url'
                                    ? 'bg-white text-blue-600 shadow-xs'
                                    : 'text-slate-400 hover:text-slate-600'
                                } ${isPreset ? 'opacity-80 cursor-not-allowed' : ''}`}
                              >
                                URL 수집
                              </button>
                              <button
                                type="button"
                                disabled={isPreset}
                                onClick={() => updateSource(index, { type: 'text' })}
                                className={`px-2 py-0.5 rounded transition-all ${
                                  source.type === 'text'
                                    ? 'bg-white text-blue-600 shadow-xs'
                                    : 'text-slate-400 hover:text-slate-600'
                                } ${isPreset ? 'opacity-80 cursor-not-allowed' : ''}`}
                              >
                                직접 입력
                              </button>
                            </div>
                            
                            {sources.length > 1 && (
                              <button 
                                type="button"
                                onClick={() => removeUrlField(index)}
                                className="text-slate-300 hover:text-red-500 transition-colors"
                                title="삭제"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>

                          {source.type === 'url' ? (
                            <div className="space-y-1 w-full">
                              {isPreset && (
                                <div className="px-2 py-1 bg-blue-500/5 border border-blue-200/60 rounded-lg flex items-center justify-between gap-1.5 select-none shrink-0 mb-1">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <Newspaper size={11} className="text-blue-500 shrink-0" />
                                    <span className="text-[9px] font-black text-blue-600 tracking-tight leading-none bg-blue-100 px-1 py-0.5 rounded">
                                      {matchedPreset.name}
                                    </span>
                                    <span className="text-[9.5px] text-slate-500 font-bold truncate">
                                      자동 수집 준비
                                    </span>
                                  </div>
                                  <span className="text-[8.5px] px-1 py-0.5 bg-green-50 text-green-600 rounded font-black tracking-tight shrink-0 animate-pulse">
                                    AUTO SCRAP
                                  </span>
                                </div>
                              )}
                              <input
                                type="url"
                                value={source.url}
                                readOnly={isPreset}
                                onChange={(e) => !isPreset && updateSource(index, { url: e.target.value })}
                                placeholder="분석할 기사 URL (https://...)"
                                className={`text-xs font-semibold bg-transparent border-none p-0 focus:ring-0 focus:outline-none w-full ${
                                  isPreset ? 'text-slate-400 cursor-not-allowed select-none' : 'text-slate-800'
                                }`}
                              />
                            </div>
                          ) : (
                          <div className="space-y-1 pt-0.5">
                            <input
                              type="text"
                              value={source.title}
                              onChange={(e) => updateSource(index, { title: e.target.value })}
                              placeholder="기사 제목 입력 (선택)"
                              className="text-xs font-bold bg-transparent border-none p-0 text-slate-800 placeholder:text-slate-300 focus:ring-0 focus:outline-none w-full"
                            />
                            <textarea
                              value={source.text}
                              onChange={(e) => updateSource(index, { text: e.target.value })}
                              rows={3}
                              placeholder="뉴스 본문을 기여용으로 복사 후 붙여넣어 주세요..."
                              className="text-[11px] font-medium bg-transparent border-none p-0 text-slate-600 placeholder:text-slate-300 focus:ring-0 focus:outline-none w-full resize-none scrollbar-none"
                            />
                          </div>
                        )}
                      </motion.div>
                    );
                    })}
                  </AnimatePresence>
                  
                  <button
                    type="button"
                    onClick={addUrlField}
                    className="w-full py-3 flex items-center justify-center gap-2 border border-dashed border-slate-200 rounded-xl text-slate-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50/30 transition-all text-xs font-bold uppercase tracking-wider"
                  >
                    <Plus size={14} />
                    소식 추가
                  </button>

                  {isLoading && currentProcessingStep && (
                    <div className="p-3.5 bg-blue-500/5 border border-blue-200/50 rounded-xl select-none animate-fade-in mt-1.5 animate-pulse">
                      <p className="text-[10px] font-black text-blue-600 mb-1.5 flex items-center justify-between">
                        <span>{currentProcessingStep}</span>
                        <button
                          type="button"
                          onClick={cancelAnalysis}
                          className="text-[8.5px] font-black text-red-650 hover:text-red-750 bg-red-100 hover:bg-red-200 px-2 py-0.5 rounded tracking-wider shrink-0 flex items-center gap-1 cursor-pointer transition-colors"
                          title="분석 생성 취소"
                        >
                          <Square size={8} fill="currentColor" />
                          <span>중단</span>
                        </button>
                      </p>
                      <div className="w-full h-1 bg-slate-200/60 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-blue-500"
                          animate={{ x: ["-100%", "100%"] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Custom Dynamic Article Count Selector */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">분석할 핵심 기사 수 설정</label>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-xl shadow-inner">
                    <button
                      type="button"
                      onClick={() => setArticleCount(prev => Math.max(1, prev - 1))}
                      disabled={articleCount <= 1 || isLoading}
                      className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-center justify-center font-black disabled:opacity-40 shadow-sm"
                    >
                      -
                    </button>
                    <div className="flex flex-col items-center">
                      <span className="text-sm font-extrabold text-slate-800">{articleCount}개 기사</span>
                      <span className="text-[8px] font-bold text-blue-500 uppercase tracking-wider">최적화 선별</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setArticleCount(prev => Math.min(20, prev + 1))}
                      disabled={articleCount >= 20 || isLoading}
                      className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-center justify-center font-black disabled:opacity-40 shadow-sm"
                    >
                      +
                    </button>
                  </div>
                  
                  {/* Quick Selection Presets */}
                  <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
                    {[3, 5, 7, 10].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setArticleCount(num)}
                        disabled={isLoading}
                        className={`py-1 text-xs font-bold rounded-md transition-all ${
                          articleCount === num
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                        }`}
                      >
                        {num}개
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {isLoading ? (
                <button
                  type="button"
                  onClick={cancelAnalysis}
                  className="w-full py-4 bg-red-50 hover:bg-red-100 border border-red-200 text-red-650 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs animate-pulse"
                  title="분석 생성 즉시 중단"
                >
                  <Square size={16} fill="currentColor" />
                  <span>생성 중단 (중지/취소)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={analyzeNews}
                  className="w-full py-4 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send size={18} />
                  <span>인사이트 리포트 생성</span>
                </button>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-[11px] text-red-600 font-medium flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 flex-1 flex flex-col min-h-0">
              <div className="p-3 bg-blue-50/50 border border-blue-100/40 rounded-xl">
                <p className="text-[10px] text-blue-700 leading-relaxed font-semibold flex items-start gap-1.5">
                  <Clock size={12} className="shrink-0 mt-0.5" />
                  <span>생성된 기상 리포트는 브라우저 안전 보관함에 보관되며, <strong>생성일로부터 7일 동안</strong> 소급 보존됩니다.</span>
                </p>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pb-4">
                {savedReports.length === 0 ? (
                  <div className="py-12 text-center">
                    <Calendar size={28} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-xs font-bold text-slate-400">보관된 요약 리포트가 없습니다.</p>
                    <p className="text-[10px] text-slate-300 mt-1">인사이트 리포트를 새로 생성하면 여기에 자동 저장됩니다.</p>
                  </div>
                ) : (
                  savedReports.map((report, idx) => {
                    const remainingDays = getRemainingDaysNum(report.createdAt);
                    const isSelected = selectedReportId === report.id;
                    const dateObj = new Date(report.createdAt);
                    const formattedDate = dateObj.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' + dateObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
                    
                    return (
                      <div
                        key={report.id}
                        onClick={() => {
                          if (confirmDeleteId === report.id) return;
                          loadSavedReport(report);
                        }}
                        className={`group p-3 border rounded-xl cursor-pointer hover:border-blue-300 hover:shadow-xs transition-all relative flex flex-col gap-2 ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50/15 shadow-sm'
                            : 'border-slate-100 bg-white'
                        }`}
                      >
                        {/* Inline Delete Confirmation Overlay */}
                        <AnimatePresence>
                          {confirmDeleteId === report.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              className="absolute inset-0 bg-rose-50/95 backdrop-blur-xs rounded-xl flex flex-col justify-center items-center p-3 gap-2 z-20 border border-rose-200 cursor-default"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="text-[11px] font-bold text-rose-700 flex items-center gap-1">
                                <AlertCircle size={12} className="shrink-0" />
                                리포트를 삭제할까요?
                              </p>
                              <div className="flex items-center gap-1.5 justify-center w-full">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteConfirm(report.id);
                                  }}
                                  className="px-2.5 py-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white rounded-md text-[10px] font-black transition-all shadow-sm"
                                >
                                  삭제
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteId(null);
                                  }}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[10px] font-black transition-all border border-slate-200"
                                >
                                  취소
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                            <Clock size={10} />
                            {formattedDate}
                          </span>
                          
                          <div className="flex items-center gap-1">
                            <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-black tracking-tight ${
                              remainingDays <= 2 
                                ? 'bg-red-50 text-red-600 border border-red-100'
                                : remainingDays <= 4
                                ? 'bg-amber-50 text-amber-600 border border-amber-100'
                                : 'bg-green-50 text-green-600 border border-green-100'
                            }`}>
                              {remainingDays}일 남음
                            </span>
                            <button
                              type="button"
                              onClick={(e) => deleteSavedReport(e, report.id)}
                              className="p-1 text-slate-300 hover:text-red-500 rounded hover:bg-slate-50 transition-colors"
                              title="삭제"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-0.5">
                          <p className={`text-xs font-bold text-slate-800 line-clamp-1 ${isSelected ? 'text-blue-600' : ''}`}>
                            {report.analyses[0]?.headline || '요약 리포트'}
                          </p>
                          <p className="text-[10px] text-slate-400 font-medium">
                            {report.analyses.length > 1 ? `외 ${report.analyses.length - 1}개 핵심 뉴스 수록` : '단일 기사 정밀 요약'}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

      </aside>

      {/* Resizable Divider Handle */}
      <div 
        onMouseDown={startResizing}
        className="w-1.5 hover:w-2 active:w-2 bg-slate-200/80 hover:bg-blue-300 active:bg-blue-400 cursor-col-resize h-screen select-none shrink-0 z-20 flex items-center justify-center transition-all duration-150 group"
        title="마우스로 드래그하여 가로 넓이 리사이징"
      >
        <div className="h-10 w-[2px] bg-slate-400 group-hover:bg-blue-500 rounded opacity-45 group-hover:opacity-100 transition-colors"></div>
      </div>

      {/* Main Content: Analysis Report */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header Bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            <div className="h-4 w-[1px] bg-slate-200"></div>
            <span className="px-2.5 py-1 bg-blue-50/55 border border-blue-100 rounded-md text-[9px] text-blue-600 font-black tracking-wider uppercase">
              AI INSIGHTS
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:border-slate-350 text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-50/50 rounded-lg text-xs font-bold transition-colors shadow-xs"
              title="API 서버 연동 및 브라우저 자체 구동용 개인키 설정"
            >
              <Settings size={13} className="hover:rotate-45 transition-transform duration-300" />
              <span className="hidden sm:inline">Settings</span>
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab(activeTab === 'history' ? 'new' : 'history')}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-bold transition-colors uppercase tracking-widest border rounded-lg ${
                activeTab === 'history' 
                  ? 'bg-blue-50 border-blue-200 text-blue-600' 
                  : 'text-slate-400 hover:text-slate-600 border-transparent hover:border-slate-100'
              }`}
            >
              History
            </button>
            {analyses.length > 0 && (
              <button 
                type="button"
                className="px-4 py-2 border border-slate-200 hover:border-blue-250 text-slate-700 hover:text-blue-600 bg-white hover:bg-blue-50/15 rounded-lg text-xs font-bold shadow-xs transition-all flex items-center gap-1.5"
                onClick={handleReuseReport}
                disabled={isLoading}
                title="이 리포트의 기사나 텍스트 소스를 '새 리포트 구성' 탭에 불러와 즉시 추가 편집 및 재분석을 진행합니다."
              >
                <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
                소스 편집 및 재활용
              </button>
            )}
            <button 
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all flex items-center gap-2"
              onClick={saveAsPDF}
              disabled={isLoading || analyses.length === 0}
            >
              <Download size={14} />
              PDF 저장
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-50/50 print:bg-white print:p-0">
          <div ref={reportRef} id="analysis-report" className="max-w-4xl mx-auto space-y-8 print:max-w-none print:m-0">
            <AnimatePresence mode="wait">
              {analyses.length > 0 ? (
                <>
                  {/* Dynamic Category Filtering Chips (Hide when printing) */}
                  <div className="flex flex-wrap items-center gap-1.5 pb-4 mb-3 border-b border-slate-200/45 print:hidden justify-start scrollbar-none overflow-x-auto select-none">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-2">
                      토픽 필터
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedTag(null)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        selectedTag === null
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'bg-white text-slate-500 hover:text-slate-800 border border-slate-200/50 hover:border-slate-350 shadow-xs'
                      }`}
                    >
                      전체 ({analyses.length})
                    </button>
                    {['AI', '반도체', '에너지', '방산', '바이오', '중국', '거시경제'].map(tag => {
                      const count = analyses.filter(a => a.tags?.includes(tag)).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setSelectedTag(tag)}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 border ${
                            selectedTag === tag
                              ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                              : 'bg-white text-slate-500 hover:text-slate-800 border-slate-200/65 hover:bg-slate-50 shadow-xs'
                          }`}
                        >
                          <span>#{tag}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 font-bold rounded ${selectedTag === tag ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {(selectedTag 
                    ? analyses.filter(analysis => analysis.tags?.includes(selectedTag))
                    : analyses
                  ).map((analysis, index) => (
                    <motion.div 
                      key={index}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      data-article-card
                      className="bg-[#FCFBF8] rounded-2xl shadow-lg border border-slate-200 overflow-hidden text-slate-900 shadow-slate-200/40 font-serif"
                    >
                      {/* Classic Editorial Page Header Bar */}
                      <div className="px-6 py-8 sm:p-12">
                        <div className="border-b-[4px] border-t border-slate-900 border-double py-2 mb-6 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-800 font-mono">
                          <span>AIS INTELLECT DISPATCH</span>
                          <span className="italic font-serif normal-case hidden sm:inline text-slate-500">Daily Economic & Tech Insights</span>
                          <span>NO. {String(index + 1).padStart(2, '0')}</span>
                        </div>
                        
                        {/* Tags list inside article card */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-3.5 select-none font-sans">
                          {analysis.tags && analysis.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {analysis.tags.map(tag => (
                                <span
                                  key={tag}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTag(tag);
                                  }}
                                  className="px-2 py-0.5 border border-slate-900/10 text-[9px] font-black tracking-tight rounded bg-slate-900/5 text-slate-650 transition-colors uppercase cursor-pointer hover:bg-slate-900/15"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-950 leading-[1.15] mb-5 tracking-tight font-serif text-justify">
                          {analysis.headline}
                        </h2>

                        {/* Traditional Bylines */}
                        <div className="flex border-y border-sans border-slate-300 py-2.5 mb-8 items-center justify-between text-[11px] text-slate-500 font-medium font-sans">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="w-1.5 h-1.5 bg-red-650 rounded-full animate-pulse"></span>
                            <span>발행 기한:</span>
                            <span className="text-slate-900 font-black">{analysis.date || '날짜 미상'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 truncate max-w-[65%]">
                            <span>원문 타이틀:</span>
                            <span className="text-slate-900 font-black truncate" title={analysis.originalTitle || ""}>
                              {analysis.originalTitle}
                            </span>
                          </div>
                        </div>

                         {/* 6W1H Summary */}
                         <div className="mb-10 text-justify">
                           <h3 className="text-base sm:text-lg font-bold text-slate-950 border-y border-slate-900 py-2 mb-5 text-center font-sans">
                             기사 요약
                           </h3>
                           <div className="bg-[#FAF9F5] border border-[#EBE6DC] rounded-xl p-6 sm:p-8 text-slate-800 leading-relaxed text-[15px] shadow-2xs relative group">
                             <div className="absolute top-3 right-3 p-3 opacity-[0.03] group-hover:opacity-10 transition-opacity">
                               <Newspaper size={64} />
                             </div>
                             <p className="font-sans first-letter:text-5xl first-letter:font-black first-letter:mr-2.5 first-letter:float-left first-letter:mt-1 first-letter:text-slate-950 whitespace-pre-wrap leading-relaxed text-justify">
                               {analysis.summary5W1H?.replace(/\\n/g, " ").replace(/\n/g, " ")}
                             </p>
                           </div>
                         </div>
 
                         {/* Core Implications */}
                         <div className="mb-6">
                           <h3 className="text-base sm:text-lg font-bold text-slate-950 border-y border-slate-900 py-2 mb-5 text-center font-sans">
                             핵심 시사점
                           </h3>
                           <div className="bg-[#FAF9F5] border border-[#EBE6DC] rounded-xl p-6 sm:p-8 text-slate-800 leading-relaxed text-[15px] shadow-2xs">
                             <p className="font-sans whitespace-pre-wrap leading-relaxed text-justify">
                               {analysis.implications?.replace(/\\n/g, " ").replace(/\n/g, " ").replace(/^[-*•■□\s\d.]+\s*/mg, "")}
                             </p>
                           </div>
                         </div>
 
                         {/* Footer Actions */}
                         <div className="border-t border-slate-900/10 py-5 mt-10 flex flex-wrap items-center justify-between gap-4 font-sans">
                           <div>
                             <a 
                               href={analysis.sourceUrl || analysis.url}
                               target="_blank"
                               rel="noopener noreferrer"
                               className="inline-flex items-center gap-1.5 text-[10.5px] font-black text-slate-500 hover:text-slate-900 transition-all uppercase tracking-wider"
                             >
                               <ExternalLink size={12} />
                               기사 원문 확인 (Source)
                             </a>
                           </div>
                           <button
                             type="button"
                             onClick={() => copyMarkdown(analysis)}
                             className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                           >
                             <Copy size={12} />
                             마크다운 복사
                           </button>
                         </div>
                      </div>
                    </motion.div>
                  ))}
                </>
              ) : (
                <div className="py-10 flex flex-col items-center justify-center text-center px-6 sm:px-10">
                  <div className="w-20 h-20 bg-blue-50 rounded-[2rem] shadow-md border border-blue-100 flex items-center justify-center text-blue-600 mb-8 select-none">
                    <Newspaper size={38} />
                  </div>
                  <h3 className="text-2xl font-extrabold text-slate-800 mb-3 tracking-tight">글로벌 비즈니스 뉴스 인사이트</h3>
                  <p className="text-sm text-slate-500 max-w-xl leading-relaxed font-medium mb-10">
                    수집된 뉴스 링크들을 심층 분석하여 비즈니스 및 기술 실무에 가장 핵심적인 가치를 선별하고, <br />
                    중복 없이 구조화된 5W1H 정밀 요약과 실체적인 시사점을 도출합니다. <br />
                    좌측 사이드바에 뉴스 링크를 넣고 <span className="font-semibold text-blue-600">‘인사이트 리포트 생성’</span> 버튼을 누르세요.
                  </p>
                  
                  {/* Specialized Selection Standards Panel */}
                  <div className="w-full max-w-3xl bg-white rounded-2xl border border-slate-200/50 p-6 text-left shadow-sm">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                      핵심 기사 중요 선별 가이드
                    </h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                      {[
                        { title: "규제 및 가이드라인", desc: "법규·규정·표준 변경" },
                        { title: "랜드마크 개발 소식", desc: "글로벌 프로젝트·초고층" },
                        { title: "하이테크 트렌드", desc: "AI·로봇·데이터센터" },
                        { title: "친환경 및 에너지", desc: "신공법·SMR·수소·기술" },
                        { title: "거시적 공급망 트렌드", desc: "원자재·글로벌정세·환경규제" }
                      ].map((item, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                          <p className="text-xs font-bold text-slate-800 leading-tight mb-1">{idx + 1}. {item.title}</p>
                          <p className="text-[10px] text-slate-400 font-medium leading-tight">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Floating status */}
        <div className="absolute bottom-10 right-10 pointer-events-none floating-status">
          <AnimatePresence>
            {isLoading && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white/90 backdrop-blur-md border border-slate-200 p-4 px-6 rounded-2xl shadow-2xl flex items-center gap-4"
              >
                <div className="relative">
                  <div className="w-10 h-10 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin"></div>
                  <CheckCircle2 size={16} className="absolute inset-0 m-auto text-blue-600/30" />
                </div>
                <div>
                  <p className="text-xs font-black text-slate-800 uppercase tracking-widest mb-0.5">Analysing...</p>
                  <p className="text-[10px] font-bold text-slate-400 tabular-nums">{currentProcessingStep}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Settings Modal Setup */}
        <AnimatePresence>
          {isSettingsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Back backdrop border click closes */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsSettingsOpen(false)}
                className="absolute inset-0 bg-slate-900/65 backdrop-blur-xs"
              />
              
              {/* Modal Box wrapper layout */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 overflow-hidden z-10 text-left"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-5">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                      <Settings size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-800 tracking-wide uppercase">API 및 연동 설정</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">CORS 우회 & 브라우저 독립 구동</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="p-1.5 hover:bg-slate-150 text-slate-400 hover:text-slate-600 transition-colors rounded-lg"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="space-y-4 text-xs font-semibold text-slate-700">
                  {/* API Server Section */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      1. AI 분석용 실서버 주소 (API Server URL)
                    </label>
                    <input
                      type="url"
                      placeholder="https://your-app-xxxx.run.app"
                      value={apiServerOverride}
                      onChange={(e) => setApiServerOverride(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 font-mono text-[11px]"
                    />
                    <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed font-bold">
                      💡 <span className="text-slate-600">Vercel 호스팅 유의사항:</span> 외부 배포 환경에서 체크박스 수집 시 발생하는 <span className="text-red-500 font-black">Failed to fetch</span> 등의 오류는 구글 IAP 임시인증 차단 때문입니다. AI Studio 상단 <span className="font-bold text-slate-600">‘Deploy to Cloud Run’</span>으로 정식 배포받은 상용 인프라 주소를 여기에 매핑해 주시면 즉각 전면 정상화됩니다.
                    </p>
                  </div>

                  {/* Gemini API Key Section */}
                  <div className="border-t border-slate-100 pt-4">
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      2. 브라우저 자가 구동용 Gemini API Key (선택)
                    </label>
                    <input
                      type="password"
                      placeholder="AIZAsy..."
                      value={localGeminiKey}
                      onChange={(e) => setLocalGeminiKey(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 font-mono text-[11px]"
                    />
                    <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed font-bold">
                      💡 백엔드 서버 없이 Vercel의 정적 웹페이지 페이지만으로 전수 기사 수집 및 Gemini 분석을 수행하고 싶다면 본인의 개인 Gemini 키를 등록하세요. 기입 시 로컬 저장소 브라우저 안전 영역(<span className="font-mono text-[9px] text-slate-600">localStorage</span>)에 보관되며 브라우저가 다이렉트로 분석을 완벽하게 완수합니다.
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem('api_server_override');
                      localStorage.removeItem('local_gemini_key');
                      setApiServerOverride('');
                      setLocalGeminiKey('');
                      alert('연동 설정이 완전히 공장초기화되었습니다.');
                      setIsSettingsOpen(false);
                    }}
                    className="px-3.5 py-1.5 border border-red-100 hover:bg-red-50 text-red-500 text-[11px] font-bold rounded-lg transition-colors"
                  >
                    초기화
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem('api_server_override', apiServerOverride.trim());
                      localStorage.setItem('local_gemini_key', localGeminiKey.trim());
                      alert('커넥터 연동 설정이 성공적으로 안전 저장되었습니다.');
                      setIsSettingsOpen(false);
                    }}
                    className="px-4 py-1.5 bg-blue-600 text-white hover:bg-blue-700 text-[11px] font-black rounded-lg transition-colors shadow-md shadow-blue-100"
                  >
                    설정 안전 저장
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
