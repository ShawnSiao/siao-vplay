export type PlaybackIdentity = { sessionId: string; saveSequence: number };
type Session = { view: number; token?: Promise<string>; sequence: number };

export class PlaybackSaveQueue {
  private sessions = new Map<string, Session>();
  private queues = new Map<string, Promise<unknown>>();
  constructor(private begin: (projectId: string) => Promise<string>) {}

  private enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve()).then(operation);
    const settled = result.catch(() => undefined);
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return result;
  }

  activate(id: string, view: number): void {
    const previous = this.sessions.get(id);
    if (previous && previous.view >= view) return;
    const session: Session = { view, sequence: 0 };
    this.sessions.set(id, session);
    session.token = this.enqueue(id, () => this.begin(id));
  }

  save<T>(id: string, view: number, write: (identity: PlaybackIdentity) => Promise<T>): Promise<T | undefined> {
    this.activate(id, view);
    const session = this.sessions.get(id)!;
    if (session.view !== view) return Promise.resolve(undefined);
    return this.enqueue(id, async () => {
      session.token ??= this.begin(id);
      let sessionId: string;
      try { sessionId = await session.token; }
      catch (error) { session.token = undefined; throw error; }
      return write({ sessionId, saveSequence: ++session.sequence });
    });
  }
}
