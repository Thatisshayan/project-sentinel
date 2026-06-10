import { config } from '../config.js';

const BASE = 'https://api.notion.com/v1';
const HEADERS = {
  Authorization: `Bearer ${config.notion.apiKey}`,
  'Notion-Version': '2026-03-11',
  'Content-Type': 'application/json',
};

export async function queryDatabase() {
  const url = `${BASE}/data_sources/${config.notion.databaseId}/query`;
  const res = await fetch(url, { method: 'POST', headers: HEADERS, body: '{}' });
  if (!res.ok) throw new Error(`Notion query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function updatePage(pageId, properties) {
  const url = `${BASE}/pages/${pageId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`Notion update failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function appendBlocks(pageId, blocks) {
  const url = `${BASE}/blocks/${pageId}/children`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ children: blocks }),
  });
  if (!res.ok) throw new Error(`Notion append blocks failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export function findProjectByRepo(results, repoName) {
  const lower = repoName.toLowerCase();
  for (const page of results) {
    const prop = page.properties?.['Repo Name'];
    if (!prop?.rich_text?.length) continue;
    const pageRepo = prop.rich_text.map(t => t.plain_text).join('').toLowerCase();
    if (pageRepo === lower) return page;
  }
  return null;
}
