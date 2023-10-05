const job = require('./claims-file-processor');
const logger = require('../../services/log-service');

(async () => {
    logger.info("Job event:", process.argv);
    logger.info(`environment - InputBucket: ${process.env.InputBucket}, FileKey: ${process.env.FileKey}`);

    let payload = JSON.parse(Buffer.from(process.argv[2], 'base64').toString());
    let results = await job.runjob(payload);
    
    logger.info("Job ends with...", results);
})();