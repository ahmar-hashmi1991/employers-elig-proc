const AWS = require('aws-sdk');
const db = require('../../services/rds-claims-data-service');
const logger = require('../../services/log-service');
const csv = require('../../services/csv-service');
const { Subject } = require('rxjs');
const { map, mergeMap, scan, tap, timestamp } = require('rxjs/operators');
const constants = require('../../common/constants');
const objectMapper = require('object-mapper');
const s3 = new AWS.S3();
const emailSrv = require('../../services/email-service');

module.exports.runjob = async (payload) => {
    logger.info(`starting claims processing job -`, payload);
    let [accounts] = await db.getAccount(payload.accountId);
    if(!accounts || accounts.length !== 1){
        logger.error(`invalid account id ${payload.accountId}`);
        throw new Error(`invalid account id ${payload.accountId}`);
    }

    const account = accounts[0];
    logger.info('account', account);

    await db.updateFileHistoryLog(payload.fileHistoryId, constants.ClaimsFileStatus.PROCESSING);
    let processor;  
    if (payload.key.includes("professional")) {
        logger.info('file name includes professional');
        processor = initRecordProcessor(account, "professional");  
    } else if (payload.key.includes("pharmacy")) {
        logger.info('file name includes pharmacy');
        processor = initRecordProcessor(account, "pharmacy");  
    } else if (payload.key.includes("facility")) {
        logger.info('file name includes facility');
        processor = initRecordProcessor(account, "facility");  
    } else {
        processor = initRecordProcessor(account);  
        logger.info('file name is not supported');
    }

    await streamFileToProcessQueue(payload.bucket, payload.key, processor.stream);

    let result = await processor.resultPromise;
    await db.updateFileHistoryLog(payload.fileHistoryId, constants.ClaimsFileStatus.SUCCESS);
    logger.info(`finished claims processing`, result);
    return {status: 'SUCCESS', result};
}

async function processCalimsRecord(record, account, type){
    logger.info('processing', record);
    try {
        if (account.mapping_schema) {
            account.mapping_schema = JSON.parse(account.mapping_schema);
            let normalized;
            switch(type) {
                case "pharmacy":
                    normalized = objectMapper(record.record, account.mapping_schema.pharmacy);
                    if (normalized) {
                        let [pharmacy] = await db.getPharmacyClaim(normalized.claim_id);
                        if (pharmacy.length > 0) {
                            await db.updatePharmacyClaim(normalized, normalized.claim_id);
                        } else {
                            await db.addNewPharmacyClaim(normalized);
                        }
                    } else {
                        throw new Error(`WARNING: pharmacy claim file mapping error`);
                    }
                    break;
                case "facility":
                    normalized = objectMapper(record.record, account.mapping_schema.facility);
                    if (normalized) {
                        let [facility] = await db.getFacilityClaim(normalized.claim_id);
                        if (facility.length > 0) {
                            await db.updateFacilityClaim(normalized, normalized.claim_id);
                        } else {
                            await db.addNewFacilityClaim(normalized);
                        }
                    } else {
                        throw new Error(`WARNING: facility claim file mapping error`);
                    }
                    break;
                case "professional":
                    normalized = objectMapper(record.record, account.mapping_schema.professional);
                    if (normalized) {
                        let [professional] = await db.getProfessionalClaim(normalized.claim_id);
                        if (professional.length > 0) {
                            await db.updateProfessionalClaim(normalized, normalized.claim_id);
                        } else {
                            await db.addNewProfessionalClaim(normalized);
                        }
                    } else {
                        throw new Error(`WARNING: professional claim file mapping error`);
                    }
                    break;
                default: 
                    logger.info('file with no supported type');
                    throw new Error(`WARNING: claim file type is not supported: ${type}`);
            }
        }
        return {success: true}
    } catch(err) {
        await emailSrv.sendEmail(`ERROR processing claims file (${process.env.STAGE})`,`ERROR processing claims file ${record.record.claim_id} (${process.env.STAGE}) :: ${err.toString()}`);
        throw err;
    }
}

const initRecordProcessor = (account, type) => {
    let stream = new Subject();
    const CHUNK_SIZE = 3;

    let processor = stream.pipe(
        map((record, i) => ({ record, _i: i+1 })),
        // tap(e => logger.info('ROW', e)),
        mergeMap(record => processCalimsRecord(record, account, type), CHUNK_SIZE),
        timestamp(),
        scan((accumulator, stamp) => {
            if(stamp.value.success) accumulator.succeeded++;
            else {
                accumulator.failed++;
                // accumulator.rejects.push(stamp.value.email)
            }
            return accumulator;
        }, { succeeded: 0 , failed: 0, rejects: []})
    );

    let resultPromise = new Promise((resolve, reject) => {
        let jobResult;
        const resultObserver = {
            next: result => {
                jobResult = result;
                // job.progress(100 * (result.succeeded + result.failed) / obfuscated.length);
            },
            error: err => reject(err),
            complete: () => resolve(jobResult)
        };
        processor.subscribe(resultObserver);
    });

    return {
        stream,
        resultPromise
    };
}

async function streamFileToProcessQueue(bucket, key, stream) {
    const instream = readFileFromS3(bucket, key);
    await csv.ProcessCsvFile(instream, (results, parser) => {
        stream.next(results.data);
    });

    stream.complete();
}

function readFileFromS3(Bucket, Key) {
    const params = {Bucket, Key};
    logger.info('reading file from s3', params);
    console.log("readFileFromS3 ", params)
    const instream = s3.getObject(params).createReadStream();
    return instream;
}