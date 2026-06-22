{
  "name": "matchoracle-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "axios": "^1.6.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "node-cache": "^5.1.2",
    "@anthropic-ai/sdk": "^0.20.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
