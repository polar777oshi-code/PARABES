// Mural do Artenks - função serverless da Vercel
// Guarda os nomes em um Redis (Upstash) pela API REST, sem dependências.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CHAVE = 'mural_artenks';
const MAX = 5000;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}

function limpa(t) {
  return String(t == null ? '' : t)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ erro: 'banco não configurado' });
  try {
    if (req.method === 'GET') {
      const itens = await redis(['LRANGE', CHAVE, 0, MAX - 1]);
      const nomes = (itens || []).map((x) => {
        try { return JSON.parse(x); } catch (e) { return null; }
      }).filter(Boolean).map((x) => ({ nome: limpa(x.nome), t: x.t }));
      return res.status(200).json({ nomes });
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const nome = limpa(body && body.nome);
      if (!nome) return res.status(400).json({ erro: 'nome vazio' });
      // limite simples: 1 assinatura a cada 8s por IP
      const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
      const ok = await redis(['SET', 'rl:' + ip, '1', 'EX', 8, 'NX']);
      if (!ok) return res.status(429).json({ erro: 'devagar' });
      const tam = await redis(['LLEN', CHAVE]);
      if (tam >= MAX) return res.status(507).json({ erro: 'mural cheio' });
      await redis(['RPUSH', CHAVE, JSON.stringify({ nome, t: Date.now() })]);
      return res.status(201).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ erro: 'método não permitido' });
  } catch (e) {
    return res.status(500).json({ erro: 'falha no banco' });
  }
};
