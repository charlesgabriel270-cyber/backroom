// api/thoughts.js — Vercel Serverless Function
// GET ?room=0,0

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { room } = req.query;
  if (!room) return res.status(400).json({ error: 'missing room' });

  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/thoughts`
      + `?room_key=eq.${encodeURIComponent(room)}`
      + `&select=distorted_text,author_name`
      + `&order=created_at.desc`
      + `&limit=20`;

    const supaRes = await fetch(url, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      }
    });

    const rows = await supaRes.json();
    const thoughts = (rows || []).map(r => ({
      text: r.distorted_text,
      author: r.author_name,
    }));

    res.setHeader('Cache-Control', 's-maxage=10');
    res.status(200).json({ thoughts });
  } catch (e) {
    console.error('Supabase fetch error:', e);
    res.status(200).json({ thoughts: [] });
  }
}
