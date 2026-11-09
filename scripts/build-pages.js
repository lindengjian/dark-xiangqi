'use strict';
// 从 Game Studio 的导出产物生成 GitHub Pages 用的静态页。
// 两者只差一处：静态页没有房间服务，要置上 window.DARK_XIANGQI_STATIC，
// 让页面隐藏「创建房间 / 加入房间」。服务端读的是 export/ 里那份原始导出。
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'export', 'dark-xiangqi.html');
const target = path.join(root, 'index.html');
// 注入点放在 canvas 之后、导出文件第一个 <script> 之前。
// 注意不能把 <script> 一起当作锚点再追加 <script>，那会生成嵌套标签。
const ANCHOR = '<canvas id="game" tabindex="0"></canvas>\n';
const FLAG = '<script>window.DARK_XIANGQI_STATIC=true;</script>\n';

const html = fs.readFileSync(source, 'utf8');
if (html.includes('window.DARK_XIANGQI_STATIC=true')) {
  throw new Error('export/dark-xiangqi.html 已带静态标记，请重新从 Game Studio 导出。');
}
if (!html.includes(ANCHOR)) {
  throw new Error('导出文件结构变了，找不到注入点。');
}
const out = html.replace(ANCHOR, ANCHOR + FLAG, 1);
// 兜底：注入后必须是干净的 <script> 序列，不能再出现嵌套。
if (out.includes('<script><script>') || !out.includes('</script>\n<script>')) {
  throw new Error('生成的静态页结构异常（疑似嵌套 script），请检查注入点。');
}
fs.writeFileSync(target, out);
console.log(`index.html 已生成（${fs.statSync(target).size} 字节）`);
