FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages -U yt-dlp
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p uploads temp
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
