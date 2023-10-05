// Import mock AWS SDK from aws-sdk-mock
const AWS = require('aws-sdk-mock');
const fs = require("fs");
const Ajv = require('ajv');
const addKeywords = require("ajv-keywords");
const db = require('../../../src/services/rds-data-service');
const braze = require('../../../src/services/braze-service');
const sf = require('../../../src/services/salesforce-service');
const shop = require('../../../src/services/shop-service');
const constants = require('../../../src/common/constants');
const queue = require('../../../src/services/sqs-service');
const sns = require('../../../src/services/sns-service');
const utils = require('../../../src/common/utils');
const emailSrv = require('../../../src/services/email-service');
const jsonMap = require('../../../src/common/json-map');
const csvSrv = require('../../../src/services/csv-service');
const multipleFilesSrv = require('../../../src/services/multipleFiles-service');
const ajv = new Ajv({allErrors: true});
const secrets = require('../../../src/services/secrets-service');
addKeywords(ajv, "transform");

const mapping = {"FirstName":"first_name","LastName":"last_name","Email Address":"email","Phone Number":"phone","Employee ID":"employee_id","Vitality ID":"reseller_employee_id","Role":"role","Gender":"gender","Date of Birth":{"key":"dob","transform":"date:MM/DD/YYYY"},"Branch":"branch","Group Name":"group_name", "Termination Date": {"key":"termination_date","transform":"date:MM/DD/YYYY"} };
const schema = {"properties":{"Vitality ID":{"type":"string","minLength":1},"FirstName":{"type":"string","minLength":1,"transform": ["trim"]},"LastName":{"type":"string","minLength":1,"transform": ["trim"]},"Employee ID":{"type":"string","minLength":1},"Date of Birth":{"type":"string","minLength":1},"Phone Number":{"type":"string"}, "Termination Date":{"type":"string"}}};
const ELIG_REC1 = { "id": 1, "first_name": 'JOHN', "last_name": 'JOHNSON', "employee_id": '123456', "reseller_employee_id": "VS00123456", "role": "EE", "dob": new Date('1984-09-08T00:00:00.000'), "email": "test@noreply.com", "gender": "male", "status": "eligible", "stage": "new", "termination_date": new Date('2024-09-08T00:00:00.000') };
const elig_rules_json = {"productTypes":["BG","BP"],"spouseCheckField":"employee_id","validationFields":["reseller_employee_id","role","dob"],"targeting":{"default":true}};
const elig_rules = JSON.stringify(elig_rules_json);
const EMPLOYER = {id: 23, external_id: '12345', mapping_rules: JSON.stringify(mapping), eligibility_rules: elig_rules};

// const empl = JSON.parse(Buffer.from(fs.readFileSync("__tests__/s3-example/employer.json")));

