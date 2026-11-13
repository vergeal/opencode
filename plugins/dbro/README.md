# DBRO

`@opencode/plugin-dbro` 把 dbro 只读查询门面封装成 `.ocplugin`，用一组方言感知的
`dbro.*` 工具同时覆盖达梦 8、MySQL 和 PostgreSQL。

查询脚本随包分发：`dbro.py` 和三个单库执行器都在 `assets/dbro` 内，安装后只读这个目录，不依赖任何本机工具目录。

打出来的单文件在 `~/.ocplugins-local/opencode.dbro/<version>/`，安装后解包到
`~/.opencode/ocplugins/opencode.dbro/`。包内包含服务端入口 `server/main.ts`（构建后是 `dist/server/main.js`）、`dbro` 技能，以及 `assets/dbro` 下的
`dbro.py` 和三个单库执行器。

## 工具

| 工具 | 作用 |
| --- | --- |
| `dbro.sources` | 已配置数据源、默认标记、口令来源和配置错误。从不返回明文口令。 |
| `dbro.query` | 执行单条只读 SQL，返回执行器的文本表格。 |
| `dbro.tables` | 按方言列出当前库或指定 schema 的表和视图。 |
| `dbro.columns` | 按方言列出单表的列名、类型、可空性与默认值。 |
| `dbro.doctor` | Python、驱动和四个脚本的自检。 |

## 只读边界

插件不实现自己的写开关，也不把 `--force` 或 `--allow-write` 传给执行器：

1. `dbro.py` 只放行单条 `select` / `show` / `desc` / `describe` / `explain`。
2. 语句内出现 `into`、`for update`、`for share`、`lock in share mode`、`nextval()`、`setval()`、
   `pg_terminate_backend`、`dblink_exec`、`lo_import` 等写法会被拒绝。
3. 执行器再开只读事务（MySQL `START TRANSACTION READ ONLY`、PostgreSQL `SET TRANSACTION READ ONLY`、
   达梦 `SET TRANSACTION READ ONLY`），结束一律回滚。

## 配置数据源

`opencode.json` 的插件 options 是项目级静态配置，插件设置的 `sources` 是用户级运行配置，同名条目后者覆盖前者：

```json
{
  "plugins": {
    "opencode.dbro": {
      "defaultSource": "mall",
      "sources": [
        "biz=dm://SYSDBA@10.0.0.5:5236/BIZ",
        "mysql://readonly@10.0.0.6:3306/im",
        {
          "name": "report",
          "dialect": "pg",
          "host": "10.0.0.7",
          "port": 5432,
          "user": "readonly",
          "database": "analytics",
          "passwordEnv": "REPORT_PG_PASSWORD"
        }
      ]
    }
  }
}
```

字符串格式是 `名字=方言://用户@主机:端口/库`，`名字=` 可省略，省略时用 `方言:主机/库` 自动命名。达梦的 `database` 是 schema。

口令查找顺序：插件加密凭据 `source.<name>.password` → 条目里的明文 `password` → `passwordEnv` →
`DBRO_<NAME>_PASSWORD` → `DM8_PASSWORD` / `MYSQL_PASSWORD` / `PGPASSWORD` → 执行器默认。

不配置数据源也能用，直接给 `dialect`（可再给 `host` / `port` / `user` / `database`）临时连库。

## 依赖

目标机器只需要 Python 3 和对应驱动，不需要另外安装 dbro：

- `pymysql`（MySQL）
- `psycopg2` / `psycopg2-binary`（PostgreSQL）
- `dmPython`（达梦，通常来自 `$DM_HOME/drivers/python`）

`assets/dbro/requirements.txt` 列出了 pip 可安装的依赖：

```sh
python3 -m pip install pymysql psycopg2-binary
```

缺某个驱动只影响那个方言；`dbro.doctor` 会报出缺失项和可用的安装命令。
插件设置里的 `python` 可指向具体解释器，默认 `python3`。

## 构建与打包

```sh
bun run build   # dist/server/main.js + dist/assets/dbro + dist/skills
bun run pack    # ~/.ocplugins-local/opencode.dbro/<version>/
```

`build` 是开发期步骤：从 `DBRO_TOOLS`（默认本机 `~/agents/tools`）复制 `dbro/dbro.py` 与三个执行器，并用
`DBRO_TOOLS=/path/to/tools` 指向其他目录。复制时给 `dbro.py` 打一个布局补丁：插件把四个脚本平铺在
`assets/dbro/`，所以 `TOOLS` 优先取脚本所在目录，再回退到上一级（源码目录的布局）。同步来源变了但补丁锚点
不存在时构建会直接失败，避免悄悄打出错误定位的包。打包后的插件在运行期不再访问 `DBRO_TOOLS` 或 `~/agents`。
