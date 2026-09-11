type TestRow = Record<string, any>;

type TestState = {
  users: TestRow[];
  tokens: TestRow[];
  emails: TestRow[];
  logs: TestRow[];
  transactions: number;
};

type TestColumn = { table: string; key: string };
type Predicate = (row: TestRow) => boolean;

function state(): TestState {
  return (globalThis as any).__passwordResetTestState as TestState;
}

function columns(table: string, names: string[]): Record<string, TestColumn> {
  return Object.fromEntries(names.map((key) => [key, { table, key }]));
}

export const usersTable = columns("users", ["id", "email", "passwordHash"]);
export const passwordResetTokensTable = columns("tokens", [
  "id",
  "userId",
  "tokenHash",
  "expiresAt",
  "usedAt",
  "requestedIp",
]);

function rowsFor(table: Record<string, TestColumn>): TestRow[] {
  return table.id.table === "users" ? state().users : state().tokens;
}

function queryResult(run: () => Promise<any>) {
  let promise: Promise<any> | undefined;
  const execute = () => (promise ??= run());
  return {
    then(onFulfilled: any, onRejected?: any) {
      return execute().then(onFulfilled, onRejected);
    },
    returning() {
      return execute();
    },
  };
}

export const db = {
  select() {
    return {
      from(table: Record<string, TestColumn>) {
        return {
          where(predicate: Predicate) {
            return Promise.resolve(rowsFor(table).filter(predicate));
          },
        };
      },
    };
  },

  insert(table: Record<string, TestColumn>) {
    return {
      async values(value: TestRow) {
        rowsFor(table).push({ ...value, id: rowsFor(table).length + 1 });
      },
    };
  },

  update(table: Record<string, TestColumn>) {
    return {
      set(values: TestRow) {
        return {
          where(predicate: Predicate) {
            return queryResult(async () => {
              const rows = rowsFor(table).filter(predicate);
              for (const row of rows) Object.assign(row, values);
              return rows;
            });
          },
        };
      },
    };
  },

  async transaction<T>(callback: (tx: typeof db) => Promise<T>): Promise<T> {
    state().transactions += 1;
    return callback(db);
  },
};