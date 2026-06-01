// api/distort.js — Vercel Serverless Function
// POST { text, room, author, playerId }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { text, room, author, playerId } = req.body || {};
  if (!text || !room) return res.status(400).json({ error: 'missing fields' });

  // 1. Distort with Claude
  let distorted = text;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: `Você é a MENTE DAS BACKROOMS — uma entidade que absorve pensamentos humanos e os regurgita de forma levemente errada, como uma cópia imperfeita feita por algo que quase entende o que é ser humano, mas erra nos detalhes sutis.

Pensamento original: "${text}"

Reescreva como um eco perturbador. Uma ou duas frases curtas. Sem aspas. Sem explicações. Apenas o eco.`
        }]
      })
    });
    const claudeData = await claudeRes.json();
    distorted = claudeData.content?.find(b => b.type === 'text')?.text?.trim() || text;
  } catch (e) {
    console.error('Claude error:', e);
  }

  // 2. Save to Supabase
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/thoughts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        room_key: room,
        original_text: text,
        distorted_text: distorted,
        author_name: author || 'anônimo',
        player_id: playerId || null,
      })
    });
  } catch (e) {
    console.error('Supabase save error:', e);
  }

  res.status(200).json({ distorted });
}
