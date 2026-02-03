#!/usr/bin/env node
// FogBugz MCP server implemented via @modelcontextprotocol/sdk

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { marked } from 'marked';
import { request } from 'undici';
import { parseStringPromise } from 'xml2js';
import FormData from 'form-data';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FOGBUGZ_BASE = process.env.FOGBUGZ_BASE || 'https://<YOUR>.fogbugz.com/api.asp';
const FOGBUGZ_TOKEN = process.env.FOGBUGZ_TOKEN || '7m5anarttjnu5o8gokr13hguod9q68';
const HELP_DOC_URL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'docs',
  'fogbugz-help.md',
);
const DEBUG = process.env.FOGBUGZ_MCP_DEBUG === '1';
const LOG_FILE = process.env.FOGBUGZ_MCP_LOG_FILE;
const WEB_BASE = (FOGBUGZ_BASE || '').replace(/\/api\.asp.*$/i, '').replace(/\/$/, '');
const PACKAGE_JSON_URL = new URL('./package.json', import.meta.url);

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
const PEOPLE_CACHE_TTL_MS = 5 * 60 * 1000;

let peopleCache = {
  asof: null,
  expiresAt: 0,
  people: null,
};

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

function normalizeId(value, fallback) {
  if (Array.isArray(value)) return Number(value[0] ?? fallback ?? null);
  if (value === undefined || value === null) return fallback ?? null;
  const num = Number(value);
  return Number.isNaN(num) ? fallback ?? null : num;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isIsoDateLike(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return true;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return true;
  return false;
}

function parseDateOrThrow(value, fieldName) {
  if (!isIsoDateLike(value)) {
    throw new Error(
      `${fieldName} must be an ISO 8601 date (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:MM:SSZ). ` +
        `Received: "${value}".`,
    );
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${fieldName} could not be parsed as a valid date. Received: "${value}".`);
  }
  return parsed;
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

function normalizePeopleList(list) {
  if (!Array.isArray(list)) return list ? [list] : [];
  return list;
}

function formatCacheTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function matchesPerson(person, needle) {
  if (!needle) return true;
  const haystackFields = [
    person?.sFullName,
    person?.sEmail,
    person?.sName,
    person?.sPerson,
    person?.sFirstName,
    person?.sLastName,
    person?.sUsername,
    person?.sLogin,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase());

  return haystackFields.some((value) => value.includes(needle));
}

async function listPeopleCached({ forceRefresh }) {
  const now = Date.now();
  if (!forceRefresh && peopleCache.people && peopleCache.expiresAt > now) {
    return {
      people: peopleCache.people,
      asof: peopleCache.asof,
      expiresAt: peopleCache.expiresAt,
      fromCache: true,
    };
  }

  if (forceRefresh) {
    peopleCache = { asof: null, expiresAt: 0, people: null };
  }

  const resp = await fbCall({ cmd: 'listPeople' });
  const list = normalizePeopleList(resp?.people?.person);
  const normalized = list.map((person) => ({
    ...person,
    ixPerson: normalizeId(person?.ixPerson, null),
  }));
  const asof = new Date().toISOString();
  const expiresAt = Date.now() + PEOPLE_CACHE_TTL_MS;

  peopleCache = {
    asof,
    expiresAt,
    people: normalized,
  };

  return { people: normalized, asof, expiresAt, fromCache: false };
}

function loadPackageVersion() {
  try {
    const raw = fs.readFileSync(PACKAGE_JSON_URL, 'utf8');
    const pkg = JSON.parse(raw);
    return {
      name: pkg?.name ?? 'fogbugz-mcp',
      version: pkg?.version ?? 'unknown',
    };
  } catch (err) {
    return { name: 'fogbugz-mcp', version: 'unknown', error: err?.message };
  }
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

function addColumn(cols, column) {
  const set = new Set(
    cols
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  set.add(column);
  return Array.from(set).join(',');
}

function applyTextTypeToEvent({ textType, eventText, fields }) {
  const resolvedTextType = textType ?? 'plain';
  let finalEventText = eventText;
  let finalFields = fields;
  if (resolvedTextType === 'markdown') {
    if (finalEventText) finalEventText = marked.parse(String(finalEventText));
    if (finalFields && Object.prototype.hasOwnProperty.call(finalFields, 'sEvent')) {
      finalFields = { ...finalFields, sEvent: marked.parse(String(finalFields.sEvent)) };
    }
  }
  return { resolvedTextType, eventText: finalEventText, fields: finalFields };
}

function buildAttachmentDownloadUrl(sUrl, { baseUrl = WEB_BASE, token = FOGBUGZ_TOKEN } = {}) {
  if (!sUrl) return sUrl;
  const cleaned = String(sUrl).replace(/&amp;/g, '&');
  if (!baseUrl) return cleaned;
  let url;
  try {
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    url = new URL(cleaned, normalizedBase);
  } catch {
    return cleaned;
  }
  url.searchParams.delete('sTicket');
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

function normalizeEventList(events) {
  if (!events) return [];
  if (Array.isArray(events)) return events;
  if (events.event) return Array.isArray(events.event) ? events.event : [events.event];
  return [events];
}

function normalizeAttachmentList(container) {
  if (!container) return [];
  const list = container.attachment ?? container;
  if (!list) return [];
  return Array.isArray(list) ? list : [list];
}

function updateAttachmentUrlsInEvent(event, options) {
  if (!event || typeof event !== 'object') return;
  for (const key of ['rgAttachments', 'attachments']) {
    const container = event[key];
    if (!container) continue;
    const attachments = normalizeAttachmentList(container);
    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== 'object') continue;
      const updated = buildAttachmentDownloadUrl(attachment.sURL, options);
      if (updated) attachment.sURL = updated;
    }
  }
}

function updateAttachmentUrlsInEvents(events, options) {
  const list = normalizeEventList(events);
  list.forEach((event) => updateAttachmentUrlsInEvent(event, options));
}

function updateAttachmentUrlsInCase(caseData, options) {
  if (!caseData) return;
  if (Array.isArray(caseData)) {
    caseData.forEach((item) => updateAttachmentUrlsInCase(item, options));
    return;
  }
  updateAttachmentUrlsInEvents(caseData.events, options);
}

function cloneJson(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function resolveCategoryValue(category) {
  if (category === undefined || category === null || String(category).trim() === '') return undefined;
  if (Number.isInteger(category)) return category;
  const parsed = Number.parseInt(category, 10);
  if (!Number.isNaN(parsed)) return parsed;
  throw new Error('Unknown category value. Provide numeric FogBugz category id.');
}

function buildCreateCasePayload(args) {
  const categoryValue = resolveCategoryValue(args.category);
  const userStoryValue = args.userStory ?? args['21_UserStory'];
  const { resolvedTextType, eventText } = applyTextTypeToEvent({
    textType: args.textType,
    eventText: args.event || 'Created via MCP',
  });
  const payload = {
    cmd: 'new',
    sTitle: args.title,
    sEvent: eventText,
    ixProject: String(args.ixProject),
    ...(args.ixArea ? { ixArea: String(args.ixArea) } : {}),
    ...(args.ixPersonAssignedTo ? { ixPersonAssignedTo: String(args.ixPersonAssignedTo) } : {}),
    ...(args.ixBugParent ? { ixBugParent: String(args.ixBugParent) } : {}),
    ...(args.ixFixFor ? { ixFixFor: String(args.ixFixFor) } : {}),
    ...(categoryValue !== undefined ? { ixCategory: String(categoryValue) } : {}),
    ...(userStoryValue ? { [USER_STORY_FIELD]: String(userStoryValue) } : {}),
  };
  if (resolvedTextType !== 'plain') payload.fRichText = '1';
  return payload;
}

function buildEventPayload({ cmd, ixBug, eventText, fields, textType }) {
  const { resolvedTextType, eventText: finalEventText, fields: finalFields } = applyTextTypeToEvent({
    textType,
    eventText,
    fields,
  });
  const payload = { cmd, ixBug: String(ixBug) };
  if (finalEventText) payload.sEvent = finalEventText;
  if (finalFields) for (const [k, v] of Object.entries(finalFields)) payload[k] = String(v);
  if (resolvedTextType !== 'plain') payload.fRichText = '1';
  return payload;
}

async function handleViewCase({ ixBug, cols, includeAttachments }) {
  let colString = columnsWithDefaults(cols);
  if (includeAttachments) colString = addColumn(colString, 'events');
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
  if (includeAttachments) {
    caseData = cloneJson(caseData);
    updateAttachmentUrlsInCase(caseData, { baseUrl: WEB_BASE, token: FOGBUGZ_TOKEN });
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
  const payload = buildCreateCasePayload(args);
  const resp = await fbCall(payload);
  return jsonResult({ ixBug: Number(resp?.case?.ixBug), raw: resp });
}

async function handleEditCase({
  ixBug,
  event,
  fields,
  title,
  userStory,
  '21_UserStory': legacyUserStory,
  textType,
}) {
  const { resolvedTextType, eventText, fields: finalFields } = applyTextTypeToEvent({
    textType,
    eventText: event,
    fields,
  });
  const payload = { cmd: 'edit', ixBug: String(ixBug) };
  if (eventText) payload.sEvent = eventText;
  if (title) payload.sTitle = title;
  const finalStory = userStory ?? legacyUserStory;
  if (finalStory) payload[USER_STORY_FIELD] = finalStory;
  if (finalFields) for (const [k, v] of Object.entries(finalFields)) payload[k] = String(v);
  if (resolvedTextType !== 'plain') payload.fRichText = '1';
  const resp = await fbCall(payload);
  return jsonResult(resp);
}

async function handleComment({ ixBug, text, textType }) {
  const payload = buildEventPayload({
    cmd: 'edit',
    ixBug,
    eventText: text,
    textType,
  });
  const resp = await fbCall(payload);
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

async function handleResolve({ ixBug, comment, fields, textType }) {
  const payload = buildEventPayload({
    cmd: 'resolve',
    ixBug,
    eventText: comment,
    fields,
    textType,
  });
  const resp = await fbCall(payload);
  return jsonResult({ ok: true, raw: resp });
}

async function handleReactivate({ ixBug, comment, fields, textType }) {
  const payload = buildEventPayload({
    cmd: 'reactivate',
    ixBug,
    eventText: comment,
    fields,
    textType,
  });
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

async function handleListStatus({ ixCategory, fResolved }) {
  const payload = {
    cmd: 'listStatus',
    ...(ixCategory ? { ixCategory: String(ixCategory) } : {}),
    ...(fResolved !== undefined ? { fResolved: fResolved ? '1' : '0' } : {}),
  };
  const resp = await fbCall(payload);
  let list = resp?.statuses?.status || [];
  if (!Array.isArray(list)) list = list ? [list] : [];
  const normalized = list.map((status) => ({
    ...status,
    ixStatus: normalizeId(status.ixStatus, null),
    ixCategory: status.ixCategory !== undefined ? normalizeId(status.ixCategory, null) : undefined,
  }));
  return jsonResult({ statuses: normalized, raw: resp });
}

async function handleViewStatus({ ixStatus, sStatus, ixCategory }) {
  if (ixStatus && (sStatus || ixCategory)) {
    throw new Error('view_status: provide either ixStatus OR (sStatus + ixCategory), not both.');
  }
  if (!ixStatus && !(sStatus && ixCategory)) {
    throw new Error('view_status requires ixStatus or (sStatus and ixCategory).');
  }
  const payload = {
    cmd: 'viewStatus',
    ...(ixStatus ? { ixStatus: String(ixStatus) } : {}),
    ...(sStatus ? { sStatus } : {}),
    ...(ixCategory ? { ixCategory: String(ixCategory) } : {}),
  };
  const resp = await fbCall(payload);
  const status = resp?.status
    ? {
        ...resp.status,
        ixStatus: normalizeId(resp.status?.ixStatus, ixStatus ?? null),
        ixCategory: resp.status?.ixCategory !== undefined ? normalizeId(resp.status?.ixCategory, ixCategory ?? null) : undefined,
      }
    : null;
  return jsonResult({ status, raw: resp });
}

async function handleListMilestones({ ixProject }) {
  if (ixProject !== undefined && ixProject <= 0) {
    throw new Error('list_milestones: ixProject must be a positive integer when provided.');
  }
  const payload = { cmd: 'listFixFors', ...(ixProject ? { ixProject: String(ixProject) } : {}) };
  const resp = await fbCall(payload);
  let list = resp?.fixfors?.fixfor || [];
  if (!Array.isArray(list)) list = list ? [list] : [];
  const normalized = list.map((fixfor) => ({
    ...fixfor,
    ixFixFor: normalizeId(fixfor.ixFixFor, null),
    ixProject: fixfor.ixProject !== undefined ? normalizeId(fixfor.ixProject, null) : undefined,
  }));
  return jsonResult({ milestones: normalized, raw: resp });
}

async function handleViewMilestone({ ixFixFor }) {
  const resp = await fbCall({ cmd: 'viewFixFor', ixFixFor: String(ixFixFor) });
  const fixfor = resp?.fixfor
    ? {
        ...resp.fixfor,
        ixFixFor: normalizeId(resp.fixfor?.ixFixFor, ixFixFor),
        ixProject: resp.fixfor?.ixProject !== undefined ? normalizeId(resp.fixfor?.ixProject, null) : undefined,
      }
    : null;
  return jsonResult({ milestone: fixfor, raw: resp });
}

async function handleCreateMilestone({ ixProject, sFixFor, dtStart, dtEnd }) {
  if (ixProject <= 0) {
    throw new Error('create_milestone: ixProject must be a positive integer.');
  }
  if (isBlank(sFixFor)) {
    throw new Error('create_milestone: sFixFor (milestone name) cannot be blank.');
  }
  if (dtStart !== undefined && isBlank(dtStart)) {
    throw new Error('create_milestone: dtStart cannot be blank when provided.');
  }
  if (dtEnd !== undefined && isBlank(dtEnd)) {
    throw new Error('create_milestone: dtEnd cannot be blank when provided.');
  }
  const startMs = dtStart ? parseDateOrThrow(dtStart, 'dtStart') : null;
  const endMs = dtEnd ? parseDateOrThrow(dtEnd, 'dtEnd') : null;
  if (startMs !== null && endMs !== null && endMs < startMs) {
    throw new Error('create_milestone: dtEnd must be the same day or after dtStart.');
  }
  const payload = {
    cmd: 'newFixFor',
    ixProject: String(ixProject),
    sFixFor,
    ...(dtStart ? { dtStart } : {}),
    ...(dtEnd ? { dtEnd } : {}),
  };
  const resp = await fbCall(payload);
  const ixFixFor = normalizeId(resp?.fixfor?.ixFixFor ?? resp?.ixFixFor, null);
  return jsonResult({ ixFixFor, raw: resp });
}

async function handleEditMilestone({
  ixFixFor,
  ixProject,
  sFixFor,
  dtStart,
  dtEnd,
  fAssignable,
  fDeleted,
  confirmDelete,
}) {
  const hasEdit =
    ixProject !== undefined ||
    sFixFor !== undefined ||
    dtStart !== undefined ||
    dtEnd !== undefined ||
    fAssignable !== undefined ||
    fDeleted !== undefined;
  if (!hasEdit) {
    throw new Error(
      'edit_milestone requires at least one field to update (ixProject, sFixFor, dtStart, dtEnd, fAssignable, fDeleted).',
    );
  }
  if (fDeleted === true && confirmDelete !== true) {
    throw new Error(
      'edit_milestone: set confirmDelete=true to delete a milestone (fDeleted=true). This prevents accidental deletes.',
    );
  }
  if (ixProject !== undefined && ixProject <= 0) {
    throw new Error('edit_milestone: ixProject must be a positive integer when provided.');
  }
  if (sFixFor !== undefined && isBlank(sFixFor)) {
    throw new Error('edit_milestone: sFixFor cannot be blank when provided.');
  }
  if (dtStart !== undefined && isBlank(dtStart)) {
    throw new Error('edit_milestone: dtStart cannot be blank when provided.');
  }
  if (dtEnd !== undefined && isBlank(dtEnd)) {
    throw new Error('edit_milestone: dtEnd cannot be blank when provided.');
  }
  const startMs = dtStart ? parseDateOrThrow(dtStart, 'dtStart') : null;
  const endMs = dtEnd ? parseDateOrThrow(dtEnd, 'dtEnd') : null;
  if (startMs !== null && endMs !== null && endMs < startMs) {
    throw new Error('edit_milestone: dtEnd must be the same day or after dtStart.');
  }
  const payload = {
    cmd: 'editFixFor',
    ixFixFor: String(ixFixFor),
    ...(ixProject ? { ixProject: String(ixProject) } : {}),
    ...(sFixFor ? { sFixFor } : {}),
    ...(dtStart ? { dtStart } : {}),
    ...(dtEnd ? { dtEnd } : {}),
    ...(fAssignable !== undefined ? { fAssignable: fAssignable ? '1' : '0' } : {}),
    ...(fDeleted !== undefined ? { fDeleted: fDeleted ? '1' : '0' } : {}),
  };
  const resp = await fbCall(payload);
  return jsonResult(resp);
}

async function handleAddMilestoneDependency({ ixFixFor, ixFixForDependsOn }) {
  if (ixFixFor === ixFixForDependsOn) {
    throw new Error('add_milestone_dependency: ixFixFor and ixFixForDependsOn must be different milestones.');
  }
  const resp = await fbCall({
    cmd: 'addFixForDependency',
    ixFixFor: String(ixFixFor),
    ixFixForDependsOn: String(ixFixForDependsOn),
  });
  return jsonResult(resp);
}

async function handleRemoveMilestoneDependency({ ixFixFor, ixFixForDependsOn }) {
  if (ixFixFor === ixFixForDependsOn) {
    throw new Error('remove_milestone_dependency: ixFixFor and ixFixForDependsOn must be different milestones.');
  }
  const resp = await fbCall({
    cmd: 'deleteFixForDependency',
    ixFixFor: String(ixFixFor),
    ixFixForDependsOn: String(ixFixForDependsOn),
  });
  return jsonResult(resp);
}

async function handleCreateArea({ ixProject, sArea, ixPersonPrimaryContact }) {
  if (ixProject <= 0) {
    throw new Error('create_area: ixProject must be a positive integer.');
  }
  if (isBlank(sArea)) {
    throw new Error('create_area: sArea (area name) cannot be blank.');
  }
  const payload = {
    cmd: 'newArea',
    ixProject: String(ixProject),
    sArea,
    ...(ixPersonPrimaryContact !== undefined ? { ixPersonPrimaryContact: String(ixPersonPrimaryContact) } : {}),
  };
  const resp = await fbCall(payload);
  const ixArea = normalizeId(resp?.area?.ixArea ?? resp?.ixArea, null);
  return jsonResult({ ixArea, raw: resp });
}

async function handleEditArea({ ixArea, sArea, ixProject, ixPersonPrimaryContact }) {
  const hasEdit = sArea !== undefined || ixProject !== undefined || ixPersonPrimaryContact !== undefined;
  if (!hasEdit) {
    throw new Error(
      'edit_area requires at least one field to update (sArea, ixProject, ixPersonPrimaryContact).',
    );
  }
  if (sArea !== undefined && isBlank(sArea)) {
    throw new Error('edit_area: sArea cannot be blank when provided.');
  }
  if (ixProject !== undefined && ixProject <= 0) {
    throw new Error('edit_area: ixProject must be a positive integer when provided.');
  }
  const payload = {
    cmd: 'editArea',
    ixArea: String(ixArea),
    ...(sArea ? { sArea } : {}),
    ...(ixProject ? { ixProject: String(ixProject) } : {}),
    ...(ixPersonPrimaryContact !== undefined ? { ixPersonPrimaryContact: String(ixPersonPrimaryContact) } : {}),
  };
  const resp = await fbCall(payload);
  return jsonResult(resp);
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

async function handleSearchUsers({ query, forceRefresh }) {
  if (query !== undefined && isBlank(query)) {
    throw new Error('search_users: query cannot be blank when provided.');
  }

  const { people, asof, expiresAt, fromCache } = await listPeopleCached({ forceRefresh });
  const needle = query ? String(query).trim().toLowerCase() : '';
  const matches = needle ? people.filter((person) => matchesPerson(person, needle)) : people;

  return jsonResult({
    query: query ?? null,
    match: needle ? 'contains' : 'all',
    asof,
    cache: {
      asof,
      expiresAt: formatCacheTimestamp(expiresAt),
      ttlSeconds: Math.floor(PEOPLE_CACHE_TTL_MS / 1000),
      fromCache,
      forcedRefresh: Boolean(forceRefresh),
    },
    count: matches.length,
    total: people.length,
    people: matches,
  });
}

async function handleVersion() {
  const pkg = loadPackageVersion();
  return jsonResult({ name: pkg.name, version: pkg.version });
}

async function handleHealth() {
  const warnings = [];
  const baseEnv = process.env.FOGBUGZ_BASE;
  const tokenEnv = process.env.FOGBUGZ_TOKEN;

  if (!baseEnv) warnings.push('FOGBUGZ_BASE is not set.');
  if (!tokenEnv) warnings.push('FOGBUGZ_TOKEN is not set.');
  if (FOGBUGZ_BASE.includes('<YOUR>')) warnings.push('FOGBUGZ_BASE is still using the placeholder value.');
  if (tokenEnv && tokenEnv.trim().length < 10) warnings.push('FOGBUGZ_TOKEN looks too short; check the value.');

  if (warnings.length > 0) {
    return jsonResult({
      ok: false,
      warnings,
      hint: 'Set FOGBUGZ_BASE/FOGBUGZ_TOKEN in your environment and restart the MCP server.',
    });
  }

  try {
    const started = Date.now();
    const resp = await fbCall({ cmd: 'listCategories' });
    const elapsedMs = Date.now() - started;
    const count = resp?.categories?.category
      ? Array.isArray(resp.categories.category)
        ? resp.categories.category.length
        : 1
      : 0;

    return jsonResult({
      ok: true,
      api: 'listCategories',
      categories: count,
      elapsedMs,
    });
  } catch (err) {
    return jsonResult({
      ok: false,
      error: err?.message || 'Unknown error while contacting FogBugz.',
      hint: 'Network unavailable or FogBugz API unreachable. Check connectivity and try again.',
    });
  }
}

const instructions = 'Use tools/list to explore available FogBugz actions or call help for guidance.';
const mcpServer = new McpServer({ name: 'fogbugz-mcp', version: '1.0.2' }, { instructions });

const noopSchema = {};
const searchSchema = { q: z.string(), cols: z.string().optional() };
const viewSchema = {
  ixBug: z.number().int(),
  cols: z.string().optional(),
  includeAttachments: z.boolean().optional(),
};
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
  textType: z.enum(['plain', 'html', 'markdown']).optional(),
};
const editSchema = {
  ixBug: z.number().int(),
  event: z.string().optional(),
  fields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  title: z.string().optional(),
  userStory: z.string().optional(),
  '21_UserStory': z.string().optional(),
  textType: z.enum(['plain', 'html', 'markdown']).optional(),
};
const commentSchema = { ixBug: z.number().int(), text: z.string(), textType: z.enum(['plain', 'html', 'markdown']).optional() };
const attachSchema = { ixBug: z.number().int(), filename: z.string(), contentBase64: z.string() };
const singleIxBugSchema = { ixBug: z.number().int() };
const optionalFieldsSchema = {
  ixBug: z.number().int(),
  comment: z.string().optional(),
  fields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  textType: z.enum(['plain', 'html', 'markdown']).optional(),
};
const listAreasSchema = { ixProject: z.number().int().optional() };
const listStatusSchema = {
  ixCategory: z.number().int().optional(),
  fResolved: z.boolean().optional(),
};
const viewStatusSchema = {
  ixStatus: z.number().int().optional(),
  sStatus: z.string().optional(),
  ixCategory: z.number().int().optional(),
};
const listMilestonesSchema = { ixProject: z.number().int().optional() };
const viewMilestoneSchema = { ixFixFor: z.number().int() };
const createMilestoneSchema = {
  ixProject: z.number().int(),
  sFixFor: z.string(),
  dtStart: z.string().optional(),
  dtEnd: z.string().optional(),
};
const editMilestoneSchema = {
  ixFixFor: z.number().int(),
  ixProject: z.number().int().optional(),
  sFixFor: z.string().optional(),
  dtStart: z.string().optional(),
  dtEnd: z.string().optional(),
  fAssignable: z.boolean().optional(),
  fDeleted: z.boolean().optional(),
  confirmDelete: z.boolean().optional(),
};
const milestoneDependencySchema = {
  ixFixFor: z.number().int(),
  ixFixForDependsOn: z.number().int(),
};
const createAreaSchema = {
  ixProject: z.number().int(),
  sArea: z.string(),
  ixPersonPrimaryContact: z.number().int().optional(),
};
const editAreaSchema = {
  ixArea: z.number().int(),
  sArea: z.string().optional(),
  ixProject: z.number().int().optional(),
  ixPersonPrimaryContact: z.number().int().optional(),
};
const listCustomFieldSchema = { ixBug: z.number().int() };
const searchUsersSchema = {
  query: z.string().optional(),
  forceRefresh: z.boolean().optional(),
};

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
registerTool('version', 'Return the FogBugz MCP server version.', noopSchema, handleVersion);
registerTool('health', 'Check FogBugz MCP configuration and API connectivity.', noopSchema, handleHealth);

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
registerTool(
  'list_status',
  'List FogBugz statuses (optionally filtered by category or resolved state).',
  listStatusSchema,
  handleListStatus,
);
registerTool(
  'view_status',
  'View a specific status (ixStatus or sStatus + ixCategory).',
  viewStatusSchema,
  handleViewStatus,
);
registerTool(
  'list_milestones',
  'List FogBugz milestones (FixFors), optionally filtered by project.',
  listMilestonesSchema,
  handleListMilestones,
);
registerTool('view_milestone', 'View a specific milestone (FixFor).', viewMilestoneSchema, handleViewMilestone);
registerTool('create_milestone', 'Create a new milestone (FixFor).', createMilestoneSchema, handleCreateMilestone);
registerTool('edit_milestone', 'Edit an existing milestone (FixFor).', editMilestoneSchema, handleEditMilestone);
registerTool(
  'add_milestone_dependency',
  'Add a dependency between two milestones (FixFors).',
  milestoneDependencySchema,
  handleAddMilestoneDependency,
);
registerTool(
  'remove_milestone_dependency',
  'Remove a dependency between two milestones (FixFors).',
  milestoneDependencySchema,
  handleRemoveMilestoneDependency,
);
registerTool('create_area', 'Create a new FogBugz area.', createAreaSchema, handleCreateArea);
registerTool('edit_area', 'Edit an existing FogBugz area.', editAreaSchema, handleEditArea);
registerTool('list_custom_fields', 'List custom field names available on a case.', listCustomFieldSchema, handleListCustomFields);
registerTool('case_link', 'Return the FogBugz web URL for a case.', singleIxBugSchema, handleCaseLink);
registerTool(
  'search_users',
  'Search FogBugz people by name/email using a cached listPeople call (contains match).',
  searchUsersSchema,
  handleSearchUsers,
);

async function start() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logDebug('MCP server is running', { transport: 'stdio' });
}

const entryPath = path.resolve(process.argv[1] || '');
const modulePath = path.resolve(fileURLToPath(import.meta.url));
const isMain = entryPath && entryPath === modulePath;

if (isMain) {
  start().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

export {
  applyTextTypeToEvent,
  buildCreateCasePayload,
  buildEventPayload,
  buildAttachmentDownloadUrl,
  updateAttachmentUrlsInCase,
};
