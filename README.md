# chikarika-TV

chikarika-TV 是一个面向小范围朋友使用的异地同步观影 Web/PWA 应用。

目标场景：房主使用自己的 Emby 片源创建房间，朋友登录后加入房间。房主尽量直连自己的 Emby，朋友通过服务器代理观看同一部影片。房间内支持实时聊天和播放同步。

> 当前仍是 MVP 阶段。核心代码、页面和部署骨架已完成，但还需要用真实 Emby 服务做端到端播放验证。

## 功能

- 邮箱密码注册/登录
- 使用 Emby 账号密码绑定服务器
- 浏览 Emby 媒体库并选择影片
- 创建两人观影房间
- 邀请链接加入房间
- 房主直连 Emby HLS
- 朋友通过 VPS Media Proxy 播放 HLS
- 朋友代理默认限码率 4 Mbps，最高 6 Mbps
- 房间 live chat
- 播放/暂停/跳转同步
- 服务端权威播放状态
- 基础漂移修正和重新同步
- 房主关闭房间、踢人、调整代理码率
- PWA manifest 和图标
- 非 Docker 优先部署方案
- 可选 ruri 轻量隔离运行方案

## 暂未完成

- 真实 Emby 端到端播放验证
- 字幕代理完整兼容
- PWA service worker/offline fallback
- 完整生产部署脚本
- 更细的 API 限流和审计日志
- 更完整的自动化 API 测试
- ruri rootfs 实际部署验证

## 架构

```txt
Browser / PWA
  -> SvelteKit Web App
  -> Fastify API
  -> WebSocket Realtime
  -> Media Proxy
  -> Host Emby Server

PostgreSQL: users, sessions, rooms, members, chat messages, Emby connections
Redis: playback state, presence, media sessions, rate limits
```

播放策略：

```txt
房主:
  Browser -> Host Emby

朋友:
  Browser -> chikarika-TV Media Proxy -> Host Emby

实时同步和聊天:
  Browser -> chikarika-TV WebSocket
```

## 技术栈

- Frontend: SvelteKit 5, Tailwind CSS v4, hls.js
- Backend: Fastify, WebSocket, PostgreSQL, Redis
- Runtime: Node.js 20+
- Package manager: pnpm
- Tests: Vitest
- Optional isolation: ruri
- Optional reverse proxy: Caddy/Nginx

## 仓库结构

```txt
apps/
  web/       SvelteKit PWA 前端
  server/    Fastify API + WebSocket + Media Proxy
packages/
  shared/    共享类型
deploy/      Caddy / systemd / ruri 示例
scripts/     本机初始化和运行脚本
```

## 端口

当前默认端口按服务器可用范围 `2201-2300` 设置：

- API / WebSocket / Media Proxy: `2261`
- Web/PWA: `2262`

本地默认地址：

- Web: `http://localhost:2262`
- API: `http://localhost:2261`
- Health check: `http://localhost:2261/api/health`

## 开发环境

默认开发方式不依赖 Docker。PostgreSQL 和 Redis 直接使用宿主机服务。

### 依赖

- Node.js 20+
- pnpm 9+
- PostgreSQL 16+
- Redis

Ubuntu/Debian:

```bash
sudo apt-get install -y postgresql postgresql-client redis-server
sudo systemctl enable --now postgresql redis-server
sudo -u postgres psql -c "CREATE USER watchroom WITH PASSWORD 'watchroom';"
sudo -u postgres createdb -O watchroom watchroom
```

也可以运行脚本：

```bash
./scripts/setup-local-db.sh
```

### 配置

复制并调整环境变量：

```bash
cp .env.example .env
```

默认开发配置：

```env
DATABASE_URL=postgresql://watchroom:watchroom@localhost:5432/watchroom
REDIS_URL=redis://localhost:6379
SERVER_PORT=2261
CORS_ORIGIN=http://localhost:2262
PUBLIC_API_URL=http://localhost:2261
PUBLIC_WS_URL=ws://localhost:2261
```

生产环境必须替换：

- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- 数据库密码
- 域名相关 URL

### 启动

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

也可以分别启动：

```bash
pnpm dev:server
pnpm dev:web
```

## 常用命令

```bash
pnpm db:migrate      # 运行数据库迁移
pnpm typecheck       # TypeScript + Svelte 检查
pnpm test            # 后端单元测试
pnpm build           # 生产构建
pnpm start:server    # 启动构建后的 API 服务
pnpm start:web       # 启动构建后的 Web 服务
```

## 部署

推荐路径：宿主机 PostgreSQL/Redis + systemd 管理 Node 服务。ruri 可作为轻量隔离运行环境，但不建议用它承载 PostgreSQL/Redis。

### 构建

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
```

### 直接运行

```bash
pnpm start:server
PORT=2262 pnpm start:web
```

### systemd

示例文件：

- `deploy/systemd/watchroom-server.service`
- `deploy/systemd/watchroom-web.service`

示例默认假设项目位于：

```txt
/srv/watchroom
```

### Caddy

示例文件：

```txt
deploy/Caddyfile.example
```

核心反代：

```txt
/api/*   -> 127.0.0.1:2261
/media/* -> 127.0.0.1:2261
/ws*     -> 127.0.0.1:2261
/        -> 127.0.0.1:2262
```

### ruri

见：

```txt
deploy/ruri/README.md
```

核心思路：

```txt
PostgreSQL/Redis: 宿主机 systemd
chikarika-TV Web/API: ruri rootfs 内运行 Node 服务
```

示例：

```bash
ROOTFS=/opt/watchroom-rootfs APP_DIR=/srv/watchroom ./scripts/run-ruri-server.sh
ROOTFS=/opt/watchroom-rootfs APP_DIR=/srv/watchroom PORT=2262 ./scripts/run-ruri-web.sh
```

## Emby 使用说明

第一版通过 `Emby 地址 + 用户名 + 密码` 登录绑定服务器。服务端会保存 Emby 返回的访问令牌，用户不需要在 Emby 后台手动创建 API Key。

注意事项：

- Emby 地址必须是 chikarika-TV 后端可以访问的公网/内网地址。
- 为了防 SSRF，默认禁止 localhost 和私有保留地址作为 Emby URL。
- 房主直连模式下，浏览器也需要能访问房主 Emby 地址。
- 朋友代理模式下，朋友不直接接触房主 Emby 访问令牌。

## 安全边界

- 不上传、不托管影片文件。
- 只代理用户绑定的 Emby 媒体源。
- Emby 访问令牌加密保存。
- Media session 使用 Redis TTL。
- 房间最多 2 人。
- 聊天和播放控制有基础 Redis 限流。
- 空房间会自动关闭。
- `.env` 不进入 Git。

## 测试状态

当前已通过：

```bash
pnpm typecheck
pnpm test
pnpm build
```

单元测试目前覆盖：

- HLS playlist URL rewrite
- 相对 segment URL
- 绝对 segment URL
- query 参数保留
- variant playlist rewrite

## 下一步

- 用真实 Emby 服务做端到端验证
- 根据实际 HLS playlist 修复 Media Proxy 兼容问题
- 增加字幕代理和字幕选择同步
- 增加 PWA service worker
- 增加更多 API 测试
- 完成生产部署流程

## License

暂未指定。
