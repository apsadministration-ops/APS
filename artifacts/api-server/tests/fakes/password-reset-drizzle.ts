type Column = { table: string; key: string };
type Predicate = (row: Record<string, any>) => boolean;

function key(column: Column): string {
  return column.key;
}

export function eq(column: Column, value: any): Predicate {
  return (row) => row[key(column)] === value;
}

export function gt(column: Column, value: any): Predicate {
  return (row) => row[key(column)] > value;
}

export function isNull(column: Column): Predicate {
  return (row) => row[key(column)] == null;
}

export function and(...predicates: Predicate[]): Predicate {
  return (row) => predicates.every((predicate) => predicate(row));
}