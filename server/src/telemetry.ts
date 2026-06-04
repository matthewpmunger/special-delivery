import type { TelemetryDb } from "./db";

export interface MatchEvent {
  ts: number;
  matchId: string;
  type: string;
  payload: unknown;
}

export class Telemetry {
  readonly events: MatchEvent[] = [];
  private readonly eventStmt;
  private readonly metricStmt;

  constructor(private readonly db?: TelemetryDb) {
    this.eventStmt = db?.prepare("INSERT INTO match_events (ts, match_id, type, payload) VALUES (?, ?, ?, ?)");
    this.metricStmt = db?.prepare("INSERT INTO aggregate_metrics (ts, match_id, metric, payload) VALUES (?, ?, ?, ?)");
  }

  append(matchId: string, type: string, payload: unknown): void {
    const event = { ts: Date.now(), matchId, type, payload };
    this.events.push(event);
    this.eventStmt?.run(event.ts, event.matchId, event.type, JSON.stringify(event.payload));
  }

  metric(matchId: string, metric: string, payload: unknown): void {
    this.metricStmt?.run(Date.now(), matchId, metric, JSON.stringify(payload));
  }
}
