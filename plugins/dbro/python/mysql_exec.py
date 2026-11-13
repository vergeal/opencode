#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MySQL 语句执行工具（供 Codex / 开发环境使用）

连接参数优先取命令行参数，其次读环境变量，最后用默认值：
    -H/--host      MYSQL_HOST      默认 127.0.0.1
    -P/--port      MYSQL_PORT      默认 3306
    -u/--user      MYSQL_USER      默认 root
    -p/--password  MYSQL_PASSWORD  默认空
    -d/--database  MYSQL_DATABASE  默认空（可省略，语句里用全限定名或先 USE）

SQL 来源（三选一）：
    -f/--file 指定 .sql 文件
    -e/--sql  直接给 SQL 字符串
    位置参数   直接给 SQL 字符串；未提供时读 stdin

安全说明：
    破坏性语句（drop/truncate/delete/update/alter/rename/grant/revoke/flush/shutdown）
    默认需要确认：交互式终端会询问，非交互（管道/重定向）直接拒绝，需加 --force 放行。
    可用 --dry-run 只打印语句不执行。
"""

import argparse
import getpass
import os
import re
import sys

DANGEROUS_KEYWORDS = (
    "drop",
    "truncate",
    "delete",
    "update",
    "alter",
    "rename",
    "grant",
    "revoke",
    "flush",
    "shutdown",
)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="执行 MySQL 语句（pymysql），查询输出文本表格，写操作输出影响行数。"
    )
    parser.add_argument("-H", "--host", default=os.environ.get("MYSQL_HOST", "127.0.0.1"))
    parser.add_argument("-P", "--port", type=int, default=int(os.environ.get("MYSQL_PORT", "3306")))
    parser.add_argument("-u", "--user", default=os.environ.get("MYSQL_USER", "root"))
    parser.add_argument("-p", "--password", default=os.environ.get("MYSQL_PASSWORD", ""))
    parser.add_argument("-d", "--database", default=os.environ.get("MYSQL_DATABASE", ""))
    parser.add_argument("-f", "--file", help="要执行的 .sql 文件路径")
    parser.add_argument("-e", "--sql", dest="sql_text", help="直接执行的 SQL 字符串")
    parser.add_argument("--dry-run", action="store_true", help="只解析并打印语句，不连接数据库")
    parser.add_argument("--force", action="store_true", help="跳过破坏性语句的确认/拦截")
    parser.add_argument("--read-only", action="store_true",
                        help="只读模式：只允许查询语句，在只读事务内执行后回滚（无写入口）")
    parser.add_argument("--timeout", type=float, default=30.0, help="连接超时（秒），默认 30")
    parser.add_argument("sql", nargs="*", help="SQL 字符串（未提供时读 stdin）")
    return parser.parse_args(argv)


def read_sql(args):
    """按优先级返回要执行的 SQL 文本。"""
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


def split_statements(sql):
    """
    按分号粗略拆分 SQL（忽略字符串/注释中的分号）。
    足够日常使用；极端复杂的存储过程体建议直接整段执行（不拆分时传 --sql）。
    """
    statements = []
    current = []
    in_single = False
    in_double = False
    in_backtick = False
    in_line_comment = False
    in_block_comment = False
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            current.append(ch)
            i += 1
            continue
        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                current.append("*/")
                i += 2
                continue
            current.append(ch)
            i += 1
            continue
        if not in_single and not in_double and not in_backtick:
            if ch == "-" and nxt == "-":
                in_line_comment = True
                current.append(ch)
                i += 1
                continue
            if ch == "#":
                in_line_comment = True
                current.append(ch)
                i += 1
                continue
            if ch == "/" and nxt == "*":
                in_block_comment = True
                current.append("/*")
                i += 2
                continue
        if ch == "'" and not in_double and not in_backtick:
            in_single = not in_single
        elif ch == '"' and not in_single and not in_backtick:
            in_double = not in_double
        elif ch == "`" and not in_single and not in_double:
            in_backtick = not in_backtick
        elif ch == ";" and not in_single and not in_double and not in_backtick:
            statements.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    if "".join(current).strip():
        statements.append("".join(current))
    return [s.strip() for s in statements if s.strip()]


def strip_comments(statement):
    """去掉 SQL 中的行注释（--、#）与块注释（/* */），返回剩余内容。"""
    out = []
    i = 0
    n = len(statement)
    in_single = False
    in_double = False
    in_backtick = False
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
        if not in_single and not in_double and not in_backtick:
            if ch == "-" and nxt == "-":
                in_line_comment = True
                i += 1
                continue
            if ch == "#":
                in_line_comment = True
                i += 1
                continue
            if ch == "/" and nxt == "*":
                in_block_comment = True
                i += 2
                continue
        if ch == "'" and not in_double and not in_backtick:
            in_single = not in_single
        elif ch == '"' and not in_single and not in_backtick:
            in_double = not in_double
        elif ch == "`" and not in_single and not in_double:
            in_backtick = not in_backtick
        out.append(ch)
        i += 1
    return "".join(out)


