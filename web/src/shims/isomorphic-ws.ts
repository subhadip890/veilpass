const ws =
  typeof WebSocket !== 'undefined'
    ? WebSocket
    : typeof window !== 'undefined'
    ? window.WebSocket
    : null;

export default ws;
export { ws as WebSocket };
