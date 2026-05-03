// Notion client — query database e converter para schema do calendário Sheets
// Requer token via header (one-shot migration). NÃO usa env var por segurança.

const NOTION_VERSION = '2022-06-28';

export async function notionQueryAll(token, databaseId) {
  if (!token || !token.startsWith('ntn_') && !token.startsWith('secret_')) {
    throw new Error('Notion token inválido (esperado: ntn_... ou secret_...)');
  }
  if (!databaseId) throw new Error('databaseId obrigatório');

  // Notion API expects database/page query via /v1/data_sources or /v1/databases/{id}/query
  // /v1/databases/{id}/query é o legado e funciona com 2022-06-28
  let allPages = [];
  let cursor = undefined;
  let pageCount = 0;
  const MAX_PAGES = 50; // safety cap (50 pages × 100 items = 5000 items)

  while (pageCount < MAX_PAGES) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Notion API ${res.status}: ${errText.slice(0, 300)}`);
    }
    const json = await res.json();
    allPages = allPages.concat(json.results || []);
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
    pageCount++;
  }

  return allPages;
}

// Converte uma página Notion no schema da aba `calendario` do Sheets
// Schema (14 colunas):
// Título | Marca | Tipo Conteúdo | Apresentador | Plataformas | Status |
// Data Publicação | Mês | Link Drive Raw | Link Drive Editado | Link Publicação |
// Notas | Notion ID | Atualizado em
export function notionPageToCalendarRow(page) {
  const props = page.properties || {};

  const getTitle = (p) => {
    if (!p) return '';
    const arr = p.title || [];
    return arr.map(t => t.plain_text || '').join('').trim();
  };
  const getSelect = (p) => p?.select?.name || '';
  const getMulti = (p) => (p?.multi_select || []).map(o => o.name).join(', ');
  const getDate = (p) => p?.date?.start || '';
  const getUrl = (p) => p?.url || '';

  const tipo = getSelect(props['Tipo de Conteúdo']);
  // Marca default: ABADV pra todos os tipos jurídicos (regra do André)
  const marca = tipo ? 'ABADV' : '';

  const plataformas = getMulti(props['Plataforma']);
  const apresentador = getSelect(props['Apresentador']);
  const status = getSelect(props['Status']);
  const dataPub = getDate(props['Data Publicação']);
  const mes = getSelect(props['Mês Referência']);
  const driveRaw = getUrl(props['Link Drive Raw']);
  const driveEdit = getUrl(props['Link Drive Editado']);
  const linkPub = getUrl(props['Link Publicação']);

  return {
    'Título': getTitle(props['Título']),
    'Marca': marca,
    'Tipo Conteúdo': tipo,
    'Apresentador': apresentador,
    'Plataformas': plataformas,
    'Status': status,
    'Data Publicação': dataPub,
    'Mês': mes,
    'Link Drive Raw': driveRaw,
    'Link Drive Editado': driveEdit,
    'Link Publicação': linkPub,
    'Notas': '',
    'Notion ID': page.id,
    'Atualizado em': page.last_edited_time || '',
  };
}

export const CALENDARIO_HEADERS = [
  'Título',
  'Marca',
  'Tipo Conteúdo',
  'Apresentador',
  'Plataformas',
  'Status',
  'Data Publicação',
  'Mês',
  'Link Drive Raw',
  'Link Drive Editado',
  'Link Publicação',
  'Notas',
  'Notion ID',
  'Atualizado em',
];
