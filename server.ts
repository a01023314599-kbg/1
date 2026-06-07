import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";

dotenv.config();

// Initialize Gemini safely on the server using lazy loading to prevent start-up crashes
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Route: Fetch News Content
  app.post("/api/fetch-news", async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const cleanUrl = url.trim().toLowerCase();

    // Define smart handlers for target preset domains
    const PRESET_MAPPING: { 
      [key: string]: { 
        rss: string, 
        selector: string, 
        fallbackTitle: string,
        domain: string
      } 
    } = {
      "techcrunch.com": {
        rss: "https://techcrunch.com/feed/",
        selector: "a[href*='/2026/'], a[href*='/2025/'], a[href*='/25/']",
        fallbackTitle: "TechCrunch 최신 기사 수집",
        domain: "TechCrunch"
      },
      "tomshardware.com": {
        rss: "https://www.tomshardware.com/feeds/all",
        selector: "a[href*='/news/'], a[href*='/reviews/']",
        fallbackTitle: "Tom's Hardware 최신 기사 수집",
        domain: "Tom's Hardware"
      },
      "apnews.com": {
        rss: "https://news.google.com/rss/search?q=site:apnews.com&hl=ko&gl=KR&ceid=KR:ko", // Utilize Google News RSS targeting AP News for reliability
        selector: "a[href*='/article/']",
        fallbackTitle: "AP News 최신 기사 수집",
        domain: "AP News"
      },
      "cnbc.com": {
        rss: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
        selector: "a[href*='/2026/'], a[href*='/2025/'], a[href*='cnbc.com/20']",
        fallbackTitle: "CNBC 최신 기사 수집",
        domain: "CNBC"
      },
      "datacenterdynamics.com": {
        rss: "https://www.datacenterdynamics.com/en/feed/",
        selector: "a[href*='/news/']",
        fallbackTitle: "Data Center Dynamics 최신 기사 수집",
        domain: "Data Center Dynamics"
      }
    };

    // Check if the requested URL is just a homepage/root or domain level request for presets
    let matchedPreset = null;
    for (const key of Object.keys(PRESET_MAPPING)) {
      if (cleanUrl.includes(key)) {
        // If it's a domain homepage or general routing, trigger smart deep-fetch
        // Root includes paths consisting only of trailing slash, or simple subdirectories like /en, etc.
        const pathPart = cleanUrl.replace(/https?:\/\/(www\.)?/, "").replace(key, "").replace(/^\//, "");
        if (pathPart.length <= 4) { // / or empty or /en/ etc.
          matchedPreset = PRESET_MAPPING[key];
          break;
        }
      }
    }

    if (matchedPreset) {
      console.log(`[Smart Scraping] Detected preset domain homepage: ${cleanUrl}. Redirecting to RSS/Deep fetch: ${matchedPreset.rss}`);
      try {
        // 1. Try RSS feed parsing using cheerio
        const rssResponse = await axios.get(matchedPreset.rss, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/xml,text/xml,application/xhtml+xml"
          },
          timeout: 8000
        });

        const $rss = cheerio.load(rssResponse.data, { xmlMode: true });
        const items = $rss("item, entry");

        if (items.length > 0) {
          // Select the first/latest item
          const firstItem = items.first();
          let targetArticleUrl = firstItem.find("link").text().trim() || firstItem.find("link").attr("href") || "";
          
          // Google search RSS holds wrapped link, we unpack it if needed
          if (targetArticleUrl.includes("news.google.com") && targetArticleUrl.includes("&url=")) {
            const urlMatch = targetArticleUrl.match(/url=([^&]+)/);
            if (urlMatch) {
              targetArticleUrl = decodeURIComponent(urlMatch[1]);
            }
          }

          let title = firstItem.find("title").text().trim() || matchedPreset.fallbackTitle;
          let pubDate = firstItem.find("pubDate, published, updated").text().trim() || "";
          let description = firstItem.find("description, summary").text().replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

          // Try to fetch individual article page for fully detailed body description
          if (targetArticleUrl && targetArticleUrl.startsWith("http")) {
            console.log(`[Smart Scraping] Fetching real article details from source: ${targetArticleUrl}`);
            try {
              const fullArticleResponse = await axios.get(targetArticleUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8"
                },
                timeout: 8000
              });
              const $article = cheerio.load(fullArticleResponse.data);
              
              // Extract best main article text body
              $article("script, style, nav, footer, header, iframe, noscript, comment").remove();
              
              // Standard selectors for main body
              let articleBody = $article("article, .article-content, .article-body, .entry-content, .story-body, [class*='bodyText'], [class*='article-text']").text();
              if (!articleBody || articleBody.trim().length < 200) {
                articleBody = $article("body").text();
              }
              
              const bodyText = articleBody.replace(/\s+/g, " ").trim().substring(0, 10000);
              
              return res.json({
                url: targetArticleUrl,
                title: $article("title").text().trim() || title,
                metaDescription: description,
                bodyText: bodyText.length > 300 ? bodyText : (description + " " + bodyText),
                sourceName: matchedPreset.domain
              });
            } catch (singleErr: any) {
              console.warn(`[Smart Scraping] Detail fetch failed, falling back to RSS summaries:`, singleErr.message);
              // Fallback to what we have in RSS
              return res.json({
                url: targetArticleUrl || url,
                title,
                metaDescription: `지정 매체 RSS 요약 (발행일: ${pubDate})`,
                bodyText: `${title}\n\n${description}\n\n${pubDate}\n\n[출처: ${matchedPreset.domain}]`,
                sourceName: matchedPreset.domain
              });
            }
          }
        }
      } catch (rssErr: any) {
        console.warn(`[Smart Scraping] RSS fetch failed for ${cleanUrl}, falling back to homepage link scanning:`, rssErr.message);
      }
    }

    // Default or Fallback: Scan given URL
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);
      
      // If we matched domain, but RSS failed, let's look for article links in the homepage
      if (matchedPreset) {
        const foundLinks: string[] = [];
        $(matchedPreset.selector).each((_, el) => {
          let href = $(el).attr("href");
          if (href) {
            if (href.startsWith("/")) {
              const urlObj = new URL(url);
              href = `${urlObj.origin}${href}`;
            }
            if (href.startsWith("http") && !foundLinks.includes(href)) {
              foundLinks.push(href);
            }
          }
        });

        if (foundLinks.length > 0) {
          const topArticleUrl = foundLinks[0];
          console.log(`[Smart Scraping] Found top link on homepage via selectors: ${topArticleUrl}. Scraping it instead.`);
          try {
            const articleResponse = await axios.get(topArticleUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
              },
              timeout: 10000
            });
            const $art = cheerio.load(articleResponse.data);
            const title = $art("title").text().trim() || "제목 미상";
            const metaDescription = $art('meta[name="description"]').attr("content") || "";
            $art("script, style, nav, footer, header, iframe, noscript").remove();
            let bodyText = $art("article, .article-content, .article-body, .entry-content, .story-body").text().replace(/\s+/g, " ").trim();
            if (!bodyText || bodyText.length < 200) {
              bodyText = $art("body").text().replace(/\s+/g, " ").trim();
            }
            return res.json({
              url: topArticleUrl,
              title,
              metaDescription,
              bodyText: bodyText.substring(0, 10000),
              sourceName: matchedPreset.domain
            });
          } catch (selErr: any) {
            console.error("[Smart Scraping] Selector fallback fetch failed:", selErr.message);
          }
        }
      }

      // Basic extraction for random URLs
      const title = $("title").text().trim() || "제목 미상";
      const metaDescription = $('meta[name="description"]').attr("content") || "";
      
      // Extract main content
      $("script, style, nav, footer, header, iframe, noscript").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").trim().substring(0, 10000); // Limit to 10000 chars for context

      res.json({
        url,
        title,
        metaDescription,
        bodyText,
      });
    } catch (error: any) {
      console.error("Error fetching URL:", error.message);
      const status = error.response?.status || 500;
      res.status(status).json({ 
        error: "Failed to fetch URL content", 
        code: status,
        details: error.message 
      });
    }
  });

  // API Route: Analyze multiple news sites into specialized insights
  app.post("/api/analyze-news", async (req, res) => {
    const { allSourcesData, articleCount } = req.body;
    
    if (!allSourcesData || !Array.isArray(allSourcesData) || allSourcesData.length === 0) {
      return res.status(400).json({ error: "No news source data provided for analysis." });
    }

    const count = typeof articleCount === "number" ? Math.max(1, Math.min(articleCount, 20)) : 5;
    const today = new Date().toISOString().split('T')[0];

    const sourceContext = allSourcesData.map((s, idx) => `
Source #${idx + 1}
URL: ${s.url}
Title: ${s.title}
Text: ${s.bodyText}
---`).join('\n');

    const prompt = `
당신은 전 세계의 뉴스를 모니터링하고 가치가 높은 비즈니스/기술 인사이트만 분석 및 선별하는 시니어 뉴스 인사이트 디렉터입니다.
특히 **건설, 설계, 기계설비 및 하이테크 분야**의 실무와 혁신 전반에 기여할 수 있는 핵심 뉴스를 엄선해야 합니다.

제공된 다음 소스들로부터 오늘(${today}) 기준의 가장 가치 있는 정보들을 종합적으로 분석하여 최우선순위가 높고 신뢰할 만한 상위 ${count}개의 핵심 뉴스를 선별해 주십시오.

---
**[기사 선별 및 필터링 기준 (우선순위 순)]**
이 기준들을 종합적으로 고려하여 실무 및 비즈니스 혁신 측면에서 우선순위/신뢰도가 가장 높은 핵심 기사 ${count}개를 선정해야 하며, 주제 및 내용의 중복이 최소화되도록 해야 합니다.

1. **시공/설계 직접 영향 소식**: 기사 / 산업 분야 중 시공 및 엔지니어링 설계 조건에 직접적인 영향을 주는 변경 소식 (법규, 규정, 표준, 정책, 자재 가격 변동, 장비 수급 등)
2. **초집중 랜드마크 소식**: 주요 글로벌 프로젝트, 국내외 세간이 주목할 만한 대형 건축물, 특수 건설 사업, 초고층/대형 랜드마크 빌딩 설계 및 구축 관련 소식
3. **하이테크 및 미래 기술**: 세계 경제적으로 영향력이 큰 하이테크 소식 (AI, 로보틱스, 데이터센터 설계/구축/냉각 기술, 우주항공, 바이오 등 트렌디한 기술적 키워드)
4. **엔지니어링/기계설비 신기술 소식**: 설비 엔지니어링 및 환경 에너지 효율에 밀접한 신기술 (신재생에너지-태양광, 풍력, 수열, 지열 등; SMR(소형 모듈 원자로), 수소 에너지, 연료전지, 탄소포집 및 친환경 설비/신공법 등)
5. **거시적 글로벌 트렌드**: 세계 트렌드 및 거시적 인사이트 등 산업 전반에 영향을 줄 수 있는 소식 (정치적 변화, 글로벌 경제, 전쟁, 핵심 자원 공급망, 환경 규제 등)

*제외 사항: 단순 가십, 게임, 비즈니스/기술과 무관한 엔터테인먼트 뉴스는 엄격하게 배제합니다.*
---

수집된 소스 데이터 목록:
${sourceContext}

지시사항:
1. 제공된 모든 소스를 검토하여 위의 5대 원칙에 가장 부합하는 **TOP ${count}개 핵심 기사**를 통합적으로 선정하세요.
2. 다른 소스에서 내용이 중복되거나 유사한 뉴스를 다루고 있다면, 가장 정보 밀도가 높고 기계설비 관점에서 해석이 풍부한 쪽을 선택하거나 내용을 하나로 통합하세요.
3. 선정된 ${count}개 기사에 대해 다음 JSON 구조로 응답하세요. 각 기사가 어느 소스(URL)에서 왔는지 정확히 명시해야 합니다.

중요: 반드시 유효한 JSON 형식이어야 하며 정확히 ${count}개의 기사를 선정하세요 (적합한 오늘의 기사가 부족하다면 제공된 데이터 중 위의 기계설비/하이테크/건설 관련 최신 뉴스를 우선순위로 하여 ${count}개를 무조건 채워주십시오). 한국어로 격조 있고 신뢰성 있게 기술 분석 보고서 톤으로 작성하세요.
    `;

    let response;
    let retries = 0;
    const maxRetries = 3;
    
    while (retries <= maxRetries) {
      try {
        response = await getGeminiClient().models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
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
                        description: "기사의 핵심을 관통하는 매력적인 헤드라인"
                      },
                      summary5W1H: {
                        type: Type.STRING,
                        description: "누가, 언제, 어디서, 무엇을, 어떻게, 왜 했는지 전문적인 기사 수준으로 상세히 서술하세요. 약 10~15문장 수준의 충분한 분량과 밀도를 유지해야 합니다."
                      },
                      implications: {
                        type: Type.STRING,
                        description: "해당 뉴스가 건설업, 기계설비, 또는 하이테크 미래 기술 비즈니스 전반에 미칠 비즈니스적 영향과 핵심 시사점을 충분한 깊이에 약 5줄 분량의 유려하고 전문적인 하나의 흐름을 지닌 '줄글(단락)' 형태로 정교하게 서술해 주십시오. 번호나 기호('-', '*', '■')를 앞에 붙여 끊어 쓰지 말고 줄바꿈 없이 하나의 완성된 문단 본문으로 쭉 이어서 전개해 주십시오."
                      },
                      date: {
                        type: Type.STRING,
                        description: "발행 날짜"
                      },
                      sourceUrl: {
                        type: Type.STRING,
                        description: "해당 뉴스의 원래 원본 출처 URL. 반드시 제공받은 실제 수집 목록(Source context) 내 작성된 원문 URL(URL: ...)값을 100% 철자 그대로 동일하게 복사하여 대입하십시오. 임의의 다른 주소를 지어내거나 누락해서는 절대 안됩니다."
                      },
                      sourceName: {
                        type: Type.STRING,
                        description: "해당 언론사 이름 또는 사이트 명칭"
                      },
                      tags: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.STRING
                        },
                        description: "기사 핵심 내용에 부합하는 카테고리 태그 리스트. 다음 항목 풀 중에서 명확히 연관된 것들을 1~3개 선정하십시오: 'AI', '반도체', '에너지', '방산', '바이오', '중국', '거시경제'. 만약 다른 중대한 카테고리가 해당될 경우 추가해도 좋습니다."
                      }
                    },
                    required: ["headline", "summary5W1H", "implications", "date", "sourceUrl", "sourceName", "tags"]
                  }
                }
              },
              required: ["articles"]
            }
          }
        });
        break; // Success!
      } catch (err: any) {
        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
          if (retries === maxRetries) {
            console.error("Gemini exhausted limit error:", err);
            return res.status(500).json({ error: "Google API 요청 한도가 일시적으로 초과되었습니다. 잠시 후 재시도 부탁드립니다." });
          }
          retries++;
          const delay = Math.pow(2, retries) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error("Gemini runtime error:", err);
          return res.status(500).json({ error: err.message || "분석 도중 오류가 발생했습니다." });
        }
      }
    }

    try {
      if (!response || !response.text) {
        throw new Error("No response text generated by Gemini model.");
      }
      const data = JSON.parse(response.text);
      res.json(data);
    } catch (parseError: any) {
      console.error("Parse or Response structure error:", parseError);
      res.status(500).json({ error: "분석 결과를 해석하는데 실패했습니다. 유효하지 않은 응답이 전달되었습니다." });
    }
  });

  // Serve built static assets in production
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // Vite middleware for development
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
