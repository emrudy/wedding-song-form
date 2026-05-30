export default async function handler(req, res) {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query" });

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  const normalized = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const queries = q !== normalized ? [q, normalized] : [q];

  // ── Try iTunes first ───────────────────────────────────────────────────
  for (const query of queries) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=10&entity=song`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      const match = data.results?.find(r => r.previewUrl);
      if (match?.previewUrl) {
        return res.status(200).json({ previewUrl: match.previewUrl, source: "itunes" });
      }
    } catch(e) { continue; }
  }

  // ── Fallback: try Deezer ───────────────────────────────────────────────
  for (const query of queries) {
    try {
      const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      const match = data.data?.find(r => r.preview);
      if (match?.preview) {
        return res.status(200).json({ previewUrl: match.preview, source: "deezer" });
      }
    } catch(e) { continue; }
  }

  return res.status(200).json({ previewUrl: null });
}
