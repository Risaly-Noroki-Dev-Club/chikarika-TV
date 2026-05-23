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
- ruri 优先部署方案
- 宿主机 systemd 基础服务方案

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
- App isolation: ruri rootfs
- Process manager: systemd
- Optional reverse proxy: Caddy/Nginx

生产运行栈：

```txt
Caddy/Nginx
  -> ruri: chikarika-TV unified app runner
       -> SvelteKit Web
       -> Fastify API / WebSocket / Media Proxy
  -> host systemd: PostgreSQL
  -> host systemd: Redis
```

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

默认开发方式不需要容器编排。PostgreSQL 和 Redis 直接使用宿主机服务；Web/API 可以直接运行，也可以放进 ruri rootfs 隔离运行。

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

不推荐使用容器编排。数据库和 Redis 直接由宿主机 systemd 管理，应用进程用 pnpm 或 ruri 启动。

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

### 使用流程

本地启动后打开：

```txt
http://localhost:2262
```

典型使用路径：

1. 注册一个 chikarika-TV 账号并登录。
2. 进入 `Emby` 页面，填写 Emby 服务器地址、Emby 用户名和密码。
3. 绑定成功后进入创建房间页面，从媒体库选择影片。
4. 创建房间后，把房间链接发给朋友。
5. 朋友注册/登录后打开邀请链接并加入房间。
6. 房主开始播放，房间内会同步播放/暂停/跳转状态，并支持实时聊天。

播放链路：

- 房主默认直连自己的 Emby HLS 地址，减少 VPS 流量消耗。
- 朋友默认通过 chikarika-TV 的 `/media` 代理播放，不会直接拿到房主的 Emby 访问令牌。
- 代理播放默认限码率 `4 Mbps`，房主可在房间内调整，最高 `6 Mbps`。

### Emby 准备

绑定前需要确认：

- Emby 服务器已启用远程访问，chikarika-TV 后端能访问该地址。
- 房主浏览器也能访问该 Emby 地址，因为房主播放默认走直连。
- 使用 Emby 普通账号密码绑定即可，不需要手动创建 API Key。
- 如果 Emby 部署在反向代理后，推荐直接填写外部可访问地址，例如 `https://emby.example.com`。
- 为了降低 SSRF 风险，默认不允许绑定 localhost、私有网段或保留地址。

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

推荐路径：宿主机 PostgreSQL/Redis + systemd 管理基础服务，Web/API 使用 ruri rootfs 隔离运行。项目不提供容器编排配置，生产部署默认向 ruri 收敛。

部署边界：

```txt
宿主机 systemd:
  PostgreSQL
  Redis
  Caddy/Nginx

ruri rootfs:
  chikarika-TV unified app runner
    -> API
    -> Web
```

不建议把 PostgreSQL/Redis 放进 ruri rootfs。它们需要稳定数据目录、备份、升级和长期 systemd 管理；ruri 更适合隔离 Node 应用进程。

### 构建

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
```

### 直接运行

直接运行适合开发调试或临时排障：

```bash
pnpm start:server
PORT=2262 pnpm start:web
```

### ruri 运行

一行安装适用于 Debian/Ubuntu：

```bash
curl -fsSL https://raw.githubusercontent.com/Risaly-Noroki-Dev-Club/chikarika-TV/main/scripts/install-ruri.sh | sudo bash
```

准备 rootfs 后，也可以手动用统一入口启动 API + Web：

```bash
ROOTFS=/opt/watchroom-rootfs APP_DIR=/srv/watchroom ./scripts/run-ruri-app.sh
```

更完整的 rootfs 准备和运行说明见 `deploy/ruri/README.md`。

### systemd

示例文件：

- `deploy/ruri/watchroom-ruri.service`

裸 Node systemd 示例仍保留用于排障或不需要隔离的环境：

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

## Emby 使用说明

第一版通过 `Emby 地址 + 用户名 + 密码` 登录绑定服务器。服务端会保存 Emby 返回的访问令牌，用户不需要在 Emby 后台手动创建 API Key。

实现细节：

- 绑定时会优先尝试用户填写的地址，也会兼容常见的 `/emby` API base path。
- Emby 登录后返回的访问令牌会加密保存到数据库。
- 浏览媒体库、获取影片详情和生成播放地址时，后端使用该访问令牌访问 Emby。
- HLS 播放地址会带上 Emby `DeviceId` 和播放参数。
- 房主直连时，浏览器会直接请求房主 Emby 的 HLS 地址。
- 朋友代理时，浏览器只请求 chikarika-TV 的 `/media` 地址，由后端转发到房主 Emby。

## 常见问题

### 绑定 Emby 失败

可以按顺序检查：

1. Emby 地址是否能从运行 API 服务的机器访问。
2. Emby 用户名和密码是否正确。
3. Emby 服务器是否允许远程访问。
4. 是否填写了内网地址、localhost 或保留地址；这些地址默认会被 SSRF 防护拒绝。
5. 如果 Emby 挂在反向代理子路径下，可以尝试填写完整外部地址，例如 `https://example.com/emby`。

### 房主能播放，朋友不能播放

通常说明房主直连 Emby 可用，但 VPS 到 Emby 的代理链路不可用。检查：

1. API 服务所在机器能否访问房主 Emby 地址。
2. 反向代理是否正确转发 `/media/*` 到 API 服务。
3. Emby 是否要求额外的公网访问配置。
4. 浏览器开发者工具里 `/media/rooms/...` 请求返回的状态码。

### 房主也不能播放

房主默认直连 Emby。检查：

1. 房主浏览器能否直接打开 Emby 外部地址。
2. Emby HLS 是否能正常转码或直出。
3. 影片是否有可用的媒体源。
4. 绑定的 Emby 用户是否有该媒体库的访问权限。

### 生产环境需要注意什么

- 必须替换 `.env` 里的 `SESSION_SECRET` 和 `ENCRYPTION_KEY`。
- `ENCRYPTION_KEY` 必须是 32 字节 hex 字符串，也就是 64 个十六进制字符。
- 数据库密码、Redis 访问策略和反向代理 HTTPS 都应按生产环境配置。
- 不建议把 PostgreSQL/Redis 放进 ruri rootfs；推荐由宿主机 systemd 管理。

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
