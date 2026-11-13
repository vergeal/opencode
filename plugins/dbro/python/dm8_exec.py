#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
达梦 8 数据库语句执行工具（供 Codex / 开发环境使用）

连接参数优先取命令行参数，其次读环境变量，最后用默认值：
    -H/--host      DM8_HOST      默认 127.0.0.1
    -P/--port      DM8_PORT      默认 5236
    -u/--user      DM8_USER      默认 SYSDBA
    -p/--password  DM8_PASSWORD  默认 SYSDBA（达梦默认口令）
    -d/--schema    DM8_SCHEMA    默认空，指定时连接后执行 SET SCHEMA

SQL 来源（三选一）：
    -f/--file 指定 .sql 文件
    -e/--sql  直接给 SQL 字符串
    位置参数   直接给 SQL 字符串；未提供时读 stdin

语句拆分：
    按分号拆分，PL/SQL 块（BEGIN、DECLARE 开头，或 CREATE 过程/函数/触发器/包/
    类型）内部的提交分号不会拆开；单独成行的 / 或语句开头的 / 也作为结束符，
    与 disql 习惯一致，end; / 写在同一行同样识别。

安全说明：
    破坏性语句（drop/truncate/delete/update/alter/rename/grant/revoke/purge/merge）
    默认需要确认：交互式终端会询问，非交互（管道/重定向）直接拒绝，需加 --force 放行。
    可用 --dry-run 只打印语句不执行。

依赖 dmPython（达梦官方 Python 驱动）：
    达梦安装目录 $DM_HOME/drivers/python 下自带，也可 pip install dmPython。
    若本机只有达梦客户端而没有该驱动，可先用 disql 手工执行。
