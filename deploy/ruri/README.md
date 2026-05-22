# chikarika-TV with ruri

ruri 可以用来替代 Docker 的“应用隔离运行环境”，但它不是 Docker Compose 的完整替代品。

推荐部署边界：

```txt
宿主机 systemd:
  PostgreSQL
  Redis
  Caddy/Nginx

ruri rootfs:
  chikarika-TV API
  chikarika-TV Web
```

## 为什么不把 PostgreSQL/Redis 放进 ruri

- 数据库需要长期稳定的数据目录、备份、升级和 systemd 管理。
- ruri 更适合运行应用进程，不适合替代数据库运维。
- PostgreSQL/Redis 直接跑宿主机更简单、更可观测，也更容易接 Caddy/Nginx。

## 准备宿主机服务

```bash
sudo apt-get install -y postgresql postgresql-client redis-server
./scripts/setup-local-db.sh
```

## 准备应用

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
```

建议把项目放到：

```txt
/srv/watchroom
```

## 准备 rootfs

可以用 rurima 拉一个 Debian/Ubuntu/Alpine rootfs，也可以用 debootstrap。rootfs 内至少需要：

```txt
node >= 20
pnpm
ca-certificates
```

示例：

```bash
. <(curl -sL https://get.ruri.zip/rurima)
./rurima lxc pull -o debian -v trixie -s /opt/watchroom-rootfs
```

然后进入 rootfs 安装 Node/pnpm，或把宿主机 Node 以只读方式 bind-mount 进去。

## 运行 API

```bash
ROOTFS=/opt/watchroom-rootfs APP_DIR=/srv/watchroom ./scripts/run-ruri-server.sh
```

默认脚本会：

- 使用 `-u` 开启 namespace 隔离。
- 使用 `-n` 开启 no_new_privs。
- bind-mount `/srv/watchroom` 到容器内 `/srv/watchroom`。
- 在容器内运行 `pnpm start:server`。

## Web 服务

SvelteKit 使用 `adapter-node` 构建，可以直接运行：

```bash
PORT=2262 pnpm start:web
```

也可以再写一个单独的 ruri 脚本运行 Web 进程。

```bash
ROOTFS=/opt/watchroom-rootfs APP_DIR=/srv/watchroom PORT=2262 ./scripts/run-ruri-web.sh
```

## 推荐反代

Caddy/Nginx 反代：

```txt
https://your-domain.example -> web:2262
https://your-domain.example/api -> server:2261
https://your-domain.example/media -> server:2261
https://your-domain.example/ws -> server:2261
```

示例配置见 `deploy/Caddyfile.example`。

## 结论

chikarika-TV 可以支持 ruri，但推荐把它定位成“Node 应用隔离运行器”，而不是把整个部署栈都塞进 ruri。
