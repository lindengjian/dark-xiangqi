#!/usr/bin/env bash
# 暗棋象棋 —— 一行命令部署
#
#   curl -fsSL https://raw.githubusercontent.com/lindengjian/dark-xiangqi/master/deploy.sh | bash
#
# 可选环境变量（放在 curl 前面）：
#   PORT=3218                  宿主机端口
#   ALLOWED_HOSTS=x.com,y.com  允许的域名，公网部署必填
#   TRUST_PROXY=1              前面有 Caddy/nginx 终结 TLS 时设为 1
#   NAME=xiangqi               容器名
#
# 例：
#   ALLOWED_HOSTS=xiangqi.example.com TRUST_PROXY=1 \
#     bash -c "$(curl -fsSL https://raw.githubusercontent.com/lindengjian/dark-xiangqi/master/deploy.sh)"
set -euo pipefail

REPO="${REPO:-lindengjian/dark-xiangqi}"
BRANCH="${BRANCH:-master}"
IMAGE="${IMAGE:-dark-xiangqi:latest}"
NAME="${NAME:-xiangqi}"
PORT="${PORT:-3218}"
ALLOWED_HOSTS="${ALLOWED_HOSTS:-}"
TRUST_PROXY="${TRUST_PROXY:-0}"
TRUST_ANY_HOST="${TRUST_ANY_HOST:-0}"
SRC_DIR="${SRC_DIR:-$HOME/.cache/dark-xiangqi-src}"

say() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31m错误：\033[0m %s\n' "$*" >&2; exit 1; }

# ---- 前置检查 -------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "没找到 docker。先装 Docker：https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || die "docker 守护进程没运行。启动它：sudo systemctl start docker（或打开 Docker Desktop）"
docker compose version >/dev/null 2>&1 || die "需要 docker compose 插件（v2）。升级 Docker 即可。"

# ---- 取源码 ---------------------------------------------------------------
# 脚本可能是 curl|bash 直接跑的，此时没有仓库副本，先拉到缓存目录。
if [ -f "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/Dockerfile" ]; then
  SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  say "使用当前目录的源码：$SRC_DIR"
else
  if [ -d "$SRC_DIR/.git" ]; then
    say "更新源码：$SRC_DIR"
    git -C "$SRC_DIR" fetch --depth 1 origin "$BRANCH" -q
    git -C "$SRC_DIR" reset --hard "origin/$BRANCH" -q
  else
    command -v git >/dev/null 2>&1 || die "需要 git 拉取源码，或先手动下载仓库再运行脚本。"
    say "拉取源码到：$SRC_DIR"
    rm -rf "$SRC_DIR"
    git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$SRC_DIR" -q
  fi
fi

# ---- 构建 -----------------------------------------------------------------
say "构建镜像 $IMAGE"
docker build -q -t "$IMAGE" "$SRC_DIR" >/dev/null

# ---- 起容器 ---------------------------------------------------------------
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  say "移除旧容器 $NAME"
  docker rm -f "$NAME" >/dev/null
fi

# 端口占用检查放在移除旧容器之后：重跑时端口正是被自己占着的。
# Linux 用 ss，macOS 用 lsof，两者都没有就跳过检查。
port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":$1 "
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}
if port_in_use "$PORT"; then
  die "端口 $PORT 已被其他进程占用。换一个端口：PORT=3219 bash deploy.sh"
fi

say "启动容器 $NAME（端口 $PORT）"
docker run -d --name "$NAME" \
  -p "$PORT:3218" \
  -e "ALLOWED_HOSTS=$ALLOWED_HOSTS" \
  -e "TRUST_PROXY=$TRUST_PROXY" \
  -e "TRUST_ANY_HOST=$TRUST_ANY_HOST" \
  --restart unless-stopped \
  "$IMAGE" >/dev/null

# ---- 等健康 ---------------------------------------------------------------
say "等待服务就绪"
# 在容器内部探测，避免宿主机端口被别的进程抢占时误判。
ready=0
for _ in $(seq 1 40); do
  if docker exec "$NAME" node -e "fetch('http://127.0.0.1:3218/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then
  printf '\n容器日志：\n' >&2
  docker logs "$NAME" >&2 || true
  die "服务没能启动。"
fi

# ---- 结果 -----------------------------------------------------------------
# macOS 的 hostname 没有 -I，失败时退回占位符，不能让 set -e 中断脚本。
ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
[ -n "${ip:-}" ] || ip="<服务器IP>"
cat <<EOF

✅ 部署完成

   本机访问   http://127.0.0.1:$PORT/
   局域网     http://$ip:$PORT/

   房间对战：一方点「创建房间」拿到六位房间号，对方点「加入房间」输入即可。

常用命令
   看日志     docker logs -f $NAME
   重启       docker restart $NAME
   停止       docker stop $NAME && docker rm $NAME
   换版本     PORT=$PORT ALLOWED_HOSTS=$ALLOWED_HOSTS bash deploy.sh

EOF

if [ -z "$ALLOWED_HOSTS" ] && [ "$TRUST_ANY_HOST" != "1" ]; then
  cat <<'EOF'
⚠️  当前只允许 localhost 与局域网 IP 访问。
    要挂到公网域名，重跑时带上：
    ALLOWED_HOSTS=你的域名 TRUST_PROXY=1 bash deploy.sh
    并且必须放在 HTTPS 反向代理后面（见 README 的 Caddy 示例）。

EOF
fi
