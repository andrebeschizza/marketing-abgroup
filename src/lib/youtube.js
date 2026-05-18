// Lê dados públicos do canal YouTube SEM precisar de API key.
// Scrape da página do canal extraindo subscriberCount via "X mil inscritos" no HTML.
// Frágil (depende do layout YouTube) mas funciona pra contagem mensal.
//
// Canal default: @andrebeschizza (channelId UCmlIbGCq9zGGtHyCbTTuM2A)
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCmlIbGCq9zGGtHyCbTTuM2A';
const CHANNEL_URL = `https://www.youtube.com/channel/${CHANNEL_ID}`;

// Converte "91,2 mil" → 91200, "1,5 mi" → 1500000, "350" → 350
function parseAbreviado(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const m = s.match(/^([\d.,]+)\s*(mil|mi|milh[õo]es|m|k)?/);
  if (!m) return null;
  const numStr = m[1].replace(/\./g, '').replace(',', '.');
  const n = parseFloat(numStr);
  if (isNaN(n)) return null;
  const suffix = (m[2] || '').replace(/[õo]/g, 'o');
  if (suffix === 'mil' || suffix === 'k') return Math.round(n * 1000);
  if (suffix === 'mi' || suffix === 'm' || suffix.startsWith('milh')) return Math.round(n * 1000000);
  return Math.round(n);
}

// Retorna { subscribers: N, raw: "91,2 mil inscritos" } ou throws
export async function getSubscriberCount() {
  const res = await fetch(CHANNEL_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Marketing-AB-Group-Cowork)',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
  const html = await res.text();
  // Procura "X inscritos" (pt-BR) ou "X subscribers" (en)
  const matchPtbr = html.match(/"([\d.,]+\s*(?:mil|mi|milh[õo]es)?\s*inscritos)"/i);
  const matchEn = html.match(/"([\d.,]+\s*[KMB]?\s*subscribers)"/i);
  const raw = matchPtbr?.[1] || matchEn?.[1] || null;
  if (!raw) throw new Error('subscriberCount não encontrado no HTML do canal');
  const n = parseAbreviado(raw);
  if (n === null) throw new Error(`falha ao parsear "${raw}"`);
  return { subscribers: n, raw };
}

// Inscritos GANHOS no mês corrente.
// Como YouTube não dá histórico, calculamos a diferença vs último snapshot
// armazenado na aba kpis_historico do indicador "Inscritos YouTube ganhos".
// Estratégia: pegamos snapshot do dia 1 do mês (ou o mais antigo do mês) e comparamos com agora.
//
// Recebe `historicoRows` (linhas da aba kpis_historico) pra evitar I/O duplicado.
export async function inscritosGanhosDoMes(historicoRows = []) {
  const atual = await getSubscriberCount();

  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const prefixoMes = `${ano}-${mes}`;

  // Filtra histórico do indicador "Inscritos YouTube ganhos" do mês corrente
  // ATENÇÃO: armazenamos cumulativo (total atual) na coluna "Realizado" do histórico.
  // Pra calcular GANHO, achamos o menor valor do mês e subtraímos do atual.
  const noMes = historicoRows
    .filter(r => String(r['Indicador'] || '').trim() === 'Inscritos YouTube ganhos')
    .filter(r => String(r['Data'] || '').startsWith(prefixoMes))
    .map(r => ({
      data: r['Data'],
      total: parseFloat(String(r['Realizado'] || '0').replace(',', '.')) || 0,
    }))
    .sort((a, b) => a.data.localeCompare(b.data));

  // Snapshot do primeiro dia do mês = referência. Se não tem, ganho = 0 (começou hoje).
  const baseline = noMes.length > 0 ? noMes[0].total : atual.subscribers;
  const ganho = Math.max(0, atual.subscribers - baseline);

  return {
    totalAtual: atual.subscribers,
    rawAtual: atual.raw,
    baseline,
    ganhoNoMes: ganho,
    snapshotsMes: noMes.length,
  };
}
