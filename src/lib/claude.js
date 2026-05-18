// Cliente Anthropic Claude API (Messages).
// Doc: https://docs.anthropic.com/en/api/messages
//
// Env: ANTHROPIC_API_KEY (gerar em https://console.anthropic.com/settings/keys)
//
// Modelos:
//   claude-haiku-4-5-20251001 — barato, rápido (~$0.0008/1k input)
//   claude-sonnet-4-6 — balance (~$0.003/1k input)
//   claude-opus-4-6 — premium

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

function getKey() {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error('ANTHROPIC_API_KEY não configurado no env');
  return k;
}

// Envia mensagem pra Claude. Retorna { content, usage }
// system = string com instruções da skill
// userMessage = string com input do usuário
export async function askClaude({ system, userMessage, model = DEFAULT_MODEL, maxTokens = 2000 }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': getKey(),
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Claude API HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = (data.content || []).map(c => c.text || '').join('\n').trim();
  return {
    content,
    usage: data.usage,
    model: data.model,
  };
}
