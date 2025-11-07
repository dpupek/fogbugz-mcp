#!/usr/bin/env node
// FogBugz MCP server implemented via @modelcontextprotocol/sdk

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { request } from 'undici';
import { parseStringPromise } from 'xml2js';
import FormData from 'form-data';
import fs from 'node:fs';

const FOGBUGZ_BASE = process.env.FOGBUGZ_BASE || 'https://<YOUR>.fogbugz.com/api.asp';
const FOGBUGZ_TOKEN = process.env.FOGBUGZ_TOKEN || '7m5anarttjnu5o8gokr13hguod9q68';
const HELP_DOC_URL = new URL('./docs/fogbugz-help.md', import.meta.url);
const DEBUG = process.env.FOGBUGZ_MCP_DEBUG === '1';
const LOG_FILE = process.env.FOGBUGZ_MCP_LOG_FILE;
const WEB_BASE = (FOGBUGZ_BASE || '').replace(/\/api\.asp.*$/i, '').replace(/\/$/, '');

const DEFAULT_COLS = [
  'ixBug',
  'sTitle',
  'sStatus',
  'sFixFor',
  'ixBugParent',
  'ixBugChildren',
  'sLatestTextSummary',
  'sPersonAssignedTo',
  'sArea',
  'sProject',
  'plugin_customfields_at_fogcreek_com_userxstoryh815',
];
const USER_STORY_FIELD = 'plugin_customfields_at_fogcreek_com_userxstoryh815';

function logDebug(...args) {
  if (!DEBUG && !LOG_FILE) return;
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [fogbugz-mcp] ${args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ')}`;
  if (DEBUG) console.error(line);
  if (LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
    } catch (err) {
      if (DEBUG) console.error(`${timestamp} [fogbugz-mcp] Failed to write log file`, err);
    }
  }
}

