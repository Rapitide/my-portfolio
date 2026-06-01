import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = `${SUPABASE_URL}/rest/v1/notes`;

// HTMLから最初のBase64画像データを抽出する関数
function extractFirstBase64Image(htmlContent) {
  if (!htmlContent) return null;
  const imgRegex = /<img[^>]+src=["'](data:image\/[^;]+;base64,[^"']+)["']/i;
  const match = imgRegex.exec(htmlContent);
  return match ? match[1] : null;
}

export default async function handler(req, res) {
  // queryパースのフォールバック
  let noteId = req.query?.note || req.query?.id;
  if (!noteId && req.url) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      noteId = parsedUrl.searchParams.get('note') || parsedUrl.searchParams.get('id');
    } catch (e) {
      console.error('URL parse error in image API:', e);
    }
  }

  // デフォルトのフォールバック画像（ルートの image_0c53e7.png）を読み込む準備
  const fallbackPath = path.join(process.cwd(), 'image_0c53e7.png');
  const serveFallback = () => {
    try {
      const fallbackBuffer = fs.readFileSync(fallbackPath);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(fallbackBuffer);
    } catch (e) {
      return res.status(404).end();
    }
  };

  if (!noteId) {
    console.log('[api/image] No noteId provided. Serving fallback image.');
    return serveFallback();
  }

  try {
    const fetchUrl = `${API_BASE}?id=eq.${noteId}&select=*`;
    console.log(`[api/image] Fetching note from Supabase: ${fetchUrl}`);
    const response = await fetch(fetchUrl, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const note = data[0];
        
        // 1. カバー画像（サムネイル）がBase64であるか確認
        let base64Data = note.thumbnail;
        if (!base64Data || !base64Data.startsWith('data:image/')) {
          // 2. なければ本文内の最初のBase64画像を取得
          base64Data = extractFirstBase64Image(note.content);
        }

        if (base64Data && base64Data.startsWith('data:image/')) {
          console.log(`[api/image] Found Base64 image data for note ID: ${noteId}. Decoding...`);
          // 例: "data:image/png;base64,iVBORw0KGgo..."
          const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const contentType = matches[1];
            const base64Image = matches[2];
            const imageBuffer = Buffer.from(base64Image, 'base64');
            
            res.setHeader('Content-Type', contentType);
            // キャッシュさせることで読み込みを高速化
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(imageBuffer);
          } else {
            console.warn('[api/image] Base64 format regex mismatch.');
          }
        } else {
          console.log(`[api/image] No Base64 image found for note ID: ${noteId}.`);
        }
      } else {
        console.warn(`[api/image] Note not found in Supabase for ID: ${noteId}`);
      }
    } else {
      console.error(`[api/image] Supabase fetch failed. Status: ${response.status}`);
    }
  } catch (err) {
    console.error('[api/image] Exception:', err);
  }

  // 画像がない、またはエラーの場合はデフォルト画像を配信
  console.log('[api/image] Serving fallback image due to error or absence.');
  return serveFallback();
}
