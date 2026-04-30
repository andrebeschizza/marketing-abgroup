// /api/atalhos — Atalhos vivos pros 10+ sistemas externos
import { readSheet } from '../lib/sheets.js';

const ATALHOS_BASE = [
  { nome: 'n8n (orquestração)', url: 'https://n8n.aposentabrasil.net.br', categoria: 'Automação', icon: '⚙️' },
  { nome: 'MLabs (agendamento)', url: 'https://www.mlabs.com.br', categoria: 'Publicação', icon: '📅' },
  { nome: 'RD Station (CRM)', url: 'https://app.rdstation.com.br', categoria: 'Leads', icon: '📊' },
  { nome: 'Atende Direito (SDR)', url: 'https://app.aposentabrasil.net.br/webhook/analise-documental', categoria: 'Leads', icon: '🤖' },
  { nome: 'Meta Business', url: 'https://business.facebook.com', categoria: 'Anúncios', icon: '📱' },
  { nome: 'Google Ads', url: 'https://ads.google.com', categoria: 'Anúncios', icon: '🎯' },
  { nome: 'TikTok Business', url: 'https://ads.tiktok.com', categoria: 'Anúncios', icon: '🎵' },
  { nome: 'Looker Studio (SEO)', url: 'https://lookerstudio.google.com/u/0/reporting/6b770afb-7546-48ca-a7ff-7cf2023095b3', categoria: 'Analytics', icon: '📈' },
  { nome: 'Google Trends', url: 'https://trends.google.com.br', categoria: 'Pesquisa', icon: '🔍' },
  { nome: 'YouTube Studio', url: 'https://studio.youtube.com', categoria: 'Plataformas', icon: '📺' },
  { nome: 'Instagram @advogados', url: 'https://www.instagram.com/andrebeschizzaadvogados', categoria: 'Plataformas', icon: '📷' },
  { nome: 'Instagram @drbeschizza', url: 'https://www.instagram.com/drbeschizza', categoria: 'Plataformas', icon: '📷' },
  { nome: 'Cloudinary', url: 'https://cloudinary.com/console', categoria: 'Mídia', icon: '☁️' },
  { nome: 'Semrush', url: 'https://www.semrush.com', categoria: 'SEO', icon: '🔬' },
  { nome: 'AnswerThePublic', url: 'https://answerthepublic.com/pt', categoria: 'Pesquisa', icon: '💬' },
  { nome: 'AlsoAsked', url: 'https://alsoasked.com', categoria: 'Pesquisa', icon: '❓' },
  { nome: 'ZapSign', url: 'https://app.zapsign.com.br', categoria: 'Operacional', icon: '✍️' },
];

export async function listAtalhos(req, res) {
  try {
    let rows = [];
    try {
      rows = await readSheet('atalhos');
    } catch (e) { /* fallback */ }

    const fromSheet = rows
      .filter(r => r['Nome'] && r['URL'])
      .map(r => ({
        nome: r['Nome'],
        url: r['URL'],
        categoria: r['Categoria'] || 'Outros',
        icon: r['Icon'] || '🔗',
      }));

    const atalhos = fromSheet.length > 0 ? fromSheet : ATALHOS_BASE;
    const grupos = {};
    atalhos.forEach(a => { if (!grupos[a.categoria]) grupos[a.categoria] = []; grupos[a.categoria].push(a); });
    res.json({ total: atalhos.length, atalhos, grupos });
  } catch (e) {
    res.json({ total: ATALHOS_BASE.length, atalhos: ATALHOS_BASE });
  }
}
