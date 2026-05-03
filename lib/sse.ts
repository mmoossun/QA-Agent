/**
 * In-process SSE emitter — single-server pub/sub for board real-time updates.
 * For multi-server deployments, replace with Redis pub/sub.
 */
type Listener = (data: string) => void;
const channels = new Map<string, Set<Listener>>();

export function sseSubscribe(boardId: string, fn: Listener): () => void {
  if (!channels.has(boardId)) channels.set(boardId, new Set());
  channels.get(boardId)!.add(fn);
  return () => channels.get(boardId)?.delete(fn);
}

export function sseEmit(boardId: string, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  channels.get(boardId)?.forEach(fn => fn(payload));
}
