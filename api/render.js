import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = `${SUPABASE_URL}/rest/v1/notes`;

// HTMLから最初の画像のURLを抽出する関数
function extractFirstImageUrl(htmlContent) {
  if (!htmlContent) return null;
  // imgタグのsrcを検索
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/i;
  const match = imgRegex.exec(htmlContent);
  if (match && match[1]) {
    return match[1];
  }
  // YouTubeのサムネイルを検索
  const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const ytMatch = ytRegex.exec(htmlContent);
  if (ytMatch && ytMatch[1]) {
    return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
  }
  return null;
}

export default async function handler(req, res) {
  // queryパースのフォールバック
  let noteId = req.query?.note || req.query?.id;
  if (!noteId && req.url) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      noteId = parsedUrl.searchParams.get('note') || parsedUrl.searchParams.get('id');
    } catch (e) {
      console.error('URL parse error:', e);
    }
  }

  console.log(`[api/render] Request received. noteId: ${noteId}, Method: ${req.method}`);

  const htmlPath = path.join(process.cwd(), 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  if (!noteId) {
    console.log('[api/render] No noteId provided. Redirecting to home.');
    html = html.replace('<head>', '<head>\n  <script>window.location.replace("/");</script>');
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }

  try {
    const fetchUrl = `${API_BASE}?id=eq.${noteId}&select=*`;
    console.log(`[api/render] Fetching from Supabase: ${fetchUrl}`);
    
    // Supabaseから記事データを取得
    const response = await fetch(fetchUrl, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`[api/render] Supabase data length: ${Array.isArray(data) ? data.length : typeof data}`);
      
      if (Array.isArray(data) && data.length > 0) {
        const note = data[0];
        const title = note.title;
        // プレビュー文の作成 (HTMLタグを除去して先頭120文字)
        const preview = note.content ? note.content.replace(/<[^>]*>/g, '').substring(0, 120).trim() + '...' : 'ラピ態度のおうちの記事';
        
        // OGP画像URLの取得とBase64検出
        let imageUrl = note.thumbnail;
        let isBase64 = false;

        if (imageUrl && imageUrl.startsWith('data:image/')) {
          isBase64 = true;
        }

        if (!imageUrl) {
          imageUrl = extractFirstImageUrl(note.content);
          if (imageUrl && imageUrl.startsWith('data:image/')) {
            isBase64 = true;
          }
        }

        // Base64画像の場合、自ドメインの動的画像配信エンドポイントを指す絶対URLに変換する！
        if (isBase64) {
          const host = req.headers.host || 'rptied-home.vercel.app';
          const protocol = host.includes('localhost') ? 'http' : 'https';
          imageUrl = `${protocol}://${host}/api/image?note=${noteId}`;
          console.log(`[api/render] Image is Base64. Rewriting OGP image URL to dynamic provider: ${imageUrl}`);
        }
        
        console.log(`[api/render] Found note "${title}". Image URL for OGP: ${imageUrl}`);

        // メタタグの書き換え
        html = html.replace(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${title} | ラピ態度のおうち">`);
        html = html.replace(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${preview}">`);
        html = html.replace(/<meta name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${title} | ラピ態度のおうち">`);
        html = html.replace(/<meta name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${preview}">`);
        
        // OGPの遷移URLを現在のVercelの動的パスに書き換え (古いGitHubへのリダイレクトやカード全体のリンク破壊を防ぐ)
        const pageUrl = `https://rptied-home.vercel.app/note?note=${noteId}`;
        html = html.replace(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${pageUrl}">`);
        
        // カードタイプを大画像に変更
        html = html.replace(/<meta name="twitter:card"[^>]*>/i, `<meta name="twitter:card" content="summary_large_image">`);

        // og:image / twitter:image の追加・置換
        if (imageUrl) {
          if (html.includes('property="og:image"')) {
            html = html.replace(/<meta property="og:image"[^>]*>/i, `<meta property="og:image" content="${imageUrl}">`);
          } else {
            html = html.replace('<!-- OGP -->', `<!-- OGP -->\n    <meta property="og:image" content="${imageUrl}">`);
          }

          if (html.includes('name="twitter:image"')) {
            html = html.replace(/<meta name="twitter:image"[^>]*>/i, `<meta name="twitter:image" content="${imageUrl}">`);
          } else {
            html = html.replace('<!-- Twitter Card -->', `<!-- Twitter Card -->\n    <meta name="twitter:image" content="${imageUrl}">`);
          }
        }
        
        // 一般ユーザー（ブラウザ）を安全なドメインルートへ転送するスクリプトを埋め込む
        const redirectScript = `
  <script>
    window.location.replace("/?note=${noteId}");
  </script>
`;
        html = html.replace('<head>', '<head>' + redirectScript);
        console.log('[api/render] Successfully replaced OGP metadata and inserted redirect script.');
      } else {
        console.warn(`[api/render] No note found in Supabase for ID: ${noteId}`);
        html = html.replace('<head>', '<head>\n  <script>window.location.replace("/");</script>');
      }
    } else {
      const errText = await response.text();
      console.error(`[api/render] Supabase fetch failed. Status: ${response.status}. Response: ${errText}`);
    }
  } catch (err) {
    console.error('[api/render] Exception in handler:', err);
  }

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
