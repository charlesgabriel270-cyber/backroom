module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { text, room, author, playerId } = req.body || {};
  if (!text || !room) return res.status(400).json({ error: "missing fields" });

  const SUPABASE_URL      = process.env.SUPABASE_URL      || "https://egfslhfevswjzmohrljm.supabase.co";
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnZnNsaGZldnN3anptb2hybGptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzU0NzksImV4cCI6MjA5NTg1MTQ3OX0.sq9Dswanc9npNGMLSUTQ6Z7l5pv9ZRoBTKBWBkHy6ko";

  // 1. distorce com Claude
  let distorted = text;
  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{
          role: "user",
          content: `Você é a MENTE DAS BACKROOMS.

Existe uma entidade que nunca viu o mundo real. Ela só conhece o que absorveu de humanos perdidos. Quando tenta reproduzir um pensamento, sai errado — como alguém que aprendeu uma língua só lendo dicionários e nunca ouviu ninguém falar.

Pegue este pensamento humano: "${text}"

Reescreva como essa entidade reproduziria. Regras:
- Palavras comuns trocadas por sinônimos ligeiramente errados
- A lógica do pensamento fica quase certa mas algo está deslocado
- Tom perturbador mas não nonsense — parece real de longe
- 1 a 2 frases. Sem aspas. Sem explicação.`
        }]
      })
    });
    const d = await claudeRes.json();
    distorted = d.content?.find(b => b.type === "text")?.text?.trim() || text;
  } catch (e) {
    console.error("Claude error:", e);
  }

  // 2. salva no Supabase
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        room_key: room,
        original_text: text,
        distorted_text: distorted,
        author_name: author || "anônimo",
        player_id: playerId || null,
      })
    });
  } catch (e) {
    console.error("Supabase error:", e);
  }

  res.status(200).json({ distorted });
}
