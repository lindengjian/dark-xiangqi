# 暗棋象棋 —— 房间对战服务
# 无第三方依赖，只需 Node 运行时和几个文件。
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3218 \
    HOST=0.0.0.0

WORKDIR /app

# 目录用 755（需要可进入），脚本用 644（源文件可能带 600，非 root 进程读不到）。
RUN mkdir -p /app/server && chown node:node /app/server && chmod 755 /app/server
COPY --chown=node:node --chmod=644 package.json ./
COPY --chown=node:node --chmod=644 server/game.js server/game.test.js server/online.js server/server.js ./server/
COPY --chown=node:node --chmod=644 online.html ./

USER node

EXPOSE 3218

# 容器内探针走 /healthz，不依赖公网 Host 头。
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3218)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/online.js"]
