# 暗棋象棋

中国传统象棋的翻棋变体（暗棋）。32 枚棋子在标准棋位上混合洗牌、全部盖住，走一步才翻面，翻出来的棋子可能属于任何一方。

在线试玩：<https://lindengjian.github.io/dark-xiangqi/>

## 玩法

- 32 枚棋子（含将帅）洗牌后盖在标准棋位上，红方先走。
- 只能动己方半场的暗棋：红方 y≥5，黑方 y≤4（棋盘顶部 y=0）。
- 暗棋按它**初始棋位**的棋种走法移动；落子后翻开，露出真实身份和颜色。
- 明棋归实际颜色所有，按实际棋种行棋，选子不受半场限制。
- 暗棋可被任意一方吃掉，吃后亮明；吃掉对方将帅即获胜，不吃己方将帅则败。没有将军、将死、将帅照面限制。
- 士斜走一格无九宫限制；象走田、塞象眼，但不受河界限制；马蹩腿、炮隔子吃照常。将帅可上下左右走一格，不限九宫。
- 明兵按实际颜色的正常兵卒规则走。

## 人机难度

点「人机对弈」后先选难度；一局结束后底部有「选择难度」可以换，也可以直接「重新开始」沿用当前难度。

| 难度 | 思路 | 单步耗时 |
| --- | --- | --- |
| 简单 | 在合法走法里随机挑一步 | 无计算 |
| 中等 | 两层搜索：走完再看对手的回应，避免白送子 | 约 10–20ms |
| 困难 | 迭代加深到四层，带时间预算，会护子、抢子力 | 上限 450ms |

AI 只使用公开信息：暗子一律按未知处理，不会偷看身份。吃暗子前会按场上剩余暗子估算「可能吃到己方子」的风险，困难档更保守。

## 三种对局方式

| 方式 | 位置 | 说明 |
| --- | --- | --- |
| 人机对弈 | 在线版 / 本地 | 三档难度：简单随机、中等两层搜索、困难迭代加深到四层 |
| 同屏双人 | 在线版 / 本地 | 两人共用一台设备，轮流走棋 |
| 房间对战 | 仅本地服务 | 局域网内两台设备，六位房间号，服务端判定走子 |

GitHub Pages 只能托管静态文件，跑不了 Node 服务，所以**在线版没有房间对战**。需要联网对战时在本地启动服务（见下）。

## 一行命令部署

```bash
curl -fsSL https://raw.githubusercontent.com/lindengjian/dark-xiangqi/master/deploy.sh | bash
```

脚本会检查 Docker、拉源码、构建镜像、起容器、等健康检查，最后打印访问地址。重跑即升级（自动替换旧容器）。

公网域名部署：

```bash
curl -fsSL https://raw.githubusercontent.com/lindengjian/dark-xiangqi/master/deploy.sh \
  | ALLOWED_HOSTS=xiangqi.example.com TRUST_PROXY=1 bash
```

可调的环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3218` | 宿主机端口 |
| `ALLOWED_HOSTS` | 空 | 允许的域名，逗号分隔 |
| `TRUST_PROXY` | `0` | 反代终结 TLS 时设 `1` |
| `TRUST_ANY_HOST` | `0` | 接受任意 Host，仅纯内网用 |
| `NAME` | `xiangqi` | 容器名 |

## Docker 部署（手动）

镜像里已经包含页面和房间 API，跑起来就能对战，不需要额外挂文件或装依赖。

```bash
git clone https://github.com/lindengjian/dark-xiangqi.git
cd dark-xiangqi

docker build -t dark-xiangqi .
docker run -d --name xiangqi -p 3218:3218 \
  -e ALLOWED_HOSTS=xiangqi.example.com \
  -e TRUST_PROXY=1 \
  --restart unless-stopped \
  dark-xiangqi
```

打开 `http://服务器IP:3218/` 即可建房对战。用 compose 更省事：

```bash
ALLOWED_HOSTS=xiangqi.example.com TRUST_PROXY=1 docker compose up -d
```

两个环境变量决定谁能访问：

| 变量 | 作用 |
| --- | --- |
| `ALLOWED_HOSTS` | 允许的域名，逗号分隔，不带 `https://` 和端口。留空则只允许 localhost 与局域网 IP |
| `TRUST_PROXY` | 前面有 Caddy/nginx/Traefik 终结 TLS 时设为 `1`，否则 https 页面调 API 会被 Origin 校验拒绝 |
| `TRUST_ANY_HOST` | 设为 `1` 时接受任意 Host，仅适合纯内网或已由前置代理严格限制的场景 |

容器自带 `/healthz` 探针，不依赖公网 Host 头，可直接接 Kubernetes 或 compose 的 healthcheck。

### 公网部署要点

- **必须放在 HTTPS 反向代理后面**。浏览器从 https 页面调 http 接口会被混合内容策略拦掉。
- 反向代理要透传 `Host` 和 `X-Forwarded-Proto`，Caddy 默认就会带。
- 房间存在进程内存里，**重启容器即清空**；多副本之间不共享房间，需要多副本时得先把房间状态挪到 Redis。
- 单容器足够个人和小范围使用，但它是无认证的公开服务，别长期暴露给不可信网络。

