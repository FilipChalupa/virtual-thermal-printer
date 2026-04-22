FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/escpos-decoder/package.json ./packages/escpos-decoder/package.json
COPY packages/virtual-thermal-printer/package.json ./packages/virtual-thermal-printer/package.json
RUN npm ci

COPY tsconfig.json ./
COPY packages/escpos-decoder ./packages/escpos-decoder
COPY packages/virtual-thermal-printer ./packages/virtual-thermal-printer

RUN npm run build --workspace=packages/escpos-decoder
RUN npm run build --workspace=packages/virtual-thermal-printer

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/escpos-decoder/dist ./packages/escpos-decoder/dist
COPY --from=builder /app/packages/escpos-decoder/package.json ./packages/escpos-decoder/package.json
COPY --from=builder /app/packages/virtual-thermal-printer/dist ./packages/virtual-thermal-printer/dist
COPY --from=builder /app/packages/virtual-thermal-printer/package.json ./packages/virtual-thermal-printer/package.json
COPY --from=builder /app/packages/virtual-thermal-printer/main.ts ./packages/virtual-thermal-printer/main.ts
COPY --from=builder /app/packages/virtual-thermal-printer/escpos.ts ./packages/virtual-thermal-printer/escpos.ts
COPY --from=builder /app/packages/virtual-thermal-printer/settings.ts ./packages/virtual-thermal-printer/settings.ts

EXPOSE 80
EXPOSE 9100

WORKDIR /app/packages/virtual-thermal-printer
CMD ["npm", "start"]
