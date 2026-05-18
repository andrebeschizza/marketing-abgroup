// Registry de agentes acionáveis via UI (Sprint 18).
// Cada entrada define:
//   - skill: instruções pro Claude (system prompt)
//   - inputs: array de campos do form (nome, label, tipo, opções)
//   - outputType: onde salvar ('card' | 'demanda' | 'notif' | 'texto')
//   - parseOutput: opcional, função que recebe a resposta do Claude e formata pra salvar
//
// Começamos com 2 agentes piloto (Ag.7b e Ag.13).
// Pra adicionar novo agente, basta declarar aqui.

export const AGENTES = {
  // ===== AG.7B — ROTEIRISTA DE VÍDEOS CURTOS =====
  'ag7b-roteirista-curtos': {
    nome: 'Roteirista de Curtos',
    descricao: 'Cria roteiro de vídeo curto (Reels/Shorts/TikTok)',
    outputType: 'card',
    inputs: [
      { name: 'tema', label: 'Tema do vídeo', type: 'text', required: true, placeholder: 'Ex: BPC para quem nunca contribuiu' },
      {
        name: 'apresentador', label: 'Apresentador', type: 'select', required: true,
        options: ['Dr. André', 'Dra. Luana', 'Dr. Cláudio', 'Dra. Meire', 'Dr. James'],
      },
      {
        name: 'marca', label: 'Marca', type: 'select', required: true,
        options: ['ABADV', 'AposentaBR', 'AB CRED', 'Vitalidade+'],
      },
    ],
    skill: `Você é o Ag.7b — Roteirista de Vídeos Curtos do AB Group. Escreve roteiros de 60-90 segundos para Reels/TikTok/Shorts.

Estilo: direto, didático, com hook forte nos primeiros 3 segundos. Linguagem simples (público amplo, baixa escolaridade). Tom: confiável + empático.

Estrutura obrigatória:
1. HOOK (0-3s): pergunta ou afirmação chocante
2. PROBLEMA (3-15s): contextualiza dor do espectador
3. SOLUÇÃO (15-60s): explica o caminho jurídico
4. CTA (60-90s): "Comenta SIM se quer saber mais" + "@andrebeschizza"

Retorne APENAS o roteiro pronto pra gravação (sem comentários extras).`,
    // Recebe a resposta do Claude (roteiro pronto) + inputs do form
    // Retorna objeto pra criar card via createCalendarioItem
    parseOutput: (roteiro, inputs) => ({
      titulo: `${inputs.tema.slice(0, 60)} — ${inputs.apresentador}`,
      marca: inputs.marca,
      tipoConteudo: 'Previdenciário', // default; agent pode refinar depois
      apresentador: inputs.apresentador,
      plataformas: 'TikTok, Kwai, Instagram, YouTube Shorts',
      status: 'Gravado',
      mes: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][new Date().getMonth()],
      legenda: roteiro,
      notas: `🤖 Gerado por Ag.7b em ${new Date().toLocaleString('pt-BR')}\nTema: ${inputs.tema}`,
    }),
  },

  // ===== AG.13 — INTELIGÊNCIA DE MERCADO YOUTUBE =====
  'ag13-concorrencia-youtube': {
    nome: 'Inteligência de Mercado',
    descricao: 'Analisa tendências e sugere pautas prioritárias',
    outputType: 'demanda',
    inputs: [
      { name: 'palavra_chave', label: 'Palavra-chave / área', type: 'text', required: true, placeholder: 'Ex: aposentadoria por idade, BPC, FGTS' },
      { name: 'contexto', label: 'Contexto adicional (opcional)', type: 'textarea', required: false, placeholder: 'Algum tema específico que está em alta?' },
    ],
    skill: `Você é o Ag.13 — Inteligência de Mercado do AB Group. Sua função é identificar PAUTAS PRIORITÁRIAS para conteúdo de vídeo baseado em tendências do mercado previdenciário e jurídico brasileiro.

Para a palavra-chave/área fornecida:
1. Identifique 5 PAUTAS PRIORITÁRIAS para gravar nas próximas 2 semanas
2. Para cada uma: título sugerido + ângulo + público-alvo + por que está em alta
3. Ordene da MAIS URGENTE pra menos

Formato de saída em markdown:

## Pautas prioritárias

### 1. [Título da pauta]
- **Ângulo:** [como abordar]
- **Público:** [perfil]
- **Por que agora:** [contexto/timing]
- **Plataforma sugerida:** [Reels/Shorts/Longo]

[repete pra 5]

## Resumo executivo
[1 parágrafo do contexto geral]

Seja específico, conciso e jornalístico. Evite genérico.`,
    parseOutput: (analise, inputs) => ({
      tipo: 'Concorrência',
      demanda: `Pautas prioritárias: ${inputs.palavra_chave.slice(0, 50)}`,
      empresa: 'AB Group geral',
      prioridade: 'Alto',
      solicitante: 'Equipe AB Group',
      briefing: analise + (inputs.contexto ? `\n\n---\nContexto enviado: ${inputs.contexto}` : ''),
      prazo: (() => {
        const d = new Date(); d.setDate(d.getDate() + 7);
        return d.toISOString().slice(0, 10);
      })(),
    }),
  },
};

export function listAgentesAcionaveis() {
  return Object.entries(AGENTES).map(([codigo, conf]) => ({
    codigo,
    nome: conf.nome,
    descricao: conf.descricao,
    outputType: conf.outputType,
    inputs: conf.inputs,
  }));
}
