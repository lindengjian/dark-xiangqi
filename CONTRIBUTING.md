# 贡献指南

感谢愿意搭把手。这个项目很小，规则也很简单。

## 环境

- Node.js 18 或更高版本，**不需要安装任何依赖**（没有 `node_modules`）
- 可选：Docker，用于验证容器部署

```bash
git clone https://github.com/lindengjian/dark-xiangqi.git
cd dark-xiangqi
npm test          # 规则测试，秒级完成
```

## 目录分工

改动前先确认该改哪里——这个项目有**两套规则实现**，这是最容易踩的坑：

| 位置 | 作用 | 改这里的时机 |
| --- | --- | --- |
| `game.js` | Game Studio 工程源码：画面、交互、AI、联网客户端 | 改界面、改 AI、改交互 |
| `server/game.js` | 服务端权威规则：洗牌、走法、落子 | 改规则本身 |

**规则改动要两边同步改**，否则单机和服务端会走法不一致。`server/game.test.js` 只覆盖服务端那份，改完记得 `npm test`。

## 提交前检查

```bash
npm test              # 规则测试，必须全过
npm run build:pages   # 改了 game.js 并重新导出后，同步静态页
```

如果动了联网相关代码，再跑一遍联调：

```bash
npm start                        # 另开一个终端
npm run test:server              # 服务端双客户端
npm run test:ui                  # 真实浏览器双开
```

`npm run test:ui` 需要本机有 Playwright 的 chromium-headless-shell，路径写死在脚本里；没有的话跳过它，跑 `test:server` 也能覆盖大部分逻辑。

## 代码风格

- 2 空格缩进，LF 换行，UTF-8，文件末尾留一个换行（`.editorconfig` 已配置）
- 没有构建步骤，也没有打包器；`server/` 下是 CommonJS，`game.js` 是一个 IIFE
- 不引入第三方运行时依赖。这个项目的卖点之一就是 `git clone` 完直接能跑

## 命名

**文件名、目录名一律用英文小写加连字符**，不要用中文。中文文件名会在终端补全、`grep`/`git` 输出对齐、跨平台与 CI 上带来实际问题。注释、文案、界面文字用中文没问题。

## 文档

- `README.md` —— 玩法、部署、API，面向使用者
- `docs/lan-play.md` —— 局域网房间对战，面向想和朋友开一局的人

## 提交信息

一句话说清改了什么，中文即可：

```
人机对弈新增三档难度
修复黑方视角棋盘未翻转
```

## 许可

提交即表示同意以 [MIT](LICENSE) 许可发布你的贡献。