function loadHelpMarkdown() {
  try {
    return fs.readFileSync(HELP_DOC_URL, 'utf8');
  } catch (err) {
    return [
      '# FogBugz MCP Helper',
      '',
      'Guidance document is unavailable.',
      err?.message ? `Error: ${err.message}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

async function fbCall(fields = {}, files = null) {
  const form = files ? files : new FormData();
  form.append('token', FOGBUGZ_TOKEN);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  if (DEBUG) {
    const safeFields = { ...fields };
    delete safeFields.token;
    logDebug('fbCall request', { url: FOGBUGZ_BASE, fields: safeFields, hasFiles: !!files });
  }

  const { statusCode, body } = await request(FOGBUGZ_BASE, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  const xml = await body.text();
  if (DEBUG) {
    logDebug('fbCall raw response', {
      statusCode,
      snippet: xml.replace(/\s+/g, ' ').slice(0, 200) || '<empty>',
    });
  }

  let json;
  try {
    json = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
  } catch (parseErr) {
    const snippet = xml.replace(/\s+/g, ' ').slice(0, 200);
    const error = new Error(`Failed to parse FogBugz XML (status ${statusCode}). Snippet: ${snippet || '<empty>'}`);
    error.cause = parseErr;
    error.status = statusCode;
    throw error;
  }

  let resp = json?.response;
  if (resp === undefined || resp === null) {
    const snippet = xml.replace(/\s+/g, ' ').slice(0, 200);
    const error = new Error(`Invalid FogBugz response (status ${statusCode}). Snippet: ${snippet || '<empty>'}`);
    error.status = statusCode;
    throw error;
  }
  if (typeof resp === 'string') resp = resp.trim() ? { value: resp.trim() } : {};
  if (resp.error) {
    const err = resp.error;
    const code = Number(err.code || -32001);
    const msg = (typeof err === 'string' ? err : err._) || 'FogBugz error';
    const e = new Error(msg);
    e.code = code;
    throw e;
  }
  return resp;
}

function normalizeIxBug(value, fallback) {
  if (Array.isArray(value)) return Number(value[0] ?? fallback ?? null);
  if (value === undefined || value === null) return fallback ?? null;
  const num = Number(value);
  return Number.isNaN(num) ? fallback ?? null : num;
}

function jsonResult(data) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        mimeType: 'application/json',
      },
    ],
  };
}

function columnsWithDefaults(cols) {
  const userCols = cols ? cols.split(',').map((c) => c.trim()).filter(Boolean) : [];
  return [...new Set([...DEFAULT_COLS, ...userCols])].join(',');
}

function withUserStory(record) {
  if (!record || typeof record !== 'object') return record;
  if ('userStory' in record) return record;
  if (record[USER_STORY_FIELD] === undefined) return record;
  return { ...record, userStory: record[USER_STORY_FIELD] };
}

async function handleViewCase({ ixBug, cols }) {
  const colString = columnsWithDefaults(cols);
  const resp = await fbCall({ cmd: 'view', ixBug: String(ixBug), cols: colString });
  let caseData = resp?.case;

  if (!caseData) {
    const fallback = await fbCall({ cmd: 'search', q: `ixbug:${ixBug}`, cols: colString });
    let list = fallback?.cases?.case || [];
    if (!Array.isArray(list)) list = list ? [list] : [];
    const first = list[0];
    if (!first) return jsonResult({ case: null, raw: fallback });
    return jsonResult({
      case: withUserStory({ ...first, ixBug: normalizeIxBug(first.ixBug, ixBug), _source: 'search' }),
      raw: fallback,
    });
  }

  if (Array.isArray(caseData)) {
    caseData = caseData.map((item) => withUserStory({
      ...item,
      ixBug: normalizeIxBug(item.ixBug, ixBug),
      _source: item._source || 'view',
    }));
  } else if (caseData && typeof caseData === 'object') {
    caseData = withUserStory({ ...caseData, ixBug: normalizeIxBug(caseData.ixBug, ixBug), _source: 'view' });
  }
  return jsonResult({ case: caseData, raw: resp });
}

async function handleSearchCases({ q, cols }) {
  const colString = columnsWithDefaults(cols);
  const resp = await fbCall({ cmd: 'search', q, cols: colString });
  let list = resp?.cases?.case || [];
  if (!Array.isArray(list)) list = list ? [list] : [];
  const normalized = list.map((item) => withUserStory({ ...item, ixBug: normalizeIxBug(item.ixBug, null) }));
  return jsonResult({ cases: normalized, raw: resp });
}

async function handleCaseEvents({ q, cols }) {
  const baseCols = columnsWithDefaults(cols);
  const colSet = new Set(baseCols.split(',').map((c) => c.trim()).filter(Boolean));
  colSet.add('events');
  const colString = Array.from(colSet).join(',');
  const resp = await fbCall({ cmd: 'search', q, cols: colString });
  let list = resp?.cases?.case || [];
  if (!Array.isArray(list)) list = list ? [list] : [];
  const normalized = list.map((item) => withUserStory({ ...item, ixBug: normalizeIxBug(item.ixBug, null) }));
  return jsonResult({ cases: normalized, raw: resp });
}

async function handleCreateCase(args) {
  let categoryValue;
  if (args.category !== undefined && args.category !== null && String(args.category).trim() !== '') {
    if (Number.isInteger(args.category)) {
      categoryValue = args.category;
    } else if (!Number.isNaN(Number.parseInt(args.category, 10))) {
      categoryValue = Number.parseInt(args.category, 10);
    } else {
      throw new Error('Unknown category value. Provide numeric FogBugz category id.');
    }
  }

  const userStoryValue = args.userStory ?? args['21_UserStory'];
  const payload = {
    cmd: 'new',
    sTitle: args.title,
    sEvent: args.event || 'Created via MCP',
    ixProject: String(args.ixProject),
    ...(args.ixArea ? { ixArea: String(args.ixArea) } : {}),
    ...(args.ixPersonAssignedTo ? { ixPersonAssignedTo: String(args.ixPersonAssignedTo) } : {}),
    ...(args.ixBugParent ? { ixBugParent: String(args.ixBugParent) } : {}),
    ...(args.ixFixFor ? { ixFixFor: String(args.ixFixFor) } : {}),
    ...(categoryValue !== undefined ? { ixCategory: String(categoryValue) } : {}),
    ...(userStoryValue ? { [USER_STORY_FIELD]: String(userStoryValue) } : {}),
  };

  const resp = await fbCall(payload);
  return jsonResult({ ixBug: Number(resp?.case?.ixBug), raw: resp });
}

async function handleEditCase({ ixBug, event, fields, title, userStory, '21_UserStory': legacyUserStory }) {
  const payload = { cmd: 'edit', ixBug: String(ixBug) };
  if (event) payload.sEvent = event;
  if (title) payload.sTitle = title;
  const finalStory = userStory ?? legacyUserStory;
  if (finalStory) payload[USER_STORY_FIELD] = finalStory;
  if (fields) for (const [k, v] of Object.entries(fields)) payload[k] = String(v);
  const resp = await fbCall(payload);
  return jsonResult(resp);
}

async function handleComment({ ixBug, text }) {
  const resp = await fbCall({ cmd: 'edit', ixBug: String(ixBug), sEvent: text });
  return jsonResult(resp);
}

async function handleAttach({ ixBug, filename, contentBase64 }) {
  const buf = Buffer.from(contentBase64, 'base64');
  const files = new FormData();
  files.append('cmd', 'attach');
  files.append('ixBug', String(ixBug));
  files.append('File1', buf, { filename });
  const resp = await fbCall({}, files);
  return jsonResult(resp);
}

async function handleChildren({ ixBug }) {
  try {
    const resp = await fbCall({ cmd: 'view', ixBug: String(ixBug), cols: 'ixBugChildren' });
    const childField = resp?.case?.ixBugChildren;
    if (childField) {
      const raw = Array.isArray(childField) ? childField : String(childField);
      const ids = Array.isArray(raw) ? raw : String(raw).trim().split(/\s+/).filter(Boolean);
      return jsonResult({ parent: ixBug, children: ids.map((id) => ({ ixBug: Number(id) })) });
    }
  } catch {
    // fallthrough to search approach below
  }
  const r2 = await fbCall({ cmd: 'search', q: `parent:${ixBug}`, cols: 'ixBug,sTitle,sStatus,ixPersonAssignedTo,dtLastUpdated' });
  let list = r2?.cases?.case || [];
  if (!Array.isArray(list)) list = list ? [list] : [];
  const children = list.map((c) => ({
    ixBug: normalizeIxBug(c.ixBug, null),
    sTitle: c.sTitle,
    sStatus: c.sStatus,
    ixPersonAssignedTo: c.ixPersonAssignedTo,
    dtLastUpdated: c.dtLastUpdated,
  }));
  return jsonResult({ parent: ixBug, children });
}

async function handleCaseOutline({ ixBug, cols }) {
  const colString = columnsWithDefaults(cols);
  const resp = await fbCall({ cmd: 'search', sSearchFor: `outline:${ixBug}`, cols: colString });
  let cases = resp?.cases?.case || [];
  if (!Array.isArray(cases)) cases = cases ? [cases] : [];
  const nodesById = new Map();

  for (const item of cases) {
    const id = normalizeIxBug(item?.ixBug, null);
    if (id === null) continue;
    const parentId = normalizeIxBug(item?.ixBugParent, null);
    nodesById.set(id, {
      ixBug: id,
      ixBugParent: parentId,
      sTitle: item?.sTitle ?? '',
      sStatus: item?.sStatus ?? '',
      sPersonAssignedTo: item?.sPersonAssignedTo ?? '',
      dtLastUpdated: item?.dtLastUpdated ?? '',
      sProject: item?.sProject,
      sArea: item?.sArea,
      children: [],
    });
  }

  nodesById.forEach((node) => {
    if (node.ixBugParent && nodesById.has(node.ixBugParent)) {
      nodesById.get(node.ixBugParent).children.push(node);
    }
  });

  const forest = [];
  nodesById.forEach((node) => {
    if (!node.ixBugParent || !nodesById.has(node.ixBugParent)) forest.push(node);
  });

  const outlineRoot = nodesById.get(ixBug) || forest[0] || null;

  return jsonResult({
    query: `outline:${ixBug}`,
    outline: outlineRoot,
    forest,
    total: nodesById.size,
    raw: resp,
  });
}

async function handleResolve({ ixBug, comment, fields }) {
  const payload = { cmd: 'resolve', ixBug: String(ixBug) };
  if (comment) payload.sEvent = comment;
  if (fields) for (const [k, v] of Object.entries(fields)) payload[k] = String(v);
  const resp = await fbCall(payload);
  return jsonResult({ ok: true, raw: resp });
}

async function handleReactivate({ ixBug, comment, fields }) {
  const payload = { cmd: 'reactivate', ixBug: String(ixBug) };
  if (comment) payload.sEvent = comment;
  if (fields) for (const [k, v] of Object.entries(fields)) payload[k] = String(v);
  const resp = await fbCall(payload);
  return jsonResult({ ok: true, raw: resp });
}

async function handleListCategories() {
  const resp = await fbCall({ cmd: 'listCategories' });
  let list = resp?.categories?.category || [];
  if (!Array.isArray(list)) list = list ? [list] : [];
  const normalized = list.map((cat) => ({ ...cat, ixCategory: Number(cat.ixCategory) }));
  return jsonResult({ categories: normalized, raw: resp });
}

async function handleListAreas({ ixProject }) {
  const payload = { cmd: 'listAreas', ...(ixProject ? { ixProject: String(ixProject) } : {}) };
  const resp = await fbCall(payload);
  let list = resp?.areas?.area || [];
  if (!Array.isArray(list)) list = list ? [list] : [];
  const normalized = list.map((area) => ({
    ...area,
    ixArea: Number(area.ixArea),
    ixProject: area.ixProject !== undefined ? Number(area.ixProject) : undefined,
  }));
  return jsonResult({ areas: normalized, raw: resp });
}

function collectCustomFieldNames(source, bucket) {
  if (!source) return;
  if (Array.isArray(source)) {
    source.forEach((item) => collectCustomFieldNames(item, bucket));
    return;
  }
  if (typeof source === 'string') {
    if (source.trim()) bucket.add(source.trim());
    return;
  }
  if (typeof source !== 'object') return;

  const possibleName = source.fieldname || source.name || source.Title || source.title;
  if (possibleName) bucket.add(String(possibleName));

  for (const value of Object.values(source)) {
    if (value && typeof value === 'object') collectCustomFieldNames(value, bucket);
  }
}

async function handleListCustomFields({ ixBug }) {
  const resp = await fbCall({ cmd: 'search', q: String(ixBug), cols: 'plugin_customfield,plugin_customfields' });
  let cases = resp?.cases?.case || [];
  if (!Array.isArray(cases)) cases = cases ? [cases] : [];
  const target = cases.find((item) => Number(item?.ixBug) === Number(ixBug)) || cases[0];
  const names = new Set();
  if (target) {
    collectCustomFieldNames(target.plugin_customfields, names);
    collectCustomFieldNames(target.plugin_customfield, names);
  }
  return jsonResult({ ixBug, customFields: Array.from(names), rawCount: names.size });
}

async function handleCaseLink({ ixBug }) {
  if (!WEB_BASE) throw new Error('FOGBUGZ_BASE must be set to derive the web link.');
  const base = WEB_BASE.replace(/\/$/, '');
  const url = `${base}/f/cases/${ixBug}/`;
  return jsonResult({ ixBug, url });
}

const instructions = 'Use tools/list to explore available FogBugz actions or call help for guidance.';
const mcpServer = new McpServer({ name: 'fogbugz-mcp', version: '1.0.0' }, { instructions });

const noopSchema = {};
const searchSchema = { q: z.string(), cols: z.string().optional() };
const viewSchema = { ixBug: z.number().int(), cols: z.string().optional() };
const createSchema = {
  title: z.string(),
  event: z.string().optional(),
  ixProject: z.number().int(),
  ixArea: z.number().int().optional(),
  ixPersonAssignedTo: z.number().int().optional(),
  ixBugParent: z.number().int().optional(),
  ixFixFor: z.number().int().optional(),
  category: z.union([z.string(), z.number()]).optional(),
  userStory: z.string().optional(),
  '21_UserStory': z.string().optional(),
};
const editSchema = {
  ixBug: z.number().int(),
  event: z.string().optional(),
  fields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  title: z.string().optional(),
  userStory: z.string().optional(),
  '21_UserStory': z.string().optional(),
};
const commentSchema = { ixBug: z.number().int(), text: z.string() };
const attachSchema = { ixBug: z.number().int(), filename: z.string(), contentBase64: z.string() };
const singleIxBugSchema = { ixBug: z.number().int() };
const optionalFieldsSchema = {
  ixBug: z.number().int(),
  comment: z.string().optional(),
  fields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
};
const listAreasSchema = { ixProject: z.number().int().optional() };
const listCustomFieldSchema = { ixBug: z.number().int() };

function registerTool(name, description, schemaShape, handler) {
  mcpServer.registerTool(
    name,
    {
      title: name,
      description,
      inputSchema: schemaShape,
    },
    async (args) => handler(args),
  );
}

mcpServer.resource(
  'help',
  'help',
  { description: 'FogBugz MCP help', mimeType: 'text/markdown' },
  async () => ({ contents: [{ uri: 'help', mimeType: 'text/markdown', text: loadHelpMarkdown() }] }),
);

registerTool('help', 'Explain how to configure and use the FogBugz MCP tools.', noopSchema, async () => jsonResult(loadHelpMarkdown()));

registerTool('search_cases', 'Search FogBugz cases (q supports FogBugz query syntax).', searchSchema, handleSearchCases);
registerTool(
  'case_events',
  'Search cases and include full event history (can return large payloads). See FogBugz event codes: https://support.fogbugz.com/article/55756-fogbugz-xml-api-event-codes',
  searchSchema,
  handleCaseEvents,
);

registerTool('view_case', 'View a specific case with selected columns. Adds ixBug automatically.', viewSchema, handleViewCase);

registerTool('create_case', 'Create a new FogBugz case.', createSchema, handleCreateCase);

registerTool('edit_case', 'Edit a FogBugz case (fields mirror FogBugz XML names).', editSchema, handleEditCase);

registerTool('add_comment', 'Add a comment to a case.', commentSchema, handleComment);

registerTool('attach_file', 'Attach a base64-encoded file to a case.', attachSchema, handleAttach);

registerTool('list_children', 'List child cases of a parent.', singleIxBugSchema, handleChildren);
registerTool('case_outline', 'Return the full outline/descendant tree for a case (outline:<ixBug>).', viewSchema, handleCaseOutline);

registerTool('resolve_case', 'Resolve a case (optional comment/fields).', optionalFieldsSchema, handleResolve);

registerTool('reactivate_case', 'Reactivate (reopen) a case (optional comment/fields).', optionalFieldsSchema, handleReactivate);
registerTool('list_categories', 'List FogBugz categories (ixCategory + metadata).', noopSchema, handleListCategories);
registerTool('list_areas', 'List FogBugz areas (optionally filtered by project).', listAreasSchema, handleListAreas);
registerTool('list_custom_fields', 'List custom field names available on a case.', listCustomFieldSchema, handleListCustomFields);
registerTool('case_link', 'Return the FogBugz web URL for a case.', singleIxBugSchema, handleCaseLink);

async function start() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logDebug('MCP server is running', { transport: 'stdio' });
}

start().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
