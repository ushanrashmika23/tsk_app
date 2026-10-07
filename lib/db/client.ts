export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(colName?: string): Promise<T | null>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: any;
}

class RemoteD1Database implements D1Database {
  prepare(query: string): D1PreparedStatement {
    return new RemoteD1PreparedStatement(query);
  }
}

class RemoteD1PreparedStatement implements D1PreparedStatement {
  private query: string;
  private params: any[] = [];

  constructor(query: string) {
    this.query = query;
  }

  bind(...values: any[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  private async execute<T>(): Promise<D1Result<T>> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const dbId = process.env.CLOUDFLARE_DATABASE_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !dbId || !token) {
      // Return empty results during build/local if missing to prevent crashing
      // Only throw if we are actually trying to fetch data in runtime
      if (process.env.NODE_ENV === "development") {
        console.warn("⚠️ Missing Cloudflare D1 credentials in .env.local");
        return { results: [], success: true, meta: {} };
      }
      throw new Error("Missing Cloudflare D1 credentials. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, and CLOUDFLARE_API_TOKEN.");
    }

    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: this.query,
        params: this.params,
      }),
      // Don't aggressively cache DB calls
      cache: "no-store",
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`D1 API error: ${res.status} ${errorText}`);
    }

    const data = (await res.json()) as any;
    if (!data.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
    }

    const queryResult = data.result[0];
    
    return {
      results: queryResult.results || [],
      success: queryResult.success,
      meta: queryResult.meta || {},
    };
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const res = await this.execute<T>();
    if (res.results && res.results.length > 0) {
      return res.results[0];
    }
    return null;
  }
}

let dbInstance: D1Database | null = null;

export function getDb(): D1Database {
  if (!dbInstance) {
    dbInstance = new RemoteD1Database();
  }
  return dbInstance;
}
