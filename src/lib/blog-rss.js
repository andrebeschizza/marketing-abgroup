// Lê RSS do blog andrebeschizza.com.br e conta posts publicados no mês corrente.
// RSS é XML simples, parseamos manualmente (sem dependência extra).
const RSS_URL = process.env.BLOG_RSS_URL || 'https://andrebeschizza.com.br/feed/';

// Parser RSS minimalista — só pega <item><pubDate> de cada post
function parseRssDates(xml) {
  const dates = [];
  // Pega todos os blocos <item>...</item>
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const item = m[1];
    const pubMatch = item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/);
    if (pubMatch) {
      const d = new Date(pubMatch[1].trim());
      if (!isNaN(d.getTime())) dates.push(d);
    }
  }
  return dates;
}

export async function countPostsBlogDoMes() {
  const res = await fetch(RSS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Marketing-AB-Group-Cowork)',
      'Accept': 'application/rss+xml, application/xml, text/xml',
    },
  });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  const dates = parseRssDates(xml);
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  return dates.filter(d => d.getFullYear() === ano && d.getMonth() === mes).length;
}