### Caddy 示例

```
xiangqi.example.com {
    reverse_proxy 127.0.0.1:3218
}
```

## 本地运行（不用 Docker）

需要 Node.js 18+，无第三方依赖。

```bash
git clone https://github.com/lindengjian/dark-xiangqi.git
cd dark-xiangqi
npm start            # 默认 http://127.0.0.1:3218/
```

只玩单机也可以直接双击 `index.html`，人机与同屏双人都能跑，不需要服务。

局域网内让另一台设备加入：

```bash
HOST=0.0.0.0 PORT=3221 npm start
```

- 本机打开 `http://127.0.0.1:3221/`，对方用本机局域网地址打开，如 `http://192.168.1.10:3221/`（macOS 用 `ipconfig getifaddr en0` 查）。
- 一方点「创建房间」，然后点棋盘下方的「邀请对手」分享或复制邀请链接。对方打开链接后会自动加入；也可以手动输入六位房间号加入。
- 邀请链接沿用创建者打开游戏时的地址：`127.0.0.1`、`localhost` 只指向访问者自己的设备，不能发给其他人。请创建者先通过局域网 IP（例如 `http://192.168.1.10:3221/`）或双方都能访问的公网 HTTPS 域名打开页面，再创建和分享。浏览器不能自动复制时，可在弹窗中手动复制。
- 同一标签页刷新后会尝试恢复原有身份；房间已满或服务重启后链接会提示失败。链接相当于房间的入场凭证，请只发给希望对弈的人。
- 一局结束后双方各点一次「再来一局」，服务端重新洗牌开局，房间与身份保留。
- 房间存在内存里，重启服务即消失。仅限局域网自用，不要直接暴露到公网。

也可以直接打开根目录的 `index.html`，离线玩人机或同屏双人。

## 测试

```bash
npm test              # 规则及房间服务测试
npm run test:invite   # 邀请链接浏览器集成测试（Node 22+ 和 Chrome/Chromium）
npm run test:server   # 服务端双客户端联调（需先 npm start）
npm run test:ui       # 真实浏览器双开联调（需先 npm start）
```

规则测试覆盖洗牌完整性、暗棋按初始棋位走法、明棋归属、吃将判胜、AI 合法性等。

## 目录

游戏本体是 Game Studio 工程，服务端只负责房间；两边放在同一个目录里。

```
game.js             Game Studio 游戏源码（画面、交互、AI、联网客户端）
game.json           工程配置：标题、竖屏、素材槽
assets/             素材
dist/index.html     Game Studio 构建产物
export/dark-xiangqi.html   Game Studio 导出产物 —— 唯一的页面源文件
index.html          GitHub Pages 静态版，由 scripts/build-pages.js 从导出生成
.studio/            编辑器状态：版本历史、快照、预览图

server/
  game.js           权威规则：洗牌、走法枚举、落子、AI（与前端规则各自独立）
  game.test.js      规则测试
  server.js         房间 API：create / join / move / state / moves / rematch
  online.js         同源包装：页面 + 房间 API + /healthz，按请求改写 CSP
  public/           早期的独立房间界面（/legacy 可访问，保留备用）

scripts/
  build-pages.js    从 export/ 生成静态版 index.html
  test-server.js    服务端双客户端联调
  test-ui.js        真实浏览器双开联调
  screenshot.js     中局截图

docs/
  lan-play.md       局域网房间对战说明

LICENSE             MIT
CONTRIBUTING.md     贡献指南（含两份规则实现的提醒）
.editorconfig       缩进、换行、编码统一

deploy.sh           一行命令部署脚本：检查环境、构建、起容器、等健康
Dockerfile          镜像：node:22-alpine，非 root 运行
docker-compose.yml  用 compose 起服务
```

## 改完游戏之后

`game.js` 是 Game Studio 的工程源码，改完要在 Game Studio 里构建并导出，然后同步静态页：

```bash
npm run build:pages     # 从 export/ 重新生成 index.html
npm test                # 规则测试
npm run test:ui         # 真实浏览器双开联调（需先 npm start）
```

服务端读的是 `export/dark-xiangqi.html`，所以导出一次，本地服务和静态页就都更新了。

## 房间 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/create` | `{mode:'room'}` → 建房，返回房间号、令牌、执方 |
| POST | `/api/join` | `{room, joinKey?}` → 加入，返回令牌与执黑；可选的随机密钥用于安全重试，不能放在邀请链接里 |
| GET | `/api/state` | `?room=&token=` → 局面与再来一局状态 |
| GET | `/api/moves` | `?room=&token=&x=&y=` → 该子的合法落点 |
| POST | `/api/move` | `{room,token,from,to}` → 走子，服务端判定 |
| POST | `/api/rematch` | `{room,token}` → 请求再来一局，双方都请求才重开 |

## 贡献

改动前请看一眼 [CONTRIBUTING.md](CONTRIBUTING.md)。特别提醒：规则有**两份实现**（`game.js` 与 `server/game.js`），改规则要两边同步。

## 许可

[MIT](LICENSE)
