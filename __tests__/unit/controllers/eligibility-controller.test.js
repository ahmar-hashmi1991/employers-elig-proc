const db = require('../../../src/services/rds-data-service');
const braze = require('../../../src/services/braze-service');
const sforce = require('../../../src/services/salesforce-service');
const engage = require('../../../src/services/engage-service.js');
const secrets = require('../../../src/services/secrets-service');

describe('Test for <eligibility-controller>', () => {
    const OLD_ENV = process.env;

    beforeAll(() => {
        jest.mock('../../../src/handlers/api-gw-firewall-handler', () => {
            return{
                callHandleProvisioning: jest.fn().mockResolvedValue({ status: 'success' })
            }
        });

        db.updateEligibilityTrx = jest.fn().mockResolvedValue([{}]);
        db.addEligibilityLog  = jest.fn().mockResolvedValue([{}]);
        sforce.createOrUpdateEligibility = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        braze.sendUserEvent = jest.fn().mockResolvedValue({status: 'success'});
        engage.assignPatientToCoach = jest.fn().mockResolvedValue({body: {status: 'success'}});
        db.addEligibilityFlowLogTrx = jest.fn().mockResolvedValue([{}]);
        db.reportToFileLog = jest.fn().mockResolvedValue([{}]);
        secrets.getSecret = jest.fn().mockResolvedValue({ brazeUnifiedFlag: false});
        
        console.log = jest.fn();
    })

    beforeEach(() => {
        db.getEmployerAttribute = jest.fn().mockResolvedValue([{}]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });


    it('Verifies that updateAndEnableEligExternalServices updates salesforce with employer name and sub account', async () => {
        const employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active","sf_eligbility_account_ID":"a1q4w000004cCPdAAM",
            "eligibility_rules":{
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true},
                membership: {
                    clinic_meta: {
                        channel: 'MyChannel',
                        sub_channel: '$external_employer_id'
                    }
                }
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        const eligibility = {"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"1234567890","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","targeting":1,
            "external_employer_id":"1324","test_record":1, "employer_id": 31
        };
        const old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z", "test_record": 1,
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null
        };

        db.getEmployerAttribute = jest.fn().mockResolvedValue([[{value: 'my-sub-account'}]]);

        const controller = require('../../../src/controllers/eligibility-controller');
        await controller.updateAndEnableEligExternalServices(eligibility, old_eligibility, employer, 'eligible', 'new');

        expect(db.getEmployerAttribute).toHaveBeenCalled();
        expect(db.getEmployerAttribute).toBeCalledWith(employer.id, 'virtual_account', '1324');
        expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
        expect(sforce.createOrUpdateEligibility).toBeCalledWith(
            old_eligibility.sf_id,
            old_eligibility.eid, 
            eligibility.email,
            eligibility.first_name,
            eligibility.last_name,
            eligibility.dob,
            employer.sf_eligbility_account_ID,
            eligibility.phone,
            eligibility.home_phone,
            `${employer.name} - my-sub-account`,
            employer.external_id,
            'eligible',
            'new',
            eligibility.targeting,
            expect.anything(),
            eligibility.gender,
            eligibility.test_record ? true : false);
        expect(braze.sendUserEvent).toHaveBeenCalled();
    })

    it('Verifies that updateAndEnableEligExternalServices updates salesforce with employer name only', async () => {
        const employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active","sf_eligbility_account_ID":"a1q4w000004cCPdAAM",
            "eligibility_rules":{
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true},
                membership: {
                }
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        const eligibility = {"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"1234567890","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","targeting":1, "test_record":1, "employer_id": 31
        };
        const old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null, "test_record":1
        };

        db.getEmployerAttribute = jest.fn().mockResolvedValue([[{value: 'my-sub-account'}]]);

        const controller = require('../../../src/controllers/eligibility-controller');
        await controller.updateAndEnableEligExternalServices(eligibility, old_eligibility, employer, 'eligible', 'new');

        expect(db.getEmployerAttribute).toHaveBeenCalled();
        expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
        expect(sforce.createOrUpdateEligibility).toBeCalledWith(
            old_eligibility.sf_id,
            old_eligibility.eid, 
            eligibility.email,
            eligibility.first_name,
            eligibility.last_name, 
            eligibility.dob,
            employer.sf_eligbility_account_ID,
            eligibility.phone,
            eligibility.home_phone,
            `${employer.name}`,
            employer.external_id,
            'eligible',
            'new',
            eligibility.targeting,
            expect.anything(),
            eligibility.gender,
            eligibility.test_record ? true : false);
        expect(braze.sendUserEvent).toHaveBeenCalled();
    })

    it('Verifies that updateAndEnableEligExternalServices updates salesforce with employer name and sub account - hard coded value', async () => {
        const employer = {"id":9,"reseller_id":6,"external_id":"20001","client_id":null,"name":"scof_t","status":"active","sf_eligbility_account_ID":"a1q4w000004cCPdAAM",
            "eligibility_rules":{
                "validationFields":["first_name","last_name","dob","gender",["phone","email"]],
                "targeting":{"default":true},"provisioning":{"dario":true},
                membership: {
                    clinic_meta: {
                        channel: 'MyChannel',
                        sub_channel: 'MySubAccount'
                    }
                }
            },
            "record_source":null,"folder":"sco","file_name_filter":null,"insurance_claims":null,"insurance_claims_last_file":null,"ftp_info":null,"external_ftp":null,
            "ftp_password_creation_date":null,"support_phone":"516.953.1845","support_email":"benefits@sco.org","braze_stats":null,
            "created_at":"2021-09-26T11:54:13.000Z","updated_at":"2022-01-18T09:28:34.000Z","reseller_name":"SCO"
        };
        const eligibility = {"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com","phone":null,"home_phone":"1234567890","reseller_employee_id":"000-00-0190",
            "role":"EE","gender":"F","dob":"1990-01-01T00:00:00.000Z","address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","targeting":1,
            "external_employer_id":"1324", "employer_id": 31 , "test_record": 1
        };
        const old_eligibility = {"id":1831,"eid":"f97bea12-5cbf-475d-8943-0ea311ac69e7","employer_id":9,"first_name":"Doria20","last_name":"test","email":"testqa+20@mydario.com",
            "shop_email":"testqa+20@mydario.com","phone":null,"home_phone":"300825000000","shop_phone":"+16514099972","gender":"F","dob":"1990-01-01T00:00:00.000Z",
            "address_1":"21107 PITKIN AVENUE","address_2":"APT 1C","city":"BROOKLYN","state":"NY","zipcode":"11264","status":"eligible","stage":"enrolled","employee_id":"",
            "reseller_employee_id":"000-00-0190","reseller_member_id":null,"role":"EE","group_name":null,"branch":null,"pcp_id":null,"sku":null,"targeting":1,"sf_id":"0011q00000xHqilAAC",
            "braze_id":null,"dario_app_uid":null,"app_email":"testqa+20@mydario.com","generated_email":0,"flow_id":2020,"created_at":"2021-11-21T20:06:41.000Z",
            "updated_at":"2021-11-22T06:57:41.000Z","attribute_1":null,"attribute_2":null,"attribute_3":null,"attribute_4":null,"attribute_5":null,"record_source":null,"payer":null, "test_record": 1
        };

        db.getEmployerAttribute = jest.fn().mockResolvedValue([[]]);

        const controller = require('../../../src/controllers/eligibility-controller');
        await controller.updateAndEnableEligExternalServices(eligibility, old_eligibility, employer, 'eligible', 'new');

        expect(db.getEmployerAttribute).toHaveBeenCalled();
        expect(sforce.createOrUpdateEligibility).toHaveBeenCalled();
        expect(sforce.createOrUpdateEligibility).toBeCalledWith(
            old_eligibility.sf_id,
            old_eligibility.eid, 
            eligibility.email,
            eligibility.first_name,
            eligibility.last_name, 
            eligibility.dob,
            employer.sf_eligbility_account_ID,
            eligibility.phone,
            eligibility.home_phone,
            `MyChannel - MySubAccount`,
            employer.external_id,
            'eligible',
            'new',
            eligibility.targeting,
            expect.anything(),
            eligibility.gender,
            eligibility.test_record ? true : false);
        expect(braze.sendUserEvent).toHaveBeenCalled();
    })
})