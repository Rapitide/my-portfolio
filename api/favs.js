// Vercel Serverless Function: コスメティック田中さんの「Xいいね」ページをスクレイピングしてJSONで返すAPI
// VercelのCDNによる強力なキャッシュを設定し、速度向上と相手先サーバーへの負荷低減を実現

export default async function handler(req, res) {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    console.log('[api/favs] Fetching target page...');
    
    // コスメティック田中さんの「Xいいね」ページを取得
    // 相手サーバーが重い場合に備え、タイムアウトを設定して全体の稼働を保証
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト
    
    const response = await fetch('https://cos-tanaka.com/x-favs/', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    console.log(`[api/favs] Successfully fetched HTML. Length: ${html.length} bytes`);

    // 正規表現で twitter-tweet 埋め込み blockquote をすべて抽出
    // data-dnt="true" がついた blockquote.twitter-tweet に対応
    const tweetRegex = /<blockquote class="twitter-tweet"[^>]*>[\s\S]*?<\/blockquote>/gi;
    const matches = html.match(tweetRegex) || [];

    console.log(`[api/favs] Found ${matches.length} tweets in HTML.`);

    // 成功した場合は1時間CDNに強力キャッシュ (stale-while-revalidateでバックグラウンド更新)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      success: true,
      tweets: matches,
      count: matches.length,
      updatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('[api/favs] Error during scraping:', err);
    
    // エラー時のレスポンスはキャッシュさせない
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal Server Error',
      tweets: []
    });
  }
}
