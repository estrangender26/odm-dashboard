
/**
 * Dependency Adapter Interfaces
 */

export interface DbAdapter {
  insert: (table: any) => any;
  select: (columns?: any) => any;
  update: (table: any) => any;
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
}

export interface StorageAdapter {
  from: (bucket: string) => any;
}

export interface TusAdapter {
  Upload: new (file: any, options: any) => { url: string | null; start: () => void };
}

export interface FsAdapter {
  mkdir: (path: string, options: any) => Promise<void>;
  rm: (path: string, options: any) => Promise<void>;
}

export interface FetchAdapter {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface ClockAdapter {
  now: () => number;
  newDate: () => Date;
  randomUUID: () => string;
}

export interface LoggerAdapter {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface MigrationContext {
  db: DbAdapter;
  storage: StorageAdapter;
  tus: TusAdapter;
  fs: FsAdapter;
  fetchAdapter: FetchAdapter;
  clock: ClockAdapter;
  logger: LoggerAdapter;
  workerId: string;
  execute: boolean;
}
