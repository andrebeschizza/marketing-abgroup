// /api/agentes — Mapa dos 16 agentes
import { readSheet } from '../lib/sheets.js';

// Fallback se aba "agentes" não existir ou estiver vazia
const AGENTES_BASE = [
  { codigo: 'Ag. 0', nome: 'Orquestrador', categoria: 'Orquestração', funcao: 'Dono do sistema, classifica e roteia toda demanda', acionar: 'Toda demanda passa primeiro por aqui' },
  { codigo: 'Ag. 1', nome: 'Estrategista de Campanha', categoria: 'Estratégia', funcao: 'Cria e ajusta campanhas (ABADV, AposentaBR, AB CRED, Vitalidade+)', acionar: 'Nova campanha, ajuste sazonal, reposicionamento' },
  { codigo: 'Ag. 2', nome: 'Copywriter', categoria: 'Conteúdo', funcao: '3 versões de legenda + CTAs + hashtags', acionar: 'Auto após roteiro. Manual: copy/headline/anúncio' },
  { codigo: 'Ag. 3', nome: 'SEO & Curadoria', categoria: 'Inteligência', funcao: 'Palavras-chave, classifica tipo, otimização', acionar: 'Auto. Manual: pesquisa SEO, briefing roteiristas' },
  { codigo: 'Ag. 4', nome: 'Social Media', categoria: 'Conteúdo', funcao: 'Adapta legenda para cada plataforma', acionar: 'Auto após aprovação' },
  { codigo: 'Ag. 5', nome: 'Performance', categoria: 'Performance', funcao: 'Análise semanal, gargalos, KPIs, feedback de sexta', acionar: 'Relatório semanal/mensal' },
  { codigo: 'Ag. 6', nome: 'Gestor de Leads', categoria: 'Comercial', funcao: 'SDR Virtual, qualificação, follow-up', acionar: 'Análise leads, scripts SDR' },
  { codigo: 'Ag. 7A', nome: 'Roteirista YouTube Longo', categoria: 'Conteúdo', funcao: 'Roteiros 17-20 min canal @andrebeschizza (Padrão Ouro v2.0)', acionar: 'Roteiro YouTube longo' },
  { codigo: 'Ag. 7B', nome: 'Roteirista Curtos', categoria: 'Conteúdo', funcao: 'Roteiros 30-60s Reels/Shorts/TikTok/Kwai', acionar: 'Auto pipeline. Manual: roteiro curto' },
  { codigo: 'Ag. 8', nome: 'Calendário Editorial', categoria: 'Orquestração', funcao: 'Distribui vídeos por dia/plataforma', acionar: 'Auto dia 20. Manual: planejar mês' },
  { codigo: 'Ag. 9', nome: 'Estrategista Ecossistema', categoria: 'Estratégia', funcao: 'Mapeia conteúdo → produtos (cross-sell)', acionar: 'Jornada do cliente, conexão conteúdo-produto' },
  { codigo: 'Ag. 10', nome: 'Agendador', categoria: 'Orquestração', funcao: 'Publica em IG (2 perfis) + YouTube (2 canais)', acionar: 'Auto após aprovação' },
  { codigo: 'Ag. 11', nome: 'Editor Curtos', categoria: 'Edição', funcao: 'Whisper + crop 9:16 + Cloudinary', acionar: 'Auto quando vídeo entra no pipeline' },
  { codigo: 'Ag. 12', nome: 'Editor Longos', categoria: 'Edição', funcao: 'Transcrição + 3-5 cortes sugeridos', acionar: 'Manual: link vídeo longo' },
  { codigo: 'Ag. 13', nome: 'Concorrência YouTube', categoria: 'Inteligência', funcao: 'Análise de canais, temas quentes, autoridade final de pauta', acionar: 'Análise concorrência, sugestão temas' },
  { codigo: 'Ag. 14', nome: 'Escritor de Notícias', categoria: 'Conteúdo', funcao: 'Matérias INSS, direito, finanças para blog', acionar: 'Sáb 8h e Dom 20h. Manual: matéria especial' },
];

export async function listAgentes(req, res) {
  try {
    let rows = [];
    try {
      rows = await readSheet('agentes');
    } catch (e) {
      // Aba não existe — usa fallback
    }

    const fromSheet = rows
      .filter(r => r['Codigo'] || r['Código'])
      .map(r => ({
        codigo: r['Codigo'] || r['Código'] || '',
        nome: r['Nome'] || '',
        categoria: r['Categoria'] || '',
        funcao: r['Funcao'] || r['Função'] || '',
        acionar: r['Acionar'] || r['Quando Acionar'] || '',
        status: r['Status'] || 'Saudável',
      }));

    const agentes = fromSheet.length > 0 ? fromSheet : AGENTES_BASE;
    res.json({ total: agentes.length, agentes });
  } catch (e) {
    res.json({ total: AGENTES_BASE.length, agentes: AGENTES_BASE });
  }
}
