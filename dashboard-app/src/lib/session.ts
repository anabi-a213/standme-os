export function getSessionId(): string {
  let id = localStorage.getItem('standme_session_id');
  if (!id) {
    id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('standme_session_id', id);
  }
  return id;
}

export function clearSessionId(): void {
  localStorage.removeItem('standme_session_id');
}
