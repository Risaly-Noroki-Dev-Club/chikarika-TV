# chikarika-TV

异地同步观影 Web/PWA。房主绑定自己的 Emby 媒体源创建房间，朋友通过邀请链接加入，一起看同一部影片、聊天、同步播放状态。

## 0.1: 我等你们在崇明海边

chikarika-TV 已经脱离 MVP 阶段，进入 `0.1` 版本。

这个版本的代号是 **我等你们在崇明海边**，取自上海秋天（shanghaiqiutian）的同名歌曲。按照我们过去项目的习惯，大版本继续用歌名命名。

`0.1` 的目标不是做一个完整的流媒体平台，而是把“小范围朋友异地同步观影”这条主线跑通：账号、Emby 绑定、房间、邀请、HLS 播放、聊天、播放同步、代理播放和非 Docker 部署。

## 功能

- 邮箱密码注册/登录
- 使用 Emby 账号密码绑定服务器，不需要手动创建 API Key
- 浏览 Emby 媒体库并选择影片
- 创建两人观影房间
- 邀请链接加入房间
- 房主直连 Emby HLS，减少 VPS 流量
- 朋友通过 chikarika-TV Media Proxy 播放 HLS
- 朋友代理默认限码率 `4 Mbps`，最高 `6 Mbps`
- 房间 live chat
- 播放/暂停/跳转同步
- 服务端权威播放状态
- 基础漂移修正和重新同步
- 房主关闭房间、踢人、调整代理码率
- PWA manifest 和图标
- ruri 优先部署方案
- 一行 curl 安装脚本

## 技术栈

- Frontend: SvelteKit 5, Svelte 5, Tailwind CSS v4, hls.js
- Backend: Fastify, WebSocket, TypeScript
- Database: PostgreSQL 16+
- Realtime/cache: Redis
- Runtime: Node.js 20+
- Package manager: pnpm 9+
- Tests: Vitest
- App isolation: ruri rootfs
- Process manager: systemd
- Reverse proxy: Caddy/Nginx

生产运行栈：

```txt
Caddy/Nginx
  -> ruri: chikarika-TV unified app runner
       -> SvelteKit Web
       -> Fastify API / WebSocket / Media Proxy
  -> host systemd: PostgreSQL
  -> host systemd: Redis
```

项目不依赖 Docker，也不提供 Docker Compose 部署路径。PostgreSQL/Redis 留在宿主机 systemd，Web/API 进入 ruri rootfs。

## 一行部署

Debian/Ubuntu 上可以直接运行：

```bash
curl -fsSL https://raw.githubusercontent.com/Risaly-Noroki-Dev-Club/chikarika-TV/main/scripts/install-ruri.sh | sudo bash
```

默认行为：

- 安装 PostgreSQL、Redis、Node.js、pnpm、ruri
- 克隆或更新仓库到 `/srv/watchroom`
- 初始化 `.env`
- 自动生成 `SESSION_SECRET` 和 `ENCRYPTION_KEY`
- 运行数据库迁移
- 构建 Web/API
- 准备 ruri rootfs 到 `/opt/watchroom-rootfs`
- 安装并启动 `watchroom-ruri.service`

默认地址：

- Web: `http://localhost:2262`
- API: `http://localhost:2261`
- Health check: `http://localhost:2261/api/health`

可用环境变量覆盖路径：

```bash
curl -fsSL https://raw.githubusercontent.com/Risaly-Noroki-Dev-Club/chikarika-TV/main/scripts/install-ruri.sh \
  | APP_DIR=/srv/watchroom ROOTFS=/opt/watchroom-rootfs sudo -E bash
```

## 本地开发

### 依赖

- Node.js 20+
- pnpm 9+
- PostgreSQL 16+
- Redis

Ubuntu/Debian：

```bash
sudo apt-get install -y postgresql postgresql-client redis-server
sudo systemctl enable --now postgresql redis-server
./scripts/setup-local-db.sh
```

### 配置

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

构建后统一启动 Web/API：

```bash
pnpm build
./scripts/start-all.sh
```

## 使用流程

1. 打开 Web 页面并注册 chikarika-TV 账号。
2. 登录后进入 `Emby` 页面。
3. 填写 Emby 服务器地址、Emby 用户名和密码。
4. 绑定成功后进入创建房间页面。
5. 从 Emby 媒体库选择影片并创建房间。
6. 把房间链接发给朋友。
7. 朋友注册/登录后打开邀请链接并加入房间。
8. 房主开始播放，房间内同步播放/暂停/跳转状态，并可实时聊天。

播放链路：

```txt
房主:
  Browser -> Host Emby

朋友:
  Browser -> chikarika-TV Media Proxy -> Host Emby

实时同步和聊天:
  Browser -> chikarika-TV WebSocket
```

## Emby 说明

绑定方式：

```txt
Emby 地址 + Emby 用户名 + Emby 密码
```

chikarika-TV 会调用 Emby 用户登录接口获取访问令牌，并加密保存。后续浏览媒体库、获取影片详情和生成播放地址时，后端使用该访问令牌访问 Emby。

注意事项：

- Emby 地址必须能从 chikarika-TV API 所在机器访问。
- 房主浏览器也需要能访问 Emby 地址，因为房主默认直连播放。
- 如果 Emby 部署在反向代理后，推荐填写外部可访问地址，例如 `https://emby.example.com`。
- 绑定时会尝试兼容常见 `/emby` API base path。
- 为了降低 SSRF 风险，默认不允许绑定 localhost、私有网段或保留地址。
- 朋友代理播放时，不会直接拿到房主的 Emby 访问令牌。

## 仓库结构

```txt
apps/
  web/       SvelteKit PWA 前端
  server/    Fastify API + WebSocket + Media Proxy
packages/
  shared/    共享类型
deploy/      Caddy / systemd / ruri 示例
scripts/     本机初始化、ruri、安装和运行脚本
```

## 常用命令

```bash
pnpm db:migrate      # 运行数据库迁移
pnpm typecheck       # TypeScript + Svelte 检查
pnpm test            # 后端单元测试
pnpm build           # 生产构建
./scripts/start-all.sh
                      # 构建后统一启动 Web/API
```

## 部署细节

推荐边界：

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

ruri 统一入口：

```bash
ROOTFS=/opt/watchroom-rootfs APP_DIR=/srv/watchroom ./scripts/run-ruri-app.sh
```

systemd unit：

```txt
deploy/ruri/watchroom-ruri.service
```

裸 Node systemd 示例仍保留用于排障或不需要隔离的环境：

```txt
deploy/systemd/watchroom-server.service
deploy/systemd/watchroom-web.service
```

反向代理示例：

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

更多 ruri 说明见：

```txt
deploy/ruri/README.md
```

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

### 一行安装后如何查看日志

```bash
sudo journalctl -u watchroom-ruri.service -f
```

### 一行安装后如何重启

```bash
sudo systemctl restart watchroom-ruri.service
```

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

## 0.2 之后

- 用真实 Emby 服务做更完整端到端验证
- 根据实际 HLS playlist 继续修复 Media Proxy 兼容问题
- 增加字幕代理和字幕选择同步
- 增加 PWA service worker/offline fallback
- 增加更多 API 测试
- 完善生产升级脚本

## License

暂未指定。
