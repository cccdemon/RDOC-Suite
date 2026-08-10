# discord-mock — Discord API simulator for the local test stack.
# Zero dependencies on purpose: no install step, no lockfile, no build.
FROM node:20-alpine

WORKDIR /app
COPY tests/discord-mock/server.mjs tests/discord-mock/state.mjs ./

ENV PORT=4400 HOST=0.0.0.0
EXPOSE 4400

HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4400)+'/__mock/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.mjs"]
