// /api/calendario — Pipeline editorial de vídeos (Sprint 2)
import { readSheet, appendRow, updateRow, listTabs, createTab } from '../lib/sheets.js';
import { notionQueryAll, notionPageToCalendarRow, CALENDARIO_HEADERS } from '../lib/notion.js';

const TAB = 'calendario';
const NOTION_DB_ID = '22902ebc-b053-40d3-8363-eee51ba171af';

const STATUS_ORDER = [
  'Gravado',
  'Editando',
  'Aguardando aprovação',
  'Aprovado',
  'Agendado',
  'Publicado',
];

// Garante que aba calendario existe (cria se não)
async function ensureTab() {
  const tabs = await listTabs();
  if (!tabs.includes(TAB)) {
    await createTab(TAB, CALENDARIO_HEADERS);
  }
}

// GET /api/calendario — lista todos os items, agrupado por status (para Pipeline kanban)
// Query params: ?marca=ABADV&apresentador=Dr.+André&status=Editando
export async function listCalendario(req, res) {
  try {
    await ensureTab();
    const rows = await readSheet(TAB);
    const filter = req.query || {};

    let items = rows
      .filter(r => r['Título'])
      .map(r => ({
        row: r.__row,
        titulo: r['Título'] || '',
        marca: r['Marca'] || '',
        tipoConteudo: r['Tipo Conteúdo'] || '',
        apresentador: r['Apresentador'] || '',
        plataformas: r['Plataformas'] ? r['Plataformas'].split(',').map(s => s.trim()).filter(Boolean) : [],
        status: r['Status'] || '',
        dataPublicacao: r['Data Publicação'] || '',
        mes: r['Mês'] || '',
        linkDriveRaw: r['Link Drive Raw'] || '',
        linkDriveEditado: r['Link Drive Editado'] || '',
        linkPublicacao: r['Link Publicação'] || '',
        notas: r['Notas'] || '',
        notionId: r['Notion ID'] || '',
        atualizadoEm: r['Atualizado em'] || '',
      }));

    if (filter.marca) items = items.filter(i => i.marca === filter.marca);
    if (filter.apresentador) items = items.filter(i => i.apresentador === filter.apresentador);
    if (filter.status) items = items.filter(i => i.status === filter.status);
    if (filter.plataforma) items = items.filter(i => i.plataformas.includes(filter.plataforma));

    // Agrupa por status (ordem fixa)
    const porStatus = {};
    STATUS_ORDER.forEach(s => { porStatus[s] = []; });
    items.forEach(i => {
      const k = STATUS_ORDER.includes(i.status) ? i.status : 'Gravado';
      porStatus[k].push(i);
    });

    // Banner: o que publica hoje e amanhã
    const hoje = new Date().toISOString().slice(0, 10);
    const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const publicaHoje = items.filter(i => i.dataPublicacao && i.dataPublicacao.startsWith(hoje));
    const publicaAmanha = items.filter(i => i.dataPublicacao && i.dataPublicacao.startsWith(amanha));

    res.json({
      total: items.length,
      items,
      porStatus,
      publicaHoje,
      publicaAmanha,
      statusOrder: STATUS_ORDER,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/calendario — cria novo item
export async function createCalendarioItem(req, res) {
  const body = req.body || {};
  const titulo = body.titulo || body.title;
  if (!titulo) return res.status(400).json({ error: 'Campo obrigatório: titulo' });

  try {
    await ensureTab();
    const submetido = new Date().toISOString();

    await appendRow(TAB, {
      'Título': titulo,
      'Marca': body.marca || 'ABADV',
      'Tipo Conteúdo': body.tipoConteudo || '',
      'Apresentador': body.apresentador || '',
      'Plataformas': Array.isArray(body.plataformas) ? body.plataformas.join(', ') : (body.plataformas || ''),
      'Status': body.status || 'Gravado',
      'Data Publicação': body.dataPublicacao || '',
      'Mês': body.mes || '',
      'Link Drive Raw': body.linkDriveRaw || '',
      'Link Drive Editado': body.linkDriveEditado || '',
      'Link Publicação': body.linkPublicacao || '',
      'Notas': body.notas || '',
      'Notion ID': body.notionId || '',
      'Atualizado em': submetido,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// PATCH /api/calendario/:row/status — muda status (mover no kanban)
export async function updateCalendarioStatus(req, res) {
  const row = parseInt(req.params.row, 10);
  const { status } = req.body || {};
  if (!row || !status) return res.status(400).json({ error: 'row e status obrigatórios' });
  if (!STATUS_ORDER.includes(status)) {
    return res.status(400).json({ error: `status inválido. Use um de: ${STATUS_ORDER.join(', ')}` });
  }

  try {
    await ensureTab();
    const rows = await readSheet(TAB);
    const target = rows.find(r => r.__row === row);
    if (!target) return res.status(404).json({ error: 'Item não encontrado' });

    target['Status'] = status;
    target['Atualizado em'] = new Date().toISOString();
    await updateRow(TAB, row, target);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/calendario/migrate-from-notion — uma vez, popular Sheets a partir do Notion
// Token enviado via header X-Notion-Token (não armazenado)
export async function migrateFromNotion(req, res) {
  const token = req.headers['x-notion-token'];
  if (!token) return res.status(400).json({ error: 'Header X-Notion-Token obrigatório' });

  try {
    await ensureTab();
    // Verifica se já tem dados (evita duplicação)
    const existing = await readSheet(TAB);
    const existingNotionIds = new Set(existing.map(r => r['Notion ID']).filter(Boolean));

    const notionPages = await notionQueryAll(token, NOTION_DB_ID);

    let inserted = 0;
    let skipped = 0;
    for (const page of notionPages) {
      if (existingNotionIds.has(page.id)) { skipped++; continue; }
      const rowObj = notionPageToCalendarRow(page);
      await appendRow(TAB, rowObj);
      inserted++;
    }

    res.json({
      ok: true,
      total: notionPages.length,
      inserted,
      skipped,
      message: inserted > 0 ? `Migração concluída: ${inserted} novos items.` : 'Nada novo pra migrar.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
