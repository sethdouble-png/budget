const server = require('../server');
const serverless = require('serverless-http');

module.exports = serverless(server);