"""

import argparse
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
    "purge",
    "merge",
)

# 变量声明块与过程体：这类语句的结束符由块结构决定，不能见分号就拆
BLOCK_STARTERS = ("begin", "declare")
BLOCK_CREATE_TARGETS = ("procedure", "function", "trigger", "package", "type", "java")

# 块内的嵌套结构，用于统计层数：IF、LOOP、CASE 都以 END 收尾
BLOCK_OPENERS = ("begin", "if", "loop", "case")


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="执行达梦 8 语句（dmPython），查询输出文本表格，写操作输出影响行数。"
    )
    parser.add_argument("-H", "--host", default=os.environ.get("DM8_HOST", "127.0.0.1"))
    parser.add_argument("-P", "--port", type=int, default=int(os.environ.get("DM8_PORT", "5236")))
    parser.add_argument("-u", "--user", default=os.environ.get("DM8_USER", "SYSDBA"))
    parser.add_argument("-p", "--password", default=os.environ.get("DM8_PASSWORD", "SYSDBA"))
    parser.add_argument("-d", "--schema", default=os.environ.get("DM8_SCHEMA", ""))
    parser.add_argument("-f", "--file", help="要执行的 .sql 文件路径")
    parser.add_argument("-e", "--sql", dest="sql_text", help="直接执行的 SQL 字符串")
    parser.add_argument("--dry-run", action="store_true", help="只解析并打印语句，不连接数据库")
    parser.add_argument("--force", action="store_true", help="跳过破坏性语句的确认/拦截")
    parser.add_argument("--read-only", action="store_true",
                        help="只读模式：只允许查询语句，在只读事务内执行后回滚（无写入口）")
    parser.add_argument("--timeout", type=float, default=30.0,
                        help="连接超时（秒），默认 30；旧版驱动不认该参数时传 0 跳过")
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


def skip_quoted(sql, index):
    """
    返回字符串（'）或引号标识符（"）的结束下标。
    达梦沿用 SQL 标准的双写转义，'' 与 "" 都表示字面量中的引号本身。
    """
    quote = sql[index]
    i = index + 1
    while i < len(sql):
        if sql[i] == quote:
            if i + 1 < len(sql) and sql[i + 1] == quote:
                i += 2
                continue
            return i + 1
        i += 1
    return len(sql)


def identifier_at(sql, index):
    """取 index 处的标识符，返回 (小写词, 结束下标)。"""
    end = index
    while end < len(sql) and (sql[end].isalnum() or sql[end] in "_$#"):
        end += 1
    return sql[index:end].lower(), end


def split_statements(sql):
    """
    按分号拆分 SQL（忽略字符串/注释中的分号）。
    PL/SQL 块内部的分号不拆分，块由最后一个 END 之后的分号或单独成行的 / 收尾；
    语句开头的 / 同样按结束符处理，兼容 end; / 写在同一行的脚本。
    """
    statements = []
    current = []
    block = False
    depth = 0
    closed = False
    first_word = None
    line_blank = True
    current_blank = True
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if ch == "-" and nxt == "-":
            end = sql.find("\n", i + 1)
            end = n if end < 0 else end + 1
            current.append(sql[i:end])
            line_blank = True
            i = end
            continue
        if ch == "/" and nxt == "*":
            end = sql.find("*/", i + 2)
            end = n if end < 0 else end + 2
            current.append(sql[i:end])
            i = end
            continue
        if ch in ("'", '"'):
            end = skip_quoted(sql, i)
            current.append(sql[i:end])
            line_blank = False
            current_blank = False
            i = end
            continue
        if ch == "/" and (line_blank or current_blank):
            statements.append("".join(current))
            current, block, depth, closed = [], False, 0, False
            first_word, current_blank = None, True
            i += 1
            continue
        if ch.isalpha() or ch == "_":
            word, end = identifier_at(sql, i)
            if first_word is None:
                first_word = word
                if word in BLOCK_STARTERS:
                    block = True
            elif not block and first_word == "create" and word in BLOCK_CREATE_TARGETS:
                block = True
            if block:
                if word in BLOCK_OPENERS:
                    depth += 1
                elif word == "end":
                    depth -= 1
                    if depth <= 0:
                        closed = True
            current.append(sql[i:end])
            line_blank = False
            current_blank = False
            i = end
            continue
        current.append(ch)
        if ch == "\n":
            line_blank = True
        elif not ch.isspace():
            line_blank = False
            current_blank = False
        if ch == ";" and (not block or closed):
            statements.append("".join(current))
            current, block, depth, closed = [], False, 0, False
            first_word, current_blank = None, True
        i += 1
    if "".join(current).strip():
        statements.append("".join(current))
    return [s.strip() for s in statements if s.strip()]


def strip_comments(statement):
    """去掉 SQL 中的行注释（--）与块注释（/* */），返回剩余内容。"""
    out = []
    i = 0
    n = len(statement)
    while i < n:
        ch = statement[i]
        nxt = statement[i + 1] if i + 1 < n else ""
        if ch == "-" and nxt == "-":
            end = statement.find("\n", i + 1)
            i = n if end < 0 else end
            continue
        if ch == "/" and nxt == "*":
            end = statement.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        if ch in ("'", '"'):
            end = skip_quoted(statement, i)
            out.append(statement[i:end])
            i = end
            continue
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


def schema_statement(schema):
    """按输入原样拼 SET SCHEMA：简单标识符不加引号，其余加双引号。"""
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$#]*", schema):
        return "SET SCHEMA %s" % schema
    return 'SET SCHEMA "%s"' % schema.replace('"', '""')


def connect(args):
    """连接达梦，返回连接对象；驱动缺失或连接失败时抛异常。"""
    import dmPython
    kwargs = {
        "user": args.user,
        "password": args.password,
        "server": args.host,
        "port": args.port,
        "autoCommit": True,
    }
    if args.timeout > 0:
        kwargs["connection_timeout"] = args.timeout
    return dmPython.connect(**kwargs)


def print_result(cursor, index):
    """打印一条语句的结果集或影响行数。"""
    if cursor.description is not None:
        headers = [d[0] for d in cursor.description]
        print(render_table(headers, cursor.fetchall()))
    else:
        print("[%d] OK，影响 %d 行" % (index, cursor.rowcount))


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

    try:
        conn = connect(args)
    except ImportError:
        print("未安装 dmPython 驱动。达梦安装目录 $DM_HOME/drivers/python 下自带，"
              "也可 pip install dmPython。", file=sys.stderr)
        return 1
    except Exception as exc:
        print("连接达梦失败：%s" % exc, file=sys.stderr)
        return 1

    try:
        cursor = conn.cursor()
        if args.read_only:
            # 库级兜底：达梦支持只读事务；驱动不认时靠白名单与 rollback。
            try:
                conn.autocommit = False
                cursor.execute("SET TRANSACTION READ ONLY")
            except Exception as exc:
                print("提示：未能开启只读事务（%s），按白名单只读执行。" % exc,
                      file=sys.stderr)
        if args.schema:
            cursor.execute(schema_statement(args.schema))
        for idx, stmt in enumerate(statements, 1):
            try:
                cursor.execute(stmt)
            except Exception as exc:
                print("[%d] 执行失败：%s" % (idx, exc), file=sys.stderr)
                print("语句：%s" % " ".join(stmt.split()), file=sys.stderr)
                return 1
            print_result(cursor, idx)
    except Exception as exc:
        print("执行失败：%s" % exc, file=sys.stderr)
        return 1
    finally:
        if args.read_only:
            try:
                conn.rollback()
            except Exception:
                pass
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