READ_ONLY_FIRST = ("select", "show", "desc", "describe", "explain")
READ_ONLY_FORBIDDEN = re.compile(
    r"\binto\b"
    r"|\bfor\s+update\b"
    r"|\bfor\s+share\b"
    r"|\block\s+in\s+share\s+mode\b"
    r"|\bnextval\s*\("
    r"|\bsetval\s*\("
    r"|\bpg_(?:terminate|cancel)_backend\b"
    r"|\bdblink_exec\b"
    r"|\blo_(?:import|export|unlink|create)\b",
    re.I,
)


def readonly_reason(statement):
    """--read-only 下的白名单校验；返回拒绝原因，通过则返回 None。"""
    cleaned = strip_comments(statement).strip()
    first = re.match(r"[A-Za-z]+", cleaned)
    if not first or first.group(0).lower() not in READ_ONLY_FIRST:
        return "只允许 select/show/desc/describe/explain，收到 %s" % cleaned[:30]
    hit = READ_ONLY_FORBIDDEN.search(cleaned)
    if hit:
        return "不允许的写法 %s" % hit.group(0)
    return None


def is_dangerous(statement):
    """判断语句是否属于破坏性操作。"""
    cleaned = strip_comments(statement)
    first = re.sub(r"^\s*", "", cleaned).lower()
    for kw in DANGEROUS_KEYWORDS:
        if first.startswith(kw) and (
                len(first) == len(kw) or not (first[len(kw)].isalnum() or first[len(kw)] == "_")
        ):
            return True
    return False


def confirm_dangerous(statement, force):
    if not is_dangerous(statement):
        return True
    if force:
        return True
    if sys.stdin.isatty():
        print("\n检测到破坏性语句：")
        print("  " + " ".join(statement.split())[:160])
        answer = input("确认执行？输入 yes 继续：").strip().lower()
        return answer == "yes"
    print("\n检测到破坏性语句且当前为非交互环境，已拒绝执行。如需放行请加 --force。")
    return False


def render_table(headers, rows):
    """把查询结果渲染成简单的文本表格。"""
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
        print("未提供 SQL（可用 -f 文件 / -e 字符串 / 管道输入）。", file=sys.stderr)
        return 2

    statements = [s for s in split_statements(sql_text) if strip_comments(s).strip()]
    if not statements:
        print("未解析出有效语句。", file=sys.stderr)
        return 2

    if args.dry_run:
        print("--dry-run：以下语句将不会执行\n")
        for idx, stmt in enumerate(statements, 1):
            print("[%d] %s\n" % (idx, " ".join(stmt.split())))
        return 0

    if args.read_only:
        if args.force:
            print("拒绝执行：--read-only 不能与 --force 同时使用。", file=sys.stderr)
            return 3
        for stmt in statements:
            reason = readonly_reason(stmt)
            if reason:
                print("拒绝执行（--read-only）：%s" % reason, file=sys.stderr)
                return 3

    # 危险语句确认：在执行任何操作前统一检查（非交互且未加 --force 直接拒绝）
    for stmt in statements:
        if not confirm_dangerous(stmt, args.force):
            return 3

    import pymysql
    from pymysql.constants import CLIENT

    conn_kwargs = {
        "host": args.host,
        "port": args.port,
        "user": args.user,
        "password": args.password,
        "charset": "utf8mb4",
        "autocommit": not args.read_only,
        "connect_timeout": args.timeout,
        "client_flag": CLIENT.MULTI_STATEMENTS,
    }
    if args.database:
        conn_kwargs["database"] = args.database

    try:
        conn = pymysql.connect(**conn_kwargs)
    except Exception as exc:
        print("连接 MySQL 失败：%s" % exc, file=sys.stderr)
        return 1

    try:
        with conn.cursor() as cursor:
            if args.read_only:
                # 库级兜底：就算白名单漏判，MySQL 也会拒绝写。
                cursor.execute("START TRANSACTION READ ONLY")
            for idx, stmt in enumerate(statements, 1):
                try:
                    cursor.execute(stmt)
                except Exception as exc:
                    print("[%d] 执行失败：%s" % (idx, exc), file=sys.stderr)
                    print("语句：%s" % " ".join(stmt.split()), file=sys.stderr)
                    return 1
                while True:
                    if cursor.description is not None:
                        headers = [d[0] for d in cursor.description]
                        print(render_table(headers, cursor.fetchall()))
                    else:
                        print("[%d] OK，影响 %d 行" % (idx, cursor.rowcount))
                    if not cursor.nextset():
                        break
    finally:
        if args.read_only:
            conn.rollback()
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
