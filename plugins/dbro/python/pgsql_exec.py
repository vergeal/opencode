#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PostgreSQL 语句执行工具（默认只读）

连接参数优先取命令行参数，其次读环境变量，最后用默认值：
    -H/--host      PGHOST      默认 127.0.0.1
    -P/--port      PGPORT      默认 5432
    -d/--database  PGDATABASE  默认 postgres
    -u/--user      PGUSER      默认 postgres
    -p/--password  PGPASSWORD  默认空

SQL 来源（三选一）：
    -f/--file 指定 .sql 文件
    -e/--sql  直接给 SQL 字符串
    位置参数   直接给 SQL 字符串；未提供时读 stdin

安全说明：
    默认以只读事务执行，拒绝 insert/update/delete/drop/truncate/alter 等写语句。
    确需写操作时显式加 --allow-write；本工具不会主动加 --allow-write。
    可用 --dry-run 只打印 SQL 不连接数据库。
"""

import argparse
import os
import re
import sys

import psycopg2

DANGEROUS_KEYWORDS = (
    "insert",
    "update",
    "delete",
    "drop",
    "truncate",
    "alter",
    "create",
    "rename",
    "grant",
    "revoke",
    "comment",
    "copy",
    "vacuum",
    "analyze",
    "reindex",
    "cluster",
    "refresh",
    "call",
    "do",
)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="执行 PostgreSQL 语句（psycopg2），查询输出文本表格。默认只读。"
    )
    parser.add_argument("-H", "--host", default=os.environ.get("PGHOST", "127.0.0.1"))
    parser.add_argument("-P", "--port", type=int, default=int(os.environ.get("PGPORT", "5432")))
    parser.add_argument("-d", "--database", default=os.environ.get("PGDATABASE", "postgres"))
    parser.add_argument("-u", "--user", default=os.environ.get("PGUSER", "postgres"))
    parser.add_argument("-p", "--password", default=os.environ.get("PGPASSWORD", ""))
    parser.add_argument("-f", "--file", help="要执行的 .sql 文件路径")
    parser.add_argument("-e", "--sql", dest="sql_text", help="直接执行的 SQL 字符串")
    parser.add_argument("--allow-write", action="store_true", help="允许执行写语句（默认只读）")
    parser.add_argument("--dry-run", action="store_true", help="只打印 SQL，不连接数据库")
    parser.add_argument("--timeout", type=float, default=30.0, help="连接超时（秒），默认 30")
    parser.add_argument("--statement-timeout", type=float, default=60.0,
                        help="单条语句超时（秒），默认 60")
    parser.add_argument("--max-rows", type=int, default=2000, help="最多显示行数，默认 2000")
    parser.add_argument("sql", nargs="*", help="SQL 字符串（未提供时读 stdin）")
    return parser.parse_args(argv)


def read_sql(args):
    if args.file:
        with open(args.file, "r", encoding="utf-8") as fh:
            return fh.read()
    if args.sql_text:
        return args.sql_text
    if args.sql:
        return " ".join(args.sql)
    if not sys.stdin.isatty():
        return sys.stdin.read()
    return ""


def strip_comments(statement):
    """去掉行注释与块注释，字符串内的内容保留。"""
    out = []
    i = 0
    n = len(statement)
    in_single = False
    in_double = False
    in_line_comment = False
    in_block_comment = False
    while i < n:
        ch = statement[i]
        nxt = statement[i + 1] if i + 1 < n else ""
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
                out.append(ch)
            i += 1
            continue
        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if not in_single and not in_double:
            if ch == "-" and nxt == "-":
                in_line_comment = True
                i += 1
                continue
            if ch == "/" and nxt == "*":
                in_block_comment = True
                i += 2
                continue
        if ch == "'" and not in_double:
            # PostgreSQL 的 '' 转义
            if in_single and nxt == "'":
                out.append("''")
                i += 2
                continue
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        out.append(ch)
        i += 1
    return "".join(out)


def is_write(statement):
    cleaned = strip_comments(statement)
    first = re.sub(r"^\s*", "", cleaned).lower()
    if first.startswith("with"):
        # WITH ... INSERT/UPDATE/DELETE 仍按写处理；只读 CTE 允许
        return bool(re.search(r"\b(insert|update|delete|merge)\b", first))
    for kw in DANGEROUS_KEYWORDS:
        if first.startswith(kw) and (
                len(first) == len(kw) or not (first[len(kw)].isalnum() or first[len(kw)] == "_")
        ):
            return True
    return False


def render_table(headers, rows):
    headers = [str(h) if h is not None else "NULL" for h in headers]
    rows = [[("" if v is None else str(v)) for v in row] for row in rows]
    widths = [len(h) for h in headers]
    for row in rows:
        for idx, cell in enumerate(row):
            widths[idx] = max(widths[idx], len(cell))
    line = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    out = [line]
    out.append("| " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers)) + " |")
    out.append(line)
    for row in rows:
        out.append("| " + " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)) + " |")
    out.append(line)
    out.append("(%d rows)" % len(rows))
    return "\n".join(out)


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    sql_text = read_sql(args)
    if not sql_text.strip():
        print("没有 SQL。用 -e/--sql、-f/--file 或 stdin 传入。", file=sys.stderr)
        return 2

    if is_write(sql_text) and not args.allow_write:
        print("拒绝执行：检测到写语句。默认只读；确需写入请显式加 --allow-write。", file=sys.stderr)
        return 3
    if args.dry_run:
        print(sql_text)
        return 0

    conn = None
    try:
        conn = psycopg2.connect(
            host=args.host,
            port=args.port,
            dbname=args.database,
            user=args.user,
            password=args.password,
            connect_timeout=max(1, int(args.timeout)),
        )
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = %s", (int(args.statement_timeout * 1000),))
            if not args.allow_write:
                cur.execute("SET TRANSACTION READ ONLY")
            cur.execute(sql_text)
            if cur.description:
                headers = [d[0] for d in cur.description]
                rows = cur.fetchmany(max(0, args.max_rows))
                print(render_table(headers, rows))
                if len(rows) == args.max_rows:
                    print("注意：结果达到 --max-rows 上限，可能还有更多行。", file=sys.stderr)
            else:
                print("影响行数：%d" % cur.rowcount)
        if args.allow_write:
            conn.commit()
        else:
            conn.rollback()
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        print("执行失败：%s" % exc, file=sys.stderr)
        return 1
    finally:
        if conn is not None:
            conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
