#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
只读数据库查询入口（达梦 8 / MySQL / PostgreSQL）。

查库一律走这里，不要直接调 dm8_exec.py / mysql_exec.py / pgsql_exec.py：
那三个留了写入口，本脚本**没有任何写开关**。

三层防护：
1. 白名单：只放行单条 select / show / desc / describe / explain；
2. 语句体内禁止 select ... into、for update / for share / lock in share mode、
   nextval() / setval() 这类会改数据的写法；
3. 底层执行器再开只读事务（MySQL `START TRANSACTION READ ONLY`、PG
   `SET TRANSACTION READ ONLY`、达梦 `SET TRANSACTION READ ONLY`），
   结束一律 rollback。即使白名单漏判，库也会拒绝写。

用法：
    dbro.py dm    -e "select * from v$instance"
    dbro.py mysql -d im -e "show tables" -H 10.199.10.15 -u readonly
    dbro.py pg    -d choa -e "select 1" --timeout 10

连接信息优先命令行，其次环境变量（DM8_* / MYSQL_* / PG*），与三个执行器一致。
口令不要写在命令行里，用环境变量或 --password-stdin。
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent

# 语句只允许以这些词开头（小写比较）
ALLOWED_FIRST = ("select", "show", "desc", "describe", "explain")

# 出现在白名单语句内部、但会产生写入/副作用的关键词
FORBIDDEN = re.compile(
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
MAX_TIMEOUT = 120.0


def strip_comments(sql):
    """去掉 -- 行注释与 /* */ 块注释，便于取首词。"""
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


def split_statements(sql):
    """按分号拆分（忽略字符串字面量里的分号）。"""
    out, buf, quote = [], [], None
    for ch in sql:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"', "`"):
            quote = ch
        elif ch == ";":
            out.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    out.append("".join(buf))
    return [s for s in out if strip_comments(s).strip()]


def check(sql):
    """校验 SQL 是否可执行；通过返回校验后的文本，否则抛 ValueError。"""
    statements = split_statements(sql)
    if not statements:
        raise ValueError("没有 SQL。")
    if len(statements) > 1:
        raise ValueError("只允许单条查询，检测到 %d 条语句。" % len(statements))
    stmt = statements[0]
    cleaned = strip_comments(stmt).strip()
    first = re.match(r"[A-Za-z]+", cleaned)
    if not first or first.group(0).lower() not in ALLOWED_FIRST:
        raise ValueError("只允许 select/show/desc/describe/explain，收到：%s"
                         % cleaned[:40])
    hit = FORBIDDEN.search(cleaned)
    if hit:
        raise ValueError("语句包含只读入口禁止的写法：%s" % hit.group(0))
    return stmt.strip().rstrip(";")


def build(dialect, ns, sql):
    """拼出对应执行器命令。只传 --read-only，永不传 --force/--allow-write。"""
    tool = {"dm": "dm8_exec.py", "mysql": "mysql_exec.py", "pg": "pgsql_exec.py"}[dialect]
    cmd = [sys.executable, str(TOOLS / tool), "-e", sql]
    # pg 执行器默认只读，用 --allow-write 反向开启；另外两个要显式 --read-only。
    if dialect != "pg":
        cmd.insert(2, "--read-only")

    if dialect == "dm":
        cmd += ["-H", ns.host, "-P", str(ns.port), "-u", ns.user]
        if ns.database:
            cmd += ["-d", ns.database]
    else:
        if not ns.database:
            raise ValueError("%s 需要 -d 指定库名。" % dialect)
        cmd += ["-H", ns.host, "-P", str(ns.port), "-u", ns.user, "-d", ns.database]

    cmd += ["--timeout", str(ns.timeout)]
    if ns.max_rows and dialect == "pg":
        cmd += ["--max-rows", str(ns.max_rows)]
    return cmd


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="只读查询达梦 / MySQL / PostgreSQL 数据库（单条 select 类语句，无写开关）。")
    parser.add_argument("dialect", choices=("dm", "mysql", "pg"), help="库类型")
    parser.add_argument("-e", "--sql", help="SQL 字符串")
    parser.add_argument("-f", "--file", help="从文件读 SQL")
    parser.add_argument("-H", "--host")
    parser.add_argument("-P", "--port", type=int)
    parser.add_argument("-u", "--user")
    parser.add_argument("-p", "--password", help="不推荐：口令会留在 shell 历史")
    parser.add_argument("--password-stdin", action="store_true",
                        help="从标准输入读口令（推荐）")
    parser.add_argument("-d", "--database", help="库名 / 达梦 schema")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--max-rows", type=int, default=200,
                        help="PostgreSQL 最多显示行数，默认 200")
    return parser.parse_args(argv)


DEFAULTS = {
    "dm": {"host": "DM8_HOST", "port": ("DM8_PORT", 5236), "user": ("DM8_USER", "SYSDBA"),
           "password": ("DM8_PASSWORD", "SYSDBA")},
    "mysql": {"host": "MYSQL_HOST", "port": ("MYSQL_PORT", 3306), "user": ("MYSQL_USER", "root"),
              "password": ("MYSQL_PASSWORD", "")},
    "pg": {"host": "PGHOST", "port": ("PGPORT", 5432), "user": ("PGUSER", "postgres"),
           "password": ("PGPASSWORD", "")},
}


def fill_defaults(ns):
    spec = DEFAULTS[ns.dialect]
    if not ns.host:
        ns.host = os.environ.get(spec["host"], "127.0.0.1")
    if ns.port is None:
        env, default = spec["port"]
        ns.port = int(os.environ.get(env, default))
    if not ns.user:
        env, default = spec["user"]
        ns.user = os.environ.get(env, default)
    if ns.password_stdin:
        ns.password = sys.stdin.readline().rstrip("\n")
    elif ns.password is None:
        env, default = spec["password"]
        ns.password = os.environ.get(env, default)
    ns.timeout = min(max(ns.timeout, 1.0), MAX_TIMEOUT)
    return ns


def main(argv=None):
    ns = fill_defaults(parse_args(argv))

    if ns.file:
        with open(ns.file, encoding="utf-8") as fh:
            raw = fh.read()
    elif ns.sql:
        raw = ns.sql
    elif not sys.stdin.isatty():
        raw = sys.stdin.read()
    else:
        print("没有 SQL：用 -e / -f / 管道传入。", file=sys.stderr)
        return 2

    try:
        sql = check(raw)
        cmd = build(ns.dialect, ns, sql)
    except ValueError as exc:
        print("拒绝执行：%s" % exc, file=sys.stderr)
        return 3

    # 口令走环境变量，不放在 argv 里（避免 ps / 进程列表泄露）。
    env = dict(os.environ)
    env[{"dm": "DM8_PASSWORD", "mysql": "MYSQL_PASSWORD",
         "pg": "PGPASSWORD"}[ns.dialect]] = ns.password or ""
    proc = subprocess.run(cmd, env=env)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
