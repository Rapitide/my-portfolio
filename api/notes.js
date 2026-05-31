// Vercel Serverless Function: Supabase PostgreSQL へのプロキシ
// 記事を個別レコードとして保存するため、容量の心配なし

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = `${SUPABASE_URL}/rest/v1/notes`;

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: 記事データを取得 (一覧用の軽量取得と、詳細用の個別取得に対応)
    if (req.method === 'GET') {
      // queryパースの堅牢なフォールバック (VercelのESM環境対策)
      let noteId = req.query?.id;
      if (!noteId && req.url) {
        try {
          const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          noteId = parsedUrl.searchParams.get('id');
        } catch (e) {
          console.error('URL parse error in notes API:', e);
        }
      }

      let url = `${API_BASE}?order=created_at.asc`;
      
      if (noteId) {
        // 個別記事の全データを取得 (詳細表示用)
        console.log(`[api/notes] Fetching full note details for ID: ${noteId}`);
        url = `${API_BASE}?id=eq.${noteId}&select=*`;
      } else {
        // 一覧用の軽量データを取得 (重い本文 content を除外して容量パンクと502エラーを完全回避)
        console.log('[api/notes] Fetching lightweight notes list');
        url = `${API_BASE}?select=id,title,thumbnail,tags,date&order=created_at.asc`;
      }

      const response = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      if (!response.ok) {
        const text = await response.text();
        console.error('Supabase GET error:', response.status, text);
        return res.status(response.status).json({ error: text });
      }
      const data = await response.json();
      return res.status(200).json(data);
    }

    // PUT: 全記事データを同期（既存の仕組みとの互換性を保持）
    // フロントエンドから配列が送られてくるので、差分をSupabaseに反映する
    if (req.method === 'PUT') {
      const notes = req.body;
      if (!Array.isArray(notes)) {
        return res.status(400).json({ error: 'Body must be an array of notes' });
      }

      // Supabase の upsert を使って一括同期
      // upsert: 存在すれば更新、なければ挿入
      if (notes.length > 0) {
        const upsertRes = await fetch(`${API_BASE}?on_conflict=id`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(notes.map(n => ({
            id: n.id,
            title: n.title,
            thumbnail: n.thumbnail || '',
            tags: n.tags || '',
            content: n.content || '',
            date: n.date
          })))
        });
        if (!upsertRes.ok) {
          const text = await upsertRes.text();
          console.error('Supabase UPSERT error:', upsertRes.status, text);
          return res.status(upsertRes.status).json({ error: text });
        }
      }

      // フロントエンドから送られた配列に含まれないIDのレコードを削除
      // (フロントエンドで記事が削除された場合の同期)
      const existingRes = await fetch(`${API_BASE}?select=id`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      if (existingRes.ok) {
        const existing = await existingRes.json();
        const frontendIds = new Set(notes.map(n => n.id));
        const toDelete = existing.filter(e => !frontendIds.has(e.id)).map(e => e.id);
        
        if (toDelete.length > 0) {
          const deleteFilter = toDelete.map(id => `id.eq.${id}`).join(',');
          await fetch(`${API_BASE}?or=(${deleteFilter})`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
          });
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
