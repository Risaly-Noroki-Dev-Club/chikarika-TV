# chikarika-TV with ruri

chikarika-TV 的推荐部署方式是：基础服务放在宿主机 systemd，Node 应用进程放进 ruri rootfs 隔离运行。

推荐部署边界：

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

## 一行安装

在 Debian/Ubuntu 系统上可以直接运行：

```bash
curl -fsSL https://raw.githubusercontent.com/Risaly-Noroki-Dev-Club/chikarika-TV/main/scripts/install-ruri.sh | sudo bash
```

默认路径：

```txt
项目目录: /srv/watchroom
rootfs:   /opt/watchroom-rootfs
服务名:   watchroom-ruri.service
Web:      http://localhost:2262
API:      http://localhost:2261
```

可通过环境变量覆盖：

```bash
curl -fsSL https://raw.githubusercontent.com/Risaly-Noroki-Dev-Club/chikarika-TV/main/scripts/install-ruri.sh \
  | APP_DIR=/srv/watchroom ROOTFS=/opt/watchroom-rootfs sudo -E bash
```

## 为什么 PostgreSQL/Redis 留在宿主机

- 数据库需要长期稳定的数据目录、备份、升级和 systemd 管理。
- ruri 更适合运行无状态应用进程，不适合替代数据库运维。
- PostgreSQL/Redis 直接跑宿主机更简单、更可观测，也更容易接 Caddy/Nginx。

## 准备宿主机服务

```bash
sudo apt-get install -y postgresql postgresql-client redis-server
./scripts/setup-local-db.sh
```

## 准备应用目录

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

rootfs 内的 Node 版本需要满足：

```txt
node >= 20
pnpm >= 9
```

## 统一运行应用

```bash
ROOTFS=/opt/watchroom-rootfs APP_DIR=/srv/watchroom ./scripts/run-ruri-app.sh
```

默认脚本会：

- 使用 `-u` 开启 namespace 隔离。
- 使用 `-n` 开启 no_new_privs。
- bind-mount `/srv/watchroom` 到 rootfs 内 `/srv/watchroom`。
- 在 rootfs 内运行 `scripts/start-all.sh`。
- `scripts/start-all.sh` 会同时启动 API 和 Web，任一进程退出都会整体退出，便于 systemd 统一重启。

## systemd 管理 ruri 进程

示例 unit：

- `deploy/ruri/watchroom-ruri.service`

安装示例：

```bash
sudo cp deploy/ruri/watchroom-ruri.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now watchroom-ruri.service
```

示例 unit 假设：

```txt
项目目录: /srv/watchroom
rootfs:   /opt/watchroom-rootfs
unit 用户: root
```

示例 unit 用 root 启动 ruri，因为 ruri 需要创建隔离环境。应用目录仍通过 `APP_DIR` bind-mount 到 rootfs 内。如果你的路径不同，修改 unit 里的 `ROOTFS`、`APP_DIR` 和 `WorkingDirectory`。

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

chikarika-TV 的应用层可以迁移到 ruri；数据库和 Redis 保持宿主机 systemd 管理。这种边界更轻，也更符合本项目的小规模自托管场景。
