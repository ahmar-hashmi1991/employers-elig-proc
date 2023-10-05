// Import mock AWS SDK from aws-sdk-mock
const AWS = require('aws-sdk-mock');
const db = require('../../../src/services/rds-data-service');
const braze = require('../../../src/services/braze-service');
const sf = require('../../../src/services/salesforce-service');
const emailSrv = require('../../../src/services/email-service');
const constants = require('../../../src/common/constants');
const office = require('../../../src/services/office-service');
const secrets = require('../../../src/services/secrets-service');
const HEADER = 'Employee First Name|Employee Last Name|Patient First Name|Patient Last Name|Patient Gender|Patient DOB|Relationship Code|Sequence Number|Procedure Code|Diag Code 1|Diag Code 2|Diag Code 3|NDC|DRG|Paid Date|Begin Date|End Date|Provider Name|Provider TIN|Group Number'

describe('Test for s3-csv-handler', () => {
    beforeAll(() => {
        // jest.mock('../../../src/services/rds-data-service');
        db.beginTransaction = jest.fn();
        db.commit = jest.fn();
        db.rollback = jest.fn();
        db.end = jest.fn();
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[{id: 201, email: 'test@mydario.com', sf_id: '123456', targeting: 0}], []]);
        db.updateEligibility = jest.fn().mockResolvedValue({});
        db.addEligibilityLog = jest.fn().mockResolvedValue({insertId: 1});
        db.updateInsuranceClaimsFile = jest.fn().mockResolvedValue({insertId: 1});

        //braze
        braze.sendUserEvent = jest.fn().mockResolvedValue({status: 'success'});
        //Salesforce
        sf.updateSFAccountTargeting = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        //email
        emailSrv.sendEmailWithAttachment = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        emailSrv.sendEmail = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        
        secrets.getSecret = jest.fn().mockResolvedValue({ brazeUnifiedFlag: false});
        

        //omit logging
        console.log = jest.fn();
        console.error = jest.fn();
    })

    afterAll(() => {
    })

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Verifies excel is generated from csv', async () => {
        let csv = 'col1,col2,col3\nval1,val2,val3';
        let excel = await office.generateExcelDoc(csv, ',', 'password');

        expect(excel).not.toBeNull();
    });

    it('Verifies the claims object is read and the csv is processed - DIABETES match', async () => {
        const ROW = 'JOHN|SMITH|JOHN|SMITH|M|19710328|IN|00|36415|E785|Z79899|E119||000|20210127|20210112|20210112|COFFEY,DAVID,G,III,MD|561935767|76414587';
        const objectBody = `${HEADER}\n${ROW}`;
        AWS.mock('S3', 'getObject', Buffer.from(objectBody));

        let employer = {id: 23};
        let claimsjson = {"path":"emblem/umr/incoming","delimiter":"|","icd10_fields":["Diag Code 1","Diag Code 2","Diag Code 3"]};
        const params = {
            Bucket: 'test-bucket',
            Key: 'test.csv'
        };

        // Import all functions from s3-json-logger.js. The imported module uses the mock AWS SDK
        const s3ClaimsProcessor = require('../../../src/handlers/insurance-claims-file-processor');
        await s3ClaimsProcessor.s3InsuranceClaimsFileHandler(params, employer, claimsjson);

        // Verify that console.log has been called with the expected payload
        // expect(console.log).toHaveBeenCalledWith(objectBody);
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.updateEligibility).toHaveBeenCalled();
        expect(db.updateEligibility).toBeCalledWith(
            expect.objectContaining({
                targeting: 1
            }),
            201
        );
        expect(sf.updateSFAccountTargeting).toHaveBeenCalled();
        expect(sf.updateSFAccountTargeting).toBeCalledWith(
            '123456',
            1   
        );
        expect(braze.sendUserEvent).toHaveBeenCalled();
        expect(braze.sendUserEvent).toBeCalledWith(
            'test@mydario.com',
            constants.Braze.UPDATE,
            {},
            expect.objectContaining({
                b2b_targeting: 1
            })
        );

        AWS.restore('S3', 'getObject');
    });

    it('Verifies the claims object is read and the csv is processed - HYPERTENTION match', async () => {
        const ROW = 'JOHN|SMITH|JOHN|SMITH|M|19710328|IN|00|36415|E785|Z79899|I168||000|20210127|20210112|20210112|COFFEY,DAVID,G,III,MD|561935767|76414587';
        const objectBody = `${HEADER}\n${ROW}\n${ROW}`;
        AWS.mock('S3', 'getObject', Buffer.from(objectBody));

        let employer = {id: 23};
        let claimsjson = {"path":"emblem/umr/incoming","delimiter":"|","icd10_fields":["Diag Code 1","Diag Code 2","Diag Code 3"]};
        const params = {
            Bucket: 'test-bucket',
            Key: 'test.csv'
        };

        // Import all functions from s3-json-logger.js. The imported module uses the mock AWS SDK
        const s3ClaimsProcessor = require('../../../src/handlers/insurance-claims-file-processor');
        await s3ClaimsProcessor.s3InsuranceClaimsFileHandler(params, employer, claimsjson);

        // Verify that console.log has been called with the expected payload
        // expect(console.log).toHaveBeenCalledWith(objectBody);
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.updateEligibility).toHaveBeenCalled();
        expect(db.updateEligibility).toBeCalledWith(
            expect.objectContaining({
                targeting: 1
            }),
            201
        );
        expect(sf.updateSFAccountTargeting).toHaveBeenCalled();
        expect(sf.updateSFAccountTargeting).toBeCalledWith(
            '123456',
            1   
        );
        expect(braze.sendUserEvent).toHaveBeenCalled();
        expect(braze.sendUserEvent).toBeCalledWith(
            'test@mydario.com',
            constants.Braze.UPDATE,
            {},
            expect.objectContaining({
                b2b_targeting: 1
            })
        );

        AWS.restore('S3', 'getObject');
    });

    it('Verifies the claims object is read and the csv is processed - HYPERTENTION match simulate mode', async () => {
        const ROW = 'JOHN|SMITH|JOHN|SMITH|M|19710328|IN|00|36415|E785|Z79899|I168||000|20210127|20210112|20210112|COFFEY,DAVID,G,III,MD|561935767|76414587';
        const objectBody = `${HEADER}\n${ROW}`;
        AWS.mock('S3', 'getObject', Buffer.from(objectBody));

        let employer = {id: 23};
        let claimsjson = {"path":"emblem/umr/incoming","delimiter":"|","icd10_fields":["Diag Code 1","Diag Code 2","Diag Code 3"],"simulate":true};
        const params = {
            Bucket: 'test-bucket',
            Key: 'test.csv'
        };

        // Import all functions from s3-json-logger.js. The imported module uses the mock AWS SDK
        const s3ClaimsProcessor = require('../../../src/handlers/insurance-claims-file-processor');
        await s3ClaimsProcessor.s3InsuranceClaimsFileHandler(params, employer, claimsjson);

        // Verify that console.log has been called with the expected payload
        // expect(console.log).toHaveBeenCalledWith(objectBody);
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.updateEligibility).toHaveBeenCalledTimes(0);
        expect(sf.updateSFAccountTargeting).toHaveBeenCalledTimes(0);
        expect(braze.sendUserEvent).toHaveBeenCalledTimes(0);

        AWS.restore('S3', 'getObject');
    });

    it('Verifies the claims object is read and the csv is processed - diabetes NO match', async () => {
        const ROW = 'JOHN|SMITH|JOHN|SMITH|M|19710328|IN|00|36415|E785|Z79899|E124||000|20210127|20210112|20210112|COFFEY,DAVID,G,III,MD|561935767|76414587';
        const objectBody = `${HEADER}\n${ROW}`;
        AWS.mock('S3', 'getObject', Buffer.from(objectBody));

        let employer = {id: 23};
        let claimsjson = {"path":"emblem/umr/incoming","delimiter":"|","icd10_fields":["Diag Code 1","Diag Code 2","Diag Code 3"]};
        const params = {
            Bucket: 'test-bucket',
            Key: 'test-2.csv'
        };
        
        // Import all functions from s3-json-logger.js. The imported module uses the mock AWS SDK
        const s3ClaimsProcessor = require('../../../src/handlers/insurance-claims-file-processor');
        await s3ClaimsProcessor.s3InsuranceClaimsFileHandler(params, employer, claimsjson);

        expect(db.getEligibilityByFields).toHaveBeenCalledTimes(0);
        expect(db.updateEligibility).toHaveBeenCalledTimes(0);
        expect(sf.updateSFAccountTargeting).toHaveBeenCalledTimes(0);
        expect(braze.sendUserEvent).toHaveBeenCalledTimes(0);

        AWS.restore('S3', 'getObject');
    });

});
