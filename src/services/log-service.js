const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'debug',
    prettyPrint: true,
    colorize: true,
    silent: false,
    timestamp: false,
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
    ],
});

module.exports = logger;