export interface Actor {
  id: string;
  type?: string;
  name?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
}

export interface Target {
  id: string;
  type?: string;
  name?: string;
}

export interface AuditEventInput {
  event_id?: string;
  id?: string;
  service?: string;
  action: string;
  actor?: Actor;
  target?: Target;
  status?: 'SUCCESS' | 'FAILURE' | 'ATTEMPT';
  severity?: 'INFO' | 'WARNING' | 'CRITICAL' | 'AUDIT';
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
  timestamp?: string | Date;
}

export interface AuditrClientOptions {
  url?: string;
  service?: string;
  apiKey?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  debug?: boolean;
  onError?: (err: Error) => void;
}

export class AuditrClient {
  constructor(options?: AuditrClientOptions);
  log(event: AuditEventInput): string;
  logNow(event: AuditEventInput): Promise<any>;
  flush(): Promise<any>;
  diff(before: Record<string, any>, after: Record<string, any>): {
    before: Record<string, any>;
    after: Record<string, any>;
    modified: string[];
    added: string[];
    removed: string[];
  };
  expressMiddleware(options?: {
    service?: string;
    skipPaths?: string[];
    actorExtractor?: (req: any) => Actor;
  }): (req: any, res: any, next: any) => void;
  close(): Promise<void>;
}

export default AuditrClient;
