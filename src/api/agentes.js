// /api/agentes — Mapa dos 16 agentes + acionamento via Claude API
import { readSheet, appendRow } from '../lib/sheets.js';
import { askClaude } from '../lib/claude.js';
import { AGENTES, listAgentesAcionaveis } from '../agentes/registry.js';
import { notify } from './notificacoes.js';

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
    // Marca quais agentes têm botão "Acionar" disponível
    const acionaveis = listAgentesAcionaveis();
    const acionaveisMap = Object.fromEntries(acionaveis.map(a => [a.codigo, a]));
    const enriched = agentes.map(a => {
      // Tenta achar pelo código tipo "Ag. 7B" → "ag7b-..."
      const norm = String(a.codigo || '').toLowerCase().replace(/[\s\.]/g, '');
      const match = acionaveis.find(ag => ag.codigo.replace(/-.*/, '').toLowerCase().includes(norm));
      return { ...a, acionavel: match ? match.codigo : null };
    });
    res.json({ total: enriched.length, agentes: enriched });
  } catch (e) {
    res.json({ total: AGENTES_BASE.length, agentes: AGENTES_BASE });
  }
}

// GET /api/agentes/acionaveis — lista agentes que têm botão "Acionar" disponível (com inputs)
export async function listAcionaveis(req, res) {
  res.json({ agentes: listAgentesAcionaveis() });
}

// POST /api/agentes/:codigo/acionar — chama Claude API com a skill, cria card/demanda/notif
export async function acionarAgente(req, res) {
  const codigo = req.params.codigo;
  const conf = AGENTES[codigo];
  if (!conf) return res.status(404).json({ error: `Agente "${codigo}" não disponível` });

  const inputs = req.body || {};
  // Validação básica dos inputs obrigatórios
  for (const field of conf.inputs) {
    if (field.required && !inputs[field.name]) {
      return res.status(400).json({ error: `Campo obrigatório: ${field.label}` });
    }
  }

  // Monta o userMessage com os inputs preenchidos
  const userMessage = conf.inputs.map(f => {
    const val = inputs[f.name];
    return val ? `**${f.label}:** ${val}` : null;
  }).filter(Boolean).join('\n');

  try {
    // Chama Claude
    const inicio = Date.now();
    const resp = await askClaude({
      system: conf.skill,
      userMessage,
      maxTokens: conf.maxTokens || 3000,
    });
    const duracao = Date.now() - inicio;

    // Aplica parseOutput (cada agente tem o seu)
    const payload = conf.parseOutput(resp.content, inputs);

    let savedAs = null;
    if (conf.outputType === 'card') {
      // Cria card no calendário (mesmo formato que createCalendarioItem)
      const { CALENDARIO_HEADERS } = await import('../lib/notion.js').catch(() => ({ CALENDARIO_HEADERS: [] }));
      await appendRow('calendario', {
        'Título': payload.titulo,
        'Marca': payload.marca || '',
        'Tipo Conteúdo': payload.tipoConteudo || '',
        'Apresentador': payload.apresentador || '',
        'Plataformas': payload.plataformas || '',
        'Status': payload.status || 'Gravado',
        'Mês': payload.mes || '',
        'Legenda': payload.legenda || '',
        'Notas': payload.notas || '',
        'Atualizado em': new Date().toISOString(),
      });
      savedAs = { tipo: 'card', titulo: payload.titulo };
      await notify({
        tipo: 'agente_executado',
        titulo: `🤖 ${conf.nome} criou card: ${payload.titulo}`,
        detalhe: `Acionado em ${new Date().toLocaleString('pt-BR')}`,
        url: '/#calendario',
        para: 'mkt',
        marca: payload.marca || '',
      });
    } else if (conf.outputType === 'demanda') {
      await appendRow('demandas', {
        'Tipo': payload.tipo || '',
        'Demanda': payload.demanda || '',
        'Empresa': payload.empresa || '',
        'Prioridade': payload.prioridade || 'Normal',
        'Solicitante': payload.solicitante || '',
        'Briefing': payload.briefing || '',
        'Prazo': payload.prazo || '',
        'Status': 'Não iniciada',
        'Submetido em': new Date().toISOString(),
      });
      savedAs = { tipo: 'demanda', titulo: payload.demanda };
      await notify({
        tipo: 'agente_executado',
        titulo: `🤖 ${conf.nome} criou demanda: ${payload.demanda}`,
        detalhe: `Acionado em ${new Date().toLocaleString('pt-BR')}`,
        url: '/#demandas',
        para: 'mkt',
      });
    } else if (conf.outputType === 'texto') {
      // Só retorna o texto sem salvar
      savedAs = { tipo: 'texto', preview: resp.content.slice(0, 200) };
    }

    res.json({
      ok: true,
      agente: codigo,
      duracaoMs: duracao,
      usage: resp.usage,
      output: resp.content,
      savedAs,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
