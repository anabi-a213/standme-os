import axios, { AxiosInstance } from 'axios';
import { retry } from '../../utils/retry';
import { TRELLO_CONFIG } from '../../config/trello';

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
  return retry(async () => {
    const resp = await getTrelloClient().post('/cards', {
      idList: listId,
      name,
      desc,
      due,
    });
    return resp.data;
  }, 'createCard');
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

// ---- Helper: get all cards with list names ----

export async function getBoardCardsWithListNames(boardId: string): Promise<TrelloCard[]> {
  const [lists, cards] = await Promise.all([
    getBoardLists(boardId),
    getBoardCards(boardId),
  ]);

  const listMap = new Map(lists.map(l => [l.id, l.name]));

  return cards.map(card => ({
    ...card,
    listName: listMap.get(card.idList) || 'Unknown',
  }));
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
