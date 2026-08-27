FROM ghcr.io/puppeteer/puppeteer:22.13.1

# The base image already ships Chromium + all system deps Puppeteer needs,
# avoiding the usual "missing shared libraries" failures on plain Node images.
USER root
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production

RUN mkdir -p /app/whatsapp-session && chown -R pptruser:pptruser /app
USER pptruser

EXPOSE 4100
CMD ["node", "server.js"]
