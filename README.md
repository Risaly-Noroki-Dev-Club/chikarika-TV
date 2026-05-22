# chikarika-TV

异地同步观影房间。支持 Emby 片源，房主直连，朋友 VPS 代理，实时聊天和播放同步。

## 结构

```
apps/
  web/       - SvelteKit PWA 前端
  server/    - Fastify API + WebSocket + Media Proxy
packages/
  shared/    - 共享类型和工具
deploy/      - systemd / ruri 部署示例
scripts/     - 本机初始化和运行脚本
```

## 开发

默认开发方式不依赖 Docker。PostgreSQL 和 Redis 直接使用宿主机服务。

### 依赖服务

Ubuntu/Debian:

```bash
sudo apt-get install -y postgresql postgresql-client redis-server
sudo systemctl enable --now postgresql redis-server
sudo -u postgres psql -c "CREATE USER watchroom WITH PASSWORD 'watchroom';"
sudo -u postgres createdb -O watchroom watchroom
```

也可以直接运行：

```bash
./scripts/setup-local-db.sh
```

### 启动开发

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

前端默认地址：`http://localhost:2262`

后端默认地址：`http://localhost:2261`

当前默认端口按服务器可用范围 `2201-2300` 设置：

- API / WebSocket / Media Proxy: `2261`
- Web/PWA: `2262`

## 部署

推荐路径：宿主机 PostgreSQL/Redis + systemd 管理 Node 服务。ruri 可以作为轻量隔离运行环境，用来运行 Node 服务，但不建议用它承载 PostgreSQL/Redis。

### 构建

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
```

### 直接运行

```bash
pnpm start:server
pnpm start:web
```

### ruri 运行

见 `deploy/ruri/README.md`。

核心思路：

```txt
PostgreSQL/Redis: 宿主机 systemd
chikarika-TV Web/API: ruri rootfs 内运行 Node 服务
```
