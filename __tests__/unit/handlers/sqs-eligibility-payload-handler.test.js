const db = require('../../../src/services/rds-data-service');
const braze = require('../../../src/services/braze-service');
const sforce = require('../../../src/services/salesforce-service');
const shop = require('../../../src/services/shop-service');
const constants = require('../../../src/common/constants');
const engage = require('../../../src/services/engage-service.js');
const sqs = require('../../../src/services/sqs-service.js');
const AWS = require('aws-sdk-mock');
const secrets = require('../../../src/services/secrets-service');

describe('Test for <sqs-eligibility-payload-handler>', () => {
    const OLD_ENV = process.env;

    beforeAll(() => {
        jest.mock('../../../src/handlers/api-gw-firewall-handler', () => {
            return{
                callHandleProvisioning: jest.fn().mockResolvedValue({ status: 'success' })
            }
        });
        AWS.mock('S3', 'putObject', Buffer.from(require("fs").readFileSync("__tests__/s3-example/test.csv")));
        db.addEligibilityTrx = jest.fn().mockResolvedValue([[{insertId: 999}],[]]);
        db.updateEligibilityTrx = jest.fn().mockResolvedValue([{}]);
        db.addEligibilityLog  = jest.fn().mockResolvedValue([{}]);
        sforce.createOrUpdateEligibility = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        braze.sendUserEvent = jest.fn().mockResolvedValue({status: 'success'});
        engage.assignPatientToCoach = jest.fn().mockResolvedValue({body: {status: 'success'}});
        db.addEligibilityFlowLogTrx = jest.fn().mockResolvedValue([{}]);
        db.updateEligibilitySalesForceIDTrx = jest.fn().mockResolvedValue([{}]);
        db.reportToFileLog = jest.fn().mockResolvedValue([{}]);
        db.updateFileHistoryLog = jest.fn().mockResolvedValue({});
        db.getFileHistoryLog = jest.fn().mockResolvedValue([[{"id":1,"employer_id":2,"employer_upload_counter":0,"file_name":"11"}]]);
        secrets.getSecret = jest.fn().mockResolvedValue({ brazeUnifiedFlag: false});
        db.getEligibilityHistory = jest.fn().mockResolvedValue({email:'eloise.reilly57@test.soleranetwork.com', first_name:'Eloise',last_name: 'Reilly', phone:'+972527830792', dob:'1967-10-16'},'31',2);
        var error =  {id:'2',files_history_id:'651',type:'error',activity:"csv-validation",notes:"CSV invalid record data['Date of Birth'] should be string",data:'{"FirstName":"Elaine","LastName":"Benes","Employee ID":"100012","Entity ID":null,"Vitality ID":"VS10000012","Gender":"F","Date of Birth":null,"Role":null,"Branch":"TEST","Reporting Attribute 1":null,"Reporting Attribute 2":null,"Reporting Attribute 3":null,"Reporting Attribute 4":null,"Reporting Attribute 5":null,"Group Name":"Emerson","Release Consent":"Y","Member Outreach Consent":"Y","Phone Number":"0544400162","Email Address":"emerson+12@mydario.com"}'}
        var error1 =  {id:'2',files_history_id:'651',type:'error',activity:"add-eligibility",notes:"Error: Duplicate entry '99898639-46b7-4564-b619-25bba654acb4' for key 'eid_idx'",data:'{"FirstName":"Elaine","LastName":"Benes","Employee ID":"100012","Entity ID":null,"Vitality ID":"VS10000012","Gender":"F","Date of Birth":null,"Role":null,"Branch":"TEST","Reporting Attribute 1":null,"Reporting Attribute 2":null,"Reporting Attribute 3":null,"Reporting Attribute 4":null,"Reporting Attribute 5":null,"Group Name":"Emerson","Release Consent":"Y","Member Outreach Consent":"Y","Phone Number":"0544400162","Email Address":"emerson+12@mydario.com"}'}

        db.retrieveFileLogs = jest.fn().mockResolvedValue([[error,error1]]);
        db.getEmployerByID = jest.fn().mockResolvedValue([[{"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
        "eligibility_rules":{
            "update_limit":210,
            "productTypes":["BP","BG","WM"],
            "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
            "targeting":{"default":true},"provisioning":{"dario":true}
        },
        "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
        "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
        "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        }]]);

        console.log = jest.fn();
    })


    beforeEach(() => {
        db.getEmployerAttribute = jest.fn().mockResolvedValue([{}]);
        process.env = { ...OLD_ENV };
        process.env.SQS_EXTERNAL_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/139820419717/employers-elig-proc-ExternalServicesQueue-wI4D5Dpa6OKz12345.fifo'
        sqs.sendMessage = jest.fn().mockResolvedValue([{}]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // it('Verifies that Error file created and upload to AWS error folder', async () => {
    //     AWS.mock('S3', 'putObject', Buffer.from(require("fs").readFileSync("__tests__/s3-example/test.csv")));

    //     let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
    //         "eligibility_rules":{
    //             "update_limit":210,
    //             "productTypes":["BP","BG","WM"],
    //             "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
    //             "targeting":{"default":true},"provisioning":{"dario":true}
    //         },
    //         "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
    //         "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
    //         "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
    //     };
    //     let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
    //         "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
    //     };

    //     let originalRecord = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
    //     "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","TestFiled": "Test123456"
    //     };
    //     let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
    //         "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
    //         "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
    //         "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
    //         "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
    //         "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
    //     };

    //     const s3Configuration = {
    //         Bucket: "AWSmyBucketName",
    //         Key: "myFileName",
    //     };
        
    //     let body = {
    //         "eligibility": eligibility,
    //         "old_eligibility": old_eligibility,
    //         "employer": employer,
    //         "fileHistId": 640,
    //         "originalRecord": originalRecord,
    //         "stats": "stats",
    //         "s3Configuration": s3Configuration
    //     };

    //     let event = {
    //         Records: [{
    //             "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
    //             "body": JSON.stringify(body),
    //             "messageAttributes": {
    //                 "EligibilityAction": {
    //                     stringValue: "finish"
    //                 },
    //                 "RecordIndex": {
    //                     stringValue: "318"
    //                 },
    //                 "RecordCount": {
    //                     stringValue: "329"
    //                 }
    //             }
    //         }]
    //     }

    //         const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
    //         await sqsHandler.sqsPayloadHandler(event, {});

    //         AWS.restore('S3', 'putObject');
    // })

    it('Verifies that update eligibility transaction is executed - update record and write original record to history list', async () => {
        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
            "eligibility_rules":{
                "update_limit":210,
                "productTypes":["BP","BG","WM"],
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true}
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };

        let originalRecord = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
        "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","TestFiled": "Test123456"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": 640,
            "originalRecord": originalRecord
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "update"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

            const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
            await sqsHandler.sqsPayloadHandler(event, {});

            expect(db.updateEligibilityTrx).toHaveBeenCalled();
            expect(db.addEligibilityLog).toHaveBeenCalled();
    })

    it('Verifies that create eligibility transaction is executed - add record and write original record to history list', async () => {
        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
            "eligibility_rules":{
                "update_limit":210,
                "productTypes":["BP","BG","WM"],
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true}
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };

        let originalRecord = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
        "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","TestFiled": "Test123456"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": 640,
            "originalRecord": originalRecord
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "add"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

        const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
        await sqsHandler.sqsPayloadHandler(event, {});

        expect(db.addEligibilityTrx).toHaveBeenCalled();
        expect(db.addEligibilityLog).toHaveBeenCalled();
        expect(db.addEligibilityFlowLogTrx).toHaveBeenCalled();
        expect(db.updateEligibilitySalesForceIDTrx).toHaveBeenCalled();
        expect(db.updateEligibilitySalesForceIDTrx).toHaveBeenCalledWith('0011q00000b2kwIAAQ', 640, 999);

    })
    
    it('Verifies that update eligibility transaction is executed - without assign to PCP', async () => {
        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
            "eligibility_rules":{
                "update_limit":210,
                "productTypes":["BP","BG","WM"],
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true}
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": 640
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "update"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

            const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
            await sqsHandler.sqsPayloadHandler(event, {});

            expect(db.updateEligibilityTrx).toHaveBeenCalled();
            expect(db.addEligibilityLog).toHaveBeenCalled();
            // expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
            // expect(braze.sendUserEvent).toHaveBeenCalled();
            //no pcp assign
            expect(db.getEmployerAttribute).not.toHaveBeenCalled();
            expect(engage.assignPatientToCoach).not.toHaveBeenCalled();
    })

    it('Verifies that update eligibility transaction is executed - with assign to PCP (stage enrolled)', async () => {
        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
            "eligibility_rules":{
                "update_limit":210,
                "productTypes":["BP","BG","WM"],
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true}
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            pcp_id: "11111",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible",
            "stage":"enrolled",
            "employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null, pcp_id:null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": 640
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "update"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

        db.getEmployerAttribute = jest.fn().mockResolvedValue([ [{value: 'xyz'}] ]);

        const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
        await sqsHandler.sqsPayloadHandler(event, {});

        expect(db.updateEligibilityTrx).toHaveBeenCalled();
        expect(db.addEligibilityLog).toHaveBeenCalled();
        // expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
        // expect(braze.sendUserEvent).toHaveBeenCalled();
        //pcp assign called
        expect(db.getEmployerAttribute).toHaveBeenCalled();
        expect(engage.assignPatientToCoach).toHaveBeenCalled();
        expect(engage.assignPatientToCoach).toHaveBeenCalledWith('testqa+20@mydario.com', 'xyz', undefined);
    })

    it('Verifies that update eligibility transaction is executed - with assign to PCP (status enrolled)', async () => {
        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
            "eligibility_rules":{
                "update_limit":210,
                "productTypes":["BP","BG","WM"],
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true}
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            pcp_id: "11111",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"enrolled",
            "stage":"Braze flow",
            "employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null, pcp_id:null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": 640
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "update"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                },
            }]
        }

        db.getEmployerAttribute = jest.fn().mockResolvedValue([ [{value: 'xyz'}] ]);

        const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
        await sqsHandler.sqsPayloadHandler(event, {});

        expect(db.updateEligibilityTrx).toHaveBeenCalled();
        expect(db.addEligibilityLog).toHaveBeenCalled();
        // expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
        // expect(braze.sendUserEvent).toHaveBeenCalled();
        //pcp assign called
        expect(db.getEmployerAttribute).toHaveBeenCalled();
        expect(engage.assignPatientToCoach).toHaveBeenCalled();
        expect(engage.assignPatientToCoach).toHaveBeenCalledWith('testqa+20@mydario.com', 'xyz', undefined);
    })

    it('Verifies that update eligibility transaction is executed - with assign to 1st and 2nd PCP', async () => {
        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
            "eligibility_rules":{
                "update_limit":210,
                "productTypes":["BP","BG","WM"],
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true}
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            pcp_id: "11111", pcp_id_2: "22222",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible",
            "stage":"enrolled",
            "employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null, pcp_id: null, pcp_id_2: null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": 640
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "update"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

        db.getEmployerAttribute = jest.fn()
            .mockImplementationOnce(() => Promise.resolve([ [{value: 'xyz'}] ]))
            .mockImplementationOnce(() => Promise.resolve([ [{value: 'qwe'}] ]));
        //jest.fn().mockResolvedValue([ [{value: 'xyz'}] ]);

        const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
        await sqsHandler.sqsPayloadHandler(event, {});

        expect(db.updateEligibilityTrx).toHaveBeenCalled();
        expect(db.addEligibilityLog).toHaveBeenCalled();
        // expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
        // expect(braze.sendUserEvent).toHaveBeenCalled();
        //pcp assign called
        expect(db.getEmployerAttribute).toHaveBeenCalled();
        expect(engage.assignPatientToCoach).toHaveBeenCalledTimes(2);
        expect(engage.assignPatientToCoach).toHaveBeenNthCalledWith(1,'testqa+20@mydario.com', 'xyz', undefined);
        expect(engage.assignPatientToCoach).toHaveBeenNthCalledWith(2,'testqa+20@mydario.com', 'qwe', undefined);
    })

    it('Verifies that update eligibility transaction is executed - with assign to 2nd PCP only', async () => {
        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
            "eligibility_rules":{
                "update_limit":210,
                "productTypes":["BP","BG","WM"],
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true}
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            pcp_id: "11111", pcp_id_2: "22222",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible",
            "stage":"enrolled",
            "employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null, pcp_id: "11111", pcp_id_2: null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": 640
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "update"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

        db.getEmployerAttribute = jest.fn()
            .mockImplementationOnce(() => Promise.resolve([ [{value: 'xyz'}] ]))
            .mockImplementationOnce(() => Promise.resolve([ [{value: 'qwe'}] ]));
        //jest.fn().mockResolvedValue([ [{value: 'xyz'}] ]);

        const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
        await sqsHandler.sqsPayloadHandler(event, {});

        expect(db.updateEligibilityTrx).toHaveBeenCalled();
        expect(db.addEligibilityLog).toHaveBeenCalled();
        // expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
        // expect(braze.sendUserEvent).toHaveBeenCalled();
        //pcp assign called
        expect(db.getEmployerAttribute).toHaveBeenCalled();
        expect(engage.assignPatientToCoach).toHaveBeenCalledTimes(1);
        expect(engage.assignPatientToCoach).toHaveBeenNthCalledWith(1,'testqa+20@mydario.com', 'xyz', undefined);
    })

    it('Verifies that update eligibility transaction is executed - sending DOB and Role to Braze', async () => {
        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
            "eligibility_rules":{
                "update_limit":210,
                "productTypes":["BP","BG","WM"],
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true}
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        let eligibility = {"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":null,
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": 640
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "update"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

            const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
            await sqsHandler.sqsPayloadHandler(event, {});

            expect(db.updateEligibilityTrx).toHaveBeenCalled();
            expect(db.addEligibilityLog).toHaveBeenCalled();
            // expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
            // expect(braze.sendUserEvent).toHaveBeenCalledWith('testqa+20@mydario.com', expect.anything(), {}, expect.objectContaining({
            //     dob: '1990-01-01T00:00:00.000Z', 
            //     b2b_role: 'EE'
            // }));
            //no pcp assign
            expect(db.getEmployerAttribute).not.toHaveBeenCalled();
            expect(engage.assignPatientToCoach).not.toHaveBeenCalled();
    })

    it('Verifies that update eligibility stage to grace is executed', async () => {

        const eligibility_id = 54321
        const fileHistId = 640
        const grace = 30
        const date = new Date(); 
        date.setDate(date.getDate() + grace);
        const grace_period_date = date.toISOString().split('T')[0];

        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
        "eligibility_rules": JSON.stringify({
            "grace": grace,
            "update_limit":210,
            "productTypes":["BP","BG","WM"],
            "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
            "targeting":{"default":true},"provisioning":{"dario":true}
        }),
        "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
        "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
        "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        db.getEmployerByID = jest.fn().mockResolvedValue([[{...employer}]]);
        // db.getEmployerByID().then(data => console.log(">>> res", data))
        
        db.updateEligibilityStageTrx = jest.fn()
        db.updateEligibilityGracePeriodTrx = jest.fn()

        let eligibility = {"id": eligibility_id, "first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","employer_id": 9,"address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":null,
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": fileHistId
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "grace"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

        const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
        await sqsHandler.sqsPayloadHandler(event, {});

        expect(db.updateEligibilityStageTrx).toHaveBeenCalled();
        expect(db.updateEligibilityStageTrx).toHaveBeenCalledWith(constants.EligibilityStage.GRACE_STARTED, fileHistId, eligibility_id)
        expect(db.updateEligibilityGracePeriodTrx).toHaveBeenCalled();
        expect(db.updateEligibilityGracePeriodTrx).toHaveBeenCalledWith(grace_period_date, fileHistId, eligibility_id)
        expect(db.addEligibilityFlowLogTrx).toHaveBeenCalledWith(eligibility_id, 9700, `adding eligibility a grace period ${fileHistId}`);

    })

    it('Verifies that update eligibility stage to unGrace is executed', async () => {

        const eligibility_id = 54321
        const fileHistId = 640
        const grace = 30

        let employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active",
        "eligibility_rules": JSON.stringify({
            "grace": grace,
            "update_limit":210,
            "productTypes":["BP","BG","WM"],
            "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
            "targeting":{"default":true},"provisioning":{"dario":true}
        }),
        "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
        "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
        "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        db.getEmployerByID = jest.fn().mockResolvedValue([[{...employer}]]);
        // db.getEmployerByID().then(data => console.log(">>> res", data))
        
        db.updateEligibilityStageTrx = jest.fn()
        db.updateEligibilityGracePeriodTrx = jest.fn()

        let eligibility = {"id": eligibility_id, "first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"3.00825E+11","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","employer_id": 9,"address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264"
        };
        let old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":null,
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };
        
        let body = {
            "eligibility": eligibility,
            "old_eligibility": old_eligibility,
            "employer": employer,
            "fileHistId": fileHistId
        };

        let event = {
            Records: [{
                "messageId": "79876f15-8e45-4187-802d-ecb199a31ced",
                "body": JSON.stringify(body),
                "messageAttributes": {
                    "EligibilityAction": {
                        stringValue: "ungrace"
                    },
                    "RecordIndex": {
                        stringValue: "318"
                    },
                    "RecordCount": {
                        stringValue: "329"
                    }
                }
            }]
        }

        const sqsHandler = require('../../../src/handlers/sqs-eligibility-payload-handler');
        await sqsHandler.sqsPayloadHandler(event, {});

        expect(db.updateEligibilityStageTrx).toHaveBeenCalled();
        expect(db.updateEligibilityStageTrx).toHaveBeenCalledWith(constants.EligibilityStage.GRACE_REMOVED, fileHistId, eligibility_id)
        expect(db.updateEligibilityGracePeriodTrx).toHaveBeenCalled();
        expect(db.updateEligibilityGracePeriodTrx).toHaveBeenCalledWith(null, fileHistId, eligibility_id)
        expect(db.addEligibilityFlowLogTrx).toHaveBeenCalledWith(eligibility_id, 9700, `remove eligibility a grace period ${fileHistId}`);

    })

})