describe('Test for s3-csv-handler', () => {
    beforeAll(() => {
       
        AWS.mock('S3', 'getObject', Buffer.from(require("fs").readFileSync("__tests__/s3-example/test.csv")));
        AWS.mock('S3', 'copyObject', Buffer.from(require("fs").readFileSync("__tests__/s3-example/test.csv")));
        AWS.mock('S3', 'deleteObject', Buffer.from(require("fs").readFileSync("__tests__/s3-example/test.csv")));

        // jest.mock('../../../src/services/rds-data-service');
        db.beginTransaction = jest.fn();
        db.commit = jest.fn();
        db.rollback = jest.fn();
        db.end = jest.fn();
        db.getReseller = jest.fn().mockResolvedValue([[{name: 'Vitality'}], []]);
        db.getEmployerEligibilityList = jest.fn().mockResolvedValue([[], []]);
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 2000}], []]);
        // db.getEmployerByFolder = jest.fn().mockResolvedValue([[{...EMPLOYER}], []]);
        db.createFileHistoryLog = jest.fn().mockResolvedValue([{insertId: 12}]);
        db.updateEligibility = jest.fn().mockResolvedValue({});
        db.addEligibility = jest.fn().mockResolvedValue({insertId: 1});
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[{eid: 'test-eid'}]])
        db.addEligibilityLog = jest.fn().mockResolvedValue({insertId: 1});
        db.updateFileHistoryLog = jest.fn().mockResolvedValue({});
        db.addEligibilityHistory = jest.fn().mockResolvedValue({insertId: 1});
        db.addEligibilityTrx = jest.fn().mockResolvedValue([[{insertId: 1}],[{}]]);
        db.updateEligibilityTrx = jest.fn().mockResolvedValue([{}]);
        db.updateEligibilityStatusTrx = jest.fn().mockResolvedValue([{}]);
        db.getRedeemedProductsList = jest.fn().mockResolvedValue([[],[]]);
        db.addEligibilityFlowLogTrx = jest.fn().mockResolvedValue([{insertId: 21}]);
        db.reportToFileLog = jest.fn().mockResolvedValue([{insertId: 21}]);
        //braze
        braze.sendUserEvent = jest.fn().mockResolvedValue({status: 'success'});
        //Salesforce
        sf.createOrUpdateEligibility = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        sf.updateEligibilityStatus = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        sf.cancelOrders = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        //shop
        shop.cancelOrders = jest.fn().mockResolvedValue({ status: 'success' });
        //sqs
        queue.sendEligibilityMessage = jest.fn().mockResolvedValue({ status: 'success' });
        queue.sendFinishMessage = jest.fn().mockResolvedValue({ status: 'success' });
        queue.sendBatch = jest.fn().mockResolvedValue({ status: 'success' });
        //sns
        sns.sendMessage = jest.fn().mockResolvedValue({ status: 'success' });
        sns.sendFullMessage = jest.fn().mockResolvedValue({ status: 'success' });
        secrets.getSecret = jest.fn().mockResolvedValue({ brazeUnifiedFlag: false, unifiedFlag: false});
        //email
        emailSrv.sendEmailWithAttachment = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        emailSrv.sendEmail = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        emailSrv.sendTemplateEmail = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        //omit logging
        console.log = jest.fn();
        console.error = jest.fn();
        console.warn = jest.fn();
        console.debug = jest.fn();

        expect.extend({
            toBeValid(jsonstr, cb) {
                return {
                    message: () =>
                        `expected ${jsonstr} to be valid.`,
                    pass: cb(jsonstr),
                }
            }
        })
    })

    beforeEach(() => {
        db.getEmployerByFolder = jest.fn().mockResolvedValue([[{...EMPLOYER}], []]);
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 2000}], []]);
        db.getRedeemedProductsList = jest.fn().mockResolvedValue([[],[]]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Verifies the hash2 run without space', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"Custom Attribute 1 (Member ID)": '7000101', "First Name": 'Nastya', "Last Name": "Qa01", "employee_id": 'test_employee_id'}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"__DUMMY__":{"key": "reseller_employee_id", "transform": "hash2:Custom Attribute 1 (Member ID):First Name:Last Name"}})};
        jsonMap.setupEmployerMappingRules(employer);

        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'A2105251110';
                })
            })
        ]));
    });

    it('Verifies the hash2 run with space', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"Custom Attribute 1 (Member ID)": '   7000101', "First Name": 'Nastya', "Last Name": "Qa01"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"__DUMMY__":{"key": "reseller_employee_id", "transform": "hash2:Custom Attribute 1 (Member ID):First Name:Last Name"}})};
        jsonMap.setupEmployerMappingRules(employer);

        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'A2105251110';
                })
            })
        ]));
    });

    it('Verifies that the file name is rename and copy to relevant folder if process success', async () => {

        // Create a sample payload with S3 message format
        const event = {
            Records: [
                {
                    s3: {
                        bucket: {
                            name: 'test-bucket',
                        },
                        object: {
                            key: 'test-key',
                        },
                    },
                },
            ],
        };

        // Import all functions from s3-json-logger.js. The imported module uses the mock AWS SDK
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler.js');
        await s3JsonLogger.s3EmployerFileHandler(event, null);

        // Verify that console.log has been called with the expected payload
        // expect(console.log).toHaveBeenCalledWith(objectBody);
         expect(db.getEmployerEligibilityList).toHaveBeenCalled();
         expect(db.getEmployerByFolder).toHaveBeenCalled();
         expect(db.getReseller).toHaveBeenCalled();
         expect(db.createFileHistoryLog).toHaveBeenCalled();
        expect(db.updateFileHistoryLog).toHaveBeenCalled();
    });

    // This test invokes the s3-json-logger Lambda function and verifies that the received payload is logged
    it('Verifies the object is read and the payload is processed - no validation', async () => {
        AWS.mock('S3', 'getObject', Buffer.from(require("fs").readFileSync("__tests__/s3-example/test.csv")));

        // Create a sample payload with S3 message format
        const event = {
            Records: [
                {
                    s3: {
                        bucket: {
                            name: 'test-bucket',
                        },
                        object: {
                            key: 'test-key',
                        },
                    },
                },
            ],
        };

        // Import all functions from s3-json-logger.js. The imported module uses the mock AWS SDK
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler.js');
        await s3JsonLogger.s3EmployerFileHandler(event, null);

        // Verify that console.log has been called with the expected payload
        // expect(console.log).toHaveBeenCalledWith(objectBody);
        expect(db.getEmployerEligibilityList).toHaveBeenCalled();
        expect(db.getEmployerByFolder).toHaveBeenCalled();
        expect(db.createFileHistoryLog).toHaveBeenCalled();
        expect(db.updateFileHistoryLog).toHaveBeenCalled();
        expect(db.updateFileHistoryLog).toBeCalledWith(
            12,
            expect.anything()
        );

        AWS.restore('S3', 'getObject');
    });

    it('Verifies the object is read and the payload is processed - multi eligibility file sources', async () => {
        AWS.mock('S3', 'getObject', Buffer.from(require("fs").readFileSync("__tests__/s3-example/test.csv")));
        db.getEmployerByFolder = jest.fn().mockResolvedValue([[{...EMPLOYER,
            mapping_rules: JSON.stringify({source1: mapping}),
            record_source: JSON.stringify([{file: 'eligibility_.*.csv', source_name: 'source1'}])
        }], []]);

        // Create a sample payload with S3 message format
        const event = {
            Records: [
                {
                    s3: {
                        bucket: {
                            name: 'test-bucket',
                        },
                        object: {
                            key: 'eligibility_20220101.csv',
                        },
                    },
                },
            ],
        };

        // Import all functions from s3-json-logger.js. The imported module uses the mock AWS SDK
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler.js');
        await s3JsonLogger.s3EmployerFileHandler(event, null);

        // Verify that console.log has been called with the expected payload
        // expect(console.log).toHaveBeenCalledWith(objectBody);
        expect(db.getEmployerEligibilityList).toHaveBeenCalled();
        expect(db.getEmployerByFolder).toHaveBeenCalled();
        expect(db.createFileHistoryLog).toHaveBeenCalled();
        expect(db.updateFileHistoryLog).toHaveBeenCalled();
        expect(db.updateFileHistoryLog).toBeCalledWith(
            12,
            expect.anything()
        );
        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.last_name === 'Johnson' && json.eligibility.record_source === 'source1' && json.fileHistId === 12;
                })
            })
        ]));

        AWS.restore('S3', 'getObject');
    });

    it('Verifies the object is mapped and add new eligibility', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHNNY', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"}];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;
        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped and failes on duplicate records', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'Ron', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
    });

    it('Verifies the object is mapped and failes on suspecious char found - ;', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT12345;", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'VT12345%3B';
                })
            })
        ]));
    });
    it('Verifies the object is mapped and failes on suspecious char found - <>', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "<VT12345>", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === '%3CVT12345%3E';
                })
            })
        ]));
    });
    it('Verifies the object is mapped and failes on suspecious char found - {}', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "{VT12345}", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === '%7BVT12345%7D';
                })
            })
        ]));
    });
    it('Verifies the object is mapped and failes on suspecious char found - []', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "[VT12345]", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === '%5BVT12345%5D';
                })
            })
        ]));
    });
    it('Verifies the object is mapped and failes on suspecious char found - =', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "=VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === '%3DVT12345';
                })
            })
        ]));
    });


    it('Verifies the object is mapped and update existing eligibility', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON-NEW', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "test@noreply.com"}];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [ELIG_REC1];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.last_name === 'JOHNSON-NEW' && json.fileHistId === fileLogID;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped and update existing eligibility when existing email is empty', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON-NEW', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "test@noreply.com"}];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [{...ELIG_REC1, email: null}];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'test@noreply.com' && json.fileHistId === fileLogID;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped and update existing eligibility when existing email is empty and current eligibility is empty', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON-NEW', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": null}];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [{...ELIG_REC1, email: ''}];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email.match(/el_\d{10,}_test_employer@mydario\.com/) && json.eligibility.generated_email === 1 && json.fileHistId === fileLogID;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped and update existing eligibility DATE changes', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let dob = new Date('1973-03-08T00:00:00.000Z');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Date of Birth": dob, "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "test@noreply.com"}];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [ELIG_REC1];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    // console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>', json.eligibility.dob, dob);
                    return json.eligibility.dob === dob.toISOString() && json.fileHistId === fileLogID;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped and update existing INACTIVE eligibility to ACTIVE', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "test@noreply.com"}];
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [{...ELIG_REC1, status: "ineligible"}];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.last_name === 'JOHNSON' && json.fileHistId === fileLogID;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped and NOT updates existing eligibility', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON',"Date of Birth": "09/08/1984", "Vitality ID": "VS00123456", "Role": "EE", "Employee ID": '123456', "Email Address": "test@noreply.com", "Gender": "male", "Termination Date": "09/08/2024"}];
        let employer = {id: 23, external_id: '99999', mapping_rules: JSON.stringify(mapping), eligibility_rules: elig_rules};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [ELIG_REC1];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies existing eligibility is revoked when not in eligibility list', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let filerecords = [];
        let employer = {id: 23, external_id: '99999', schema, _validate: ajv.compile(schema), mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [ELIG_REC1];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(filerecords, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'remove'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.fileHistId === fileLogID;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(1);
    });

    it('Verifies existing eligibility is NOT added to grace queue when not have grace in JSON', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let filerecords = [];

        let grace_elig_rules = {...JSON.parse(elig_rules)}

        let employer = {id: 23, external_id: '99999', schema, _validate: ajv.compile(schema), mapping_rules: mapping, eligibility_rules: grace_elig_rules};
        let currentEligibility = [ELIG_REC1];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(filerecords, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).not.toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'grace'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.fileHistId === fileLogID;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(1);
    });

    it('Verifies existing eligibility is added to grace queue when not in eligibility list', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let filerecords = [];

        let grace_elig_rules = {...JSON.parse(elig_rules), grace: 30}

        let employer = {id: 23, external_id: '99999', schema, _validate: ajv.compile(schema), mapping_rules: mapping, eligibility_rules: grace_elig_rules};
        let currentEligibility = [ELIG_REC1];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(filerecords, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'grace'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.fileHistId === fileLogID;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(1);
    });

    it('Verifies existing eligibility is added to ungrace queue when back to eligibility list', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let filerecords = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "test@noreply.com", "Gender": "male"}]

        let grace_elig_rules = {...JSON.parse(elig_rules), grace: 30}

        let employer = {id: 23, external_id: '99999', schema, _validate: ajv.compile(schema), mapping_rules: mapping, eligibility_rules: grace_elig_rules};
        let currentEligibility = [{...ELIG_REC1, grace_period: '2022-12-12'}];
        let fileLogID = 546;

        const res = await s3JsonLogger.processEligibility(filerecords, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'ungrace'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.fileHistId === fileLogID;
                })
            })
        ]));
        // expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped with empty email generates fake email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "", "Gender": "male"}];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email.match(/el_\d{10,}_test_employer@mydario\.com/) && json.eligibility.generated_email === 1;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped with empty email generates fake email when employer name has spaces', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "", "Gender": "male"}];
        let employer = {id: 23, external_id: '99999', name: 'test  employer', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email.match(/el_\d{10,}_test_employer@mydario\.com/) && json.eligibility.generated_email === 1;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped with empty email uses existing fake email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON-NEW', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": ""}];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [{...ELIG_REC1, email: 'existing@mydario.com'}];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'existing@mydario.com';
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped with real email replaces existing fake email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON-NEW', "Employee ID": '123456', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "valid_email@mydario.com"}];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [{...ELIG_REC1, email: 'el_1609798568_commscope@mydario.com', generated_email: 1}];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'valid_email@mydario.com' && json.eligibility.generated_email === 0;
                })
            })
        ]));
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies the object is mapped with inheritance of employee id', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Employee ID": '123456', "Role": "EE"},
            {"Employee ID": '', "Role": "CA"},
            {"Employee ID": '123400', "Role": "EE"},
        ];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Employee ID":{"key":"reseller_employee_id","transform":"inherit:Role"}, "Role":{"key":"role","default":"EE"}})};
        let currentEligibility = [];
        let fileLogID = 546;
        // console.log = console.xlog;
        jsonMap.setupEmployerMappingRules(employer);

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === '123456';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === '123400';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with email transition', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Vitality ID": "VS00123456", "Role": "EE", "Employee ID": '123456', "Email Address": "NOEmail@corp.com", "Gender": "male", "Date of Birth": "9/08/1984"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Email Address":{"key":"email","transform":"email"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'noemail@corp.com';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with email transition and ignores invalid email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Vitality ID": "VS00123456", "Role": "EE", "Employee ID": '123456', "Email Address": "NOEMAIL@commscope.com", "Gender": "male", "Date of Birth": "9/08/1984"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Email Address":{"key":"email","transform":"email:^noemail@commscope.com$"}, "FirstName":"first_name","LastName":"last_name","Vitality ID":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
                expect.objectContaining({
                    MessageBody: expect.toBeValid(jsonstr => {
                        const json = JSON.parse(jsonstr);
                        return json.eligibility.email.match(/el_\d{10,}_test@mydario\.com/) && json.eligibility.generated_email === 1;
                    })
                })
            ]));
    });

    it('Verifies the object is mapped with valid_email transition and generate fake email for invalid email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Vitality ID": "VS00123456", "Role": "EE", "Employee ID": '123456', "Email Address": "no email", "Gender": "male", "Date of Birth": "9/08/1984"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Email Address":{"key":"email","transform":"valid_email"}, "FirstName":"first_name","LastName":"last_name","Vitality ID":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
                expect.objectContaining({
                    MessageBody: expect.toBeValid(jsonstr => {
                        const json = JSON.parse(jsonstr);
                        return json.eligibility.email.match(/el_\d{10,}_test@mydario\.com/) && json.eligibility.generated_email === 1;
                    })
                })
            ]));
    });

    it('Verifies the object is mapped with employee_email transition and generate fake email for non-employee record', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Vitality ID": "VS00123456", "Role": "SP", "Employee ID": '123456', "Email Address": "myemail@comp.com", "Gender": "male", "Date of Birth": "9/08/1984"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Email Address":{"key":"email","transform":"employee_email:Role"}, "FirstName":"first_name","LastName":"last_name","Vitality ID":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
                expect.objectContaining({
                    MessageBody: expect.toBeValid(jsonstr => {
                        const json = JSON.parse(jsonstr);
                        return json.eligibility.email.match(/el_\d{10,}_test@mydario\.com/) && json.eligibility.generated_email === 1;
                    })
                })
            ]));
    });

    it('Verifies the object is mapped with employee_email transition and map email for employee record', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Vitality ID": "VS00123456", "Role": "EE", "Employee ID": '123456', "Email Address": "myemail@comp.com", "Gender": "male", "Date of Birth": "9/08/1984"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Email Address":{"key":"email","transform":"employee_email:Role"}, "FirstName":"first_name","LastName":"last_name","Vitality ID":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
                expect.objectContaining({
                    MessageBody: expect.toBeValid(jsonstr => {
                        const json = JSON.parse(jsonstr);
                        return json.eligibility.email=== 'myemail@comp.com' && !json.eligibility.generated_email;
                    })
                })
            ]));
    });

    it('Verifies the object is mapped with employee_email transition and map invalid email for employee record as fake email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Vitality ID": "VS00123456", "Role": "EE", "Employee ID": '123456', "Email Address": "myinvalidemail", "Gender": "male", "Date of Birth": "9/08/1984"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Email Address":{"key":"email","transform":"employee_email:Role"}, "FirstName":"first_name","LastName":"last_name","Vitality ID":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
                expect.objectContaining({
                    MessageBody: expect.toBeValid(jsonstr => {
                        const json = JSON.parse(jsonstr);
                        return json.eligibility.email.match(/el_\d{10,}_test@mydario\.com/) && json.eligibility.generated_email === 1;
                    })
                })
            ]));
    });

    it('Verifies the fake email created and identified correctly', async () => {
        let fakeEmail = utils.generateFakeEmail('ibm');
        let fake = utils.isFakeEmail(fakeEmail);
        expect(fake).toBe(true);
    });

    it('Verifies the indentification of fake mail backward compatible', async () => {
        let fake = utils.isFakeEmail('el_1609798568_commscope@mydario.com');
        expect(fake).toBe(true);
    });

    it('Verifies the object is mapped with email transition and pass valid email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Vitality ID": "VS00123456", "Role": "EE", "Employee ID": '123456', "Email Address": "GoodEmail@corp.com", "Gender": "male", "Date of Birth": "9/08/1984"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules, mapping_rules: JSON.stringify({"Email Address":{"key":"email","transform":"email:^noemail@.*$"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'goodemail@corp.com';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with hash transformation and pass valid email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON'}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"__DUMMY__":{"key":"emp_id","transform":"hash:FirstName:LastName"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.emp_id === 'B1676163812';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with phone_number transformation and pass valid phone number', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "PhoneNumber": '516-375-9444'}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"PhoneNumber":{"key":"phone","transform":"phone_number"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3CSVHandler.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.phone === '+15163759444';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with phone_number transformation and pass invalid phone number', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "PhoneNumber": '516-375'}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"PhoneNumber":{"key":"phone","transform":"phone_number"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3CSVHandler.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.phone === undefined;
                })
            })
        ]));
    });

    it('Verifies the object is mapped with phone_number transformation and pass empty phone number', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "PhoneNumber": null}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"PhoneNumber":{"key":"phone","transform":"phone_number"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3CSVHandler.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.phone === undefined;
                })
            })
        ]));
    });

    it('Verifies the object is mapped with gender transformation and pass long gender', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Gender": 'Female'}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Gender":{"key":"gender","transform":"gender"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3CSVHandler.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.gender === 'F';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with gender transformation and pass short gender', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Gender": 'M'}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Gender":{"key":"gender","transform":"gender"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3CSVHandler.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.gender === 'M';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with gender transformation and pass other short gender', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Gender": 'U'}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Gender":{"key":"gender","transform":"gender"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3CSVHandler.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.gender === 'U';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with gender transformation and pass empty gender', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Gender": null}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Gender":{"key":"gender","transform":"gender"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3CSVHandler.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return !json.eligibility.gender;
                })
            })
        ]));
    });

    it('Verifies the object is mapped with gender transformation with default value and pass empty gender', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN', "LastName": 'JOHNSON', "Gender": null}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Gender":{"key":"gender","transform":"gender","default": "U"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3CSVHandler.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.gender === 'U';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with hash 2 transformation and pass valid email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{FirstName: 'Jerry',MiddleName: 'F',LastName: 'Seinfeld',DateOfBirth: '19610304'}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Employee ID":{"key":"reseller_employee_id","transform":"hash:FirstName:LastName:DateOfBirth"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'B849994826';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with trim transformation - preserve trailing spaces when no trim', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{FirstName: '  Jerry  ',MiddleName: 'F',LastName: 'Seinfeld',DateOfBirth: '19610304',"Employee ID":"123456"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Employee ID":{"key":"reseller_employee_id"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.first_name === '  Jerry  ';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with trim transformation - trim trailing spaces when using trim', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{FirstName: '  Jerry  ',MiddleName: 'F',LastName: 'Seinfeld',DateOfBirth: '19610304',"Employee ID":"123456"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Employee ID":{"key":"reseller_employee_id"}, "FirstName":{"key":"first_name","transform":"trim"},"LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.first_name === 'Jerry';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with date transformation - date format including hour, minute, second', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{FirstName: '  Jerry  ',MiddleName: 'F',LastName: 'Seinfeld',DateOfBirth: '10/3/1950 0:00',"Employee ID":"123456"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Employee ID":{"key":"reseller_employee_id"},"DateOfBirth":{"key":"dob","transform":"date:MM/D/YYYY H:mm"},"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.dob === (new Date('1950-10-03T00:00:00.000')).toISOString();
                })
            })
        ]));
    });

    it('Verifies the object is mapped - mapping of field with special characters', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{'Social Security No.': '000-00-0001', FirstName: 'Jerry',MiddleName: 'F',LastName: 'Seinfeld',DateOfBirth: '19610304',"Employee ID":"123456"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Social Security No\\.":{"key":"reseller_employee_id"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === '000-00-0001';
                })
            })
        ]));
    });

    it('Verifies the object is mapped - in validation mode, nothing is sent to queue', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{'Social Security No.': '000-00-0001', FirstName: 'Jerry',MiddleName: 'F',LastName: 'Seinfeld',DateOfBirth: '19610304',"Employee ID":"123456"}];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, validation: true},
            mapping_rules: JSON.stringify({"Social Security No\\.":{"key":"reseller_employee_id"}, "FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of removals by int', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, remove_limit: 2},
            mapping_rules: JSON.stringify({"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com'},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com'},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com'}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of removals by percents', async () => {
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, remove_limit: '3%'},
            mapping_rules: JSON.stringify({"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com'},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com'},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com'}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of removals by wrong string', async () => {
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, remove_limit: 'aaa'},
            mapping_rules: JSON.stringify({"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com'},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com'},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com'}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of removals by default', async () => {
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json},
            mapping_rules: JSON.stringify({"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com'},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com'},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com'}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of removed_enrolled_users by int', async () => {
        db.getRedeemedProductsList = jest.fn().mockResolvedValue([[{}, {}],[]]);
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, remove_limit: 10, removed_enrolled_users_limit: 2},
            mapping_rules: JSON.stringify({"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com'},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com'},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com'}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of removed_enrolled_users by percents', async () => {
        db.getRedeemedProductsList = jest.fn().mockResolvedValue([[{}, {}],[]]);
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, remove_limit: 10, removed_enrolled_users_limit: '2%'},
            mapping_rules: JSON.stringify({"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com'},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com'},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com'}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of removed_enrolled_users by wrong string', async () => {
        db.getRedeemedProductsList = jest.fn().mockResolvedValue([[{}, {}],[]]);
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, remove_limit: 10, removed_enrolled_users_limit: 'aaa'},
            mapping_rules: JSON.stringify({"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com'},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com'},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com'}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of removed_enrolled_users by default', async () => {
        db.getRedeemedProductsList = jest.fn().mockResolvedValue([[{}, {}],[]]);
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, remove_limit: 10},
            mapping_rules: JSON.stringify({"FirstName":"first_name","LastName":"last_name"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com'},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com'},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com'}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of updates by int', async () => {
            const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
            let records = [
                {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1_new', "employee_id": '1000001',email: 'john1@mydario.com',"reseller_employee_id": "VS00123451"},
                {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2_new', "employee_id": '1000002',email: 'john2@mydario.com',"reseller_employee_id": "VS00123452"},
                {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3_new', "employee_id": '1000003',email: 'john3@mydario.com',"reseller_employee_id": "VS00123453"}
            ];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, update_limit: 2},
            mapping_rules: JSON.stringify({"first_name":"first_name","last_name":"last_name","email":"email","role":"role","employee_id":"employee_id","reseller_employee_id":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com',"reseller_employee_id": "VS00123451"},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com',"reseller_employee_id": "VS00123452"},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com',"reseller_employee_id": "VS00123453"}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of updates by percents', async () => {
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1_new', "employee_id": '1000001',email: 'john1@mydario.com',"reseller_employee_id": "VS00123451"},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2_new', "employee_id": '1000002',email: 'john2@mydario.com',"reseller_employee_id": "VS00123452"},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3_new', "employee_id": '1000003',email: 'john3@mydario.com',"reseller_employee_id": "VS00123453"}
        ];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, update_limit: '2%'},
            mapping_rules: JSON.stringify({"first_name":"first_name","last_name":"last_name","email":"email","role":"role","employee_id":"employee_id","reseller_employee_id":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com',"reseller_employee_id": "VS00123451"},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com',"reseller_employee_id": "VS00123452"},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com',"reseller_employee_id": "VS00123453"}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of updates by wrong string', async () => {
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1_new', "employee_id": '1000001',email: 'john1@mydario.com',"reseller_employee_id": "VS00123451"},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2_new', "employee_id": '1000002',email: 'john2@mydario.com',"reseller_employee_id": "VS00123452"},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3_new', "employee_id": '1000003',email: 'john3@mydario.com',"reseller_employee_id": "VS00123453"}
        ];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json, update_limit: 'aaa'},
            mapping_rules: JSON.stringify({"first_name":"first_name","last_name":"last_name","email":"email","role":"role","employee_id":"employee_id","reseller_employee_id":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com',"reseller_employee_id": "VS00123451"},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com',"reseller_employee_id": "VS00123452"},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com',"reseller_employee_id": "VS00123453"}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped - do not process on large number of updates by default', async () => {
        db.getEmployerEligibilityCount = jest.fn().mockResolvedValue([[{count: 20}], []]);
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1_new', "employee_id": '1000001',email: 'john1@mydario.com',"reseller_employee_id": "VS00123451"},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2_new', "employee_id": '1000002',email: 'john2@mydario.com',"reseller_employee_id": "VS00123452"},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3_new', "employee_id": '1000003',email: 'john3@mydario.com',"reseller_employee_id": "VS00123453"}
        ];
        let employer = {id: 23, external_id: '99999', name: 'test', eligibility_rules: {...elig_rules_json},
            mapping_rules: JSON.stringify({"first_name":"first_name","last_name":"last_name","email":"email","role":"role","employee_id":"employee_id","reseller_employee_id":"reseller_employee_id"})};
        jsonMap.setupEmployerMappingRules(employer);
        let currentEligibility = [
            {...ELIG_REC1, "id": 1, "first_name": 'John1', "last_name": 'Smith1', "employee_id": '1000001',email: 'john1@mydario.com',"reseller_employee_id": "VS00123451"},
            {...ELIG_REC1, "id": 2, "first_name": 'John2', "last_name": 'Smith2', "employee_id": '1000002',email: 'john2@mydario.com',"reseller_employee_id": "VS00123452"},
            {...ELIG_REC1, "id": 3, "first_name": 'John3', "last_name": 'Smith3', "employee_id": '1000003',email: 'john3@mydario.com',"reseller_employee_id": "VS00123453"}
        ];
        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies fixed width parser', async () => {

        let streamFile = fs.createReadStream("__tests__/s3-example/fixed-width.txt")

        let parserConf = {
            "name": "FIXED_WIDTH",
            "startParseAtRow": 1,
            "removeLastRow": true,
            "removeEmptyRow": true,
            "file_structure": {
                "Member Number": {
                    "type": "string",
                    "width": 11,
                    "start": 2
                },
                "Last Name": {
                    "type": "string",
                    "width": 30,
                    "start": 13
                },
                "First Name": {
                    "type": "string",
                    "width": 15,
                    "start": 43
                },
                "Date of Birth": {
                    "type": "string",
                    "width": 8,
                    "start": 59
                }
            }
        }

        let result = await csvSrv.fixedWidthParseFile(streamFile, parserConf)
        expect(result).toEqual([
            {
                'Member Number': '02962969702',
                'Last Name': 'POWELL                        ',
                'First Name': 'ERIN           ',
                'Date of Birth': '19760611'
              },
              {
                'Member Number': '10752744804',
                'Last Name': 'CULVER                        ',
                'First Name': 'EDWARD         ',
                'Date of Birth': '19880204'
              },
              {
                'Member Number': '52647468003',
                'Last Name': 'MARCOTTE                      ',
                'First Name': 'LORNA          ',
                'Date of Birth': '19911029'
              },
              {
                'Member Number': '30866542203',
                'Last Name': 'VOSSBERG                      ',
                'First Name': 'GEORGE         ',
                'Date of Birth': '19890419'
              },
              {
                'Member Number': '30866542204',
                'Last Name': 'VOSSBERG                      ',
                'First Name': 'CLAYTON        ',
                'Date of Birth': '19920812'
              },
              {
                'Member Number': '10752744803',
                'Last Name': 'CULVER                        ',
                'First Name': 'MELISSA        ',
                'Date of Birth': '19920430'
              }
        ]);
    });

    it('Verifies incremental files with fixed width parser', async () => {

        const files = [
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/MAD.txt"), key: 'MAD'},
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/HIS.txt"), key: 'HIS'},
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/MEM.txt"), key: 'MEM'}
        ];
        let membersObj = {}

        const parserConf = {
            // "name": "FIXED_WIDTH",
            "cron_parser_name":"FIXED_WIDTH",
            "primaryKeys":["employee_id"],
            "removeEmptyRow": true,
            "parserFileWithFileName": true,
            "file_structure": {
                "MAD": {
                    "reseller_employer_id": {
                        "type": "string",
                        "width": 7,
                        "start": 21
                    },
                    "employee_id": {
                        "type": "string",
                        "width": 8,
                        "start": 28
                    },
                    "address_1": {
                        "type": "string",
                        "width": 55,
                        "start": 37
                    },
                    "address_2": {
                        "type": "string",
                        "width": 55,
                        "start": 92
                    },
                    "city": {
                        "type": "string",
                        "width": 30,
                        "start": 147
                    },
                    "state": {
                        "type": "string",
                        "width": 2,
                        "start": 177
                    },
                    "zipcode": {
                        "type": "string",
                        "width": 9,
                        "start": 179
                    },
                    "phone": {
                        "type": "string",
                        "width": 20,
                        "start": 188
                    },
                    "email": {
                        "type": "string",
                        "width": 50,
                        "start": 208
                    }
                },
                "HIS": {
                    "reseller_employer_id": {
                        "type": "string",
                        "width": 7,
                        "start": 21
                    },
                    "employee_id": {
                        "type": "string",
                        "width": 8,
                        "start": 28
                    },
                    "effective_date": {
                        "type": "string",
                        "width": 8,
                        "start": 60
                    },
                    "end_date": {
                        "type": "string",
                         "type": "string",
                        "width": 8,
                        "start": 68
                    }
                },
                "MEM": {
                    "reseller_employer_id": {
                        "type": "string",
                        "width": 7,
                        "start": 21
                    },
                    "employee_id": {
                        "type": "string",
                        "width": 8,
                        "start": 28
                    },
                    "role": {
                        "type": "string",
                        "width": 1,
                        "start": 37
                    },
                    "ssn": {
                        "type": "string",
                        "width": 9,
                        "start": 68
                    },
                    "lastName":{
                        "type": "string",
                        "width": 35,
                        "start": 77
                    },
                    "firstName":{
                        "type": "string",
                        "width": 25,
                        "start": 112
                    },
                    "dob":{
                        "type": "string",
                        "width": 8,
                        "start": 137
                    },
                    "gender":{
                        "type": "string",
                        "width": 1,
                        "start": 145
                    }
                }
            }
        }

        for(let i = 0 ;  i < files.length; i++){
            const fileData = await csvSrv[constants.FileParser.FIXED_WIDTH](files[i].file, parserConf, files[i].key);
            const primaryKeys = parserConf.primaryKeys;
            const matchDataBetweenFilesFunction = parserConf.matchMultipleFilesByFunction || constants.matchMultipleFilesByFunction.DEFAULT;
            membersObj = await multipleFilesSrv[matchDataBetweenFilesFunction](fileData, primaryKeys, membersObj);
        }

        console.log('incremental-fixed width parser-res', membersObj)
        // check obj keys
        expect(membersObj).toHaveProperty('999999ee');
        expect(membersObj).toHaveProperty('999988ee');

    });

    it('Verifies incremental files with papa parser - broken headers 600 records', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let membersObj = {}

        const parserConf = {
            "primaryKeys": [
                "SSN",
                "SSN NO"
            ],
            "headerTransform": [
                {
                    "encoding": "base64",
                    "brokenHeader": utils.stringToBase64("\"GROUP(\\r\\n|\\n|\\r|[\\s\\S])NUMBER\",SUB ID,\"MBR(\\r\\n|\\n|\\r|[\\s\\S])ID\",ALT ID,\"EMPLOYEE(\\r\\n|\\n|\\r|[\\s\\S])LAST NAME\",\"EMPLOYEE(\\r\\n|\\n|\\r|[\\s\\S])FIRST NAME\",\"MEMBER(\\r\\n|\\n|\\r|[\\s\\S])LAST NAME\",\"MEMBER(\\r\\n|\\n|\\r|[\\s\\S])FIRST NAME\",SSN NO,GENDER,\"DATE OF(\\r\\n|\\n|\\r|[\\s\\S])BIRTH\",AGE,RELATIONSHIP,\"COVERAGE(\\r\\n|\\n|\\r|[\\s\\S])TIER\",\"HIRE(\\r\\n|\\n|\\r|[\\s\\S])DATE\",\"BEGIN(\\r\\n|\\n|\\r|[\\s\\S])DATE\",ADDRESS,CITY,STATE,\"ZIP(\\r\\n|\\n|\\r|[\\s\\S])CODE\""),
                    "fixedHeader": "GROUP NUMBER,SUB ID,MBR ID,ALT ID,EMPLOYEE LAST NAME,EMPLOYEE FIRST NAME,MEMBER LAST NAME,MEMBER FIRST NAME,SSN NO,GENDER,DATE OF BIRTH,AGE,RELATIONSHIP,COVERAGE TIER,HIRE DATE,BEGIN DATE,ADDRESS,CITY,STATE,ZIP CODE"
                }
            ],
            "removeChars": "SSN|-"
        }
        const files = [
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/contact600.csv").pipe(s3JsonLogger.fileHeaderTransform({parserConf: JSON.stringify( parserConf )})), key: 'contact'},
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/members600.csv").pipe(s3JsonLogger.fileHeaderTransform({parserConf: JSON.stringify( parserConf )})), key: 'members'}
        ];

        for(let i = 0 ;  i < files.length; i++){
            const fileData = await csvSrv.papaParseFile(files[i].file, parserConf, files[i].key);
            const primaryKeys = parserConf.primaryKeys;
            const matchDataBetweenFilesFunction = parserConf.matchMultipleFilesByFunction ? constants.matchMultipleFilesByFunction[parserConf.matchMultipleFilesByFunction] : constants.matchMultipleFilesByFunction.DEFAULT;
            membersObj = await multipleFilesSrv[matchDataBetweenFilesFunction](fileData, primaryKeys, membersObj, files[i].key);
        }

        console.log('incremental-papa parser-res', membersObj)
        // check obj keys
        expect(membersObj).toHaveProperty('103456001');
        // expect(membersObj).toHaveProperty('123456755');
        expect(membersObj[103456001]).toHaveProperty('MEMBER FIRST NAME')
        expect(membersObj[103456001]).toHaveProperty('MEMBER LAST NAME')
        // expect(membersObj[103456001]).toHaveProperty('Home Address Line 1 1')

    });

    it('Verifies incremental files with papa parser - broken headers', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let membersObj = {}

        const parserConf = {
            "primaryKeys": [
                "SSN",
                "SSN NO"
            ],
            "headerTransform": [
                {
                    "brokenHeader": "SSN$$$,Home Address Line 1 1,Home Address Line 2 1,Home City 1,Home State 1,Home Zip 1,Primary Phone,Email,Alternate Email",
                    "fixedHeader": "SSN,Home Address Line 1 1,Home Address Line 2 1,Home City 1,Home State 1,Home Zip 1,Primary Phone,Email,Alternate Email"
                },
                {
                    "encoding": "base64",
                    "brokenHeader": utils.stringToBase64("\"GROUP(\\r\\n|\\n|\\r|[\\s\\S])NUMBER\",SUB ID,\"MBR(\\r\\n|\\n|\\r|[\\s\\S])ID\",ALT ID,\"EMPLOYEE(\\r\\n|\\n|\\r|[\\s\\S])LAST NAME\",\"EMPLOYEE(\\r\\n|\\n|\\r|[\\s\\S])FIRST NAME\",\"MEMBER(\\r\\n|\\n|\\r|[\\s\\S])LAST NAME\",\"MEMBER(\\r\\n|\\n|\\r|[\\s\\S])FIRST NAME\",SSN NO,GENDER,\"DATE OF(\\r\\n|\\n|\\r|[\\s\\S])BIRTH\",AGE,RELATIONSHIP,\"COVERAGE(\\r\\n|\\n|\\r|[\\s\\S])TIER\",\"HIRE(\\r\\n|\\n|\\r|[\\s\\S])DATE\",\"BEGIN(\\r\\n|\\n|\\r|[\\s\\S])DATE\",ADDRESS,CITY,STATE,\"ZIP(\\r\\n|\\n|\\r|[\\s\\S])CODE\""),
                    "fixedHeader": "GROUP NUMBER,SUB ID,MBR ID,ALT ID,EMPLOYEE LAST NAME,EMPLOYEE FIRST NAME,MEMBER LAST NAME,MEMBER FIRST NAME,SSN NO,GENDER,DATE OF BIRTH,AGE,RELATIONSHIP,COVERAGE TIER,HIRE DATE,BEGIN DATE,ADDRESS,CITY,STATE,ZIP CODE"
                },
                {
                    "brokenHeader": "bla bla",
                    "fixedHeader": "GROUP NUMBER,SUB ID,MBR ID,ALT ID,EMPLOYEE LAST NAME,EMPLOYEE FIRST NAME,MEMBER LAST NAME,MEMBER FIRST NAME,SSN NO,GENDER,DATE OF BIRTH,AGE,RELATIONSHIP,COVERAGE TIER,HIRE DATE,BEGIN DATE,ADDRESS,CITY,STATE,ZIP CODE"
                }
            ],
            "removeChars": "SSN|-"
        }
        const files = [
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/contact2.csv").pipe(s3JsonLogger.fileHeaderTransform({parserConf: JSON.stringify( parserConf )})), key: 'contact'},
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/members2broken.csv").pipe(s3JsonLogger.fileHeaderTransform({parserConf: JSON.stringify( parserConf )})), key: 'members'}
        ];

        for(let i = 0 ;  i < files.length; i++){
            const fileData = await csvSrv.papaParseFile(files[i].file, parserConf, files[i].key);
            const primaryKeys = parserConf.primaryKeys;
            const matchDataBetweenFilesFunction = parserConf.matchMultipleFilesByFunction ? constants.matchMultipleFilesByFunction[parserConf.matchMultipleFilesByFunction] : constants.matchMultipleFilesByFunction.DEFAULT;
            membersObj = await multipleFilesSrv[matchDataBetweenFilesFunction](fileData, primaryKeys, membersObj, files[i].key);
        }

        console.log('incremental-papa parser-res', membersObj)
        // check obj keys
        expect(membersObj).toHaveProperty('123456789');
        expect(membersObj).toHaveProperty('123456755');
        expect(membersObj[123456789]).toHaveProperty('MEMBER FIRST NAME')
        expect(membersObj[123456789]).toHaveProperty('MEMBER LAST NAME')
        expect(membersObj[123456789]).toHaveProperty('Home Address Line 1 1')

    });

    it('Verifies incremental files with papa parser - parserConf null', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let membersObj = {}

        const parserConf = {
            "primaryKeys": [
                "SSN",
                "SSN NO"
            ],
            "removeChars": "SSN|-"
        }

        const files = [
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/contact.csv").pipe(s3JsonLogger.fileHeaderTransform({parserConf: null })), key: 'contact'},
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/members.csv").pipe(s3JsonLogger.fileHeaderTransform({parserConf: null })), key: 'members'}
        ];

        for(let i = 0 ;  i < files.length; i++){
            const fileData = await csvSrv.papaParseFile(files[i].file, parserConf, files[i].key);
            const primaryKeys = parserConf.primaryKeys;
            const matchDataBetweenFilesFunction = parserConf.matchMultipleFilesByFunction ? constants.matchMultipleFilesByFunction[parserConf.matchMultipleFilesByFunction] : constants.matchMultipleFilesByFunction.DEFAULT;
            membersObj = await multipleFilesSrv[matchDataBetweenFilesFunction](fileData, primaryKeys, membersObj, files[i].key);
        }

        console.log('incremental-papa parser-res', membersObj)
        // check obj keys
        expect(membersObj).toHaveProperty('123456789');


    });

    it('Verifies incremental files with papa parser - headerTransform undefined', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let membersObj = {}

        const parserConf = {
            "primaryKeys": [
                "SSN",
                "SSN NO"
            ],
            "removeChars": "SSN|-"
        }

        const files = [
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/contact.csv").pipe(s3JsonLogger.fileHeaderTransform({parserConf: JSON.stringify( parserConf ) })), key: 'contact'},
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/members.csv").pipe(s3JsonLogger.fileHeaderTransform({parserConf: JSON.stringify( parserConf ) })), key: 'members'}
        ];

        for(let i = 0 ;  i < files.length; i++){
            const fileData = await csvSrv.papaParseFile(files[i].file, parserConf, files[i].key);
            const primaryKeys = parserConf.primaryKeys;
            const matchDataBetweenFilesFunction = parserConf.matchMultipleFilesByFunction ? constants.matchMultipleFilesByFunction[parserConf.matchMultipleFilesByFunction] : constants.matchMultipleFilesByFunction.DEFAULT;
            membersObj = await multipleFilesSrv[matchDataBetweenFilesFunction](fileData, primaryKeys, membersObj, files[i].key);
        }

        console.log('incremental-papa parser-res', membersObj)
        // check obj keys
        expect(membersObj).toHaveProperty('123456789');


    });

    it('Verifies incremental files with papa parser', async () => {

        const files = [
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/contact.csv"), key: 'contact'},
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/members.csv"), key: 'members'},
        ];
        let membersObj = {}

        const parserConf = {
            "primaryKeys":["SSN", "SSN NO"],
            "removeChars": 'SSN|-'
        }

        for(let i = 0 ;  i < files.length; i++){
            const fileData = await csvSrv.papaParseFile(files[i].file, parserConf, files[i].key);
            const primaryKeys = parserConf.primaryKeys;
            const matchDataBetweenFilesFunction = parserConf.matchMultipleFilesByFunction ? constants.matchMultipleFilesByFunction[parserConf.matchMultipleFilesByFunction] : constants.matchMultipleFilesByFunction.DEFAULT;
            membersObj = await multipleFilesSrv[matchDataBetweenFilesFunction](fileData, primaryKeys, membersObj, files[i].key);
        }

        console.log('incremental-papa parser-res', membersObj)
        // check obj keys
        expect(membersObj).toHaveProperty('123456755');
        expect(membersObj).toHaveProperty('123456789');
    });

    it('Verifies incremental files with papa parser- incorrect primary key', async () => {

        const files = [
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/contact.csv"), key: 'contact'},
            {file: fs.createReadStream("__tests__/s3-example/incrementalFiles/Wichita/members.csv"), key: 'members'},
        ];
        let membersObj = {}

        const parserConf = {
            "primaryKeys":["employee_id"],
            "removeChars": 'SSN|-'
        }

        for(let i = 0 ;  i < files.length; i++){
            const fileData = await csvSrv.papaParseFile(files[i].file, parserConf, files[i].key);
            const primaryKeys = parserConf.primaryKeys;
            const matchDataBetweenFilesFunction = parserConf.matchMultipleFilesByFunction ? constants.matchMultipleFilesByFunction[parserConf.matchMultipleFilesByFunction] : constants.matchMultipleFilesByFunction.DEFAULT;
            membersObj = await multipleFilesSrv[matchDataBetweenFilesFunction](fileData, primaryKeys, membersObj, files[i].key);
        }

        // console.warn('incremental-papa parser-empty res', membersObj);
        expect(membersObj).toEqual({});
    });

    it('Verifies papaParser with parser config remove last row)', async () => {

        let streamFile = fs.createReadStream("__tests__/s3-example/papaParse-optima.csv")

        let parserConf = {
            "name": "DEFAULT",
            "removeLastRow": true
        }

        let result = await csvSrv.papaParseFile(streamFile, parserConf)
        expect(result).toEqual([
            {
                MemberID: '87ndeabdc245759856940293dc0da559',
                SubscriberID: '87bdgabdc245759856940293dc0da288',
                GroupID: '6af586t6e516082c4f6ba24a3bff2r0d',
                GroupName: null,
                SubGroupID: '67ajebd34183ad8f7a159fb67093f2r8',
                SubGroupName: '12c87c10c7b36f6d0fei53bdcaa9fa75',
                LineofBusiness: '26',
                DateofBirth: '20020806',
                Gender: 'F',
                RelationshiptoSubscriber: 'EE',
                EffectiveDate: '20200827',
                TerminationDate: null,
                PharmacyCoverage: null,
                FirstName: 'Doria10',
                MiddleName: null,
                LastName: 'optima',
                MaidenName: null,
                Ethnicity: null,
                Race: null,
                MaritalStatus: null,
                StreetAddress1: 'test10',
                StreetAddress2: null,
                City: 'newYork',
                State: 'NY',
                Zip: '12345',
                HomePhone: '8069207559',
                WorkPhone: null,
                MobilePhone: null,
                PersonalEmail: 'testqa+optima10@mydario.com',
                WorkEmail: 'testqa+optima10@mydario.com',
                OtherEmail: null,
                'PCPID#': 'c63c77f66927bb14725c916ee416b5c8',
                LocationNumber: null,
                OtherMemberID: '86bdeabdt245959856940293dc0da237',
                ReasonforTermination: null,
                DateofDeath: null,
                PCPCopayAmount: null,
                SpecialistCopay: null,
                FacilityCopay: null,
                RxCopayGeneric: null,
                RxCopayBrand: null,
                CoinsuranceRate: null,
                DeductibleAmountIndividual: null,
                OutofPocketMaximumIndividual: null,
                AccountID: '9a0490d6e7e2c96bd403f482e6774e89',
                HbA1c: '30.699999999999999',
                DateofHbA1cmeasurement: null
            },
            {
            MemberID: '87ndeabdc245759856940293dc0da569',
            SubscriberID: '87bdgabdc245759856940293dc0da278',
            GroupID: '6af586t6e516082c4f6ba24a3bff2nd',
            GroupName: null,
            SubGroupID: '67bjebd34183ad8f7a159fb67093f2r8',
            SubGroupName: '22c87c10c7b36f6d0fei53bdcaa9fa75',
            LineofBusiness: '26',
            DateofBirth: '20020806',
            Gender: 'F',
            RelationshiptoSubscriber: 'EE',
            EffectiveDate: '20200827',
            TerminationDate: null,
            PharmacyCoverage: null,
            FirstName: 'Doria11',
            MiddleName: null,
            LastName: 'optima',
            MaidenName: null,
            Ethnicity: null,
            Race: null,
            MaritalStatus: null,
            StreetAddress1: 'test11',
            StreetAddress2: null,
            City: 'newYork',
            State: 'NY',
            Zip: '12345',
            HomePhone: '8069207559',
            WorkPhone: null,
            MobilePhone: null,
            PersonalEmail: 'testqa+optima11@mydario.com',
            WorkEmail: 'testqa+optima11@mydario.com',
            OtherEmail: null,
            'PCPID#': 'd63c77f66927bb14725c916ee416b5c8',
            LocationNumber: null,
            OtherMemberID: '87bdeabdt245959856940293dc0da237',
            ReasonforTermination: null,
            DateofDeath: null,
            PCPCopayAmount: null,
            SpecialistCopay: null,
            FacilityCopay: null,
            RxCopayGeneric: null,
            RxCopayBrand: null,
            CoinsuranceRate: null,
            DeductibleAmountIndividual: null,
            OutofPocketMaximumIndividual: null,
            AccountID: '9m0490d6e7e2c96bd403f482e6774e89',
            HbA1c: '30.699999999999999',
            DateofHbA1cmeasurement: null
            }
        ]);
    });

    it('Verifies papaParser with tab delimiter)', async () => {

        let streamFile = fs.createReadStream("__tests__/s3-example/avenel.txt")

        let parserConf = {}
        const mockData = {
            MRN: "UPDOX 5/2020",
            PersonUID: "E0DFA6EF-51BE-425C-9013-6E8980EA673F",
            LastName: "Abad",
            Gender: "Female",
            FirstName: "Grace",
            Email: "CHRIESELLA@YAHOO.COM",
            BirthDate: "1/24/1965"
        }
        let result = await csvSrv.papaParseFile(streamFile, parserConf)
        // console.warn('tab delimiter-res', result)
        expect(result).toEqual(expect.arrayContaining([expect.objectContaining(mockData)])
        )
    });

    it('Verifies multiline dependents parser)', async () => {

        const streamFile = fs.createReadStream("__tests__/s3-example/CF_Industries.txt")

        const parserConf = {
            name: "MULTILINE_DEPENDENTS",
            firstRole: 'EE',
            startNewLine: ["Spouse", "Dep1", "Dep2", "Dep3", "Dep4", "Dep5"],
            mappingByRole: {
                EE: {
                    'Employee Gender': 'gender',
                    'Employee Date_Of_Birth': 'dob',
                    'First_Name': 'first_name',
                    'Employee_ID': 'reseller_employee_id',
                    'Last_Name': 'last_name'
                },
                Spouse: {
                    'CF-_Spouse_Gender': 'gender',
                    'Spouse_Date_of_birth': 'dob',
                    'Spouse_First_Name': 'first_name',
                    'Spouse__ID': 'reseller_employee_id',
                    'Spouse_Last_Name': 'last_name'
                },
                Dep1: {
                    'Dep1_Gender': 'gender',
                    'Dep1_Date_of_birth': 'dob',
                    'Dep1_First_Name': 'first_name',
                    'Dep1__ID': 'reseller_employee_id',
                    'Dep1_Last_Name': 'last_name'
                },
                Dep2: {
                    'Dep2_Gender': 'gender',
                    'Dep2_Date_of_birth': 'dob',
                    'Dep2_First_Name': 'first_name',
                    'Dep2__ID': 'reseller_employee_id',
                    'Dep2_Last_Name': 'last_name'
                },
                Dep3: {
                    'Dep3_Gender': 'gender',
                    'Dep3_Date_of_birth': 'dob',
                    'Dep3_First_Name': 'first_name',
                    'Dep3__ID': 'reseller_employee_id',
                    'Dep3_Last_Name': 'last_name'
                },
                Dep4: {
                    'Dep4_Gender': 'gender',
                    'Dep4_Date_of_birth': 'dob',
                    'Dep4_First_Name': 'first_name',
                    'Dep4__ID': 'reseller_employee_id',
                    'Dep4_Last_Name': 'last_name'
                },
                Dep5: {
                    'Dep5_Gender': 'gender',
                    'Dep5_Date_of_birth': 'dob',
                    'Dep5_First_Name': 'first_name',
                    'Dep5__ID': 'reseller_employee_id',
                    'Dep5_Last_Name': 'last_name'
                }
            }
        }

        const mockData = {
            role: 'EE',
            reseller_employee_id: '1234',
            first_name: 'Nitzan',
            last_name: 'Vish',
            gender: 'Female',
            dob: '04-15-1990'
        }
        let result = await csvSrv.multilineDependentsParseFile(streamFile, parserConf)
        // console.warn('multiline dependents parser-res', result)
        expect(result).toEqual(expect.arrayContaining([expect.objectContaining(mockData)])
        )
    });

    it('Skip on minors', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Employee ID": "0123456", "FirstName": 'JOHN1', "LastName": 'JOHNSON1', "Role": "EE", "Date of Birth": "09/08/2020"},
            {"Employee ID": "0123456", "FirstName": 'JOHN2', "LastName": 'JOHNSON2', "Role": "SP", "Date of Birth": "10/07/2012"},
            {"Employee ID": "0123457", "FirstName": 'JOHN3', "LastName": 'JOHNSON3',"Role": "EE", "Date of Birth": "09/08/1990"},
            {"Employee ID": "0123457", "FirstName": 'JOHN4', "LastName": 'JOHNSON4', "Role": "SP", "Date of Birth": "10/07/2012"}
        ];
        let mapping = {"Employee ID":"employee_id","FirstName":"first_name","LastName":"last_name","Role":"role","Date of Birth":{"key":"dob","transform":"date:MM/DD/YYYY"}};
        let elig_rules = {"productTypes":["BG","BP"],"validationFields":["first_name","last_name","dob"],"targeting":{"default":true,"minor_age": 19},"skipIfMinor": true,"spouseCheckField": "employee_id"}
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.last_name === 'JOHNSON3';
                })
            })
        ]));
    });

    it('Dont Skip on Effective Date', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Employee ID": "0123456", "FirstName": 'JOHN4', "LastName": 'JOHNSON4', "Role": "SP", "Date of Birth": "10/07/2012","Member's Current Structure Effective Date":"2022-04-7"}
        ];
        let mapping = {"Employee ID":"employee_id","FirstName":"first_name","LastName":"last_name","Role":"role","Date of Birth":{"key":"dob","transform":"date:MM/DD/YYYY"},"Member's Current Structure Effective Date":{"key": "effective_date","transform": "date:YYYYMMDD"}};
        let elig_rules = {"productTypes":["BG","BP"],"validationFields":["first_name","last_name","dob"],"targeting":{"default":true,"minor_age": 19},"skipIfMinor": false,"spouseCheckField": "employee_id","skipIfEffectiveDate": true};
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
     });

     it('Skip on Effective Date', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"FirstName": 'JOHN4', "LastName": 'JOHNSON4', "Role": "SP", "Date of Birth": "10/07/2012","Member's Current Structure Effective Date":"2027-04-8"}
        ];
        let mapping = {"FirstName":"first_name","LastName":"last_name","Role":"role","Date of Birth":{"key":"dob","transform":"date:MM/DD/YYYY"},"Member's Current Structure Effective Date":{"key": "effective_date","transform": "date:YYYYMMDD"}};
        let elig_rules = {"productTypes":["BG","BP"],"validationFields":["first_name","last_name","dob"],"targeting":{"default":true,"minor_age": 19},"skipIfMinor": false,"skipIfEffectiveDate": true}
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
     });
    it('Verifies the object is mapped with ignoring family members email if duplicating the employee email', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Employee ID": '123456', "Role": "EE", "Email": "test1@mycompany.com"},
            {"Employee ID": '123456', "Role": "CA", "Email": "test1@mycompany.com"},
            {"Employee ID": '123400', "Role": "EE", "Email": "test2@mycompany.com"},
        ];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Employee ID":"reseller_employee_id", "Email":{"key":"email","transform":"unique_email:Role"}, "Role":{"key":"role","default":"EE"}})};
        let currentEligibility = [];
        let fileLogID = 546;
        // console.log = console.xlog;
        jsonMap.setupEmployerMappingRules(employer);

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'test1@mycompany.com'  && json.eligibility.role === 'EE';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email.match(/el_\d{10,}_test_employer@mydario\.com/) && json.eligibility.role !== 'EE';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'test2@mycompany.com';
                })
            })
        ]));
    });

    it('Verifies the object is mapped with ignoring family members email if duplicating the employee email and fail on duplicate employee emails', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Employee ID": '123456', "Role": "EE", "Email": "test1@mycompany.com"},
            {"Employee ID": '123456', "Role": "CA", "Email": "test1@mycompany.com"},
            {"Employee ID": '123400', "Role": "EE", "Email": "test1@mycompany.com"},
        ];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({"Employee ID":"reseller_employee_id", "Email":{"key":"email","transform":"unique_email:Role"}, "Role":{"key":"role","default":"EE"}})};
        let currentEligibility = [];
        let fileLogID = 546;
        // console.log = console.xlog;
        jsonMap.setupEmployerMappingRules(employer);

        // await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);
        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error');
    });

    it('Verifies the object is mapped with ignoring family members email if duplicating the employee email (2)', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Employee ID": '123451', "Relationship to Subscriber": "EE", "Work Email": "testqa+minosEE110@mydario.com"},
            {"Employee ID": '123452', "Relationship to Subscriber": "EE", "Work Email": "testqa+minosEE111@mydario.com"},
            {"Employee ID": '123453', "Relationship to Subscriber": "EE", "Work Email": "testqa+minosEE112@mydario.com"},
            {"Employee ID": '123456', "Relationship to Subscriber": "EE", "Work Email": "testqa+minosEE100@mydario.com"},
            {"Employee ID": '123456', "Relationship to Subscriber": "SP", "Work Email": "testqa+minosEE101@mydario.com"},
            {"Employee ID": '123456', "Relationship to Subscriber": "CH", "Work Email": "testqa+minosEE100@mydario.com"},
            {"Employee ID": '123400', "Relationship to Subscriber": "EE", "Work Email": "test2@mycompany.com"},
        ];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({
                "Employee ID":"reseller_employee_id",
                "Work Email":{"key":"email?","transform":"unique_email:Relationship to Subscriber"},
                "Relationship to Subscriber":{"key":"role","default":"EE"}
            })};
        let currentEligibility = [];
        let fileLogID = 546;
        // console.log = console.xlog;
        jsonMap.setupEmployerMappingRules(employer);

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'testqa+minosee100@mydario.com'  && json.eligibility.role === 'EE';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email.match(/el_\d{10,}_test_employer@mydario\.com/) && json.eligibility.role !== 'EE';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email === 'test2@mycompany.com';
                })
            })
        ]));
    });

    it('Skip on Delta File', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            { "FirstName": 'JOHN4', "LastName": 'JOHNSON4', "Role": "SP", "Date of Birth": "10/07/2012", "Member's Current Structure Effective Date": "2027-04-8" }
        ];
        let mapping = { "FirstName": "first_name", "LastName": "last_name", "Role": "role", "Date of Birth": { "key": "dob", "transform": "date:MM/DD/YYYY" }, "Member's Current Structure Effective Date": { "key": "effective_date", "transform": "date:YYYYMMDD" } };
        let elig_rules = { "productTypes": ["BG", "BP"], "validationFields": ["first_name", "last_name", "dob"], "targeting": { "default": true, "minor_age": 19 }, "skipIfMinor": false, "skipIfEffectiveDate": true,"isDeltaFile": false}
        let employer = { id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules };
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(0);
    });

    it('Verifies the object is mapped with ignoring family members email if duplicating the employee email (3)', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Employee ID": '0443398', "Member ID": "00443398AdamAndrews19840205", "First Name": "Adam", "Last Name": "Andrews", "Relationship to Subscriber": "EE", "Work Email": "aaandrew@dario.com"},
            {"Employee ID": '0443398', "Member ID": "00443398AddisonAndrews20110415", "First Name": "Addison", "Last Name": "Andrews", "Relationship to Subscriber": "CH", "Work Email": null},
            {"Employee ID": '0443398', "Member ID": "00443398AnsonAndrews20150511", "First Name": "Anson", "Last Name": "Andrews", "Relationship to Subscriber": "CH", "Work Email": null},
            {"Employee ID": '0443398', "Member ID": "00443398AutumnbreannaGrinnall19900422", "First Name": "Autumnbreanna", "Last Name": "Grinnall", "Relationship to Subscriber": "DP", "Work Email": null},
        ];
        let employer = {id: 23, external_id: '99999', name: 'test_employer', eligibility_rules: elig_rules,
            mapping_rules: JSON.stringify({
                "Employee ID":"employee_id",
                "Member ID": "reseller_employee_id",
                "First Name":{"key":"first_name","transform":"trim"},
                "Last Name":{"key":"last_name","transform":"trim"},
                "Work Email":{"key":"email?","transform":"unique_email:Relationship to Subscriber"},
                "Relationship to Subscriber":{"key":"role","default":"EE"}
            })};
        let currentEligibility = [
            {"first_name":"Adam","last_name":"Andrews","email":"aaandrew@dario.com","role":"EE","shop_phone":null,"gender":"M","dob":new Date("1984-02-05T00:00:00.000Z"),"status":"eligible","stage":"new","employee_id":"0443398","reseller_employee_id":"00443398AdamAndrews19840205","reseller_member_id":null,"group_name":null,"branch":null,"pcp_id":null,"pcp_id_2":null,"targeting":1,"record_source":"union_pacific","payer":"UMR","termination_date":null,"external_employer_id":null,"preferred_language":null},
            {"first_name":"Addison","last_name":"Andrews","email":null,"role":"CH","shop_phone":null,"gender":"F","dob":new Date("2011-04-15T00:00:00.000Z"),"status":"eligible","stage":"new","employee_id":"0443398","reseller_employee_id":"00443398AddisonAndrews20110415","reseller_member_id":null,"group_name":null,"branch":null,"pcp_id":null,"pcp_id_2":null,"targeting":1,"app_email":null,"generated_email":0,"record_source":"union_pacific","payer":"UMR","termination_date":null,"external_employer_id":null,"preferred_language":null},
            {"first_name":"Anson","last_name":"Andrews","email":null,"role":"CH","shop_phone":null,"gender":"M","dob":new Date("2015-05-11T00:00:00.000Z"),"status":"eligible","stage":"new","employee_id":"0443398","reseller_employee_id":"00443398AnsonAndrews20150511","reseller_member_id":null,"group_name":null,"branch":null,"pcp_id":null,"pcp_id_2":null,"targeting":1,"app_email":null,"generated_email":0,"flow_id":1250,"record_source":"union_pacific","payer":"UMR","termination_date":null,"external_employer_id":null,"preferred_language":null},
            {"first_name":"Autumnbreanna","last_name":"Grinnall","email":null,"role":"DP","shop_phone":null,"gender":"F","dob":new Date("1990-04-22T00:00:00.000Z"),"status":"eligible","stage":"new","employee_id":"0443398","reseller_employee_id":"00443398AutumnbreannaGrinnall19900422","reseller_member_id":null,"group_name":null,"branch":null,"pcp_id":null,"pcp_id_2":null,"targeting":1,"generated_email":1,"flow_id":1250,"record_source":"union_pacific","payer":"UMR","termination_date":null,"external_employer_id":null,"preferred_language":null}
        ];
        let fileLogID = 546;
        // console.log = console.xlog;
        jsonMap.setupEmployerMappingRules(employer);

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email.match(/el_\d{10,}_test_employer@mydario\.com/) && json.eligibility.role !== 'CH';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email.match(/el_\d{10,}_test_employer@mydario\.com/) && json.eligibility.role !== 'CH';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.email.match(/el_\d{10,}_test_employer@mydario\.com/) && json.eligibility.role !== 'DP';
                })
            }),
        ]));
    });

    it('Verifies that correct original record map to DB', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [{"FirstName": 'JOHN1', "LastName": 'JOHNSON1', "Vitality ID": "VS00123451", "Role": "EE",  "Email Address": "no email", "Gender": "male", "Date of Birth": "09/08/2021","Effective Date":"2027-04-8"}, //skip on minor
                        {"FirstName": 'JOHN2', "LastName": 'JOHNSON2', "Vitality ID": "VS00123452", "Role": "EE", "Email Address": "aviv@gmail.com", "Gender": "male", "Date of Birth": "9/08/1984","Effective Date":"2022-01-1"},//valid
                        {"FirstName": 'JOHN3', "LastName": 'JOHNSON3', "Vitality ID": "VS00123453", "Role": "EE", "Email Address": "no email", "Gender": "male", "Date of Birth": "9/08/1984","Effective Date":"2027-04-8"},//skip on effective date;
                        {"FirstName": 'JOHN4', "LastName": 'JOHNSON4', "Vitality ID": "VS00123454", "Role": "EE",  "Email Address": "no email", "Gender": "male", "Date of Birth": "09/08/2015","Effective Date":"2021-04-8"}, //skip on minor
                        {"FirstName": 'JOHN5', "LastName": 'JOHNSON5', "Vitality ID": "VS00123455", "Role": "EE", "Email Address": "no email", "Gender": "male", "Date of Birth": "9/08/1954","Effective Date":"2022-01-1"}, //valid
                        {"FirstName": 'JOHN6', "LastName": 'JOHNSON6', "Vitality ID": "VS00123456", "Role": "EE", "Email Address": "no email", "Gender": "male", "Date of Birth": "9/08/1954","Effective Date":"2027-01-1"},//skip on effective date;
                        {"FirstName": 'JOHN7', "LastName": 'JOHNSON7', "Vitality ID": "VS00123457", "Role": "EE", "Email Address": "no email", "Gender": "male", "Date of Birth": "9/08/1954","Effective Date":"2022-01-1"},//valid
                        {"FirstName": 'JOHN8', "LastName": 'JOHNSON8', "Vitality ID": "VS00123457", "Role": "EE", "Email Address": "no email", "Gender": "male", "Date of Birth": "9/08/1954","Effective Date":"2022-01-1"}] //valid - Vitality ID

        let mapping = {"FirstName":"first_name","LastName":"last_name","Vitality ID":"reseller_employee_id","Role":"role","Date of Birth":{"key":"dob","transform":"date:MM/DD/YYYY"},"Effective Date":{"key": "effective_date","transform": "date:YYYYMMDD"},"Email Address":"email"};


        let elig_rules = {"productTypes":["BG","BP"],"validationFields":["first_name","last_name","dob"],"targeting":{"default":true,"minor_age": 19},"skipIfMinor": true,"spouseCheckField":"reseller_employee_id","skipIfEffectiveDate": true};
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalled();
        expect(currentEligibility).toHaveLength(0);
    });

    it('Verifies processing policy flag "duplicateRecords": "keepFirst" and keeps the first record of the duplicate records', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'Ron', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let rules = {
            "targeting":{"default":true},
            processingPolicy: {
                duplicateRecords: 'keepFirst'
            },
            spouseCheckField: "employee_id",
        };
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.last_name === 'JOHNSON';
                })
            })
        ]));
    });

    it('Verifies processing policy flag "duplicateRecords": "keepLast" and keeps the last record of the duplicate records', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'Ron', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let rules = {
            "targeting":{"default":true},
            processingPolicy: {
                duplicateRecords: 'keepLast'
            },
            spouseCheckField: "employee_id",
        };
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.last_name === 'Ron';
                })
            })
        ]));
    });

    it('Verifies processing policy flag "duplicateRecords": "keepFirst" and keeps the first record of the duplicate records 2', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT12345", "Role": "EE", "FirstName": 'Ronny', "LastName": 'Ron', "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT12399", "Role": "EE", "FirstName": 'Jonny', "LastName": 'Smith1', "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT12399", "Role": "EE", "FirstName": 'Jonny', "LastName": 'Smith2', "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let rules = {
            "targeting":{"default":true},
            processingPolicy: {
                duplicateRecords: 'keepFirst'
            },
            spouseCheckField: "employee_id",
        };
        let employer = {id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.last_name === 'JOHNSON';
                })
            }),
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.last_name === 'Smith1';
                })
            })
        ]));
    });

    it('Verifies the objects FirstName and LastName gets trimed of spaces', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT11111", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT11112", "Role": "EE", "FirstName": '  Jonny  ', "LastName": 'Smith', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT11113", "Role": "EE", "FirstName": 'Mary', "LastName": 'Smith', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"},
        ];

        let schema = {
            "type":"object",
            "properties":{"FirstName":{"type":"string","minLength":1,"transform": ["trim"]},"LastName":{"type":"string","minLength":1,"transform": ["trim"]},"Date of Birth":{"type":"string","minLength":1}},
            "required":["FirstName","LastName","Date of Birth"]};
        let employer = {id: 23, external_id: '99999', structure: schema, _validate: ajv.compile(schema), mapping_rules: mapping, eligibility_rules: elig_rules};
        let currentEligibility = [
            {"reseller_employee_id":"VT11111","role":"EE","first_name":'Ronny',"last_name":'JOHNSON',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"},
            {"reseller_employee_id":"VT11112","role":"EE","first_name":'Jonny',"last_name":'Smith',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"},
            {"reseller_employee_id":"VT11113","role":"EE","first_name":'Mary',"last_name":'Smith',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"},
        ];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.first_name === 'Jonny';
                })
            })
        ]));
    });

    it('Verifies the objects FirstName and LastName dont accept white spaces as values', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT11111", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT11112", "Role": "EE", "FirstName": 'Jonny', "LastName": 'Smith', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT11113", "Role": "EE", "FirstName": ' ', "LastName": 'Smith', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];

        let schema = {
            "type":"object",
            "properties":{"FirstName":{"type":"string","minLength":1,"transform": ["trim"]},"LastName":{"type":"string","minLength":1,"transform": ["trim"]},"Date of Birth":{"type":"string","minLength":1}},
            "required":["FirstName","LastName","Date of Birth"]};

        let employer = {id: 23, external_id: '99999', structure: schema, _validate: ajv.compile(schema), mapping_rules: mapping, eligibility_rules: elig_rules};

        let currentEligibility = [
            {"reseller_employee_id":"VT11111","role":"EE","first_name":'Ronny',"last_name":'JOHNSON',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"},
            {"reseller_employee_id":"VT11112","role":"EE","first_name":'Jonny',"last_name":'Smith',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"},
            {"reseller_employee_id":"VT11113","role":"EE","first_name":'Mary',"last_name":'Smith',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"}
        ];

        let fileLogID = 546;

        await expect(s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID)).rejects.toThrow('Error')

        expect(queue.sendBatch).toHaveBeenCalledTimes(0);


    });

    it('Verifies processing policy flag "invalidRecords": "skip" and skips validation errors of update events', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT11111", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT11112", "Role": "EE", "FirstName": 'Jonny', "LastName": 'Smith', "Date of Birth": null, "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT11113", "Role": "EE", "FirstName": 'Mary', "LastName": 'Smith', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let rules = {
            "targeting":{"default":true},
            processingPolicy: {
                invalidRecords: 'skip'
            }
        };
        let schema = {
            "type":"object",
            "properties":{"FirstName":{"type":"string","minLength":1},"LastName":{"type":"string","minLength":1},"Date of Birth":{"type":"string","minLength":1}},
            "required":["FirstName","LastName","Date of Birth"]};
        let employer = {id: 23, external_id: '99999', structure: schema, _validate: ajv.compile(schema), mapping_rules: mapping, eligibility_rules: rules};
        let currentEligibility = [
            {"reseller_employee_id":"VT11111","role":"EE","first_name":'Ronny',"last_name":'JOHNSON',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"},
            {"reseller_employee_id":"VT11112","role":"EE","first_name":'Jonny',"last_name":'Smith',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"},
            {"reseller_employee_id":"VT11113","role":"EE","first_name":'Mary',"last_name":'Smith',"dob":new Date("1984-08-09T00:00:00.000Z"),"employee_id":'123456',"email":"test@noreply.com"}
        ];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.not.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'VT11112';
                })
            })
        ]));

        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'VT11111';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'update'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'VT11113';
                })
            })
        ]));

        expect(db.reportToFileLog).toHaveBeenCalledTimes(2);
        expect(db.reportToFileLog).toHaveBeenNthCalledWith(2,'skip', 'csv-processing', expect.anything(), expect.anything(), fileLogID);
    });

    it('Verifies processing policy flag "invalidRecords": "skip" and skips validation errors of create events', async () => {
        const s3JsonLogger = require('../../../src/handlers/s3-csv-handler');
        let records = [
            {"Vitality ID": "VT11111", "Role": "EE", "FirstName": 'Ronny', "LastName": 'JOHNSON', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT11112", "Role": "EE", "FirstName": 'Jonny', "LastName": 'Smith', "Date of Birth": null, "Employee ID": '123456', "Email Address": "test@noreply.com"},
            {"Vitality ID": "VT11113", "Role": "EE", "FirstName": 'Mary', "LastName": 'Smith', "Date of Birth": "9/08/1984", "Employee ID": '123456', "Email Address": "test@noreply.com"}
        ];
        let rules = {
            "targeting":{"default":true},
            processingPolicy: {
                invalidRecords: 'skip'
            },
            spouseCheckField: "emloyee_id",
        };
        let schema = {
            "type":"object",
            "properties":{"FirstName":{"type":"string","minLength":1},"LastName":{"type":"string","minLength":1},"Date of Birth":{"type":"string","minLength":1}},
            "required":["FirstName","LastName","Date of Birth"]};
        let employer = {id: 23, external_id: '99999', structure: schema, _validate: ajv.compile(schema), mapping_rules: mapping, eligibility_rules: rules};
        let currentEligibility = [];
        let fileLogID = 546;

        await s3JsonLogger.processEligibility(records, employer, currentEligibility, fileLogID);

        expect(queue.sendBatch).toHaveBeenCalledTimes(1);
        expect(queue.sendBatch).toBeCalledWith(expect.not.arrayContaining([
            expect.objectContaining({
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'VT11112';
                })
            })
        ]));

        expect(queue.sendBatch).toBeCalledWith(expect.arrayContaining([
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'VT11111';
                })
            }),
            expect.objectContaining({
                MessageAttributes: expect.objectContaining({
                    EligibilityAction: expect.objectContaining({StringValue: 'add'})
                }),
                MessageBody: expect.toBeValid(jsonstr => {
                    const json = JSON.parse(jsonstr);
                    return json.eligibility.reseller_employee_id === 'VT11113';
                })
            })
        ]));

        expect(db.reportToFileLog).toHaveBeenCalledTimes(2);
        expect(db.reportToFileLog).toHaveBeenNthCalledWith(2,'skip', 'csv-processing', expect.anything(), expect.anything(), fileLogID);
    });

    it('getEmployeeBySpouseCheckField: Verifies processing skipping if fileRecord role is "EE" =>', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');

        const fileRecord = {
            employee_id: 'STLEN000101',
            role: 'EE',
            first_name: 'Spouse_first_name',
            last_name: 'Spouse_last_name',
            email: 'spouse_email@mydario.com',
            gender: 'F',
        }

        const resultEmployee = s3CSVHandler.getEmployeeBySpouseCheckField(fileRecord, EMPLOYER)

        expect(resultEmployee).toEqual({ eid: null })
    });

    it('getEmployeeBySpouseCheckField: Verifies processing finding employee for spouse from eligibility DB records =>', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');

        const fileRecord = {
            employee_id: 'STLEN000101',
            role: 'SP',
            first_name: 'Spouse_first_name',
            last_name: 'Spouse_last_name',
            email: 'spouse_email@mydario.com',
            gender: 'F',
        }

        const eligDbRecords = [
            {
                eid: 'faf80e82-e167-485d-87e7-fce6a7618095',
                parent_eid: 'faf80e82-e167-485d-87e7-fce6a7618095',
                employee_id: 'STLEN000101',
                role: 'EE',
                first_name: 'Employee_first_name',
                last_name: 'Employee_last_name',
                email: 'employee_email@dariohealth.com',
                gender: 'M',
            },
            {
                eid: 'faf80e82-e167-485d-87e7-fce6a7618096',
                parent_eid: 'faf80e82-e167-485d-87e7-fce6a7618096',
                employee_id: 'STLEN000213',
                role: 'EE',
                first_name: 'Any_employee_first_name',
                last_name: 'Any_employee_last_name',
                email: 'Any_employee_email@dariohealth.com',
                gender: 'M',
            },
        ]

        const resultEmployee = s3CSVHandler.getEmployeeBySpouseCheckField(fileRecord, EMPLOYER, eligDbRecords)

        expect(resultEmployee).toEqual({
            eid: 'faf80e82-e167-485d-87e7-fce6a7618095',
            parent_eid: 'faf80e82-e167-485d-87e7-fce6a7618095',
            employee_id: 'STLEN000101',
            role: 'EE',
            first_name: 'Employee_first_name',
            last_name: 'Employee_last_name',
            email: 'employee_email@dariohealth.com',
            gender: 'M',
        })
    });

    it('getEmployeeBySpouseCheckField: Verifies processing finding employee for spouse from file records =>', async () => {
        const s3CSVHandler = require('../../../src/handlers/s3-csv-handler');

        const fileRecord = {
            employee_id: 'STLEN000101',
            role: 'SP',
            first_name: 'Spouse_first_name',
            last_name: 'Spouse_last_name',
            email: 'spouse_email@mydario.com',
            gender: 'F',
        }

        const fileRecords = [
            {
                first_name: 'Testqa01',
                last_name: 'Testqa01',
                employee_id: 'STLEN000100',
                email: 'testqa+stleo01@mydario.com',
                role: 'EE',
                gender: 'F',
            },
            {
                first_name: 'Testqa02',
                last_name: 'Testqa02',
                employee_id: 'STLEN000101',
                email: 'testqa+stleo02@mydario.com',
                role: 'EE',
                gender: 'F',
            },
        ]

        const resultEmployeeWithEid = s3CSVHandler.getEmployeeBySpouseCheckField(fileRecord, EMPLOYER, null, fileRecords)
        const { eid, ...restEmployee } = resultEmployeeWithEid

        expect(typeof eid === 'string').toBe(true)
        expect(restEmployee).toEqual({
            first_name: 'Testqa02',
            last_name: 'Testqa02',
            employee_id: 'STLEN000101',
            email: 'testqa+stleo02@mydario.com',
            role: 'EE',
            gender: 'F',
        })
    });

});
