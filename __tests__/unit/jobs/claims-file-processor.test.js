const db = require('../../../src/services/rds-claims-data-service');
const logger = require('../../../src/services/log-service');

describe('Test for claims file processing job', () => {
    const OLD_ENV = process.env;

    beforeAll(() => {
        db.createFileHistoryLog = jest.fn().mockResolvedValue([[{insertId: 1}],[{}]]);
        db.updateFileHistoryLog = jest.fn().mockResolvedValue([[{insertId: 1}],[{}]]);
        //omit logging
        console.log = jest.fn();
        logger.silent = true;
    })

    beforeEach(() => {
        db.getAccount = jest.fn().mockResolvedValue([[{id: 12345}], []]);

        jest.mock('aws-sdk', () => {
            class mockS3 {
                getObject(params) {
                    return {
                        createReadStream: () => {
                            return require("fs").createReadStream("__tests__/s3-example/claims_test.csv");
                        }
                    }
                }
            }
            return {
                ...jest.requireActual('aws-sdk'),
                S3: mockS3,
            };
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        logger.silent = false;
    });

    it('Verifies claims job - fails on invalid account id', async () => {
        const cliamsJob = require('../../../src/jobs/claims/claims-file-processor');
        let payload = {
            eventTime: '2022-03-24T19:00:59.594Z',
            bucket: 'aws-us-east-1-dario-employers-elig-proc-claimsbucket-stage',
            key: 'test/claims-test.csv',
            accountId: 1
        }
        db.getAccount = jest.fn().mockResolvedValue([[], []]);

        await expect(cliamsJob.runjob(payload)).rejects.toThrow(`invalid account id ${payload.accountId}`);
    })

    it('Verifies claims job', async () => {
        const cliamsJob = require('../../../src/jobs/claims/claims-file-processor');
        let payload = {
            eventTime: '2022-03-24T19:00:59.594Z',
            bucket: 'claimsbucket-stage',
            key: 'test/claims-test.csv',
            accountId: 1
        }
        let result = await cliamsJob.runjob(payload);

        expect(result.status).toEqual('SUCCESS');
    })
})
