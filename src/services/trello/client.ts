import axios, { AxiosInstance } from 'axios';
import { retry } from '../../utils/retry';
import { TRELLO_CONFIG } from '../../config/trello';
import { logger } from '../../utils/logger';

const boardCache = new Map<string, { data: TrelloCard[]; fetchedAt: number }>();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

// Hard guard: prevent any write operation on read-only boards
function assertWritable(boardEnvKey: string): void {
  if (!TRELLO_CONFIG.writableBoards.includes(boardEnvKey)) {
    throw new Error(`Board "${boardEnvKey}" is read-only. Writes are only allowed on TRELLO_BOARD_SALES_PIPELINE.`);
  }
}

// Resolve env key → board ID
function boardId(envKey: string): string {
  return process.env[envKey] || '';
}

let _client: AxiosInstance | null = null;

function getTrelloClient(): AxiosInstance {
  if (!_client) {
    _client = axios.create({
      baseURL: 'https://api.trello.com/1',
      timeout: 10000,
      params: {
        key: process.env.TRELLO_API_KEY,
        token: process.env.TRELLO_TOKEN,
      },
    });
  }
  return _client;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  listName?: string;
  due: string | null;
  labels: { id: string; name: string; color: string }[];
  url: string;
  dateLastActivity: string;
  customFieldItems?: { idCustomField: string; value: Record<string, string> }[];
}

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

// ---- Board operations ----

export async function getBoardLists(boardId: string): Promise<TrelloList[]> {
  return retry(async () => {
    const resp = await getTrelloClient().get(`/boards/${boardId}/lists`, {
      params: { filter: 'open' },
    });
    return resp.data;
  }, 'getBoardLists');
}

export async function getBoardCards(boardId: string): Promise<TrelloCard[]> {
  return retry(async () => {
    const resp = await getTrelloClient().get(`/boards/${boardId}/cards`, {
      params: { fields: 'name,desc,idList,due,labels,url,dateLastActivity', customFieldItems: 'true' },
    });
    return resp.data;
  }, 'getBoardCards');
}

// ---- Card operations ----

// Only call this for SALES_PIPELINE lists — will throw otherwise
export async function createCard(listId: string, name: string, desc: string, due?: string, boardEnvKey = 'TRELLO_BOARD_SALES_PIPELINE'): Promise<TrelloCard> {
  assertWritable(boardEnvKey);
  const result = await retry(async () => {
    const resp = await getTrelloClient().post('/cards', {
      idList: listId,
      name,
      desc,
      due,
    });
    return resp.data;
  }, 'createCard');
  invalidateBoardCache(process.env.TRELLO_BOARD_SALES_PIPELINE || '');
  return result;
}

export async function addComment(cardId: string, text: string): Promise<void> {
  await retry(async () => {
    await getTrelloClient().post(`/cards/${cardId}/actions/comments`, {
      text,
    });
  }, 'addComment');
}

// Only call this for SALES_PIPELINE cards — will throw otherwise
export async function moveCard(cardId: string, listId: string, boardEnvKey = 'TRELLO_BOARD_SALES_PIPELINE'): Promise<void> {
  assertWritable(boardEnvKey);
  await retry(async () => {
    await getTrelloClient().put(`/cards/${cardId}`, {
      idList: listId,
    });
  }, 'moveCard');
  invalidateBoardCache(process.env.TRELLO_BOARD_SALES_PIPELINE || '');
}

export async function getCard(cardId: string): Promise<TrelloCard> {
  return retry(async () => {
    const resp = await getTrelloClient().get(`/cards/${cardId}`, {
      params: { customFieldItems: 'true' },
    });
    return resp.data;
  }, 'getCard');
}

export async function getListCards(listId: string): Promise<TrelloCard[]> {
  return retry(async () => {
    const resp = await getTrelloClient().get(`/lists/${listId}/cards`);
    return resp.data;
  }, 'getListCards');
}

// ---- Helper: get all cards with list names (cached, 3-min TTL) ----

export async function getBoardCardsWithListNames(
  boardId: string,
  forceRefresh = false,
): Promise<TrelloCard[]> {
  const cached = boardCache.get(boardId);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    logger.info(`[Trello] Cache hit: ${boardId}`);
    return cached.data;
  }

  const [lists, cards] = await Promise.all([
    getBoardLists(boardId),
    getBoardCards(boardId),
  ]);
  const listMap = new Map(lists.map(l => [l.id, l.name]));
  const result = cards.map(card => ({
    ...card,
    listName: listMap.get(card.idList) || 'Unknown',
  }));
  boardCache.set(boardId, { data: result, fetchedAt: Date.now() });
  logger.info(`[Trello] Fetched+cached: ${boardId} (${result.length} cards)`);
  return result;
}

export function invalidateBoardCache(boardId: string): void {
  boardCache.delete(boardId);
  logger.info(`[Trello] Cache cleared: ${boardId}`);
}

// ---- Find list by name ----

export async function findListByName(boardId: string, listName: string): Promise<TrelloList | null> {
  const lists = await getBoardLists(boardId);
  return lists.find(l => l.name.toLowerCase().includes(listName.toLowerCase())) || null;
}

// ---- All 5 boards snapshot (read-only safe) ----

export async function getAllBoardsSnapshot(): Promise<Record<string, TrelloCard[]>> {
  const boards = {
    salesPipeline: process.env.TRELLO_BOARD_SALES_PIPELINE || '',
    sales:         process.env.TRELLO_BOARD_SALES || '',
    design:        process.env.TRELLO_BOARD_DESIGN || '',
    operation:     process.env.TRELLO_BOARD_OPERATION || '',
    production:    process.env.TRELLO_BOARD_PRODUCTION || '',
  };

  const [salesPipeline, sales, design, operation, production] = await Promise.all([
    getBoardCardsWithListNames(boards.salesPipeline),
    getBoardCardsWithListNames(boards.sales),
    getBoardCardsWithListNames(boards.design),
    getBoardCardsWithListNames(boards.operation),
    getBoardCardsWithListNames(boards.production),
  ]);

  return { salesPipeline, sales, design, operation, production };
}
