export default async function handler(req, res) {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query" });

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=10&entity=song`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: "iTunes fetch failed" });
  }
}