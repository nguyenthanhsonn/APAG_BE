const { createServer } = require('node:http');
const { hostname } = require('node:os');

const instance = process.env.RENDER_INSTANCE_ID ?? hostname();
const port = Number(process.env.PORT ?? 5050);

createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/api/v1/health') {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end(`${instance}\n`);
}).listen(port, '0.0.0.0');
