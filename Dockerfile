# Smart City Vision Inspector — production image
# Usage:
#   docker build -t smartcity-vision-inspector .
#   docker run -d --name scvi -p 3000:3000 smartcity-vision-inspector
# Then forward http://<server-ip>:3000 (or your domain) to this container.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first (leverages the Docker layer cache)
COPY package.json ./
RUN npm install --omit=dev

# Then copy the server and frontend assets
COPY server.js ./
COPY public ./public

EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["node", "server.js"]
