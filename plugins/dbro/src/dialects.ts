export * as Dialects from "./dialects.js"

/**
 * The three engines dbro.py fronts. `dm` is 达梦 8, whose `-d` argument is the schema rather than a database; the
 * SQL below keeps that difference in one place instead of letting every caller branch on the dialect.
 */
export const VALUES = ["dm", "mysql", "pg"] as const
export type Dialect = (typeof VALUES)[number]

export const LABEL: Record<Dialect, string> = {
  dm: "达梦 8",
  mysql: "MySQL",
  pg: "PostgreSQL",
}

export const DEFAULT_PORT: Record<Dialect, number> = {
  dm: 5236,
  mysql: 3306,
  pg: 5432,
}

export const DEFAULT_USER: Record<Dialect, string> = {
  dm: "SYSDBA",
  mysql: "root",
  pg: "postgres",
}

/** The password environment variable each executor reads, matching dbro.py and the three executors. */
export const PASSWORD_ENV: Record<Dialect, string> = {
  dm: "DM8_PASSWORD",
  mysql: "MYSQL_PASSWORD",
  pg: "PGPASSWORD",
}

export const EXECUTOR: Record<Dialect, string> = {
  dm: "dm8_exec.py",
  mysql: "mysql_exec.py",
  pg: "pgsql_exec.py",
}

export function is(value: string): value is Dialect {
  return (VALUES as readonly string[]).includes(value)
}

/** A single-quoted SQL string literal. Callers only ever compare names, never splice identifiers. */
export function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

export function tables(dialect: Dialect, database?: string) {
  switch (dialect) {
    case "dm":
      return database
        ? `SELECT owner, table_name FROM all_tables WHERE owner = upper(${literal(database)}) ORDER BY table_name`
        : "SELECT table_name FROM user_tables ORDER BY table_name"
    case "mysql":
      return `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = ${database ? literal(database) : "DATABASE()"} ORDER BY table_name`
    case "pg":
      return `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = ${database ? literal(database) : "current_schema()"} AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name`
  }
}

export function columns(dialect: Dialect, table: string, database?: string) {
  switch (dialect) {
    case "dm":
      return database
        ? `SELECT column_name, data_type, data_length, nullable FROM all_tab_columns WHERE owner = upper(${literal(database)}) AND table_name = upper(${literal(table)}) ORDER BY column_id`
        : `SELECT column_name, data_type, data_length, nullable FROM user_tab_columns WHERE table_name = upper(${literal(table)}) ORDER BY column_id`
    case "mysql":
      return `SELECT column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns WHERE table_schema = ${database ? literal(database) : "DATABASE()"} AND table_name = ${literal(table)} ORDER BY ordinal_position`
    case "pg":
      return `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = ${database ? literal(database) : "current_schema()"} AND table_name = ${literal(table)} ORDER BY ordinal_position`
  }
}
