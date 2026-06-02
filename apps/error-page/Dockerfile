FROM node:20-alpine
WORKDIR /app
COPY apps/error-page/server.js ./
COPY apps/error-page/package.json ./
ENV PORT=9091
EXPOSE 9091
CMD ["node", "server.js"]
